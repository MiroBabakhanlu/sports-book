// ─────────────────────────────────────────────────────────────────────────
// One self-contained script, one unified flow, one interval
// (UNIFIED_INTERVAL_MS, 15 minutes). No per-match timers - every tracked
// league/season gets bulk-checked every tick instead. Toggled from
// server.js like every other pipeline (commented out by default).
//
// Every tick:
//   0. Reconstruct any StreakResult rows that should exist for finished
//      matches in the last RESULT_BACKFILL_LOOKBACK_DAYS but don't (reuses
//      backfill-streak-results.js as-is) - covers a match whose status is
//      already correctly FT but whose grading step happened to fail
//      earlier (that step is deliberately try/caught so a grading failure
//      never blocks the rest of a match's processing).
//   1. For every league/season with at least one non-finished match, bulk-
//      fetch its fixture list spanning FIXTURE_LOOKBACK_DAYS back through
//      FIXTURE_WINDOW_DAYS ahead, in ONE API call per league (not one call
//      per match) - covers postponed status, kickoff-time drift, and live
//      status/score, all from the same response, for every match in that
//      window at once. The backward half means a match still stuck in a
//      non-final status from before now (server downtime, a missed check)
//      gets rediscovered the same way an upcoming one does.
//   2. Any fixture whose status just became postponed (or un-postponed), or
//      whose kickoff time moved, gets a StreakChangeEvent logged for every
//      active (>=3) streak belonging to either team in that match.
//   3. Any fixture that just turned FT/AET/PEN gets a second, detail-level
//      bulk fetch (batched by id, since the list call above doesn't include
//      per-match statistics) and is queued for the same finish-processing
//      this script has always done - final score, every market's stats,
//      season averages/standings, league streak recalculation, StreakResult
//      grading, and a new/continued/broken StreakChangeEvent row for every
//      affected streak. Matches finishing in the same tick are batched
//      together so the per-league/season recalculation runs once, not once
//      per match.
//   4. Odds get refreshed for every tracked league/season (via the
//      now-optimized odds-pipeline.js).
//   5. Every currently active (>=3) streak whose next match falls within
//      DETECTION_WINDOW_DAYS gets its current best odd compared against
//      what it was last tick (held in memory - see previousBestOdds below);
//      any difference logs an 'odds_changed' StreakChangeEvent.
//
// All detected changes land in the StreakChangeEvent table (see
// prisma/schema.prisma) - the external server polls
// GET /api/streaks/changes for unsent rows and acks them via
// POST /api/streaks/changes/ack, per that route's own comments.
// ─────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const { prisma, connectDB } = require('./src/utils/prisma');
const { generateSeasonAverages, generateStandings } = require('./pop-db');
const { calculateLeagueStreaks } = require('./streak-tracker');
const { syncTargetedOdds } = require('./odds-pipeline');
const { backfillStreakResults } = require('./backfill-streak-results');
const { SLUG_MAP } = require('./src/services/teams.service');

const API_KEY = '6dea7d814258faa2db4f3051b6cfc065';
const BASE_URL = 'https://v3.football.api-sports.io';
const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];

const UNIFIED_INTERVAL_MS = 15 * 60 * 1000;
const FIXTURE_WINDOW_DAYS = 30;
const DETECTION_WINDOW_DAYS = 30;

// How far back the fixture fetch also looks, alongside the forward window -
// catches anything still stuck in a non-final status (NS/PST/live) from
// before now (server downtime, a missed check, etc). Matches don't need
// their own scheduled check to be rediscovered anymore; they just have to
// fall inside this range on the next tick.
const FIXTURE_LOOKBACK_DAYS = 7;

// Companion to the lookback above but for a different failure mode: a match
// whose status already correctly says FT (so the fetch above won't touch it
// again) but whose StreakResult grading never completed - captureStreakResults
// is deliberately try/caught so a grading failure never blocks the rest of a
// match's processing, which means it's possible to end up with a fully
// correct match/stats/averages and zero graded StreakResult rows. Reuses
// backfill-streak-results.js as-is (point-in-time reconstruction, skips
// combos that already exist) rather than duplicating that logic here.
const RESULT_BACKFILL_LOOKBACK_DAYS = 7;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

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
// StreakChangeEvent logging helpers
// ─────────────────────────────────────────────────────────────────────────
async function logChangeEvent(teamStreakId, changeType, description) {
    await prisma.streakChangeEvent.create({
        data: { team_streak_id: teamStreakId, change_type: changeType, description }
    });
}

// Used for match-level changes (postponed, kickoff time) - logs one event
// per currently-active (>=3) streak belonging to either team in the match,
// since those are exactly the streaks a user would currently be shown a
// prediction for involving this match.
async function logChangeEventsForMatchStreaks(homeTeamId, awayTeamId, seasonId, changeType, description) {
    const streaks = await prisma.teamStreak.findMany({
        where: { season_id: seasonId, team_id: { in: [homeTeamId, awayTeamId] }, streak_length: { gte: 3 } }
    });
    if (streaks.length === 0) return;
    await prisma.streakChangeEvent.createMany({
        data: streaks.map(s => ({ team_streak_id: s.id, change_type: changeType, description }))
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Match/stat sync
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
            } else if (actualValue === threshold) {
                // Whole-number line landed on exactly - a push in betting terms
                // (stake back, no win, no loss), not a loss. Only possible when
                // threshold is a whole number - a .5 threshold can never tie an
                // integer actual value.
                result = 'push';
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
// Streak snapshot / current-data resolution
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

// Best (highest) odd across every bookmaker offering this exact streak's
// recommended selection for its next match - shared by buildActiveStreakRecord
// (resolving current data for the external API) and detectOddsChanges below
// (comparing this same value tick-over-tick), so the two can never disagree
// about what "the odds for this streak" means.
async function getBestOddForStreak(teamId, marketSlug, direction, threshold, binary, suggestedOutcome, nextMatch) {
    if (!nextMatch) return null;
    const isHome = nextMatch.home_team_id === teamId;
    const rawSlug = CANONICAL_TO_RAW[marketSlug]?.[isHome ? 'home' : 'away'];
    if (!rawSlug) return null;

    const rawMarket = await prisma.market.findUnique({ where: { slug: rawSlug } });
    if (!rawMarket) return null;

    const matchOdds = await prisma.matchOdds.findMany({ where: { match_id: nextMatch.id }, include: { bookmaker: true } });
    const selectionSlug = binary ? suggestedOutcome : `${direction}-${threshold}`;
    const matches = matchOdds.filter(o => o.market_id === rawMarket.id && o.slug === selectionSlug);
    matches.sort((a, b) => Number(b.odd) - Number(a.odd));
    if (!matches[0]) return null;
    return { value: Number(matches[0].odd), bookmaker: matches[0].bookmaker?.name ?? null };
}

// Resolves one TeamStreak to everything the external server needs to render
// it - used both when building a new/continued record after a finish, and
// when resolving a StreakChangeEvent to current data for GET /changes.
async function buildActiveStreakRecord(teamStreakId, team, marketSlug, marketName, status) {
    const teamStreak = await prisma.teamStreak.findUnique({
        where: { id: teamStreakId },
        include: { market: { include: { sport: true } } }
    });
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

    const recommendedOdd = await getBestOddForStreak(team.id, marketSlug, direction, threshold, binary, suggestedOutcome, nextMatch);

    return {
        streak_id: teamStreak.id,
        status, // 'new' | 'continued'
        team: team.name,
        market: marketName,
        aimed_sport: teamStreak.market.sport.slug,
        streak_count: teamStreak.streak_length,
        confidence: teamStreak.confidence != null ? Number(teamStreak.confidence) : null,
        direction: binary ? null : direction,
        threshold: binary ? null : threshold,
        suggested_outcome: suggestedOutcome,
        avg_value: avgValue,
        next_match: nextMatch ? {
            id_api: nextMatch.id_api,
            status: nextMatch.status, // e.g. 'NS', 'PST' - lets a postponed/kickoff_changed event be read structurally instead of parsing `description`
            kickoff_at: nextMatch.kickoff_at,
            home: nextMatch.homeTeam.name,
            away: nextMatch.awayTeam.name,
            league: nextMatch.season.league.name
        } : null,
        odds: recommendedOdd,
        updated_at: new Date().toISOString()
    };
}

function buildBrokenStreakRecord(teamStreakId, team, marketName, newStreakLength, aimedSport) {
    return {
        streak_id: teamStreakId,
        status: 'broken',
        team: team.name,
        market: marketName,
        aimed_sport: aimedSport,
        streak_count: newStreakLength,
        updated_at: new Date().toISOString()
    };
}

// Single entry point the external-facing API uses to resolve any
// team_streak_id to its current display data, regardless of what kind of
// change was originally logged for it.
async function resolveCurrentStreakData(teamStreakId) {
    const teamStreak = await prisma.teamStreak.findUnique({
        where: { id: teamStreakId },
        include: { team: true, market: { include: { sport: true } } }
    });
    if (!teamStreak) return null;

    if (teamStreak.streak_length < 3) {
        return buildBrokenStreakRecord(teamStreak.id, teamStreak.team, teamStreak.market.name, teamStreak.streak_length, teamStreak.market.sport.slug);
    }
    return buildActiveStreakRecord(teamStreak.id, teamStreak.team, teamStreak.market.slug, teamStreak.market.name, 'continued');
}

// ─────────────────────────────────────────────────────────────────────────
// The full sync for one or more confirmed-finished matches: match+stats,
// averages/standings, league streaks - then diff each match's streak state
// before/after to find new/continued/broken markets and log a
// StreakChangeEvent for each. Takes a BATCH so that when several matches
// share a league and season (a full matchday, or catching up a backlog),
// the expensive per-league/season steps - averages, standings, streak
// recalculation - run ONCE for the whole batch instead of once per match.
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

    const markets = await prisma.market.findMany({ where: { slug: { in: STREAK_ELIGIBLE_MARKET_SLUGS } }, include: { sport: true } });
    const changeEventRows = [];
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
                        const record = await buildActiveStreakRecord(afterState.id, teamsById[teamId], market.slug, market.name, 'new');
                        if (record) {
                            changeEventRows.push({ team_streak_id: record.streak_id, change_type: 'new', description: `${record.team} ${record.market} streak is new at ${record.streak_count}.` });
                            matchEntryCount++;
                        }
                    } else if (wasActive && isActive) {
                        const record = await buildActiveStreakRecord(afterState.id, teamsById[teamId], market.slug, market.name, 'continued');
                        if (record) {
                            changeEventRows.push({ team_streak_id: record.streak_id, change_type: 'continued', description: `${record.team} ${record.market} streak continued at ${record.streak_count}.` });
                            matchEntryCount++;
                        }
                    } else if (wasActive && !isActive) {
                        const record = buildBrokenStreakRecord(beforeState.id, teamsById[teamId], market.name, afterState ? afterState.streak_length : 0, market.sport.slug);
                        changeEventRows.push({ team_streak_id: record.streak_id, change_type: 'broken', description: `${record.team} ${record.market} streak broken (now ${record.streak_count}).` });
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

    if (changeEventRows.length > 0) {
        await prisma.streakChangeEvent.createMany({ data: changeEventRows });
    }
    console.log(`[streak-sync-scheduler] Batch done - ${items.length} match(es) synced, ${changeEventRows.length} total streak change event(s) logged.`);
}

// Convenience wrapper for syncing exactly one match immediately (used by
// direct/manual calls and tests) - just a batch of one.
async function syncFinishedMatch(apiFixture, dbMatch) {
    return processFinishedFixturesBatch([{ apiFixture, dbMatch }]);
}

// ─────────────────────────────────────────────────────────────────────────
// Odds-change detection - in-memory only for now (per explicit instruction;
// durability/memory footprint to be revisited later if it turns out to be a
// problem). Keyed by team_streak_id -> { value, bookmaker } | null. A streak
// seen for the first time just seeds the map - there's no "before" to
// compare against yet, so it never logs a change on its first tick.
// ─────────────────────────────────────────────────────────────────────────
const previousBestOdds = new Map();

async function detectOddsChanges() {
    console.log('[streak-sync-scheduler] Checking active streaks for odds changes...');
    const windowEnd = new Date(Date.now() + DETECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const activeStreaks = await prisma.teamStreak.findMany({
        where: { streak_length: { gte: 3 } },
        include: { team: true, market: true }
    });

    let changeCount = 0;
    for (const ts of activeStreaks) {
        const nextMatch = await prisma.match.findFirst({
            where: {
                season_id: ts.season_id,
                status: { notIn: FINISHED_STATUSES },
                OR: [{ home_team_id: ts.team_id }, { away_team_id: ts.team_id }]
            },
            orderBy: { kickoff_at: 'asc' }
        });
        if (!nextMatch || nextMatch.kickoff_at > windowEnd) continue;

        const avgRow = await prisma.teamSeasonAverage.findFirst({
            where: { team_id: ts.team_id, season_id: ts.season_id, market_id: ts.market_id }
        });
        const avgValue = avgRow ? Number(avgRow.avg_value) : 0;
        const threshold = (avgValue % 1 === 0) ? avgValue : Math.floor(avgValue) + 0.5;
        const direction = ts.streak_direction === 'below' ? 'over' : 'under';
        const binary = BINARY_MARKET_OUTCOMES[ts.market.slug];
        const suggestedOutcome = binary ? (ts.streak_direction === 'below' ? binary.positive : binary.negative) : null;

        const currentOdd = await getBestOddForStreak(ts.team_id, ts.market.slug, direction, threshold, binary, suggestedOutcome, nextMatch);
        const previous = previousBestOdds.get(ts.id);

        if (previous !== undefined) {
            const changed = (previous?.value ?? null) !== (currentOdd?.value ?? null) || (previous?.bookmaker ?? null) !== (currentOdd?.bookmaker ?? null);
            if (changed) {
                await logChangeEvent(
                    ts.id,
                    'odds_changed',
                    `Best odd for ${ts.team.name} ${ts.market.name} changed from ${previous?.value ?? '—'} (${previous?.bookmaker ?? '—'}) to ${currentOdd?.value ?? '—'} (${currentOdd?.bookmaker ?? '—'}).`
                );
                changeCount++;
            }
        }
        previousBestOdds.set(ts.id, currentOdd);
    }
    console.log(`[streak-sync-scheduler] Odds change detection done - ${changeCount} change(s) logged.`);
}

// ─────────────────────────────────────────────────────────────────────────
// Per-league fixture sync - status/postponed/kickoff-time/live, all from one
// bulk API call spanning FIXTURE_LOOKBACK_DAYS back through FIXTURE_WINDOW_DAYS
// ahead, so a match still stuck in a non-final status from before now (server
// downtime, a missed check) gets rediscovered the same way an upcoming one
// does - it doesn't need its own scheduled check, just to fall inside this
// range on some future tick. Returns the list of { apiFixture, dbMatch } for
// fixtures that just turned finished this pass (apiFixture here is the FULL
// detail version, with statistics - see the second fetch below).
// ─────────────────────────────────────────────────────────────────────────
async function syncFixturesForLeague(leagueApiId, seasonYear) {
    const dbMatches = await prisma.match.findMany({
        where: {
            status: { notIn: FINISHED_STATUSES },
            season: { year: String(seasonYear), league: { id_api: String(leagueApiId) } }
        },
        include: { homeTeam: true, awayTeam: true, season: { include: { league: true } } }
    });
    if (dbMatches.length === 0) return [];

    const dbMatchesByIdApi = new Map(dbMatches.map(m => [m.id_api, m]));

    const today = new Date();
    const windowStart = new Date(today.getTime() - FIXTURE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(today.getTime() + FIXTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    let apiFixtures;
    try {
        const response = await axios.get(`${BASE_URL}/fixtures`, {
            headers: { 'x-apisports-key': API_KEY },
            params: {
                league: leagueApiId,
                season: seasonYear,
                from: windowStart.toISOString().slice(0, 10),
                to: windowEnd.toISOString().slice(0, 10)
            }
        });
        apiFixtures = response.data?.response || [];
    } catch (error) {
        console.error(`[streak-sync-scheduler] Fixture list fetch failed for league ${leagueApiId}/${seasonYear}:`, error.message);
        return [];
    }

    const newlyFinishedIds = [];

    for (const apiFixture of apiFixtures) {
        const idApi = String(apiFixture.fixture.id);
        const dbMatch = dbMatchesByIdApi.get(idApi);
        if (!dbMatch) continue; // not a match this script creates - only syncs existing ones

        const newStatus = apiFixture.fixture.status.short;
        const newKickoff = new Date(apiFixture.fixture.date);
        const oldStatus = dbMatch.status;
        const oldKickoff = dbMatch.kickoff_at;
        const matchLabel = `${dbMatch.homeTeam.name} vs ${dbMatch.awayTeam.name} (API ${idApi})`;

        const becamePostponed = newStatus === 'PST' && oldStatus !== 'PST';
        const unpostponed = oldStatus === 'PST' && newStatus !== 'PST';
        if (becamePostponed || unpostponed) {
            const description = becamePostponed
                ? `${matchLabel} was postponed.`
                : `${matchLabel} is no longer postponed - new kickoff ${newKickoff.toISOString()}.`;
            console.log(`[streak-sync-scheduler] ${description}`);
            await logChangeEventsForMatchStreaks(dbMatch.home_team_id, dbMatch.away_team_id, dbMatch.season_id, 'postponed', description);
        }

        if (newKickoff.getTime() !== oldKickoff.getTime()) {
            const description = `${matchLabel} kickoff time changed from ${oldKickoff.toISOString()} to ${newKickoff.toISOString()}.`;
            console.log(`[streak-sync-scheduler] ${description}`);
            await logChangeEventsForMatchStreaks(dbMatch.home_team_id, dbMatch.away_team_id, dbMatch.season_id, 'kickoff_changed', description);
        }

        if (FINISHED_STATUSES.includes(newStatus)) {
            console.log(`[streak-sync-scheduler] ${matchLabel} is finished (${newStatus}, ${apiFixture.goals.home}-${apiFixture.goals.away}) - queued for detail fetch + batched sync.`);
            newlyFinishedIds.push(idApi);
            continue;
        }

        const scoreChanged = apiFixture.goals.home !== dbMatch.home_score || apiFixture.goals.away !== dbMatch.away_score;
        const statusChanged = newStatus !== oldStatus;
        const kickoffChanged = newKickoff.getTime() !== oldKickoff.getTime();
        if (statusChanged || scoreChanged || kickoffChanged) {
            await prisma.match.update({
                where: { id: dbMatch.id },
                data: { status: newStatus, home_score: apiFixture.goals.home, away_score: apiFixture.goals.away, kickoff_at: newKickoff }
            });
            console.log(`[streak-sync-scheduler] ${matchLabel} -> ${newStatus} (${apiFixture.goals.home}-${apiFixture.goals.away})${kickoffChanged ? ', kickoff updated' : ''}.`);
        }
    }

    if (newlyFinishedIds.length === 0) return [];

    // The list endpoint above doesn't include per-match statistics - a
    // second, detail-level bulk fetch (batched by id, same pattern
    // pop-db.js's initial sync already uses) is needed before these can be
    // safely handed to the stats-writing pipeline.
    const finishedBatch = [];
    for (const idsChunk of chunkArray(newlyFinishedIds, 20)) {
        try {
            const detailResponse = await axios.get(`${BASE_URL}/fixtures`, {
                headers: { 'x-apisports-key': API_KEY },
                params: { ids: idsChunk.join('-') }
            });
            for (const detailedFixture of (detailResponse.data?.response || [])) {
                const dbMatch = dbMatchesByIdApi.get(String(detailedFixture.fixture.id));
                if (dbMatch) finishedBatch.push({ apiFixture: detailedFixture, dbMatch });
            }
        } catch (error) {
            console.error(`[streak-sync-scheduler] Finished-fixture detail fetch failed for league ${leagueApiId}/${seasonYear}:`, error.message);
        }
    }

    return finishedBatch;
}

// ─────────────────────────────────────────────────────────────────────────
// The unified tick
// ─────────────────────────────────────────────────────────────────────────
async function runUnifiedSync() {
    console.log(`[streak-sync-scheduler] Unified sync tick starting at ${new Date().toISOString()}...`);

    // Gap B (independent of everything below - a match here doesn't need a
    // non-finished status anywhere, it's already FT, just possibly missing
    // its grading): reconstruct any StreakResult rows that should exist for
    // the last RESULT_BACKFILL_LOOKBACK_DAYS but don't. Safe to run every
    // tick - backfillStreakResults skips (match, team, market) combos that
    // already have a row.
    try {
        await backfillStreakResults(RESULT_BACKFILL_LOOKBACK_DAYS);
    } catch (error) {
        console.error('[streak-sync-scheduler] StreakResult backfill failed:', error.message);
    }

    const targetSeasons = await prisma.match.findMany({
        where: { status: { notIn: FINISHED_STATUSES } },
        distinct: ['season_id'],
        select: { season: { select: { year: true, league: { select: { id_api: true } } } } }
    });
    const leagueSeasonPairs = targetSeasons.map(m => [m.season.league.id_api, m.season.year]);

    if (leagueSeasonPairs.length === 0) {
        console.log('[streak-sync-scheduler] No leagues with non-finished matches - nothing to sync this tick.');
        return;
    }
    console.log(`[streak-sync-scheduler] Syncing fixtures for ${leagueSeasonPairs.length} league/season pair(s)...`);

    const allFinished = [];
    for (const [leagueApiId, seasonYear] of leagueSeasonPairs) {
        const finished = await syncFixturesForLeague(leagueApiId, seasonYear);
        allFinished.push(...finished);
    }

    if (allFinished.length > 0) {
        try {
            await processFinishedFixturesBatch(allFinished);
        } catch (error) {
            console.error('[streak-sync-scheduler] Finished-match batch processing failed:', error.message);
        }
    }

    console.log(`[streak-sync-scheduler] Syncing odds for ${leagueSeasonPairs.length} league/season pair(s)...`);
    try {
        await syncTargetedOdds(leagueSeasonPairs);
    } catch (error) {
        console.error('[streak-sync-scheduler] Odds sync failed:', error.message);
    }

    try {
        await detectOddsChanges();
    } catch (error) {
        console.error('[streak-sync-scheduler] Odds change detection failed:', error.message);
    }

    console.log('[streak-sync-scheduler] Unified sync tick done.');
}

function startStreakSyncScheduler() {
    console.log('🗓️  Starting Unified Streak Sync (every 15 minutes)...');
    const tick = async () => {
        try {
            await connectDB();
            await runUnifiedSync();
        } catch (error) {
            console.error('[streak-sync-scheduler] Unified sync tick failed:', error.message);
        }
    };
    tick();
    setInterval(tick, UNIFIED_INTERVAL_MS);
    console.log(`[streak-sync-scheduler] Scheduled to run every ${UNIFIED_INTERVAL_MS / 60000} minutes.`);
}

module.exports = {
    startStreakSyncScheduler,
    runUnifiedSync,
    syncFixturesForLeague,
    detectOddsChanges,
    processFinishedFixturesBatch,
    syncFinishedMatch,
    resolveCurrentStreakData,
    buildActiveStreakRecord,
    buildBrokenStreakRecord
};
