// ─────────────────────────────────────────────────────────────────────────
// One self-contained script whose job is keeping the database in sync with
// the live API - for every game, not just ones with an active streak - and,
// once a game finishes, detecting which teams' streaks are now new/continued/
// broken and recording those to a JSON file (later: sent to another server;
// for now, written locally so the data to be sent can be inspected).
// Toggled from server.js like every other pipeline (commented out by
// default). Fully self-contained - does not import from or coordinate with
// any other watcher/pipeline script.
//
// Flow (every SCAN_INTERVAL_MS):
//   1. Resync stale matches first - any match still "NS" whose kickoff
//      already passed unnoticed (server was off, missed a restart, etc)
//      gets caught up immediately, before anything else runs, so a gap in
//      uptime never permanently loses a match's data.
//   2. Re-check any postponed (PST) match directly against the API - if it
//      now has a real NS date, update the DB so it's picked up by step 3
//      below in the same pass.
//   3. Find every match kicking off in the next 24h and, for any that
//      doesn't already have one, schedule 5 checks after its kickoff time
//      (SCHEDULE_OFFSETS_MIN: 0/25/50/75/115 min) - covering kickoff, two
//      mid-match points, the regular full-time mark, and a final safety
//      check well past 90+stoppage to catch extra time/penalties too.
//   4. Each check asks the live API about that one fixture:
//        - Finished -> run the full sync (match result, every market's
//          stats, season averages/standings, league streaks, odds), then
//          diff that team's streak state before/after to detect new/
//          continued/broken markets and upsert them into the JSON file.
//        - Still live/in-progress -> just update status + the live score,
//          nothing heavier (averages/streaks only make sense once final).
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { prisma, connectDB } = require('./src/utils/prisma');
const { generateSeasonAverages, generateStandings } = require('./pop-db');
const { calculateLeagueStreaks } = require('./streak-tracker');
const { syncTargetedOdds } = require('./odds-pipeline');
const { SLUG_MAP } = require('./src/services/teams.service');

const API_KEY = '6dea7d814258faa2db4f3051b6cfc065';
const BASE_URL = 'https://v3.football.api-sports.io';
const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];

// Covers kickoff, two mid-match points, the regular full-time mark, and a
// final +115min safety check for matches still going (extra time, penalties,
// a delayed kickoff) at the 75min mark.
const SCHEDULE_OFFSETS_MIN = [0, 25, 50, 75, 115];
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// How far back to look for "stale" NS matches - ones whose kickoff already
// passed without ever being checked (server was off, a restart happened
// mid-window, etc). Bounded so a tick doesn't go hammering the API for
// genuinely ancient/broken rows - a week comfortably covers "forgot to keep
// the server on over the weekend."
const STALE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const OUTPUT_FILE = path.join(__dirname, 'data', 'tracked-streaks.json');

// matchId -> true once its checks are scheduled, so a re-scan within the
// same 24h window never double-schedules the same match. In-memory only.
const scheduledMatchIds = new Set();

// ─────────────────────────────────────────────────────────────────────────
// Shared lookup tables (same derivations streaks.service.js / render_stats.js /
// the React client's markets.js each keep their own small local copy of -
// small enough that importing from any of those would pull in unrelated
// machinery just for these few lines).
// ─────────────────────────────────────────────────────────────────────────
const CANONICAL_TO_RAW = {};
for (const [rawSlug, canonicalSlug] of Object.entries(SLUG_MAP)) {
    if (!CANONICAL_TO_RAW[canonicalSlug]) CANONICAL_TO_RAW[canonicalSlug] = {};
    if (rawSlug.includes('away')) {
        CANONICAL_TO_RAW[canonicalSlug].away = rawSlug;
    } else if (rawSlug.includes('home')) {
        CANONICAL_TO_RAW[canonicalSlug].home = rawSlug;
    } else {
        CANONICAL_TO_RAW[canonicalSlug].home = rawSlug;
        CANONICAL_TO_RAW[canonicalSlug].away = rawSlug;
    }
}

const BINARY_MARKET_OUTCOMES = {
    oddeven: { positive: 'odd', negative: 'even' },
    'both-teams-score': { positive: 'yes', negative: 'no' }
};

const STAT_MARKET_SLUGS = [
    'team-goals', 'total-goals', 'team-yellow-cards', 'total-yellow-cards',
    'team-red-cards', 'total-red-cards', 'team-corner-kicks', 'total-corner-kicks',
    'total-goals-1st-half', 'total-goals-2nd-half', 'team-goals-conceded',
    'team-goals-1st-half', 'team-goals-2nd-half', 'team-possession', 'team-shots',
    'team-clean-sheets', 'oddeven', 'both-teams-score'
];

const STREAK_ELIGIBLE_MARKET_SLUGS = [
    'team-goals', 'total-goals', 'team-yellow-cards', 'total-yellow-cards',
    'team-red-cards', 'total-red-cards', 'team-corner-kicks', 'total-corner-kicks',
    'total-goals-1st-half', 'total-goals-2nd-half', 'oddeven', 'both-teams-score'
];

// ─────────────────────────────────────────────────────────────────────────
// JSON output helpers
// ─────────────────────────────────────────────────────────────────────────
function readTrackedStreaks() {
    try {
        return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch {
        return {};
    }
}

// Read-modify-write, synchronous - calls here are spaced by match events,
// never a request hot path, so blocking briefly avoids a torn file from
// overlapping writes.
function upsertTrackedStreaks(entries) {
    if (entries.length === 0) return;
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    const current = readTrackedStreaks();
    for (const entry of entries) {
        current[`streak_${entry.streak_id}`] = entry;
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(current, null, 2));
    console.log(`[streak-sync-scheduler] Wrote ${entries.length} streak change(s) to ${OUTPUT_FILE}.`);
}

// ─────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────
async function fetchSingleFixture(idApi) {
    const response = await axios.get(`${BASE_URL}/fixtures`, {
        headers: { 'x-apisports-key': API_KEY },
        params: { id: idApi }
    });
    return response.data.response?.[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// Match/stat sync (same logic that used to live in match-status-watcher.js -
// folded in here directly since this script no longer depends on that file)
// ─────────────────────────────────────────────────────────────────────────
async function upsertMatchStat(tx, matchId, teamId, marketId, value, side) {
    await tx.matchTeamStat.upsert({
        where: { match_id_team_id_market_id: { match_id: matchId, team_id: teamId, market_id: marketId } },
        update: { value, side },
        create: { match_id: matchId, team_id: teamId, market_id: marketId, value, side }
    });
}

// Every canonical market's home/away value for one finished fixture, computed
// once and shared by both the MatchTeamStat upsert and the streak-result
// grading below, so the two can never disagree about what "actually happened."
function computeMarketValues(apiFixture) {
    const homeStatsArray = apiFixture.statistics?.find(s => s.team.id === apiFixture.teams.home.id)?.statistics || [];
    const awayStatsArray = apiFixture.statistics?.find(s => s.team.id === apiFixture.teams.away.id)?.statistics || [];
    const getRawStatValue = (statsArray, typeString) => {
        const found = statsArray.find(s => s.type === typeString);
        return found ? (parseInt(found.value) || 0) : 0;
    };

    const homeGoals = apiFixture.goals.home ?? 0;
    const awayGoals = apiFixture.goals.away ?? 0;
    const homeGoalsHT = apiFixture.score?.halftime?.home ?? 0;
    const awayGoalsHT = apiFixture.score?.halftime?.away ?? 0;
    const homeGoals2H = homeGoals - homeGoalsHT;
    const awayGoals2H = awayGoals - awayGoalsHT;
    const homeYellows = getRawStatValue(homeStatsArray, 'Yellow Cards');
    const awayYellows = getRawStatValue(awayStatsArray, 'Yellow Cards');
    const homeReds = getRawStatValue(homeStatsArray, 'Red Cards');
    const awayReds = getRawStatValue(awayStatsArray, 'Red Cards');
    const homeCorners = getRawStatValue(homeStatsArray, 'Corner Kicks');
    const awayCorners = getRawStatValue(awayStatsArray, 'Corner Kicks');
    const homePossession = getRawStatValue(homeStatsArray, 'Ball Possession');
    const awayPossession = getRawStatValue(awayStatsArray, 'Ball Possession');
    const homeShots = getRawStatValue(homeStatsArray, 'Total Shots');
    const awayShots = getRawStatValue(awayStatsArray, 'Total Shots');
    const isOdd = (homeGoals + awayGoals) % 2 === 1 ? 1 : 0;
    const btts = (homeGoals > 0 && awayGoals > 0) ? 1 : 0;

    return {
        'team-goals': { home: homeGoals, away: awayGoals },
        'total-goals': { home: homeGoals + awayGoals, away: homeGoals + awayGoals },
        'team-yellow-cards': { home: homeYellows, away: awayYellows },
        'total-yellow-cards': { home: homeYellows + awayYellows, away: homeYellows + awayYellows },
        'team-red-cards': { home: homeReds, away: awayReds },
        'total-red-cards': { home: homeReds + awayReds, away: homeReds + awayReds },
        'team-corner-kicks': { home: homeCorners, away: awayCorners },
        'total-corner-kicks': { home: homeCorners + awayCorners, away: homeCorners + awayCorners },
        'total-goals-1st-half': { home: homeGoalsHT + awayGoalsHT, away: homeGoalsHT + awayGoalsHT },
        'total-goals-2nd-half': { home: homeGoals2H + awayGoals2H, away: homeGoals2H + awayGoals2H },
        'team-goals-conceded': { home: awayGoals, away: homeGoals },
        'team-goals-1st-half': { home: homeGoalsHT, away: awayGoalsHT },
        'team-goals-2nd-half': { home: homeGoals2H, away: awayGoals2H },
        'team-possession': { home: homePossession, away: awayPossession },
        'team-shots': { home: homeShots, away: awayShots },
        'team-clean-sheets': { home: awayGoals === 0 ? 1 : 0, away: homeGoals === 0 ? 1 : 0 },
        oddeven: { home: isOdd, away: isOdd },
        'both-teams-score': { home: btts, away: btts }
    };
}

async function upsertStatsForFinishedFixture(tx, marketValues, matchId, homeTeam, awayTeam) {
    const dbMarkets = await tx.market.findMany({ where: { slug: { in: STAT_MARKET_SLUGS } } });
    for (const market of dbMarkets) {
        const values = marketValues[market.slug];
        if (!values) continue;
        await upsertMatchStat(tx, matchId, homeTeam.id, market.id, values.home, 'home');
        await upsertMatchStat(tx, matchId, awayTeam.id, market.id, values.away, 'away');
    }
}

// Grades every (team, market) streak that was >=3 long going into this match
// (i.e. was actually eligible to be shown as an upcoming prediction) against
// what actually happened. Must run before calculateLeagueStreaks recomputes
// TeamStreak for this same team/season - that's exactly the state this reads,
// so it has to happen first, or there'd be nothing left to grade against.
async function captureStreakResults(apiFixture, dbMatch, homeTeam, awayTeam, marketValues) {
    const sides = [
        { team: homeTeam, isHome: true },
        { team: awayTeam, isHome: false }
    ];

    const [homeStreaks, awayStreaks, avgRows, rawMarkets, matchOdds] = await Promise.all([
        prisma.teamStreak.findMany({ where: { team_id: homeTeam.id, season_id: dbMatch.season_id, streak_length: { gte: 3 } }, include: { market: true } }),
        prisma.teamStreak.findMany({ where: { team_id: awayTeam.id, season_id: dbMatch.season_id, streak_length: { gte: 3 } }, include: { market: true } }),
        prisma.teamSeasonAverage.findMany({ where: { season_id: dbMatch.season_id, team_id: { in: [homeTeam.id, awayTeam.id] } } }),
        prisma.market.findMany({ where: { slug: { in: Object.keys(SLUG_MAP) } } }),
        prisma.matchOdds.findMany({ where: { match_id: dbMatch.id }, include: { bookmaker: true } })
    ]);

    const avgMap = new Map(avgRows.map(r => [`${r.team_id}-${r.market_id}`, Number(r.avg_value)]));
    const rawMarketBySlug = new Map(rawMarkets.map(m => [m.slug, m.id]));
    const streaksBySide = { home: homeStreaks, away: awayStreaks };

    const records = [];
    for (const { team, isHome } of sides) {
        const side = isHome ? 'home' : 'away';
        for (const ts of streaksBySide[side]) {
            const slug = ts.market.slug;
            const actualValue = marketValues[slug]?.[side];
            if (actualValue === undefined) continue;

            const avgValue = avgMap.get(`${team.id}-${ts.market_id}`) ?? 0;
            const threshold = (avgValue % 1 === 0) ? avgValue : Math.floor(avgValue) + 0.5;
            const direction = ts.streak_direction === 'below' ? 'over' : 'under';
            const binary = BINARY_MARKET_OUTCOMES[slug];

            let predictedOutcome = null;
            let result;
            if (binary) {
                predictedOutcome = ts.streak_direction === 'below' ? binary.positive : binary.negative;
                const actualOutcome = actualValue === 1 ? binary.positive : binary.negative;
                result = actualOutcome === predictedOutcome ? 'hit' : 'miss';
            } else {
                result = direction === 'over' ? (actualValue > threshold ? 'hit' : 'miss') : (actualValue < threshold ? 'hit' : 'miss');
            }

            const rawSlug = CANONICAL_TO_RAW[slug]?.[side];
            const rawMarketId = rawSlug ? rawMarketBySlug.get(rawSlug) : null;
            const selectionSlug = binary ? predictedOutcome : `${direction}-${threshold}`;
            const oddRow = rawMarketId
                ? matchOdds.filter(o => o.market_id === rawMarketId && o.slug === selectionSlug).sort((a, b) => Number(b.odd) - Number(a.odd))[0]
                : null;

            records.push({
                match_id: dbMatch.id,
                team_id: team.id,
                market_id: ts.market_id,
                streak_count: ts.streak_length,
                confidence: ts.confidence,
                direction,
                threshold: binary ? null : threshold,
                predicted_outcome: predictedOutcome,
                avg_value: avgValue,
                odds_value: oddRow ? Number(oddRow.odd) : null,
                odds_bookmaker: oddRow?.bookmaker?.name ?? null,
                actual_value: actualValue,
                result
            });
        }
    }

    if (records.length > 0) {
        await prisma.streakResult.createMany({ data: records });
        console.log(`[streak-sync-scheduler] Recorded ${records.length} StreakResult row(s) for API ${apiFixture.fixture.id}.`);
    }
}

// Match result + every market's MatchTeamStat, in one transaction. The axios
// call already happened before this is called, so the transaction only ever
// wraps DB writes, never a network call.
async function updateMatchAndStats(apiFixture, dbMatch, homeTeam, awayTeam) {
    const currentStatus = apiFixture.fixture.status.short;

    let winnerTeamId = null;
    if (apiFixture.goals.home > apiFixture.goals.away) {
        winnerTeamId = homeTeam.id;
    } else if (apiFixture.goals.away > apiFixture.goals.home) {
        winnerTeamId = awayTeam.id;
    } else if (currentStatus === 'PEN' && apiFixture.score?.penalty) {
        const penHome = apiFixture.score.penalty.home;
        const penAway = apiFixture.score.penalty.away;
        if (penHome > penAway) winnerTeamId = homeTeam.id;
        if (penAway > penHome) winnerTeamId = awayTeam.id;
    }

    const marketValues = computeMarketValues(apiFixture);

    await prisma.$transaction(async (tx) => {
        await tx.match.update({
            where: { id: dbMatch.id },
            data: {
                home_score: apiFixture.goals.home,
                away_score: apiFixture.goals.away,
                status: currentStatus,
                winner_team_id: winnerTeamId
            }
        });
        await upsertStatsForFinishedFixture(tx, marketValues, dbMatch.id, homeTeam, awayTeam);
    }, { timeout: 30000 });

    return marketValues;
}

// ─────────────────────────────────────────────────────────────────────────
// Streak snapshot / diff / JSON record building
// ─────────────────────────────────────────────────────────────────────────
async function snapshotTeamStreaks(teamIds, seasonId) {
    const rows = await prisma.teamStreak.findMany({
        where: { team_id: { in: teamIds }, season_id: seasonId },
        include: { market: true }
    });
    const map = new Map();
    for (const row of rows) {
        map.set(`${row.team_id}-${row.market_id}`, { id: row.id, streak_length: row.streak_length });
    }
    return map;
}

async function buildActiveStreakRecord(teamStreakId, team, marketSlug, marketName, status) {
    const teamStreak = await prisma.teamStreak.findUnique({ where: { id: teamStreakId } });
    if (!teamStreak) return null;

    const nextMatch = await prisma.match.findFirst({
        where: {
            season_id: teamStreak.season_id,
            status: { notIn: FINISHED_STATUSES },
            OR: [{ home_team_id: team.id }, { away_team_id: team.id }]
        },
        orderBy: { kickoff_at: 'asc' },
        include: { homeTeam: true, awayTeam: true, season: { include: { league: true } } }
    });

    const avgRow = await prisma.teamSeasonAverage.findFirst({
        where: { team_id: team.id, season_id: teamStreak.season_id, market_id: teamStreak.market_id }
    });
    const avgValue = avgRow ? Number(avgRow.avg_value) : 0;
    const threshold = (avgValue % 1 === 0) ? avgValue : Math.floor(avgValue) + 0.5;
    const direction = teamStreak.streak_direction === 'below' ? 'over' : 'under';
    const binary = BINARY_MARKET_OUTCOMES[marketSlug];
    const suggestedOutcome = binary ? (teamStreak.streak_direction === 'below' ? binary.positive : binary.negative) : null;

    let recommendedOdd = null;
    if (nextMatch) {
        const isHome = nextMatch.home_team_id === team.id;
        const rawSlug = CANONICAL_TO_RAW[marketSlug]?.[isHome ? 'home' : 'away'];
        if (rawSlug) {
            const rawMarket = await prisma.market.findUnique({ where: { slug: rawSlug } });
            if (rawMarket) {
                const matchOdds = await prisma.matchOdds.findMany({ where: { match_id: nextMatch.id }, include: { bookmaker: true } });
                const selectionSlug = binary ? suggestedOutcome : `${direction}-${threshold}`;
                const matches = matchOdds.filter(o => o.market_id === rawMarket.id && o.slug === selectionSlug);
                matches.sort((a, b) => Number(b.odd) - Number(a.odd));
                if (matches[0]) recommendedOdd = { value: Number(matches[0].odd), bookmaker: matches[0].bookmaker?.name ?? null };
            }
        }
    }

    return {
        streak_id: teamStreak.id,
        status, // 'new' | 'continued'
        team: team.name,
        market: marketName,
        streak_count: teamStreak.streak_length,
        confidence: teamStreak.confidence != null ? Number(teamStreak.confidence) : null,
        direction: binary ? null : direction,
        threshold: binary ? null : threshold,
        suggested_outcome: suggestedOutcome,
        avg_value: avgValue,
        next_match: nextMatch ? {
            id_api: nextMatch.id_api,
            kickoff_at: nextMatch.kickoff_at,
            home: nextMatch.homeTeam.name,
            away: nextMatch.awayTeam.name,
            league: nextMatch.season.league.name
        } : null,
        odds: recommendedOdd,
        updated_at: new Date().toISOString()
    };
}

function buildBrokenStreakRecord(teamStreakId, team, marketName, newStreakLength) {
    return {
        streak_id: teamStreakId,
        status: 'broken',
        team: team.name,
        market: marketName,
        streak_count: newStreakLength,
        updated_at: new Date().toISOString()
    };
}

// ─────────────────────────────────────────────────────────────────────────
// The full sync for one or more confirmed-finished matches: match+stats,
// averages/standings, league streaks, odds - then diff each match's streak
// state before/after to find new/continued/broken markets and write them to
// the JSON file. Takes a BATCH so that when several matches share a league
// and season (a full matchday, or catching up a backlog after downtime),
// the expensive per-league/season steps - averages, standings, streak
// recalculation, and especially the odds sync (a multi-page API call per
// league) - run ONCE for the whole batch instead of once per match.
// ─────────────────────────────────────────────────────────────────────────
async function processFinishedFixturesBatch(items) {
    if (items.length === 0) return;
    console.log(`[streak-sync-scheduler] Batch-processing ${items.length} finished match(es)...`);

    const synced = [];
    for (const { apiFixture, dbMatch } of items) {
        const homeTeam = dbMatch.homeTeam;
        const awayTeam = dbMatch.awayTeam;
        const teamIds = [dbMatch.home_team_id, dbMatch.away_team_id];
        const matchLabel = `${homeTeam.name} vs ${awayTeam.name} (API ${apiFixture.fixture.id})`;

        console.log(`[streak-sync-scheduler] ${matchLabel} is finished (${apiFixture.fixture.status.short}, ${apiFixture.goals.home}-${apiFixture.goals.away}).`);

        const before = await snapshotTeamStreaks(teamIds, dbMatch.season_id);

        console.log(`[streak-sync-scheduler] ${matchLabel} - writing final score + stats for all ${STAT_MARKET_SLUGS.length} markets...`);
        const marketValues = await updateMatchAndStats(apiFixture, dbMatch, homeTeam, awayTeam);

        // Grading past predictions is a nice-to-have, not something that
        // should ever block the rest of the sync if it fails.
        console.log(`[streak-sync-scheduler] ${matchLabel} - grading past streak predictions...`);
        try {
            await captureStreakResults(apiFixture, dbMatch, homeTeam, awayTeam, marketValues);
        } catch (error) {
            console.error(`[streak-sync-scheduler] Failed to capture streak results for ${matchLabel}:`, error.message);
        }

        synced.push({ dbMatch, homeTeam, awayTeam, teamIds, before, matchLabel });
    }

    const seasonIds = [...new Set(items.map(i => i.dbMatch.season_id))];
    console.log(`[streak-sync-scheduler] Recomputing season averages + standings for ${seasonIds.length} season(s)...`);
    for (const seasonId of seasonIds) {
        await prisma.$transaction(async (tx) => {
            await generateSeasonAverages(tx, seasonId);
            await generateStandings(tx, seasonId);
        }, { timeout: 30000 });
    }

    const leagueSeasonPairs = new Map();
    for (const { dbMatch } of items) {
        const key = `${dbMatch.season.league.id_api}-${dbMatch.season.year}`;
        if (!leagueSeasonPairs.has(key)) {
            leagueSeasonPairs.set(key, { leagueApiId: dbMatch.season.league.id_api, seasonYear: dbMatch.season.year });
        }
    }
    console.log(`[streak-sync-scheduler] Recalculating league streaks for ${leagueSeasonPairs.size} league/season pair(s)...`);
    for (const { leagueApiId, seasonYear } of leagueSeasonPairs.values()) {
        await calculateLeagueStreaks(leagueApiId, seasonYear);
    }

    console.log(`[streak-sync-scheduler] Syncing odds for ${leagueSeasonPairs.size} league/season pair(s) in one pass...`);
    try {
        await syncTargetedOdds([...leagueSeasonPairs.values()].map(p => [p.leagueApiId, p.seasonYear]));
    } catch (error) {
        console.error(`[streak-sync-scheduler] Batched odds sync failed:`, error.message);
    }

    const markets = await prisma.market.findMany({ where: { slug: { in: STREAK_ELIGIBLE_MARKET_SLUGS } } });
    const allEntries = [];
    for (const { dbMatch, homeTeam, awayTeam, teamIds, before, matchLabel } of synced) {
        const after = await snapshotTeamStreaks(teamIds, dbMatch.season_id);
        const teamsById = { [dbMatch.home_team_id]: homeTeam, [dbMatch.away_team_id]: awayTeam };

        let matchEntryCount = 0;
        for (const teamId of teamIds) {
            for (const market of markets) {
                const key = `${teamId}-${market.id}`;
                const beforeState = before.get(key);
                const afterState = after.get(key);
                const wasActive = beforeState && beforeState.streak_length >= 3;
                const isActive = afterState && afterState.streak_length >= 3;

                try {
                    if (!wasActive && isActive) {
                        allEntries.push(await buildActiveStreakRecord(afterState.id, teamsById[teamId], market.slug, market.name, 'new'));
                        matchEntryCount++;
                    } else if (wasActive && isActive) {
                        allEntries.push(await buildActiveStreakRecord(afterState.id, teamsById[teamId], market.slug, market.name, 'continued'));
                        matchEntryCount++;
                    } else if (wasActive && !isActive) {
                        allEntries.push(buildBrokenStreakRecord(beforeState.id, teamsById[teamId], market.name, afterState ? afterState.streak_length : 0));
                        matchEntryCount++;
                    }
                    // neither before nor after active -> nothing changed, nothing to report
                } catch (error) {
                    console.error(`[streak-sync-scheduler] Failed to build record for team ${teamId} / ${market.slug}:`, error.message);
                }
            }
        }
        console.log(`[streak-sync-scheduler] ${matchLabel} synced - ${matchEntryCount} streak change(s).`);
    }

    upsertTrackedStreaks(allEntries.filter(Boolean));
    console.log(`[streak-sync-scheduler] Batch done - ${items.length} match(es) synced, ${allEntries.length} total streak change(s).`);
}

// Convenience wrapper for syncing exactly one match immediately (used by
// direct/manual calls) - just a batch of one.
async function syncFinishedMatch(apiFixture, dbMatch) {
    return processFinishedFixturesBatch([{ apiFixture, dbMatch }]);
}

// ─────────────────────────────────────────────────────────────────────────
// Debounced batching for the live per-match timer flow. Matches in the same
// league very often share a kickoff time, so their "just turned finished"
// checks tend to land within moments of each other too - instead of syncing
// each one the instant it's detected, queue it and reset a short timer on
// every new arrival, so the batch only flushes once arrivals stop (whether
// that's one match alone, or a whole matchday's worth). This is also what
// resyncStaleMatches relies on to collapse a downtime backlog into as few
// league/season recalculations as possible.
// ─────────────────────────────────────────────────────────────────────────
const FINISH_BATCH_DEBOUNCE_MS = 5000;
const pendingFinishedFixtures = [];
let finishBatchFlushTimer = null;

function enqueueFinishedFixture(apiFixture, dbMatch) {
    if (pendingFinishedFixtures.some(item => item.dbMatch.id === dbMatch.id)) return;
    pendingFinishedFixtures.push({ apiFixture, dbMatch });
    if (finishBatchFlushTimer) clearTimeout(finishBatchFlushTimer);
    finishBatchFlushTimer = setTimeout(flushFinishedFixtureQueue, FINISH_BATCH_DEBOUNCE_MS);
}

async function flushFinishedFixtureQueue() {
    finishBatchFlushTimer = null;
    if (pendingFinishedFixtures.length === 0) return;
    const batch = pendingFinishedFixtures.splice(0, pendingFinishedFixtures.length);
    try {
        await processFinishedFixturesBatch(batch);
    } catch (error) {
        console.error('[streak-sync-scheduler] Batch flush failed:', error.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────────────────

// One scheduled check for one match: ask the live API about this single
// fixture.
//   - Finished (any check, not just the last) -> run the full sync, once -
//     the FINISHED_STATUSES guard below makes any later check for this
//     match a no-op.
//   - Still live -> update just status + the live score in Match, so the
//     admin panel reflects what's actually happening mid-game; averages/
//     standings/streaks only get (re)computed once there's a final score.
//   - Still not finished on the last scheduled check -> log a warning
//     (extra time/penalties or an unusually delayed match can outlast this
//     5-check schedule).
async function checkAndProcessMatch(matchId, offsetMin, isLastCheck) {
    const checkLabel = offsetMin === null ? 'immediate stale-resync' : `+${offsetMin}min`;
    console.log(`[streak-sync-scheduler] Running ${checkLabel} check for match ${matchId}...`);

    const dbMatch = await prisma.match.findUnique({
        where: { id: matchId },
        include: { homeTeam: true, awayTeam: true, season: { include: { league: true } } }
    });
    if (!dbMatch) {
        console.warn(`[streak-sync-scheduler] Match ${matchId} no longer exists in the DB, skipping check.`);
        return;
    }
    const matchLabel = `${dbMatch.homeTeam.name} vs ${dbMatch.awayTeam.name} (API ${dbMatch.id_api})`;
    if (FINISHED_STATUSES.includes(dbMatch.status)) {
        console.log(`[streak-sync-scheduler] ${matchLabel} already finished (synced by an earlier check), skipping.`);
        return;
    }

    let apiFixture;
    try {
        apiFixture = await fetchSingleFixture(dbMatch.id_api);
    } catch (error) {
        console.error(`[streak-sync-scheduler] API lookup failed for ${dbMatch.id_api}:`, error.message);
        return;
    }
    if (!apiFixture) {
        console.warn(`[streak-sync-scheduler] API returned no fixture for ${dbMatch.id_api}.`);
        return;
    }

    const newStatus = apiFixture.fixture.status.short;

    if (FINISHED_STATUSES.includes(newStatus)) {
        console.log(`[streak-sync-scheduler] ${matchLabel} is finished (${newStatus}, ${apiFixture.goals.home}-${apiFixture.goals.away}) - queued for batched sync.`);
        enqueueFinishedFixture(apiFixture, dbMatch);
        return { finished: true };
    }

    if (newStatus !== dbMatch.status || apiFixture.goals.home !== dbMatch.home_score || apiFixture.goals.away !== dbMatch.away_score) {
        await prisma.match.update({
            where: { id: matchId },
            data: { status: newStatus, home_score: apiFixture.goals.home, away_score: apiFixture.goals.away }
        });
        console.log(`[streak-sync-scheduler] ${matchLabel} -> ${newStatus} (${apiFixture.goals.home}-${apiFixture.goals.away}).`);
    } else {
        console.log(`[streak-sync-scheduler] ${matchLabel} - no change (still "${newStatus}", ${apiFixture.goals.home}-${apiFixture.goals.away}).`);
    }

    if (isLastCheck) {
        console.warn(`[streak-sync-scheduler] ${matchLabel} still "${newStatus}" ${offsetMin}min after kickoff - no further checks scheduled for this match.`);
    }

    return { finished: false };
}

// Postponed matches don't have a trustworthy kickoff_at to schedule against,
// so they're handled separately from the NS/24h-lookahead query below:
// re-check each one's real status directly, and if the API now gives it a
// fresh NS date, write that to the DB. The NS query right after this picks
// it up automatically the moment it's genuinely NS again.
async function recheckPostponedMatches() {
    const postponed = await prisma.match.findMany({ where: { status: 'PST' } });
    if (postponed.length === 0) {
        console.log('[streak-sync-scheduler] No postponed matches to recheck.');
        return;
    }
    console.log(`[streak-sync-scheduler] Rechecking ${postponed.length} postponed match(es)...`);

    for (const match of postponed) {
        let apiFixture;
        try {
            apiFixture = await fetchSingleFixture(match.id_api);
        } catch (error) {
            console.error(`[streak-sync-scheduler] Postponed-match recheck failed for ${match.id_api}:`, error.message);
            continue;
        }
        if (!apiFixture) continue;

        const newStatus = apiFixture.fixture.status.short;
        if (newStatus === 'PST') continue; // still postponed - nothing to do this cycle

        const newKickoff = apiFixture.fixture.date ? new Date(apiFixture.fixture.date) : match.kickoff_at;
        await prisma.match.update({ where: { id: match.id }, data: { status: newStatus, kickoff_at: newKickoff } });
        console.log(`[streak-sync-scheduler] Postponed match API ${match.id_api} is now "${newStatus}" (kickoff ${newKickoff?.toISOString()}).`);
    }
}

// Matches still marked "NS" whose kickoff already passed - the server was
// off (or missed a restart window) through their entire scheduled-check
// lifetime, so no timer ever ran for them and they'd otherwise sit stale
// forever (the NS/24h query below only ever looks forward). For each one:
// run one immediate check right now to catch it up to reality - if it's
// already finished that's the full sync, done in one shot; if it's
// somehow still genuinely live, schedule only whichever of the normal
// offsets still lie in the future so the rest of its lifecycle is covered
// normally. Runs sequentially (not fired as parallel timers) so two checks
// for the same match can never race each other.
async function resyncStaleMatches() {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_LOOKBACK_MS);

    const staleMatches = await prisma.match.findMany({
        where: { status: 'NS', kickoff_at: { lt: now, gte: staleCutoff } },
        select: { id: true, id_api: true, kickoff_at: true }
    });

    if (staleMatches.length === 0) {
        console.log('[streak-sync-scheduler] No stale NS matches to resync.');
        return;
    }
    console.log(`[streak-sync-scheduler] Found ${staleMatches.length} stale NS match(es) whose kickoff already passed unchecked - resyncing now...`);

    for (const match of staleMatches) {
        if (scheduledMatchIds.has(match.id)) continue;
        scheduledMatchIds.add(match.id);

        console.log(`[streak-sync-scheduler] Resyncing stale match ${match.id} (API ${match.id_api}, kickoff was ${match.kickoff_at.toISOString()})...`);
        let result;
        try {
            result = await checkAndProcessMatch(match.id, null, false);
        } catch (error) {
            console.error(`[streak-sync-scheduler] Stale resync failed for match ${match.id}:`, error.message);
            continue;
        }

        if (result && !result.finished) {
            // Genuinely still in progress - cover whatever's left of its
            // schedule, skipping any offset the immediate check above
            // already covers.
            SCHEDULE_OFFSETS_MIN.forEach((offsetMin, i) => {
                const fireAt = match.kickoff_at.getTime() + offsetMin * 60 * 1000;
                if (fireAt <= Date.now()) return;
                const delay = fireAt - Date.now();
                const isLastCheck = i === SCHEDULE_OFFSETS_MIN.length - 1;
                setTimeout(() => {
                    checkAndProcessMatch(match.id, offsetMin, isLastCheck).catch(error =>
                        console.error(`[streak-sync-scheduler] Check failed for match ${match.id}:`, error.message)
                    );
                }, delay);
            });
        }
    }
}

async function scanForUpcomingMatches() {
    const now = new Date();
    console.log(`[streak-sync-scheduler] Scan tick starting at ${now.toISOString()}...`);

    await resyncStaleMatches();
    await recheckPostponedMatches();

    const matches = await prisma.match.findMany({
        where: { status: 'NS', kickoff_at: { gte: now, lte: new Date(now.getTime() + LOOKAHEAD_MS) } },
        select: { id: true, id_api: true, kickoff_at: true }
    });
    console.log(`[streak-sync-scheduler] Found ${matches.length} NS match(es) kicking off in the next 24h.`);

    let scheduledCount = 0;
    for (const match of matches) {
        if (scheduledMatchIds.has(match.id)) continue;
        scheduledMatchIds.add(match.id);
        scheduledCount++;

        console.log(`[streak-sync-scheduler] Scheduling checks for match ${match.id} (API ${match.id_api}, kickoff ${match.kickoff_at.toISOString()}) at +${SCHEDULE_OFFSETS_MIN.join('/')}min.`);

        SCHEDULE_OFFSETS_MIN.forEach((offsetMin, i) => {
            const fireAt = match.kickoff_at.getTime() + offsetMin * 60 * 1000;
            const delay = fireAt - Date.now();
            const isLastCheck = i === SCHEDULE_OFFSETS_MIN.length - 1;
            setTimeout(() => {
                checkAndProcessMatch(match.id, offsetMin, isLastCheck).catch(error =>
                    console.error(`[streak-sync-scheduler] Check failed for match ${match.id}:`, error.message)
                );
            }, Math.max(0, delay));
        });
    }

    console.log(`[streak-sync-scheduler] Scan tick done - ${scheduledCount} new match(es) scheduled, ${scheduledMatchIds.size} total tracked this run.`);
}

function startStreakSyncScheduler() {
    console.log('🗓️  Starting Streak Sync Scheduler...');
    const tick = async () => {
        try {
            await connectDB();
            await scanForUpcomingMatches();
        } catch (error) {
            console.error('[streak-sync-scheduler] Scan failed:', error.message);
        }
    };
    tick();
    setInterval(tick, SCAN_INTERVAL_MS);
    console.log(`[streak-sync-scheduler] Scheduled to scan every ${SCAN_INTERVAL_MS / 60000} minutes.`);
}

module.exports = {
    startStreakSyncScheduler,
    scanForUpcomingMatches,
    resyncStaleMatches,
    recheckPostponedMatches,
    checkAndProcessMatch,
    syncFinishedMatch,
    processFinishedFixturesBatch,
    flushFinishedFixtureQueue
};
