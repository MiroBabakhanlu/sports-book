import { state } from "./state_stats.js";

const API_TEAM_URL = '/api/teams';


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

import { fetchTeamDashboardData, fetchSeasonsForLeague, fetchTeamsForSeason, fetchAndRenderUpcomingMatches, handleUpComingMatchesUi } from "../main.js";

import { prepareInsightsData, calculateLeagueMarketCounts, getColorForValue, getOddForPrediction } from "./utils_stats.js";

export function loadStatEvents() {


    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const response = await fetch(`${API_TEAM_URL}/leagues`);
            const result = await response.json();
            state.allLeaguesData = result?.data;
            if (!result.success) throw new Error(result.message);

            const leaguesContainer = document.getElementById('leaguesContainer');

            leaguesContainer.innerHTML = result.data.map(l => `
            <div class="border border-gray-100 rounded-lg overflow-hidden bg-white mb-1">
                <button id="league-btn-${l.id}"
                    data-league-id="${l.id}"
                    data-league-name="${l.name}"
                    class="league-btn w-full text-left bg-white hover:bg-gray-50 px-3 py-2.5 text-xs font-semibold transition-all flex justify-between items-center text-gray-700 border-l-4 border-transparent">

                    <span class="flex items-center gap-2">
                        <span>${l.name} ${l?.country || ''}</span>
                        <span id="sidebar-count-${l.id}" class="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full text-[9px] font-bold">0</span>
                    </span>

                    <span
                        id="arrow-${l.id}"
                        class="text-[10px] text-gray-400 transform transition-transform duration-200 cursor-pointer px-2"
                        onclick="toggleLeagueDropdown(${l.id}, '${l.name.replace(/'/g, "\\'")}')"
                    >&darr;</span>
                </button>

                <div id="dropdown-seasons-${l.id}" class="hidden bg-gray-50/50 px-2 py-1.5 space-y-1 border-t border-gray-150">
                    <div class="text-[11px] text-gray-400 italic p-1 text-center">
                        Loading seasons...
                    </div>
                </div>
            </div>
        `).join('');


            leaguesContainer.querySelectorAll('.league-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const leagueId = parseInt(btn.dataset.leagueId);
                    const leagueName = btn.dataset.leagueName;

                    // Ignore arrow click
                    if (e.target.closest(`#arrow-${leagueId}`)) {
                        return;
                    }


                    if (state.neededDataForUpCOmmingGames) {
                        handleUpComingMatchesUi(state.neededDataForUpCOmmingGames);
                    }


                    const isTeamSelected =
                        state.filterByTeam !== null &&
                        state.filterByTeam !== undefined;



                    // SAME LEAGUE CLICKED
                    if (state.filterByLeague === leagueId) {

                        if (isTeamSelected) {

                            // Team selected -> clicking league
                            // Remove team filter but keep league and dropdown open
                            state.filterByTeam = null;
                            state.filterByLeague = leagueId;


                            btn.classList.remove(
                                'bg-white',
                                'text-gray-700',
                                'border-transparent'
                            );

                            btn.classList.add(
                                'bg-purple-50',
                                'text-purple-700',
                                'border-purple-500'
                            );


                            // Make sure dropdown stays open
                            const dropdown = document.getElementById(
                                `dropdown-seasons-${leagueId}`
                            );

                            if (dropdown.classList.contains('hidden')) {
                                toggleLeagueDropdown(
                                    leagueId,
                                    leagueName
                                );
                            }


                        } else {

                            // Same league clicked again with no team selected
                            // Remove league filter and close dropdown
                            state.filterByLeague = null;


                            btn.classList.remove(
                                'bg-purple-50',
                                'text-purple-700',
                                'border-purple-500'
                            );

                            btn.classList.add(
                                'bg-white',
                                'text-gray-700',
                                'border-transparent'
                            );


                            const dropdown = document.getElementById(
                                `dropdown-seasons-${leagueId}`
                            );

                            if (!dropdown.classList.contains('hidden')) {
                                toggleLeagueDropdown(
                                    leagueId,
                                    leagueName
                                );
                            }
                        }



                    } else {

                        // NEW LEAGUE SELECTED
                        state.filterByLeague = leagueId;
                        state.filterByTeam = null;


                        // Reset other buttons
                        leaguesContainer.querySelectorAll('.league-btn').forEach(otherBtn => {

                            otherBtn.classList.remove(
                                'bg-purple-50',
                                'text-purple-700',
                                'border-purple-500'
                            );

                            otherBtn.classList.add(
                                'bg-white',
                                'text-gray-700',
                                'border-transparent'
                            );
                        });



                        // Highlight selected league
                        btn.classList.remove(
                            'bg-white',
                            'text-gray-700',
                            'border-transparent'
                        );

                        btn.classList.add(
                            'bg-purple-50',
                            'text-purple-700',
                            'border-purple-500'
                        );



                        // Open dropdown if actually hidden
                        const dropdown = document.getElementById(
                            `dropdown-seasons-${leagueId}`
                        );

                        if (dropdown.classList.contains('hidden')) {
                            toggleLeagueDropdown(
                                leagueId,
                                leagueName
                            );
                        }
                    }



                    if (typeof window.refreshInsightsDashboard === 'function') {
                        window.refreshInsightsDashboard();
                    }


                    console.log(
                        'League Filter:',
                        state.filterByLeague,
                        '| Team Filter:',
                        state.filterByTeam
                    );
                });
            });


            document.getElementById('dashboardPlaceholder').classList.add('hidden');
            document.getElementById('openAllMArketsBtn').click();


        } catch (err) {

            console.error(err);

            document.getElementById('leaguesContainer').innerHTML =
                `<div class="text-xs text-red-500 p-2">Error structural config loading.</div>`;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTableView();
        }
    });
    document.getElementById('openCurrTeamAvgsBtn').addEventListener('click', () => {
        openTab('team-avgs-container');
    })
    document.getElementById('openFullTimeGameViewBtn').addEventListener('click', () => {
        openTab('matchday-container');
    })
    document.getElementById('openUpcomingMatchesContainerBtn').addEventListener('click', () => {
        openTab('upcoming-matches-container');
    })
    document.getElementById('openInDepthView').addEventListener('click', () => {
        openTab('in-depth-container')
        // openTableView();
    })
    document.getElementById('league-games').addEventListener('click', () => {
        activeUpcomingFilter = 'league';
        updateUpcomingFilterUI('league');
        fetchAndRenderUpcomingMatches({
            leagueId: activeOpenLeagueId,
            seasonYear: selectedSeasonYear
        })
    })
    document.getElementById('team-games').addEventListener('click', () => {
        activeUpcomingFilter = 'team';
        updateUpcomingFilterUI('team');
        fetchAndRenderUpcomingMatches({
            teamId: selectedTeamId,
            seasonYear: selectedSeasonYear
        })
    })

    document.getElementById('openAllMArketsBtn').addEventListener('click', async () => {
        console.log('allLeaguesData', state.allLeaguesData);

        const availableSeason = '2026';

        // Extract all league IDs into a comma-separated string
        const leagueIds = state.allLeaguesData.map(league => league?.id).filter(Boolean).join(',');

        const params = new URLSearchParams({ season: availableSeason });
        if (leagueIds) params.append('leagueIds', leagueIds);

        // ONE single network request instead of a loop
        const response = await fetch(`${API_TEAM_URL}/upcoming-games?${params.toString()}`);
        const result = await response.json();

        let AllLeaguesResults = { data: result.data || [] };
        console.log(AllLeaguesResults);

        state.neededDataForUpCOmmingGames = AllLeaguesResults;
        document.getElementById('dashboardPlaceholder').classList.add('hidden');
        document.getElementById('dashboardDataGrid').classList.remove('hidden');
        document.getElementById('navContainer').style.display = 'none';
        openTab('upcoming-matches-container');

        const insights = [];

        AllLeaguesResults.data.forEach(match => {
            const homeOddObj = match.matchWinnerOdds?.find(o => o.selection === 'home');
            const awayOddObj = match.matchWinnerOdds?.find(o => o.selection === 'away');

            match.marketData.forEach(m => {
                // Team-specific slugs (e.g. 'total-home', 'home-corners-overunder') only ever
                // describe one side of the match; the streak computed for the other side isn't
                // a real signal for this market. Must be excluded here (not just at render time
                // in renderInsightsDashboard) so the sidebar count badge matches what's shown.
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
        handleUpComingMatchesUi(AllLeaguesResults);

        let leagueMarketCounts = calculateLeagueMarketCounts(insights);
        console.log(leagueMarketCounts);

        state.allLeaguesData.forEach(league => {
            const countSpan = document.getElementById(`sidebar-count-${league.id}`);
            if (countSpan) {
                const count = leagueMarketCounts[league.id] || 0;
                countSpan.textContent = count;

                if (count === 0) {
                    countSpan.classList.add('hidden');
                } else {
                    countSpan.classList.remove('hidden');
                }
            }
        });
    });



}
