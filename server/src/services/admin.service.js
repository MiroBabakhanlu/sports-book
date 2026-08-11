const crypto = require("crypto");
const AppError = require("../middlewares/AppError");
const { prisma } = require("../utils/prisma");
const { getUpcomingMatches } = require("./teams.service");

// throw new AppError('Missing mandatory analytical parameter matrices', 400);
const adminService = {

    getALlLeagues: async () => {
        // id as a final tiebreaker: any two leagues that ever end up sharing the
        // same display_order (a fresh league still on its default of 999, or a
        // display_order tie from before the changePinStatus race fix) would
        // otherwise sort in a DB-arbitrary order that can flip between reloads.
        let allLeagues = await prisma.league.findMany({
            orderBy: [
                { is_pinned: 'desc' },
                { display_order: 'asc' },
                { id: 'asc' }
            ]
        }) ?? [];

        return enrichLeaguesWithStreakAndMatchday(allLeagues);
    },
    changeVisibility: async (leagueId) => {
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

        return updatedLeagueData;
    },
    // pinnedIds / unpinnedIds: each is the full ordered list of league ids for that zone.
    // A league's zone membership (which array it's found in) is what determines is_pinned,
    // so dragging an item into the other zone re-pins/un-pins it as part of the same update.
    // NOTE: intentionally does NOT recompute streakCount/currentMatchday - that's an expensive
    // per-league query pipeline meant only for the initial page load, not every reorder.
    changeLeagueOrder: async (pinnedIds, unpinnedIds) => {
        if (!Array.isArray(pinnedIds) || !Array.isArray(unpinnedIds)) {
            throw new AppError('pinnedIds and unpinnedIds arrays are required', 400);
        }

        const updateOperations = [
            ...pinnedIds.map((id, index) => prisma.league.update({
                where: { id: Number(id) },
                data: { is_pinned: true, display_order: index }
            })),
            ...unpinnedIds.map((id, index) => prisma.league.update({
                where: { id: Number(id) },
                data: { is_pinned: false, display_order: index }
            }))
        ];

        const updatedLeagues = await prisma.$transaction(updateOperations);
        return updatedLeagues;
    },
    // Same note as changeLeagueOrder: no streak/matchday recompute here, just the pin write.
    changePinStatus: async (leagueId) => {
        if (!leagueId) {
            throw new AppError('leagueId is required', 400);
        }

        const leagueData = await prisma.league.findUnique({
            where: { id: Number(leagueId) },
            select: { is_pinned: true },
        });

        if (!leagueData) {
            throw new AppError('leagueData is required', 404);
        }

        const nextPinned = !leagueData.is_pinned;

        // Place the league at the end of whichever group it's entering, so the
        // manual toggle behaves the same as dropping it at the end of that zone.
        // Read-then-write, so it has to happen inside one transaction - otherwise
        // two near-simultaneous toggles into the same zone (two tabs, a double
        // click) can both read the same "current max" before either writes,
        // landing both leagues on the same display_order and leaving their
        // relative order arbitrary from then on.
        const updatedLeague = await prisma.$transaction(async (tx) => {
            const lastInGroup = await tx.league.findFirst({
                where: { is_pinned: nextPinned },
                orderBy: { display_order: 'desc' },
                select: { display_order: true }
            });

            return tx.league.update({
                where: { id: Number(leagueId) },
                data: {
                    is_pinned: nextPinned,
                    display_order: (lastInGroup?.display_order ?? -1) + 1
                }
            });
        });

        return updatedLeague;
    },

    // Returns the token authMiddleware currently accepts - the "Manage API" admin
    // panel section displays this so it can be copied over to the frontend team.
    getApiToken: async () => {
        const active = await prisma.apiToken.findFirst({
            where: { is_active: true },
            orderBy: { created_at: 'desc' }
        });

        if (!active) {
            throw new AppError('No active API token found', 404);
        }

        return active;
    },

    // Deactivates the current token and issues a new one. Takes effect immediately -
    // authMiddleware checks is_active on every request, so the old token stops
    // working the instant this runs. The new value must be handed to the frontend
    // team before/along with rotating it, or their requests start 401ing.
    regenerateApiToken: async () => {
        const newToken = crypto.randomBytes(32).toString('hex');

        const [, created] = await prisma.$transaction([
            prisma.apiToken.updateMany({ where: { is_active: true }, data: { is_active: false } }),
            prisma.apiToken.create({ data: { token: newToken } })
        ]);

        return created;
    },

    // ErrorLog grows without bound (see errorMiddleware.js), so this is always
    // keyset pagination on `id` - never OFFSET/skip-by-count, which gets slower
    // the deeper the admin panel scrolls as the table grows. Two modes:
    //   - afterId: "what's new since I last checked" (the 1-min poll) - every
    //     row newer than a known id, capped so a genuine error storm can't
    //     return an unbounded response.
    //   - cursor: "give me the next page going backward" (the Load More
    //     button) - everything older than a known id, page-sized.
    getErrorLogs: async ({ cursor, afterId, limit = 25 } = {}) => {
        if (afterId) {
            const items = await prisma.errorLog.findMany({
                where: { id: { gt: Number(afterId) } },
                orderBy: { id: 'desc' },
                take: 50
            });
            return { items, next_cursor: null, has_more: false };
        }

        const take = Math.min(Number(limit) || 25, 100);
        const rows = await prisma.errorLog.findMany({
            take: take + 1, // one extra row just to know if there's a next page, not returned
            ...(cursor ? { skip: 1, cursor: { id: Number(cursor) } } : {}),
            orderBy: { id: 'desc' }
        });

        const hasMore = rows.length > take;
        const items = hasMore ? rows.slice(0, take) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;

        return { items, next_cursor: nextCursor, has_more: hasMore };
    }

}

// Adds streakCount and currentMatchday to each league. Every endpoint that returns
// league lists to the admin UI needs this, or those fields silently fall back to 0/undefined.
async function enrichLeaguesWithStreakAndMatchday(allLeagues) {
    // getUpcomingMatches's param is leagueIds (plural/array) - fetch once for every league
    // and derive per-league counts from the single result, instead of calling it once per
    // league (which used to silently ignore the filter and refetch+reprocess the entire
    // upcoming-matches dataset N times).
    const leagueIds = allLeagues.map(league => league.id);
    const upcomingMatches = await getUpcomingMatches({ leagueIds, seasonYear: 2026 });
    const streakCountsByLeague = handleLeaueStreakCount(upcomingMatches);

    for (const league of allLeagues) {
        const leagueId = league.id;

        league.streakCount = streakCountsByLeague[`${leagueId}`] ?? 0;

        // --- FIXED: Current Matchday via Highest Finished Matchday Number ---
        const season = await prisma.season.findFirst({
            where: {
                league_id: leagueId,
                year: "2026"
            }
        });

        if (season) {
            const highestFinishedMatchday = await prisma.match.findFirst({
                where: {
                    season_id: season.id,
                    status: { in: ["FT", "AET", "PEN"] }, // Only finished games
                    matchday: { not: null }
                },
                orderBy: {
                    matchday: 'desc' // <-- YOUR LOGIC: Gets the absolute highest round number first
                },
                select: {
                    matchday: true
                }
            });

            if (highestFinishedMatchday?.matchday) {
                // If Matchday 18 has finished games, this guarantees we display 18
                league.currentMatchday = highestFinishedMatchday.matchday;
            } else {
                // Fallback: If ZERO games have finished yet, default to the first scheduled round
                const firstScheduledMatch = await prisma.match.findFirst({
                    where: { season_id: season.id, matchday: { not: null } },
                    orderBy: { kickoff_at: 'asc' },
                    select: { matchday: true }
                });

                league.currentMatchday = firstScheduledMatch?.matchday ?? 1;
            }
        } else {
            league.currentMatchday = 0;
        }
    }

    return allLeagues;
}

function handleLeaueStreakCount(AllLeaguesResults) {
    const insights = [];

    AllLeaguesResults.forEach(match => {
        const homeOddObj = match.matchWinnerOdds?.find(o => o.selection === 'home');
        const awayOddObj = match.matchWinnerOdds?.find(o => o.selection === 'away');

        match.marketData.forEach(m => {
            // Team-specific slugs (e.g. 'total-home', 'home-corners-overunder') only ever
            // describe one side of the match. The backend still computes a streak for the
            // other side too (it's a generic per-team lookup), but that value isn't a real
            // signal for this market and must not be counted as an insight - otherwise the
            // count here disagrees with what renderInsightsDashboard actually displays
            // (which already filters these out client-side).
            const slug = (m.marketSlug || '').toLowerCase();
            const homeSideValid = !slug.includes('away');
            const awaySideValid = !slug.includes('home');

            if (homeSideValid && m.home?.streak?.length >= 3) {
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
            if (awaySideValid && m.away?.streak?.length >= 3) {
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

// oddeven/both-teams-score are 1/0 outcomes, not numeric-vs-threshold - MatchOdds
// for them is genuinely stored under 'odd'/'even'/'yes'/'no' (see pop-db.js /
// odds-pipeline.js), not '<direction>-<val>' like every other market here.
// OVER = the positive side (odd/yes) by the same convention used everywhere else.
const BINARY_MARKET_OUTCOMES = {
    'oddeven': { positive: 'odd', negative: 'even' },
    'both-teams-score': { positive: 'yes', negative: 'no' }
};

const getOddForPrediction = (market, direction, val) => {
    const binaryOutcomes = BINARY_MARKET_OUTCOMES[(market.marketSlug || '').toLowerCase()];
    const searchStr = binaryOutcomes
        ? (direction.toUpperCase() === 'OVER' ? binaryOutcomes.positive : binaryOutcomes.negative)
        : `${direction.toLowerCase()}-${val}`;
    const found = market.odds?.find(o => o.selection.toLowerCase() === searchStr);
    return found ? found.odd : null;
};


module.exports = adminService;