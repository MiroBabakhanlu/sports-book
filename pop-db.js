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

async function runCompletePipeline(leagueId, seasonYear) {
    try {
        await connectDB();


        console.log('fetching starts');
        const leagueApiResponse = await axios.get(`${BASE_URL}/leagues`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { id: leagueId, season: seasonYear }
        });

        const data = leagueApiResponse.data.response[0];
        if (!data) throw new Error("League or season data not found on the external API");

        const { league, country, seasons } = data;
        const currentSeason = seasons[0];
        const leagueSlug = league.name.toLowerCase().replace(/ /g, '-');

        const sport = await prisma.sport.findUnique({ where: { slug: 'football' } });
        if (!sport) throw new Error("Sport 'football' not found in DB. Please run your sport seed script first.");

        // upserting League record
        const dbLeague = await prisma.league.upsert({
            where: { slug: leagueSlug },
            update: {},
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
        const dbSeason = await prisma.season.upsert({
            where: {
                id_api_league_id: {
                    id_api: String(currentSeason.year),
                    league_id: dbLeague.id
                }
            },
            update: { is_current: currentSeason.current },
            create: {
                league_id: dbLeague.id,
                year: String(currentSeason.year),
                is_current: currentSeason.current,
                id_api: String(currentSeason.year)
            }
        });
        console.log(`League & Season Are done.`);


        console.log(`now  fetching teams `);
        const teamsResponse = await axios.get(`${BASE_URL}/teams`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { league: leagueId, season: seasonYear }
        });

        const teams = teamsResponse.data.response || [];

        for (const t of teams) {
            await prisma.team.upsert({
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
        console.log(` teams  added in db.`);


        const targetSlugs = [
            'team-goals', 'total-goals',
            'team-yellow-cards', 'total-yellow-cards',
            'team-red-cards', 'total-red-cards',
            'team-corner-kicks', 'total-corner-kicks'
        ];

        const dbMarkets = await prisma.market.findMany({
            where: { slug: { in: targetSlugs } }
        });
        console.log(`Loaded ${dbMarkets.length} from market table`);


        console.log('Fetching fixtures');
        const fixturesResponse = await axios.get(`${BASE_URL}/fixtures`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { league: leagueId, season: seasonYear, status: 'FT' }
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

                const homeTeam = await prisma.team.findUnique({ where: { id_api: f.teams.home.id.toString() } });
                const awayTeam = await prisma.team.findUnique({ where: { id_api: f.teams.away.id.toString() } });

                if (!homeTeam || !awayTeam) {
                    console.log(`team structural layout mismatch`);
                    continue;
                }

                // upserting match record
                const match = await prisma.match.upsert({
                    where: { id_api: apiMatchId },
                    update: {
                        home_score: f.goals.home,
                        away_score: f.goals.away,
                        status: f.fixture.status.short
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
                        venue: f.fixture.venue.name
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
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeGoals, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayGoals, 'away');
                    }
                    else if (market.slug === 'total-goals') {
                        finalValue = homeGoals + awayGoals;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-yellow-cards') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeYellows, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayYellows, 'away');
                    }
                    else if (market.slug === 'total-yellow-cards') {
                        finalValue = homeYellows + awayYellows;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-red-cards') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeReds, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayReds, 'away');
                    }
                    else if (market.slug === 'total-red-cards') {
                        finalValue = homeReds + awayReds;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                    else if (market.slug === 'team-corner-kicks') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeCorners, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayCorners, 'away');
                    }
                    else if (market.slug === 'total-corner-kicks') {
                        finalValue = homeCorners + awayCorners;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                }
            }
        }
        console.log('match events loaded to database');


        await generateSeasonAverages(dbSeason.id);

        console.log(`END  FOR league ${leagueId}!`);

    } catch (error) {
        console.error('crashed:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}


async function upsertMatchStat(matchId, teamId, marketId, value, side) {
    await prisma.matchTeamStat.upsert({
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


async function generateSeasonAverages(seasonId) {
    const stats = await prisma.matchTeamStat.findMany({
        where: { match: { season_id: seasonId } }
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

        const existingRow = await prisma.teamSeasonAverage.findFirst({
            where: { team_id: teamId, season_id: seasonId, market_id: marketId }
        });

        if (existingRow) {
            await prisma.teamSeasonAverage.update({
                where: { id: existingRow.id },
                data: {
                    avg_value: avgOverall,
                    avg_value_home: avgHome,
                    avg_value_away: avgAway,
                    matches_played: metrics.countAll
                }
            });
        } else {
            await prisma.teamSeasonAverage.create({
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

// runCompletePipeline(140, 2025);
runCompletePipeline(135, 2025);