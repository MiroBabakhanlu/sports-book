import { state } from "./state_stats.js";

import {
    renderTeamDashboard,
    selectTeam,
    renderSeasonsDropdown,
    toggleLeagueDropdown,
    renderTeamsList,
    selectSeason,
    renderInsightsDashboard,
    handleStreakPopUp,
    renderMarketComparisonTable,
    openTableView,
    updateUpcomingFilterUI,
    toggleAuditPanel,
    openTab,
    setActiveTabButton,
    closeTableView
} from "./render_stats.js";

export function getColorForValue(value, avgValue) {
    if (value === null || value === undefined || value === '-') {
        return 'text-gray-300';
    }
    const numVal = Number(value);
    const avgNum = Number(avgValue);

    if (numVal > avgNum) {
        return 'text-blue-600 font-bold bg-blue-50/50 rounded';
    }
    if (numVal < avgNum) {
        return 'text-red-500 font-medium bg-red-50/30 rounded';
    }
    return 'text-gray-600';
}
export function calculateLeagueMarketCounts(insights) {
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
// ⭐ Updated to return the whole object instead of just the odd number
export const getOddForPrediction = (market, direction, val) => {
    const searchStr = `${direction.toLowerCase()}-${val}`;
    return market.odds?.find(o => o.selection.toLowerCase() === searchStr) || null;
};

export function prepareInsightsData(result) {

    const insights = [];

    result.data.forEach(match => {

        const mwOdds = match.matchWinnerOdds || [];

        // Pick the best (highest) odd per selection to display on the card
        const pickBest = (selection) =>
            mwOdds
                .filter(o => o.selection === selection)
                .sort((a, b) => Number(b.odd) - Number(a.odd))[0] || null;

        const homeOddObj = pickBest('home');
        const awayOddObj = pickBest('away');

        match.marketData.forEach(m => {
            // ⭐ 1. Grab ALL available odds for this market on this match
            const allMarketOdds = m.odds || [];

            // Helper just to find the best odd to display on the main dashboard card
            const getBestOdd = (market, direction, val) => {
                const searchStr = `${direction.toLowerCase()}-${val}`;
                const matches = market.odds?.filter(o => o.selection.toLowerCase() === searchStr) || [];
                matches.sort((a, b) => Number(b.odd) - Number(a.odd));
                return matches[0] || null;
            };

            // Team-specific slugs (e.g. 'total-home', 'home-corners-overunder') only ever
            // describe one side of the match; the streak computed for the other side isn't
            // a real signal for this market. Must be excluded here (not just at render time)
            // so counts (sidebar badges, admin panel) match what's actually shown.
            const slug = (m.marketSlug || '').toLowerCase();
            const homeSideValid = !slug.includes('away');
            const awaySideValid = !slug.includes('home');

            // HOME STREAK
            if (homeSideValid && m.home?.streak?.length >= 3) {
                const direction = m.home.streak.direction == 'below' ? 'OVER' : 'UNDER';
                const bestOdd = getBestOdd(m, direction, m.home.suggestedValue);

                insights.push({
                    match, isHome: true, market: m,
                    homeOdd: homeOddObj?.odd || '—', awayOdd: awayOddObj?.odd || '—',
                    matchWinnerOdds: match.matchWinnerOdds || [],
                    homeOddLogo: homeOddObj?.bookmaker?.logo_url || null,   // ⭐ NEW
                    awayOddLogo: awayOddObj?.bookmaker?.logo_url || null,   // ⭐ NEW
                    streakCount: m.home.streak.length,
                    confidence: m.home.streak.confidence ?? null,
                    suggestedValue: m.home.suggestedValue,
                    avgValue: m.home.avg_value,
                    direction,
                    specificOdd: bestOdd ? bestOdd.odd : null,
                    bookmakerLogoUrl: bestOdd?.bookmaker?.logo_url || null,
                    allMarketOdds: allMarketOdds // ⭐ Save ALL market odds for the popup
                });
            }

            // AWAY STREAK
            if (awaySideValid && m.away?.streak?.length >= 3) {
                const direction = m.away.streak.direction == 'below' ? 'OVER' : 'UNDER';
                const bestOdd = getBestOdd(m, direction, m.away.suggestedValue);

                insights.push({
                    match, isHome: false, market: m,
                    homeOdd: homeOddObj?.odd || '—', awayOdd: awayOddObj?.odd || '—',
                    matchWinnerOdds: match.matchWinnerOdds || [],
                    homeOddLogo: homeOddObj?.bookmaker?.logo_url || null,   // ⭐ NEW
                    awayOddLogo: awayOddObj?.bookmaker?.logo_url || null,
                    confidence: m.away.streak.confidence ?? null,  // ⭐ NEW
                    streakCount: m.away.streak.length,
                    suggestedValue: m.away.suggestedValue,
                    avgValue: m.away.avg_value,
                    direction,
                    specificOdd: bestOdd ? bestOdd.odd : null,
                    bookmakerLogoUrl: bestOdd?.bookmaker?.logo_url || null,
                    allMarketOdds: allMarketOdds // ⭐ Save ALL market odds for the popup
                });
            }
        });
    });

    insights.sort((a, b) => b.streakCount - a.streakCount);
    return insights;
}