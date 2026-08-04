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
                                'team-corner-kicks', 'total-corner-kicks',
                                'total-goals-1st-half', 'total-goals-2nd-half',
                                'team-goals-conceded',
                                'team-goals-1st-half', 'team-goals-2nd-half', 'team-possession', 'team-shots', 'team-clean-sheets',
                                'oddeven', 'both-teams-score'
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
                const homePossession = getRawStatValue(homeStatsArray, 'Ball Possession');
                const awayPossession = getRawStatValue(awayStatsArray, 'Ball Possession');
                const homeShots = getRawStatValue(homeStatsArray, 'Total Shots');
                const awayShots = getRawStatValue(awayStatsArray, 'Total Shots');

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
                    } else if (market.slug === 'total-goals-1st-half') {
                        finalValue = homeGoalsHT + awayGoalsHT;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    } else if (market.slug === 'total-goals-2nd-half') {
                        finalValue = homeGoals2H + awayGoals2H;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, finalValue, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, finalValue, 'away');
                    } else if (market.slug === 'team-goals-conceded') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, awayGoals, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, homeGoals, 'away');
                    } else if (market.slug === 'team-goals-1st-half') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeGoalsHT, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayGoalsHT, 'away');
                    } else if (market.slug === 'team-goals-2nd-half') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeGoals2H, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayGoals2H, 'away');
                    } else if (market.slug === 'team-possession') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homePossession, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayPossession, 'away');
                    } else if (market.slug === 'team-shots') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, homeShots, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, awayShots, 'away');
                    } else if (market.slug === 'team-clean-sheets') {
                        await upsertMatchStat(match.id, homeTeam.id, market.id, awayGoals === 0 ? 1 : 0, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, homeGoals === 0 ? 1 : 0, 'away');
                    } else if (market.slug === 'oddeven') {
                        const isOdd = (homeGoals + awayGoals) % 2 === 1 ? 1 : 0;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, isOdd, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, isOdd, 'away');
                    } else if (market.slug === 'both-teams-score') {
                        const btts = (homeGoals > 0 && awayGoals > 0) ? 1 : 0;
                        await upsertMatchStat(match.id, homeTeam.id, market.id, btts, 'home');
                        await upsertMatchStat(match.id, awayTeam.id, market.id, btts, 'away');
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
                await generateStandings(seasonId);
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

// League table (W/D/L/points/goal difference) for a season - same logic as
// pop-db.js's generateStandings, non-transactional (this file uses plain `prisma`,
// not a tx client, matching how generateSeasonAverages above is already written).
async function generateStandings(seasonId) {
    const matches = await prisma.match.findMany({
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
        await prisma.teamStanding.upsert({
            where: { team_id_season_id: { team_id: row.team_id, season_id: seasonId } },
            update: data,
            create: { team_id: row.team_id, season_id: seasonId, ...data }
        });
    }
}

// Kickstart script execution loop
simplifiedUpdateOrchestrator();