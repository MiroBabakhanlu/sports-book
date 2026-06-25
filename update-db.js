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

function calculateMinutesUntilNextStatusChange(status, kickoffAt) {
    const now = new Date();
    const minutesElapsed = Math.floor((now - new Date(kickoffAt)) / (1000 * 60));

    switch (status) {
        case 'P':
            return 3;
        case 'BT':
            return 5;
        case 'HT':
            return 15;
        case '2H':
            const remainingIn2H = 95 - minutesElapsed;
            if (remainingIn2H <= 15) return 3;
            return Math.max(5, remainingIn2H - 10);
        case '1H':
            const remainingIn1H = 45 - minutesElapsed;
            return remainingIn1H > 0 ? remainingIn1H : 5;
        case 'ET':
            return 15;
        case 'NS':
            if (minutesElapsed >= 0) return 5;
            return Math.abs(minutesElapsed);
        case 'SUSP':
        case 'INT':
        case 'PST':
        case 'TBD':
            return 45;
        default:
            return 15;
    }
}

async function smartUpdateOrchestrator() {
    try {
        await connectDB();

        const activeMatches = await prisma.match.findMany({
            where: {
                status: { notIn: ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'] }
            },
            select: {
                id_api: true,
                status: true,
                kickoff_at: true,
                season_id: true
            }
        });

        if (activeMatches.length === 0) {
            console.log('No live or pending matches to monitor Sleeping for 15 minutes');
            setTimeout(smartUpdateOrchestrator, 15 * 60 * 1000);
            return;
        }

        const matchesToRefresh = activeMatches.filter(m => new Date(m.kickoff_at) <= new Date());

        if (matchesToRefresh.length > 0) {
            console.log(`Refreshing data for ${matchesToRefresh.length} live/past matches`);
            const allFixtureIds = matchesToRefresh.map(m => m.id_api);
            const batches = chunkArray(allFixtureIds, 20);
            const seasonsToRecalculate = new Set();

            for (let i = 0; i < batches.length; i++) {
                const batchIds = batches[i];
                const batchResponse = await axios.get(`${BASE_URL}/fixtures`, {
                    headers: { 'x-apisports-key': API_KEY },
                    params: { ids: batchIds.join('-') }
                });

                const detailedFixtures = batchResponse.data.response || [];

                for (const f of detailedFixtures) {
                    const apiMatchId = f.fixture.id.toString();
                    const currentStatus = f.fixture.status.short;
                    const isFinished = ['FT', 'AET', 'PEN'].includes(currentStatus);

                    const homeTeam = await prisma.team.findUnique({ where: { id_api: f.teams.home.id.toString() } });
                    const awayTeam = await prisma.team.findUnique({ where: { id_api: f.teams.away.id.toString() } });

                    if (!homeTeam || !awayTeam) continue;

                    let winnerTeamId = null;
                    if (isFinished) {
                        if (f.goals.home > f.goals.away) {
                            winnerTeamId = homeTeam.id;
                        } else if (f.goals.away > f.goals.home) {
                            winnerTeamId = awayTeam.id;
                        } else if (currentStatus === 'PEN' && f.score?.penalty) {
                            // If regular goals are tied and it's a penalty status check penalty shootout goals
                            const penHome = f.score.penalty.home;
                            const penAway = f.score.penalty.away;
                            if (penHome > penAway) winnerTeamId = homeTeam.id;
                            if (penAway > penHome) winnerTeamId = awayTeam.id;
                        }
                    }

                    // Update local match state
                    const match = await prisma.match.upsert({
                        where: { id_api: apiMatchId },
                        update: {
                            home_score: f.goals.home,
                            away_score: f.goals.away,
                            status: currentStatus,
                            winner_team_id: winnerTeamId
                        },
                        // create: 
                    });

                    if (isFinished) {
                        const matchedPending = activeMatches.find(m => m.id_api === apiMatchId);
                        if (matchedPending) seasonsToRecalculate.add(matchedPending.season_id);

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
            }

            if (seasonsToRecalculate.size > 0) {
                console.log(`Re-calculating season averages for completed games...`);
                for (const seasonId of seasonsToRecalculate) {
                    await generateSeasonAverages(seasonId);
                }
            }
        }

        const structuralPendingLeft = await prisma.match.findMany({
            where: {
                status: { notIn: ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'] }
            },
            select: {
                status: true,
                kickoff_at: true,
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } }
            }
        });

        let globalWaitMinutes = 15;
        let urgentMatchInfo = "No active matches monitored (Fallback)";

        if (structuralPendingLeft.length > 0) {
            let lowestMinutes = Infinity;

            for (const m of structuralPendingLeft) {
                const minutes = calculateMinutesUntilNextStatusChange(m.status, m.kickoff_at);

                if (minutes < lowestMinutes) {
                    lowestMinutes = minutes;
                    const matchName = `${m.homeTeam?.name || 'Home'} vs ${m.awayTeam?.name || 'Away'}`;
                    urgentMatchInfo = `Waiting for [${m.status}] ${matchName} (Kickoff Time: ${new Date(m.kickoff_at).toISOString()})`;
                }
            }
            globalWaitMinutes = lowestMinutes;
        }

        const rawWait = globalWaitMinutes;
        globalWaitMinutes = Math.max(2, Math.min(globalWaitMinutes, 45));

        const capNotice = rawWait > 45 ? ` (Capped from ${rawWait} mins due to 45-min safety limit)` : '';

        console.log(`Most Urgent Match: ${urgentMatchInfo}`);
        console.log(`Next global run in ${globalWaitMinutes} minutes.${capNotice}`);

        setTimeout(smartUpdateOrchestrator, globalWaitMinutes * 60 * 1000);

    } catch (error) {
        console.error('Engine error context failed:', error.message);
        // On crash, wait 5 minutes before restarting the automation cycle safely
        setTimeout(smartUpdateOrchestrator, 5 * 60 * 1000);
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

// Start execution loop
smartUpdateOrchestrator();