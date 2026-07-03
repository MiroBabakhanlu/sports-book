const { prisma, connectDB } = require('./src/utils/prisma');
const axios = require('axios');
const { startStreakWorker } = require('./streak-tracker');

const API_KEY = 'be6628089266c3f9779a94c9744b1dcf';
const BASE_URL = 'https://v3.football.api-sports.io';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Dummy/Placeholder for your streak tracking function
async function testStreak(streakArray) {
    console.log('🔥 testStreak called with payload:', JSON.stringify(streakArray));
    // Your custom calculation logic runs here
}

async function simplifiedUpdateOrchestrator() {
    try {
        await connectDB();
        const now = new Date();

        console.log(`\n🕒 Starting update round at: ${now.toISOString()}`);

        // ==========================================
        // PHASE 1: CHECK POSTPONED (PST) GAMES
        // ==========================================
        const postponedMatches = await prisma.match.findMany({
            where: { status: 'PST' },
            select: { id_api: true }
        });

        if (postponedMatches.length > 0) {
            console.log(`🔄 Checking ${postponedMatches.length} postponed matches for rescheduling...`);
            const pstChunks = chunkArray(postponedMatches.map(m => m.id_api), 20);

            for (const batch of pstChunks) {
                const response = await axios.get(`${BASE_URL}/fixtures`, {
                    headers: { 'x-apisports-key': API_KEY },
                    params: { ids: batch.join('-') }
                });

                const fixtures = response.data.response || [];
                for (const f of fixtures) {
                    // If the API says it's back to "Not Started", update status and kickoff time
                    if (f.fixture.status.short === 'NS') {
                        const newKickoff = new Date(f.fixture.date);
                        await prisma.match.update({
                            where: { id_api: f.fixture.id.toString() },
                            data: {
                                status: 'NS',
                                kickoff_at: newKickoff
                            }
                        });
                        console.log(`⏰ Match Rescheduled: API ID ${f.fixture.id} is now NS. New Kickoff: ${newKickoff.toISOString()}`);
                    }
                }
            }
        }

        // ==========================================
        // PHASE 2: CHECK NOT STARTED (NS) GAMES PAST KICKOFF
        // ==========================================
        const nsMatches = await prisma.match.findMany({
            where: {
                status: 'NS',
                kickoff_at: { lte: now } // Only check games that are supposed to have started
            },
            select: {
                id_api: true,
                season_id: true
            }
        });

        if (nsMatches.length === 0) {
            console.log('😴 No unstarted matches past kickoff time to check for completion.');
            return;
        }

        console.log(`🔍 Checking completion status on API for ${nsMatches.length} matches...`);
        const nsChunks = chunkArray(nsMatches.map(m => m.id_api), 20);

        const seasonsToRecalculate = new Set();
        const uniqueStreaksMap = new Map(); // Using a map to guarantee uniqueness of [leagueId, season]

        for (const batch of nsChunks) {
            const response = await axios.get(`${BASE_URL}/fixtures`, {
                headers: { 'x-apisports-key': API_KEY },
                params: { ids: batch.join('-') }
            });

            const fixtures = response.data.response || [];

            for (const f of fixtures) {
                const currentStatus = f.fixture.status.short;
                const isFinished = ['FT', 'AET', 'PEN'].includes(currentStatus);

                // If the game isn't finished yet (still playing or went back to postponed), ignore it
                if (!isFinished) continue;

                const apiMatchId = f.fixture.id.toString();
                console.log(`🏁 Match Finished: API ID ${apiMatchId} (${f.teams.home.name} vs ${f.teams.away.name})`);

                const homeTeam = await prisma.team.findUnique({ where: { id_api: f.teams.home.id.toString() } });
                const awayTeam = await prisma.team.findUnique({ where: { id_api: f.teams.away.id.toString() } });

                if (!homeTeam || !awayTeam) continue;

                // Determine Match Winner
                let winnerTeamId = null;
                if (f.goals.home > f.goals.away) {
                    winnerTeamId = homeTeam.id;
                } else if (f.goals.away > f.goals.home) {
                    winnerTeamId = awayTeam.id;
                } else if (currentStatus === 'PEN' && f.score?.penalty) {
                    const penHome = f.score.penalty.home;
                    const penAway = f.score.penalty.away;
                    if (penHome > penAway) winnerTeamId = homeTeam.id;
                    if (penAway > penHome) winnerTeamId = awayTeam.id;
                }

                // Update Match Record
                const match = await prisma.match.update({
                    where: { id_api: apiMatchId },
                    data: {
                        home_score: f.goals.home,
                        away_score: f.goals.away,
                        status: currentStatus,
                        winner_team_id: winnerTeamId
                    }
                });

                // Track database season internal ID for performance averages calculations
                const originalMatch = nsMatches.find(m => m.id_api === apiMatchId);
                if (originalMatch) seasonsToRecalculate.add(originalMatch.season_id);

                // Group data for the streak function: Key looks like "7139-2024"
                const leagueApiId = f.league.id;
                const seasonYear = f.league.season;
                uniqueStreaksMap.set(`${leagueApiId}-${seasonYear}`, [leagueApiId, seasonYear]);

                // ==========================================
                // STATS PROCESSING (MARKETS LOGIC)
                // ==========================================
                const dbMarkets = await prisma.market.findMany({
                    where: {
                        slug: {
                            in: [
                                'team-goals', 'total-goals', 'team-yellow-cards',
                                'total-yellow-cards', 'team-red-cards', 'total-red-cards',
                                'team-corner-kicks', 'total-corner-kicks'
                            ]
                        }
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
                    } else if (market.slug === 'total-goals') {
                        finalValue = homeGoals + awayGoals;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    } else if (market.slug === 'team-yellow-cards') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeYellows, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayYellows, 'away');
                    } else if (market.slug === 'total-yellow-cards') {
                        finalValue = homeYellows + awayYellows;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    } else if (market.slug === 'team-red-cards') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeReds, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayReds, 'away');
                    } else if (market.slug === 'total-red-cards') {
                        finalValue = homeReds + awayReds;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    } else if (market.slug === 'team-corner-kicks') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeCorners, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayCorners, 'away');
                    } else if (market.slug === 'total-corner-kicks') {
                        finalValue = homeCorners + awayCorners;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    }
                }
            }
        }

        // ==========================================
        // PHASE 3: PROCESS SEASON AVERAGES & STREAKS
        // ==========================================

        // 1. Recalculate rolling stats for seasons that had match updates
        if (seasonsToRecalculate.size > 0) {
            console.log(`📊 Recalculating performance averages...`);
            for (const seasonId of seasonsToRecalculate) {
                await generateSeasonAverages(seasonId);
            }
        }

        // 2. Format unique combinations into an array of arrays and call streak function
        if (uniqueStreaksMap.size > 0) {
            const streakPayload = Array.from(uniqueStreaksMap.values());
            // Result payload format: [[7139, 2024], [169, 2024]]

            await startStreakWorker(streakPayload);
        }

    } catch (error) {
        console.error('❌ Error during update cycle:', error.message);
    } finally {
        await prisma.$disconnect();
        console.log('⏰ Cycle finished. Waiting 10 minutes for next check...');
        setTimeout(simplifiedUpdateOrchestrator, 10 * 60 * 1000);
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
        where: { match: { season_id: seasonId, status: { in: ['FT', 'AET', 'PEN'] } } }
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

        const avgOverall = metrics.countAll > 0 ? Number((metrics.totalAll / metrics.countAll).toFixed(2)) : 0;
        const avgHome = metrics.countHome > 0 ? Number((metrics.totalHome / metrics.countHome).toFixed(2)) : null;
        const avgAway = metrics.countAway > 0 ? Number((metrics.totalAway / metrics.countAway).toFixed(2)) : null;

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
}

// Kickstart script execution loop
simplifiedUpdateOrchestrator();