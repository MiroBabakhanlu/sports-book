const AppError = require("../middlewares/errorMiddleware");
const { prisma } = require("../utils/prisma");
const { getUpcomingMatches } = require("./teams.service");

// throw new AppError('Missing mandatory analytical parameter matrices', 400);
const adminService = {

    getALlLeagues: async () => {
        let allLeagues = await prisma.league.findMany({
            orderBy: {
                display_order: 'asc'
            }
        }) ?? [];

        let ids = allLeagues.map(league => league.id);

        for (let i = 0; i < ids.length; i++) {
            const test = await getUpcomingMatches({ leagueId: ids[i], seasonYear: 2026 })
            let updatedLeagueData = allLeagues.find(l => l.id == ids[i]);
            updatedLeagueData.streakCount = handleLeaueStreakCount(test)[`${ids[i]}`];
            updatedLeagueData.streakCount == undefined ? updatedLeagueData.streakCount = 0 : ''
        }

        return allLeagues;
    },
    changeVisibility: async (leagueId) => {
        console.log(leagueId)
        if (!leagueId) {
            throw new AppError('leagueId is required', 400);
        }
        const leagueData = await prisma.league.findUnique({
            where: { id: leagueId },
            select: { is_visible: true },
        })

        if (!leagueData) {
            throw new AppError('leagueData is required', 404);
        }

        const updatedLeagueData = await prisma.league.update({
            where: { id: leagueId },
            data: {
                is_visible: !leagueData.is_visible
            }
        })

        const allLeagues = prisma.league.findMany();
        return allLeagues;
    },
    changeLeagueOrder: async (leagueIds) => {
        console.log('leagueIds', leagueIds)
        if (!leagueIds || !Array.isArray(leagueIds)) {
            throw new AppError('leagueIds array is required', 400);
        }

        const updateOperations = leagueIds.map((id, index) => {
            return prisma.league.update({
                where: { id: Number(id) },
                data: { display_order: index }
            });
        });

        await prisma.$transaction(updateOperations);

        const allLeagues = await prisma.league.findMany({
            orderBy: { display_order: 'asc' }
        });
        return allLeagues;
    }

}


function handleLeaueStreakCount(AllLeaguesResults) {
    const insights = [];

    AllLeaguesResults.forEach(match => {
        const homeOddObj = match.matchWinnerOdds?.find(o => o.selection === 'home');
        const awayOddObj = match.matchWinnerOdds?.find(o => o.selection === 'away');

        match.marketData.forEach(m => {
            if (m.home?.streak?.length >= 3) {
                const direction = m?.home?.streak.direction == 'below' ? 'OVER' : 'UNDER';
                const specificOdd = getOddForPrediction(m, direction, m.home.suggestedValue);

                insights.push({
                    match, isHome: true, market: m,
                    homeOdd: homeOddObj?.odd || '—', awayOdd: awayOddObj?.odd || '—',
                    streakCount: m.home.streak.length,
                    suggestedValue: m.home.suggestedValue,
                    avgValue: m.home.avg_value,
                    direction,
                    specificOdd
                });
            }
            if (m.away?.streak?.length >= 3) {
                const direction = m?.away?.streak.direction == 'below' ? 'OVER' : 'UNDER';
                const specificOdd = getOddForPrediction(m, direction, m.away.suggestedValue);

                insights.push({
                    match, isHome: false, market: m,
                    homeOdd: homeOddObj?.odd || '—', awayOdd: awayOddObj?.odd || '—',
                    streakCount: m.away.streak.length,
                    suggestedValue: m.away.suggestedValue,
                    avgValue: m.away.avg_value,
                    direction,
                    specificOdd
                });
            }
        });
    });
    insights.sort((a, b) => b.streakCount - a.streakCount);

    let leagueMarketCounts = calculateLeagueMarketCounts(insights);
    return leagueMarketCounts;
}


function calculateLeagueMarketCounts(insights) {
    if (!insights || !Array.isArray(insights)) return {};

    const leagueMarketCounts = {};

    // 1. Get the master unique list of league IDs
    const allLeagueIds = [...new Set(insights.map(i =>
        i.match.league?.id || i.match.league_id || 'OTHER_LEAGUE'
    ))];

    // 2. Count occurrences for each league ID
    allLeagueIds.forEach(id => {
        const totalResults = insights.filter(i => {
            const currentId = i.match.league?.id || i.match.league_id || 'OTHER_LEAGUE';
            return currentId === id;
        }).length;

        leagueMarketCounts[id] = totalResults;
    });

    return leagueMarketCounts;
}

const getOddForPrediction = (market, direction, val) => {
    const searchStr = `${direction.toLowerCase()}-${val}`;
    const found = market.odds?.find(o => o.selection.toLowerCase() === searchStr);
    return found ? found.odd : null;
};


module.exports = adminService;