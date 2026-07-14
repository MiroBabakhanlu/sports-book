const { prisma } = require('./src/utils/prisma');

const TARGET_SLUGS = [
    'team-goals', 'total-goals',
    'team-yellow-cards', 'total-yellow-cards',
    'team-red-cards', 'total-red-cards',
    'team-corner-kicks', 'total-corner-kicks'
];

// IF avg is a whole number:
//     return avg
// ─── Streak Strength Score helpers ──────────────────────────────
function suggestedThreshold(avg) {
    return (avg % 1 === 0) ? avg : Math.floor(avg) + 0.5;
}

function calcStreakConfidence(n, avg, threshold) {
    if (!n || n <= 0 || !threshold || threshold <= 0) return 0;

    const S = 1 - Math.exp(-n / 5);                                   // streak-length score
    const A = Math.max(0, 1 - Math.abs(threshold - avg) / threshold); // average-closeness score
    const C = 100 * Math.pow(S, 0.6) * Math.pow(A, 0.4);              // C = 100 * S^0.6 * A^0.4

    return Math.round(C * 100) / 100; // 2 decimals
}
// ────────────────────────────────────────────────────────────────

async function calculateLeagueStreaks(leagueId, seasonYear) {
    try {
        console.log(`\n📊 [Streak Worker] Starting for League: ${leagueId}, Season: ${seasonYear}`);

        // 1. Resolve Season
        const season = await prisma.season.findFirst({
            where: {
                league: { id_api: String(leagueId) },
                year: String(seasonYear)
            }
        });

        if (!season) return console.log(`[!] Season ${seasonYear} for League ${leagueId} not found.`);

        // 2. Get target market IDs
        const targetMarkets = await prisma.market.findMany({ where: { slug: { in: TARGET_SLUGS } } });
        const targetMarketIds = targetMarkets.map(m => m.id);

        // 3. Get all averages
        const averages = await prisma.teamSeasonAverage.findMany({
            where: { season_id: season.id, market_id: { in: targetMarketIds } }
        });

        const teamIds = [...new Set(averages.map(a => a.team_id))];
        let upsertCount = 0;

        for (const teamId of teamIds) {
            // Get all finished matches for this team
            const recentStats = await prisma.matchTeamStat.findMany({
                where: {
                    team_id: teamId,
                    market_id: { in: targetMarketIds },
                    match: { season_id: season.id, status: { in: ['FT', 'AET', 'PEN'] } }
                },
                orderBy: { match: { kickoff_at: 'desc' } }
            });

            const teamAverages = averages.filter(a => a.team_id === teamId);

            for (const avg of teamAverages) {
                const marketStats = recentStats.filter(s => s.market_id === avg.market_id);
                if (marketStats.length === 0) continue;

                const averageValue = Number(avg.avg_value);
                const mostRecentValue = Number(marketStats[0].value);

                // If most recent is exactly the average, streak is broken/non-existent
                // if (mostRecentValue === averageValue) {
                //     await prisma.teamStreak.deleteMany({
                //         where: { team_id: teamId, season_id: season.id, market_id: avg.market_id }
                //     });
                //     continue;
                // }

                // Determine streak direction based on the latest game
                const streakDirection = mostRecentValue > averageValue ? 'above' : 'below';
                let currentStreak = 0;

                // Count backwards from most recent match
                for (const stat of marketStats) {
                    const matchValue = Number(stat.value);
                    const isAbove = matchValue > averageValue;
                    const isBelow = matchValue < averageValue;

                    if ((streakDirection === 'above' && isAbove) || (streakDirection === 'below' && isBelow)) {
                        currentStreak++;
                    } else {
                        // Streak broken immediately when condition flips
                        break;
                    }
                }

                // ─── Compute Streak Strength Score ───
                const threshold = suggestedThreshold(averageValue);
                const confidence = calcStreakConfidence(currentStreak, averageValue, threshold);

                // Save or Update streak
                await prisma.teamStreak.upsert({
                    where: {
                        team_id_season_id_market_id: {
                            team_id: teamId,
                            season_id: season.id,
                            market_id: avg.market_id
                        }
                    },
                    update: {
                        streak_length: currentStreak,
                        streak_direction: streakDirection,
                        confidence
                    },
                    create: {
                        team_id: teamId,
                        season_id: season.id,
                        market_id: avg.market_id,
                        streak_length: currentStreak,
                        streak_direction: streakDirection,
                        confidence
                    }
                });
                upsertCount++;
            }
        }
        console.log(`✅ [Streak Worker] Updated ${upsertCount} streaks.`);
    } catch (error) {
        console.error(`❌ [Streak Worker] Error:`, error.message);
    }
}

// ---------------------------------------------------------
// Scheduler
// ---------------------------------------------------------
function startStreakWorker(tasks) {
    console.log("⏰ Starting Independent Streak Calculation Worker...");
    const runAllTasks = async () => {
        for (const [leagueId, seasonYear] of tasks) {
            await calculateLeagueStreaks(leagueId, seasonYear);
        }
    };
    runAllTasks();
    setInterval(runAllTasks, 15 * 60 * 1000);
}

module.exports = { startStreakWorker };