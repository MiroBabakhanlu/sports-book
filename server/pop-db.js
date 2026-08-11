const { prisma, connectDB } = require('./src/utils/prisma');
const axios = require('axios');
const { generateMissingStatsReport } = require('./generate-missing-stats-report');

const API_KEY = '6dea7d814258faa2db4f3051b6cfc065';
const BASE_URL = 'https://v3.football.api-sports.io';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
function extractMatchday(round) {
    if (!round) return null;

    const match = round.match(/\d+/);

    return match ? Number(match[0]) : null;
}

// 1. Helper function now accepts the transaction client (tx)
async function upsertMatchStat(tx, matchId, teamId, marketId, value, side) {
    await tx.matchTeamStat.upsert({
        where: {
            match_id_team_id_market_id: {
                match_id: matchId,
                team_id: teamId,
                market_id: marketId
            }
        },
        update: {
            match_id: matchId,
            team_id: teamId,
            market_id: marketId,
            value: value,
            side: side
        },
        create: {
            match_id: matchId,
            team_id: teamId,
            market_id: marketId,
            value: value,
            side: side
        }
    });
}

// Purely additive monitoring - does not change what gets written to MatchTeamStat
// or any existing average/streak computation. Each raw API stat type maps to the
// canonical market(s) it feeds; when getRawStatValue() would have silently defaulted
// to 0 because f.statistics had no entry for that type, this logs exactly which
// team+match+market was affected instead, so it can be queried later (e.g. "how much
// data is missing for market X in league Y") without digging through zero-value rows
// by hand.
const RAW_STAT_TO_MARKETS = {
    'Yellow Cards': ['team-yellow-cards', 'total-yellow-cards'],
    'Red Cards': ['team-red-cards', 'total-red-cards'],
    'Corner Kicks': ['team-corner-kicks', 'total-corner-kicks'],
    'Ball Possession': ['team-possession'],
    'Total Shots': ['team-shots']
};

async function logMissingStats(tx, { matchId, teamId, leagueId, seasonId, matchIdApi, statsArray, marketsBySlug }) {
    for (const [rawType, affectedSlugs] of Object.entries(RAW_STAT_TO_MARKETS)) {
        const found = statsArray.find(s => s.type === rawType);
        if (found) continue;

        for (const slug of affectedSlugs) {
            const market = marketsBySlug.get(slug);
            if (!market) continue;

            await tx.missingMatchStat.upsert({
                where: {
                    match_id_team_id_market_id: { match_id: matchId, team_id: teamId, market_id: market.id }
                },
                update: { detected_at: new Date() },
                create: {
                    match_id: matchId, team_id: teamId, market_id: market.id,
                    league_id: leagueId, season_id: seasonId, match_id_api: matchIdApi
                }
            });
        }
    }
}

// 2. Helper function now accepts the transaction client (tx)
async function generateSeasonAverages(tx, seasonId) {
    const stats = await tx.matchTeamStat.findMany({
        where: {
            match: {
                season_id: seasonId,
                status: { in: ['FT', 'AET', 'PEN'] } // ONLY count completed games
            }
        }
    });

    const breakdown = {};

    for (const s of stats) {
        const key = `${s.team_id}-${s.market_id}`;
        if (!breakdown[key]) {
            breakdown[key] = { totalAll: 0, countAll: 0, totalHome: 0, countHome: 0, totalAway: 0, countAway: 0 };
        }

        const val = Number(s.value);
        breakdown[key].totalAll += val;
        breakdown[key].countAll += 1;

        if (s.side === 'home') {
            breakdown[key].totalHome += val; breakdown[key].countHome += 1;
        } else if (s.side === 'away') {
            breakdown[key].totalAway += val; breakdown[key].countAway += 1;
        }
    }

    for (const [key, metrics] of Object.entries(breakdown)) {
        const [teamId, marketId] = key.split('-').map(Number);

        const avgOverall = metrics.countAll > 0 ? (metrics.totalAll / metrics.countAll) : 0;
        const avgHome = metrics.countHome > 0 ? (metrics.totalHome / metrics.countHome) : null;
        const avgAway = metrics.countAway > 0 ? (metrics.totalAway / metrics.countAway) : null;

        const existingRow = await tx.teamSeasonAverage.findFirst({
            where: { team_id: teamId, season_id: seasonId, market_id: marketId }
        });

        if (existingRow) {
            await tx.teamSeasonAverage.update({
                where: { id: existingRow.id },
                data: {
                    avg_value: avgOverall,
                    avg_value_home: avgHome,
                    avg_value_away: avgAway,
                    matches_played: metrics.countAll
                }
            });
        } else {
            await tx.teamSeasonAverage.create({
                data: {
                    team_id: teamId,
                    season_id: seasonId,
                    market_id: marketId,
                    avg_value: avgOverall,
                    avg_value_home: avgHome,
                    avg_value_away: avgAway,
                    matches_played: metrics.countAll
                }
            });
        }
    }
    console.log('team season averages successfully computed and saved');
}

// 2b. League table (W/D/L/points/goal difference) for a season - computed straight
// from Match rows (home_score/away_score/status), not MatchTeamStat, since standings
// don't need anything from the stats pipeline. One TeamStanding row per team,
// ranked points desc -> goal difference desc -> goals for desc.
async function generateStandings(tx, seasonId) {
    const matches = await tx.match.findMany({
        where: {
            season_id: seasonId,
            status: { in: ['FT', 'AET', 'PEN'] }
        },
        select: { home_team_id: true, away_team_id: true, home_score: true, away_score: true }
    });

    const table = {};
    const ensureTeam = (teamId) => {
        if (!table[teamId]) {
            table[teamId] = { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0 };
        }
        return table[teamId];
    };

    for (const m of matches) {
        if (m.home_score === null || m.away_score === null) continue;

        const home = ensureTeam(m.home_team_id);
        const away = ensureTeam(m.away_team_id);

        home.played++; away.played++;
        home.goals_for += m.home_score; home.goals_against += m.away_score;
        away.goals_for += m.away_score; away.goals_against += m.home_score;

        if (m.home_score > m.away_score) { home.won++; away.lost++; }
        else if (m.away_score > m.home_score) { away.won++; home.lost++; }
        else { home.drawn++; away.drawn++; }
    }

    const ranked = Object.entries(table)
        .map(([teamId, t]) => ({
            team_id: Number(teamId),
            ...t,
            goal_difference: t.goals_for - t.goals_against,
            points: t.won * 3 + t.drawn
        }))
        .sort((a, b) => (b.points - a.points) || (b.won - a.won) || (b.goal_difference - a.goal_difference) || (b.goals_for - a.goals_for));

    for (let i = 0; i < ranked.length; i++) {
        const row = ranked[i];
        const data = {
            position: i + 1,
            played: row.played,
            won: row.won,
            drawn: row.drawn,
            lost: row.lost,
            goals_for: row.goals_for,
            goals_against: row.goals_against,
            goal_difference: row.goal_difference,
            points: row.points
        };
        await tx.teamStanding.upsert({
            where: { team_id_season_id: { team_id: row.team_id, season_id: seasonId } },
            update: data,
            create: { team_id: row.team_id, season_id: seasonId, ...data }
        });
    }
    console.log('team standings successfully computed and saved');
}

// 3. Isolated function to process a single league entirely within a Prisma transaction
async function processLeague(leagueId, seasonYear) {
    // Increased timeout to 5 minutes (300,000ms) to accommodate Axios delays inside the transaction
    await prisma.$transaction(async (tx) => {
        console.log(`\n--- Fetching starts for League ${leagueId}, Season ${seasonYear} ---`);
        const leagueApiResponse = await axios.get(`${BASE_URL}/leagues`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { id: leagueId, season: seasonYear }
        });
        console.log(
            'LEAGUE API RESPONSE:',
            JSON.stringify(leagueApiResponse.data, null, 2)
        );

        const data = leagueApiResponse.data.response[0];
        if (!data) throw new Error("League or season data not found on the external API");

        const { league, country, seasons } = data;
        const currentSeason = seasons[0];
        const cleanLeagueName = league.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const cleanCountryName = country.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const leagueSlug = `${cleanLeagueName}-${cleanCountryName}`; // e.g., "serie-a-brazil" vs "serie-a-italy"

        const sport = await tx.sport.findUnique({ where: { slug: 'football' } });
        if (!sport) throw new Error("Sport 'football' not found in DB. Please run your sport seed script first.");

        // upserting League record
        const dbLeague = await tx.league.upsert({
            where: { id_api: String(league.id) },
            update: {
                sport_id: sport.id,
                name: league.name,
                country: country.name,
                id_api: String(league.id),
                slug: leagueSlug,
                is_active: true
            },
            create: {
                sport_id: sport.id,
                name: league.name,
                country: country.name,
                id_api: String(league.id),
                slug: leagueSlug,
                is_active: true
            }
        });

        // upserting Season record
        const dbSeason = await tx.season.upsert({
            where: {
                id_api_league_id: {
                    id_api: String(currentSeason.year),
                    league_id: dbLeague.id
                }
            },
            update: {
                league_id: dbLeague.id,
                year: String(currentSeason.year),
                is_current: currentSeason.current,
                id_api: String(currentSeason.year),
                start_date: new Date(currentSeason.start),
                end_date: new Date(currentSeason.end)
            },
            create: {
                league_id: dbLeague.id,
                year: String(currentSeason.year),
                is_current: currentSeason.current,
                id_api: String(currentSeason.year),
                start_date: new Date(currentSeason.start),
                end_date: new Date(currentSeason.end)
            }
        });
        console.log(`League & Season Are done.`);

        console.log(`now fetching teams `);
        const teamsResponse = await axios.get(`${BASE_URL}/teams`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { league: leagueId, season: seasonYear }
        });

        const teams = teamsResponse.data.response || [];

        for (const t of teams) {
            await tx.team.upsert({
                where: { id_api: String(t.team.id) },
                update: {
                    sport_id: sport.id,
                    name: t.team.name,
                    id_api: String(t.team.id),
                    logo_url: t.team.logo,
                    country: t.team.country,
                    is_active: true
                },
                create: {
                    sport_id: sport.id,
                    name: t.team.name,
                    id_api: String(t.team.id),
                    logo_url: t.team.logo,
                    country: t.team.country,
                    is_active: true
                }
            });
        }
        console.log(` teams added in db.`);

        const targetSlugs = [
            'team-goals', 'total-goals',
            'team-yellow-cards', 'total-yellow-cards',
            'team-red-cards', 'total-red-cards',
            'team-corner-kicks', 'total-corner-kicks',
            'total-goals-1st-half', 'total-goals-2nd-half',
            // conceded
            'team-goals-conceded',
            // 'team-corner-kicks-conceded',
            // 'team-yellow-cards-conceded'
            // Team Statistics widget - not streak-eligible, comparison stats only
            'team-goals-1st-half', 'team-goals-2nd-half', 'team-possession', 'team-shots', 'team-clean-sheets',
            // Boolean/categorical - see team-clean-sheets comment below for how these work
            'oddeven', 'both-teams-score'
        ];

        const dbMarkets = await tx.market.findMany({
            where: { slug: { in: targetSlugs } }
        });
        console.log(`Loaded ${dbMarkets.length} from market table`);
        const marketsBySlug = new Map(dbMarkets.map(m => [m.slug, m]));

        console.log('Fetching fixtures');
        const fixturesResponse = await axios.get(`${BASE_URL}/fixtures`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { league: leagueId, season: seasonYear }
        });

        const baseFixtures = fixturesResponse.data.response || [];
        console.log(` Found ${baseFixtures.length} FINISHED matches`);

        const allFixtureIds = baseFixtures.map(f => f.fixture.id);
        const batches = chunkArray(allFixtureIds, 20);

        for (let i = 0; i < batches.length; i++) {
            const batchIds = batches[i];
            console.log(`Batch ${i + 1}/${batches.length}`);

            const batchResponse = await axios.get(`${BASE_URL}/fixtures`, {
                headers: { 'x-apisports-key': API_KEY },
                params: { ids: batchIds.join('-') }
            });

            const detailedFixtures = batchResponse.data.response || [];

            for (const f of detailedFixtures) {
                const apiMatchId = f.fixture.id.toString();

                const homeTeam = await tx.team.findUnique({ where: { id_api: f.teams.home.id.toString() } });
                const awayTeam = await tx.team.findUnique({ where: { id_api: f.teams.away.id.toString() } });

                if (!homeTeam || !awayTeam) {
                    console.log(`team structural layout mismatch`);
                    continue;
                }

                let winnerTeamId = null;
                const matchStatus = f.fixture.status.short;
                const isFinished = ['FT', 'AET', 'PEN'].includes(matchStatus);

                if (isFinished) {
                    if (f.goals.home > f.goals.away) {
                        winnerTeamId = homeTeam.id;
                    } else if (f.goals.away > f.goals.home) {
                        winnerTeamId = awayTeam.id;
                    } else if (matchStatus === 'PEN' && f.score?.penalty) {
                        const penHome = f.score.penalty.home ?? 0;
                        const penAway = f.score.penalty.away ?? 0;

                        if (penHome > penAway) winnerTeamId = homeTeam.id;
                        else if (penAway > penHome) winnerTeamId = awayTeam.id;
                    }
                }

                const match = await tx.match.upsert({
                    where: { id_api: apiMatchId },
                    update: {
                        id_api: apiMatchId,
                        season_id: dbSeason.id,
                        home_team_id: homeTeam.id,
                        away_team_id: awayTeam.id,
                        matchday: extractMatchday(f.league.round),
                        kickoff_at: new Date(f.fixture.date),
                        status: f.fixture.status.short,
                        home_score: f.goals.home,
                        away_score: f.goals.away,
                        venue: f.fixture.venue.name,
                        winner_team_id: winnerTeamId
                    },
                    create: {
                        id_api: apiMatchId,
                        season_id: dbSeason.id,
                        home_team_id: homeTeam.id,
                        away_team_id: awayTeam.id,
                        matchday: extractMatchday(f.league.round),
                        kickoff_at: new Date(f.fixture.date),
                        status: f.fixture.status.short,
                        home_score: f.goals.home,
                        away_score: f.goals.away,
                        venue: f.fixture.venue.name,
                        winner_team_id: winnerTeamId
                    }
                });

                const homeStatsArray = f.statistics?.find(s => s.team.id === f.teams.home.id)?.statistics || [];
                const awayStatsArray = f.statistics?.find(s => s.team.id === f.teams.away.id)?.statistics || [];

                // Only finished matches can meaningfully be "missing" stats - an NS/PST
                // fixture trivially has no statistics yet because it hasn't been played,
                // which isn't a data gap and would otherwise flood this table with noise.
                if (isFinished) {
                    await logMissingStats(tx, {
                        matchId: match.id, teamId: homeTeam.id, leagueId: dbLeague.id, seasonId: dbSeason.id,
                        matchIdApi: apiMatchId, statsArray: homeStatsArray, marketsBySlug
                    });
                    await logMissingStats(tx, {
                        matchId: match.id, teamId: awayTeam.id, leagueId: dbLeague.id, seasonId: dbSeason.id,
                        matchIdApi: apiMatchId, statsArray: awayStatsArray, marketsBySlug
                    });
                }

                const getRawStatValue = (statsArray, typeString) => {
                    const found = statsArray.find(s => s.type === typeString);
                    return found ? (parseInt(found.value) || 0) : 0;
                };

                const homeGoals = f.goals.home ?? 0;
                const awayGoals = f.goals.away ?? 0;
                const homeGoalsHT = f.score?.halftime?.home ?? 0;
                const awayGoalsHT = f.score?.halftime?.away ?? 0;
                const homeGoals2H = homeGoals - homeGoalsHT;
                const awayGoals2H = awayGoals - awayGoalsHT;
                const homeYellows = getRawStatValue(homeStatsArray, 'Yellow Cards');
                const awayYellows = getRawStatValue(awayStatsArray, 'Yellow Cards');
                const homeReds = getRawStatValue(homeStatsArray, 'Red Cards');
                const awayReds = getRawStatValue(awayStatsArray, 'Red Cards');
                const homeCorners = getRawStatValue(homeStatsArray, 'Corner Kicks');
                const awayCorners = getRawStatValue(awayStatsArray, 'Corner Kicks');
                // parseInt("46%") -> 46, stops at the first non-numeric char, so no
                // separate % stripping needed - same getRawStatValue as everything else.
                const homePossession = getRawStatValue(homeStatsArray, 'Ball Possession');
                const awayPossession = getRawStatValue(awayStatsArray, 'Ball Possession');
                const homeShots = getRawStatValue(homeStatsArray, 'Total Shots');
                const awayShots = getRawStatValue(awayStatsArray, 'Total Shots');

                for (const market of dbMarkets) {
                    let finalValue = 0;

                    if (market.slug === 'team-goals') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeGoals, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayGoals, 'away');
                    }
                    else if (market.slug === 'total-goals') {
                        finalValue = homeGoals + awayGoals;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-yellow-cards') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeYellows, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayYellows, 'away');
                    }
                    else if (market.slug === 'total-yellow-cards') {
                        finalValue = homeYellows + awayYellows;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-red-cards') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeReds, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayReds, 'away');
                    }
                    else if (market.slug === 'total-red-cards') {
                        finalValue = homeReds + awayReds;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-corner-kicks') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeCorners, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayCorners, 'away');
                    }
                    else if (market.slug === 'total-corner-kicks') {
                        console.log('total corners', homeCorners, awayCorners, homeTeam.id, awayTeam.id)
                        finalValue = homeCorners + awayCorners;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'total-goals-1st-half') {
                        finalValue = homeGoalsHT + awayGoalsHT;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'total-goals-2nd-half') {
                        finalValue = homeGoals2H + awayGoals2H;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-goals-conceded') {
                        // home CONCEDED = what away scored; away CONCEDED = what home scored
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, awayGoals, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, homeGoals, 'away');
                    }
                    // else if (market.slug === 'team-corner-kicks-conceded') {
                    //     await upsertMatchStat(tx, match.id, homeTeam.id, market.id, awayCorners, 'home');
                    //     await upsertMatchStat(tx, match.id, awayTeam.id, market.id, homeCorners, 'away');
                    // }
                    // else if (market.slug === 'team-yellow-cards-conceded') {
                    //     await upsertMatchStat(tx, match.id, homeTeam.id, market.id, awayYellows, 'home');
                    //     await upsertMatchStat(tx, match.id, awayTeam.id, market.id, homeYellows, 'away');
                    // }
                    else if (market.slug === 'team-goals-1st-half') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeGoalsHT, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayGoalsHT, 'away');
                    }
                    else if (market.slug === 'team-goals-2nd-half') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeGoals2H, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayGoals2H, 'away');
                    }
                    else if (market.slug === 'team-possession') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homePossession, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayPossession, 'away');
                    }
                    else if (market.slug === 'team-shots') {
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, homeShots, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, awayShots, 'away');
                    }
                    else if (market.slug === 'team-clean-sheets') {
                        // Per-match 1/0, not a count - generateSeasonAverages() treats
                        // this exactly like every other market (sum/count), so avg_value
                        // ends up being the clean-sheet RATE. matchup.service.js turns
                        // that back into a count (rate * matches_played) at read time.
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, awayGoals === 0 ? 1 : 0, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, homeGoals === 0 ? 1 : 0, 'away');
                    }
                    else if (market.slug === 'oddeven') {
                        // Match-level fact (not team-specific), same value written to
                        // both sides - same pattern total-goals etc. already use.
                        // 1 = total match goals were odd, 0 = even. avg_value = odd-rate.
                        const isOdd = (homeGoals + awayGoals) % 2 === 1 ? 1 : 0;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, isOdd, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, isOdd, 'away');
                    }
                    else if (market.slug === 'both-teams-score') {
                        // Match-level fact, same value both sides. 1 = both teams
                        // scored (BTTS yes), 0 = no. avg_value = BTTS-yes rate.
                        const btts = (homeGoals > 0 && awayGoals > 0) ? 1 : 0;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, btts, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, btts, 'away');
                    }
                }
            }
        }
        console.log('match events loaded to database');

        await generateSeasonAverages(tx, dbSeason.id);
        await generateStandings(tx, dbSeason.id);

        console.log(`END FOR league ${leagueId}!`);
    }, { timeout: 300000 }); // 5 minutes max wait
}

// 4. Main exported function accepting an array of tasks
async function runPipelines(tasks) {
    try {
        await connectDB();

        for (const [leagueId, seasonYear] of tasks) {
            try {
                await processLeague(leagueId, seasonYear);
            } catch (error) {
                console.error(`\n[!] Transaction Failed & Rolled Back for League ${leagueId}, Season ${seasonYear}.`);

                if (error.response) {
                    // API responded but with an error status
                    console.error('API ERROR STATUS:', error.response.status);
                    console.error('API ERROR DATA:', JSON.stringify(error.response.data, null, 2));
                    console.error('API URL:', error.config?.url);
                    console.error('API PARAMS:', error.config?.params);

                } else if (error.request) {
                    // Request sent but no response received (timeout, network, rate limit proxy issues)
                    console.error('NO RESPONSE FROM API');
                    console.error('REQUEST:', error.request);

                } else {
                    // Non axios error (Prisma, JS error, etc.)
                    console.error('GENERAL ERROR:', error.message);
                }

                console.error(error.stack);
            }
        }

        // Runs once after every league in this batch has been processed, not per-league -
        // a single up-to-date snapshot across everything just synced, not N partial ones.
        try {
            await generateMissingStatsReport();
        } catch (error) {
            console.error('[!] Failed to generate missing stats report:', error.message);
        }

    } catch (error) {
        console.error('Fatal crash:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

// 5. Export the functions for use in other files
module.exports = {
    runPipelines,
    chunkArray,
    generateSeasonAverages,
    generateStandings
};