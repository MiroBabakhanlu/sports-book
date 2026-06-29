const { prisma, connectDB } = require('./src/utils/prisma');
const axios = require('axios');

const API_KEY = 'be6628089266c3f9779a94c9744b1dcf';
const BASE_URL = 'https://v3.football.api-sports.io';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
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
        update: { value: value },
        create: {
            match_id: matchId,
            team_id: teamId,
            market_id: marketId,
            value: value,
            side: side
        }
    });
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

// 3. Isolated function to process a single league entirely within a Prisma transaction
async function processLeague(leagueId, seasonYear) {
    // Increased timeout to 5 minutes (300,000ms) to accommodate Axios delays inside the transaction
    await prisma.$transaction(async (tx) => {
        console.log(`\n--- Fetching starts for League ${leagueId}, Season ${seasonYear} ---`);
        const leagueApiResponse = await axios.get(`${BASE_URL}/leagues`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { id: leagueId, season: seasonYear }
        });

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
                slug: leagueSlug,
                country: country.name
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
                is_current: currentSeason.current,
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
                update: { logo_url: t.team.logo },
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
            'team-corner-kicks', 'total-corner-kicks'
        ];

        const dbMarkets = await tx.market.findMany({
            where: { slug: { in: targetSlugs } }
        });
        console.log(`Loaded ${dbMarkets.length} from market table`);

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
                        home_score: f.goals.home,
                        away_score: f.goals.away,
                        status: f.fixture.status.short,
                        winner_team_id: winnerTeamId
                    },
                    create: {
                        id_api: apiMatchId,
                        season_id: dbSeason.id,
                        home_team_id: homeTeam.id,
                        away_team_id: awayTeam.id,
                        matchday: f.league.round ? parseInt(f.league.round.split('-').pop()) : null,
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

                const getRawStatValue = (statsArray, typeString) => {
                    const found = statsArray.find(s => s.type === typeString);
                    return found ? (parseInt(found.value) || 0) : 0;
                };

                const homeGoals = f.goals.home ?? 0;
                const awayGoals = f.goals.away ?? 0;
                const homeYellows = getRawStatValue(homeStatsArray, 'Yellow Cards');
                const awayYellows = getRawStatValue(awayStatsArray, 'Yellow Cards');
                const homeReds = getRawStatValue(homeStatsArray, 'Red Cards');
                const awayReds = getRawStatValue(awayStatsArray, 'Red Cards');
                const homeCorners = getRawStatValue(homeStatsArray, 'Corner Kicks');
                const awayCorners = getRawStatValue(awayStatsArray, 'Corner Kicks');

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
                        finalValue = homeCorners + awayCorners;
                        await upsertMatchStat(tx, match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(tx, match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                }
            }
        }
        console.log('match events loaded to database');

        await generateSeasonAverages(tx, dbSeason.id);

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
                // If it fails, the transaction rolls back, we log it, and move to the next item
                console.error(`\n[!] Transaction Failed & Rolled Back for League ${leagueId}, Season ${seasonYear}.`);
                console.error('Reason:', error.message);
            }
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
    chunkArray
};