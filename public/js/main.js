const API_URL = '/api/teams';
let selectedSeasonId = null;
let selectedTeamId = null;
let activeOpenLeagueId = null;
let selectedSeasonYear = null;
let currentAveragesData = [];
let currentMatchdaysData = [];
let activeTab = 'matchday-container';
let activeUpcomingFilter = 'team';
let allLeaguesData = null;
let globalInsightVariable = null;
let tabs = {
    currTeamMarket: false,
    ftMatches: false,
    upcommingTeamMatches: false,
    upcommingLeagueMatches: false,
}


let selectedLeagues = [];

let filterByLeague = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(`${API_URL}/leagues`);
        const result = await response.json();
        allLeaguesData = result?.data;
        if (!result.success) throw new Error(result.message);

        const leaguesContainer = document.getElementById('leaguesContainer');
        leaguesContainer.innerHTML = result.data.map(l => `
                    <div class="border border-gray-100 rounded-lg overflow-hidden bg-white mb-1">
                        <button onclick="toggleLeagueDropdown(${l.id}, '${l.name.replace(/'/g, "\\'")}')"
                            id="league-btn-${l.id}"
                            data-league-name="${l.name}"
                            class="w-full text-left bg-white hover:bg-gray-50 px-3 py-2.5 text-xs font-semibold transition-all flex justify-between items-center text-gray-700 border-b border-transparent">
                            
                            <span class="flex items-center gap-2">
                                <!-- Dynamic Checkbox Input for Filtering -->
                                <input type="checkbox" 
                                    id="league-chk-${l.id}"
                                    data-league-id="${l.id}"
                                    class="league-filter-chk w-3.5 h-3.5 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer mr-0.5">
                                
                                <span>${l.name} ${l?.country || ''}</span>
                                <span id="sidebar-count-${l.id}" class="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full text-[9px] font-bold">0</span>
                            </span>
                            
                            <span id="arrow-${l.id}" class="text-[10px] text-gray-400 transform transition-transform duration-200">&darr;</span>
                        </button>
                        <div id="dropdown-seasons-${l.id}" class="hidden bg-gray-50/50 px-2 py-1.5 space-y-1 border-t border-gray-150">
                            <div class="text-[11px] text-gray-400 italic p-1 text-center">Loading seasons...</div>
                        </div>
                    </div>
                `).join('');

        // --- Event Listener for Checkboxes ---
        leaguesContainer.querySelectorAll('.league-filter-chk').forEach(chk => {
            chk.addEventListener('click', (e) => {
                if (neededDataForUpCOmmingGames) {
                    handleUpComingMatchesUi(neededDataForUpCOmmingGames)
                }

                // Prevents the button's onclick event from triggering the dropdown
                e.stopPropagation();

                const leagueId = parseInt(chk.dataset.leagueId);

                if (chk.checked) {
                    filterByLeague = leagueId;

                    // Uncheck all other checkboxes to ensure single selection
                    leaguesContainer.querySelectorAll('.league-filter-chk').forEach(otherChk => {
                        if (otherChk !== chk) otherChk.checked = false;
                    });
                } else {
                    // If the current active checkbox is unticked, clear the filter variable
                    if (filterByLeague === leagueId) {
                        filterByLeague = null;
                    }
                }
                if (typeof window.refreshInsightsDashboard === 'function') {
                    window.refreshInsightsDashboard();
                }

                console.log('Selected League ID Filter:', filterByLeague);

            });
        });

        document.getElementById('dashboardPlaceholder').classList.add('hidden');
        document.getElementById('openAllMArketsBtn').click();
    } catch (err) {
        document.getElementById('leaguesContainer').innerHTML = `<div class="text-xs text-red-500 p-2">Error structural config loading.</div>`;
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
    openTableView();
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

let neededDataForUpCOmmingGames = null;
document.getElementById('openAllMArketsBtn').addEventListener('click', async () => {
    console.log('allLeaguesData', allLeaguesData)
    let AllLeaguesResults = { data: [] };
    const availableSeason = '2026';
    for (let index = 0; index < allLeaguesData.length; index++) {
        let leagueId = allLeaguesData[index]?.id;
        const params = new URLSearchParams({ season: availableSeason });
        if (leagueId) params.append('leagueId', leagueId);

        const response = await fetch(`${API_URL}/upcoming-games?${params.toString()}`);
        const result = await response.json();
        console.log(result);
        AllLeaguesResults.data.push(...(result.data));
    }

    console.log(AllLeaguesResults);
    neededDataForUpCOmmingGames = AllLeaguesResults;
    document.getElementById('dashboardPlaceholder').classList.add('hidden');
    document.getElementById('dashboardDataGrid').classList.remove('hidden');
    document.getElementById('navContainer').style.display = 'none'
    openTab('upcoming-matches-container')


    const insights = [];

    AllLeaguesResults.data.forEach(match => {
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
    handleUpComingMatchesUi(AllLeaguesResults)
    let leagueMarketCounts = calculateLeagueMarketCounts(insights);
    console.log(leagueMarketCounts)
    // --- Insert counts next to the correct league name using IDs ---
    allLeaguesData.forEach(league => {
        const countSpan = document.getElementById(`sidebar-count-${league.id}`);
        console.log(countSpan);
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
})

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


function updateUpcomingFilterUI(activeFilter) {
    const leagueSpan = document.getElementById('league-games');
    const teamSpan = document.getElementById('team-games');

    if (activeFilter === 'league') {
        leagueSpan.className = 'text-blue-600 underline decoration-dotted cursor-pointer font-bold';
        teamSpan.className = 'text-gray-500 underline decoration-dotted cursor-pointer hover:text-blue-600 transition-colors';
    } else {
        leagueSpan.className = 'text-gray-500 underline decoration-dotted cursor-pointer hover:text-blue-600 transition-colors';
        teamSpan.className = 'text-blue-600 underline decoration-dotted cursor-pointer font-bold';
    }
}

function toggleAuditPanel(marketSlug) {
    const panel = document.getElementById(`audit-panel-${marketSlug}`);
    const arrow = document.getElementById(`audit-arrow-${marketSlug}`);
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        arrow.innerHTML = 'Audit &uarr;';
        arrow.classList.add('text-blue-600', 'bg-blue-50');
    } else {
        panel.classList.add('hidden');
        arrow.innerHTML = 'Audit &darr;';
        arrow.classList.remove('text-blue-600', 'bg-blue-50');
    }
}

function getColorForValue(value, avgValue) {
    if (value === null || value === undefined || value === '-') {
        return 'text-gray-300';
    }
    const numVal = Number(value);
    const avgNum = Number(avgValue);

    if (numVal === 0) {
        return 'text-red-400 font-medium';
    }
    if (numVal > avgNum) {
        return 'text-blue-600 font-bold bg-blue-50/50 rounded';
    }
    if (numVal < avgNum) {
        return 'text-red-500 font-medium bg-red-50/30 rounded';
    }
    return 'text-gray-600';
}

function openTableView() {
    const container = document.getElementById('in-depth-container');

    if (currentAveragesData.length === 0 || currentMatchdaysData.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-12">
                <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/>
                </svg>
                <p class="text-sm font-medium">No data available</p>
                <p class="text-xs mt-1">Select a configuration tree node path to monitor variables maps logs.</p>
            </div>
        `;
        return;
    }

    const avgLookup = {};
    currentAveragesData.forEach(avg => {
        avgLookup[avg.market.slug.toLowerCase()] = avg.avg_value;
    });

    const finishedMatches = currentMatchdaysData.filter(match => {
        return ['FT', 'AET', 'PEN'].includes(match.status) ||
            (match.team_goals !== null && match.team_goals !== undefined);
    });

    const reversedMatches = [...finishedMatches].reverse();

    if (reversedMatches.length === 0) {
        container.innerHTML = `
            <p class="text-center text-gray-400 py-12 text-sm font-medium">
                No completed or finished fixtures data compiled yet.
            </p>
        `;
        return;
    }

    let tableHTML = `
        <div class="overflow-x-auto">
            <div class="mb-3 text-xs text-gray-500">
                <span class="inline-flex items-center gap-2 mr-4">
                    <span class="inline-block w-3 h-3 rounded bg-red-400"></span> Zero (0)
                </span>
                <span class="inline-flex items-center gap-2">
                    <span class="inline-block w-3 h-3 rounded bg-blue-600"></span> Above Average
                </span>
            </div>

            <table class="w-full border-collapse text-sm">
                <thead>
                    <tr class="bg-gray-50 border-b-2 border-gray-200">
                        <th class="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500 sticky top-0 bg-gray-50 z-10" style="min-width: 140px;">
                            Market
                        </th>
                        <th class="text-center py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500 sticky top-0 bg-gray-50 z-10" style="min-width: 80px;">
                            Avg Value
                        </th>
                        <th class="text-center py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500 sticky top-0 bg-gray-50 z-10" style="min-width: 70px;">
                            Total
                        </th>
                        <th class="text-center py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500 sticky top-0 bg-gray-50 z-10" style="min-width: 70px;">
                            Streak
                        </th>
                        ${reversedMatches.map(match => `
                            <th class="text-center py-3 px-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 sticky top-0 bg-gray-50 z-10 matchday-cell"
                                title="${new Date(match.kickoff_at).toLocaleDateString()}">
                                MD ${match.matchdayNumber}
                            </th>
                        `).join('')}
                    </tr>
                </thead>

                <tbody class="divide-y divide-gray-100">
    `;

    currentAveragesData.forEach((avg, index) => {
        const slug = avg.market.slug.toLowerCase();
        const val = avg.avg_value !== null ? Number(avg.avg_value).toFixed(2) : '-';
        const totalVal = avg.total_sum !== null && avg.total_sum !== undefined ? Math.round(avg.total_sum) : '-';
        const avgValue = avg.avg_value || 0;
        const streakVal = avg.streak?.length ?? 'nc';

        const bgColor = index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50';

        tableHTML += `
            <tr class="${bgColor} hover:bg-gray-100/70 transition-colors">
                <td class="py-3 px-4 font-semibold text-gray-700">
                    <span class="text-[11px] uppercase tracking-wider">
                        ${avg.market.slug.replace(/-/g, ' ')}
                    </span>
                </td>
                <td class="py-3 px-4 text-center font-bold text-gray-900 text-base">${val}</td>
                <td class="py-3 px-4 text-center font-mono text-gray-600 bg-gray-50/50 rounded">${totalVal}</td>
                <td class="py-3 px-4 text-center font-bold text-gray-900 text-base">${streakVal}</td>
        `;

        reversedMatches.forEach(match => {
            let rawValue = '-';

            switch (slug) {
                case 'team-goals':
                    rawValue = match.team_goals ?? '-';
                    break;
                case 'total-goals':
                    rawValue = match.total_goals ?? '-';
                    break;
                case 'team-yellow-cards':
                    rawValue = match.team_yellows ?? '-';
                    break;
                case 'total-yellow-cards':
                    rawValue = match.total_yellows ?? '-';
                    break;
                case 'team-red-cards':
                    rawValue = match.team_reds ?? '-';
                    break;
                case 'total-red-cards':
                    rawValue = match.total_reds ?? '-';
                    break;
                case 'team-corner-kicks':
                    rawValue = match.team_corners ?? '-';
                    break;
                case 'total-corner-kicks':
                    rawValue = match.total_corners ?? '-';
                    break;
                default:
                    rawValue = '-';
            }

            const cellClass = getColorForValue(rawValue, avgValue);

            tableHTML += `
                <td class="text-center py-3 px-2 font-mono text-xs matchday-cell ${cellClass}">
                    ${rawValue}
                </td>
            `;
        });

        tableHTML += `</tr>`;
    });

    tableHTML += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = tableHTML;
}

function closeTableView() {
    document.getElementById('tableViewOverlay').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}
function openTab(tabName) {
    activeTab = tabName;

    const finishedMatchesView = document.getElementById('matchday-container');
    const thisTeamMarketAvgsView = document.getElementById('team-avgs-container');
    const upcomingMatchesContainer = document.getElementById('upcoming-matches-container');
    const inDepthContainer = document.getElementById('in-depth-container');

    finishedMatchesView.style.display = 'none';
    thisTeamMarketAvgsView.style.display = 'none';
    upcomingMatchesContainer.style.display = 'none';
    inDepthContainer.style.display = 'none';
    document.getElementById('upComingGamesSwitchContainer').style.display = 'none'

    if (tabName === 'matchday-container') {
        finishedMatchesView.style.display = 'block';
    }
    if (tabName === 'team-avgs-container') {
        thisTeamMarketAvgsView.style.display = 'block';
    }
    if (tabName === 'upcoming-matches-container') {
        upcomingMatchesContainer.style.display = 'block';
        document.getElementById('upComingGamesSwitchContainer').style.display = 'block'
    }
    if (tabName === 'in-depth-container') {
        inDepthContainer.style.display = 'block';
    }

    setActiveTabButton(tabName);
}
function setActiveTabButton(activeId) {
    const buttons = [
        { btn: document.getElementById('openFullTimeGameViewBtn'), id: 'matchday-container' },
        { btn: document.getElementById('openCurrTeamAvgsBtn'), id: 'team-avgs-container' },
        { btn: document.getElementById('openUpcomingMatchesContainerBtn'), id: 'upcoming-matches-container' },
        { btn: document.getElementById('openInDepthView'), id: 'in-depth-container' },
    ];

    buttons.forEach(({ btn, id }) => {
        if (!btn) return;

        if (id === activeId) {
            btn.classList.add('text-blue-600', 'border-blue-600');
            btn.classList.remove('text-gray-500', 'border-transparent');
        } else {
            btn.classList.remove('text-blue-600', 'border-blue-600');
            btn.classList.add('text-gray-500', 'border-transparent');
        }
    });
}

async function selectTeam(teamId, teamName) {
    selectedTeamId = teamId;
    filterByLeague = null;

    // 3. Uncheck all UI checkboxes in the sidebar
    document.querySelectorAll('.league-filter-chk').forEach(chk => {
        chk.checked = false;
    });

    console.log('Selected Team ID:', teamId, 'Selected Season ID:', selectedSeasonId);
    document.getElementById('navContainer').style.display = 'block'
    document.querySelectorAll('[id^="team-card-"]').forEach(b => b.classList.remove('border-blue-500', 'bg-blue-50/50', 'text-blue-600'));
    const selectedBlock = document.getElementById(`team-card-${teamId}`);
    if (selectedBlock) selectedBlock.classList.add('border-blue-500', 'bg-blue-50/50', 'text-blue-600');

    try {
        const response = await fetch(`${API_URL}/dashboard?teamId=${teamId}&seasonId=${selectedSeasonId}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        const { averages } = result.data;
        const finishedMatches = result.data.matches.filter(m =>
            ['FT', 'AET', 'PEN'].includes(m.status)
        );
        currentAveragesData = averages;
        const matches = finishedMatches;

        // Capture game objects sequence logs indices
        currentMatchdaysData = matches.map((m, index) => {
            return {
                matchdayNumber: index + 1,
                status: m.status,
                kickoff_at: m.kickoff_at,
                team_goals: m.home_team_id === teamId ? m.home_score : m.away_score,
                total_goals: (m.home_score !== null && m.away_score !== null) ? m.home_score + m.away_score : null,
                team_yellows: m.home_team_id === teamId ? m.home_yellows : m.away_yellows,
                total_yellows: (m.home_yellows !== null && m.away_yellows !== null) ? m.home_yellows + m.away_yellows : null,
                team_reds: m.home_team_id === teamId ? m.home_reds : m.away_reds,
                total_reds: (m.home_reds !== null && m.away_reds !== null) ? m.home_reds + m.away_reds : null,
                team_corners: m.home_team_id === teamId ? m.home_corners : m.away_corners,
                total_corners: (m.home_corners !== null && m.away_corners !== null) ? m.home_corners + m.away_corners : null
            };
        });

        document.getElementById('dashboardPlaceholder').classList.add('hidden');
        document.getElementById('dashboardDataGrid').classList.remove('hidden');

        const TeamAvgsContainer = document.getElementById('team-avgs-container');
        if (averages.length === 0) {
            TeamAvgsContainer.innerHTML = `<p class="text-xs text-gray-400 italic p-2">No summary metrics computed.</p>`;
        } else {
            TeamAvgsContainer.innerHTML = averages.map(avg => {
                const val = avg.avg_value !== null ? Number(avg.avg_value).toFixed(2) : '-';
                const hVal = avg.avg_value_home !== null ? Number(avg.avg_value_home).toFixed(2) : '-';
                const aVal = avg.avg_value_away !== null ? Number(avg.avg_value_away).toFixed(2) : '-';

                const totalVal = avg.total_sum !== null && avg.total_sum !== undefined ? Math.round(avg.total_sum) : '-';
                const totalHVal = avg.total_sum_home !== null && avg.total_sum_home !== undefined ? Math.round(avg.total_sum_home) : '-';
                const totalAVal = avg.total_sum_away !== null && avg.total_sum_away !== undefined ? Math.round(avg.total_sum_away) : '-';

                let suffix = 'stats';
                const slug = avg.market.slug.toLowerCase();
                if (slug.includes('goal')) suffix = 'goals';
                else if (slug.includes('card')) suffix = 'cards';
                else if (slug.includes('corner')) suffix = 'corners';

                return `
                            <div class="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col justify-between p-4 relative">
                                <div class="flex justify-between items-start mb-2">
                                    <span class="text-[10px] font-bold uppercase text-gray-400 tracking-wider block truncate max-w-[70%]" title="${avg.market.slug.replace(/-/g, ' ')}">
                                        ${avg.market.slug.replace(/-/g, ' ')}
                                    </span>
                                    <button onclick="toggleAuditPanel('${avg.market.slug}')" id="audit-arrow-${avg.market.slug}" class="text-[9px] font-bold uppercase tracking-wider text-gray-500 hover:text-blue-600 border border-gray-200 rounded px-1.5 py-0.5 transition-all bg-gray-50 cursor-pointer whitespace-nowrap">
                                        Audit &darr;
                                    </button>
                                </div>
                                <div class="flex items-baseline gap-2 my-1">
                                    <span class="text-xl font-black text-gray-900">${val}</span>
                                    <span class="text-[9px] font-bold text-gray-400 italic bg-gray-100 px-1.5 py-0.5 rounded">
                                        ${totalVal} ${suffix}
                                    </span>
                                </div>
                                <div class="mt-2 pt-2 border-t border-gray-100 flex justify-between text-[10px] font-mono text-gray-500">
                                    <div>Home: <strong class="text-gray-700">${hVal}</strong> <span class="text-gray-400 text-[9px]">(${totalHVal})</span></div>
                                    <div class="border-l border-gray-150 pl-2">Away: <strong class="text-gray-700">${aVal}</strong> <span class="text-gray-400 text-[9px]">(${totalAVal})</span></div>
                                </div>

                                <div id="audit-panel-${avg.market.slug}" class="hidden bg-gray-50 rounded-lg mt-3 p-2 max-h-[220px] overflow-y-auto custom-scrollbar w-full border border-gray-150">
                                    <table class="w-full text-left text-[11px] border-collapse">
                                        <thead>
                                            <tr class="text-[9px] uppercase tracking-wider text-gray-400 border-b border-gray-200 font-mono">
                                                <th class="pb-1 px-1">Date</th>
                                                <th class="pb-1 px-1">Opponent</th>
                                                <th class="pb-1 px-1 text-center">Score</th>
                                                <th class="pb-1 px-1 text-right text-blue-600 font-bold bg-blue-50/50 rounded-t">Raw</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-100 text-gray-600 font-mono">
                                            ${(avg.matchDays || []).map(md => {
                    const matchDate = new Date(md.kickoff_at).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric'
                    });
                    const oppName = md.opponent?.name || 'Unknown';
                    const rawColorClass = getColorForValue(md.rawValue, avg.avg_value);
                    return `
                                                    <tr class="hover:bg-white/70 transition-colors">
                                                        <td class="py-1 px-1 text-gray-400 text-[10px]">${matchDate}</td>
                                                        <td class="py-1 px-1 truncate max-w-[90px]" title="${oppName}">
                                                            <span class="text-[9px] font-bold px-0.5 py-0.2 bg-gray-200/80 text-gray-600 rounded-sm mr-0.5">${md.venue[0]}</span>
                                                            ${oppName}
                                                        </td>
                                                        <td class="py-1 px-1 text-center text-gray-500">${md.score}</td>
                                                        <td class="py-1 px-1 text-right text-gray-900 font-bold bg-blue-50/30">${rawColorClass}</td>
                                                    </tr>
                                                `;
                }).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `;
            }).join('');
        }

        const fixturesTableBody = document.getElementById('fixturesTableBody');
        if (matches.length === 0) {
            fixturesTableBody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-xs text-gray-400">No events found.</td></tr>`;
        } else {
            matches.reverse();
            fixturesTableBody.innerHTML = matches.map(m => {
                const isFinished = ['FT', 'AET', 'PEN'].includes(m.status);
                const isLive = ['1H', '2H', 'HT', 'ET', 'PEN'].includes(m.status) && !isFinished;

                let badgeClass = "bg-gray-100 text-gray-600";
                if (isFinished) badgeClass = "bg-green-50 text-green-700 border border-green-200";
                if (isLive) badgeClass = "bg-amber-50 text-amber-700 border border-amber-200 font-bold animate-pulse";

                const scoreDisplay = (m.home_score !== null && m.away_score !== null) ? `${m.home_score} - ${m.away_score}` : 'vs';

                let scoreColorClass = "text-gray-900 font-bold";
                if (isFinished && m.home_score !== null && m.away_score !== null) {
                    const isHome = m.home_team_id === teamId;
                    const mainTeamScore = isHome ? m.home_score : m.away_score;
                    const opponentScore = isHome ? m.away_score : m.home_score;

                    if (mainTeamScore > opponentScore) {
                        scoreColorClass = "text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded border border-green-100";
                    } else if (mainTeamScore < opponentScore) {
                        scoreColorClass = "text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-100";
                    } else {
                        scoreColorClass = "text-gray-500 font-medium bg-gray-100 px-2 py-0.5 rounded";
                    }
                }

                const matchDate = new Date(m.kickoff_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                const fallbackIcon = `data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22><rect width=%22100%%22 height=%22100%%22 fill=%22%23f3f4f6%22/></svg>`;

                return `
                            <tr class="hover:bg-gray-50/40 transition-colors">
                                <td class="py-3.5 px-4 text-xs font-mono text-gray-500 whitespace-nowrap">${matchDate}</td>
                                
                                <td class="py-3.5 px-4 text-xs text-gray-800 text-right">
                                    <div class="flex items-center justify-end gap-2">
                                        <span class="${m.home_team_id === teamId ? 'font-bold text-blue-600' : 'font-medium'}">${m.homeTeam?.name || 'Unknown'}</span>
                                        <img src="${m.homeTeam?.logo_url || ''}" onerror="this.src='${fallbackIcon}'" class="w-4 h-4 object-contain shrink-0" />
                                    </div>
                                </td>
                                
                                <td class="py-3.5 px-4 text-center font-mono text-xs whitespace-nowrap">
                                    <span class="${scoreColorClass}">${scoreDisplay}</span>
                                </td>
                                
                                <td class="py-3.5 px-4 text-xs text-gray-800 text-left">
                                    <div class="flex items-center justify-start gap-2">
                                        <img src="${m.awayTeam?.logo_url || ''}" onerror="this.src='${fallbackIcon}'" class="w-4 h-4 object-contain shrink-0" />
                                        <span class="${m.away_team_id === teamId ? 'font-bold text-blue-600' : 'font-medium'}">${m.awayTeam?.name || 'Unknown'}</span>
                                    </div>
                                </td>
                                
                                <td class="py-3.5 px-4 text-center whitespace-nowrap">
                                    <div class="flex items-center justify-center gap-2 text-[10px] font-mono select-none">
                                        <span class="flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100" title="Yellow Cards">
                                            <span class="w-1.5 h-2.5 bg-amber-400 rounded-[1px] inline-block shadow-sm"></span>
                                            <span>${m.home_yellows ?? 0} - ${m.away_yellows ?? 0}</span>
                                        </span>
                                        <span class="flex items-center gap-1 bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-100" title="Red Cards">
                                            <span class="w-1.5 h-2.5 bg-red-500 rounded-[1px] inline-block shadow-sm"></span>
                                            <span>${m.home_reds ?? 0} - ${m.away_reds ?? 0}</span>
                                        </span>
                                        <span class="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100" title="Corners">
                                            <span class="font-sans text-[10px] font-bold">C</span>
                                            <span>${m.home_corners ?? 0} - ${m.away_corners ?? 0}</span>
                                        </span>
                                    </div>
                                </td>
                                
                                <td class="py-3.5 px-4 text-center whitespace-nowrap">
                                    <span class="px-1.5 py-0.5 text-[9px] rounded font-semibold uppercase tracking-wider ${badgeClass}">${m.status}</span>
                                </td>
                            </tr>
                        `;
            }).join('');
            await fetchAndRenderUpcomingMatches({ teamId: selectedTeamId, seasonYear: selectedSeasonYear });
            activeUpcomingFilter = 'team';
            updateUpcomingFilterUI('team');

        }
    } catch (error) {
        alert("Could not load dashboard content blocks");
    }
    openTab('upcoming-matches-container');
}

async function toggleLeagueDropdown(leagueId, leagueName) {
    const dropdown = document.getElementById(`dropdown-seasons-${leagueId}`);
    const arrow = document.getElementById(`arrow-${leagueId}`);
    if (activeOpenLeagueId === leagueId && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
        arrow.classList.remove('rotate-180');
        return;
    }

    if (activeOpenLeagueId && activeOpenLeagueId !== leagueId) {
        const oldDropdown = document.getElementById(`dropdown-seasons-${activeOpenLeagueId}`);
        const oldArrow = document.getElementById(`arrow-${activeOpenLeagueId}`);
        if (oldDropdown) oldDropdown.classList.add('hidden');
        if (oldArrow) oldArrow.classList.remove('rotate-180');
    }

    activeOpenLeagueId = leagueId;
    dropdown.classList.remove('hidden');
    arrow.classList.add('rotate-180');
    document.getElementById('navigationBreadcrumb').textContent = `League: ${leagueName} > Select Season`;

    try {
        const response = await fetch(`${API_URL}/seasons?leagueId=${leagueId}`);
        const result = await response.json();

        dropdown.innerHTML = result.data.map(s => `
                    <div class="space-y-1 mb-1">
                        <button onclick="selectSeason(event, ${s.id}, '${s.year || s.name}', '${leagueName.replace(/'/g, "\\'")}')"
                            id="season-sub-btn-${s.id}"
                            class="w-full text-left bg-white hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded text-[11px] font-medium text-gray-600 flex justify-between items-center transition-colors">
                            <span>Season ${s.year || s.name}</span>
                            <span id="season-arrow-${s.id}" class="text-gray-400 text-[9px] font-mono">&rarr;</span>
                        </button>
                        <div id="season-teams-container-${s.id}" class="hidden pl-1.5 py-1 space-y-1 flex flex-col bg-gray-100/40 border border-gray-100/70 rounded"></div>
                    </div>
                `).join('');


    } catch (err) {
        dropdown.innerHTML = `<div class="text-xs text-red-500 p-1">Failed to fetch periods.</div>`;
    }
}

async function selectSeason(event, seasonId, seasonName, leagueName) {

    event.stopPropagation();
    selectedSeasonId = seasonId;
    selectedSeasonYear = seasonName;
    const teamsContainer = document.getElementById(`season-teams-container-${seasonId}`);
    const seasonArrow = document.getElementById(`season-arrow-${seasonId}`);

    if (!teamsContainer.classList.contains('hidden')) {
        teamsContainer.classList.add('hidden');
        seasonArrow.innerHTML = '&rarr;';
        return;
    }

    document.querySelectorAll('[id^="season-teams-container-"]').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('[id^="season-arrow-"]').forEach(a => a.innerHTML = '&rarr;');

    teamsContainer.classList.remove('hidden');
    seasonArrow.innerHTML = '&darr;';

    document.querySelectorAll('[id^="season-sub-btn-"]').forEach(b => b.classList.remove('border-blue-500', 'bg-blue-50/50', 'text-blue-600'));
    document.getElementById(`season-sub-btn-${seasonId}`).classList.add('border-blue-500', 'bg-blue-50/50', 'text-blue-600');

    document.getElementById('navigationBreadcrumb').textContent = `League: ${leagueName} > Season: ${seasonName} > Select Team`;

    teamsContainer.innerHTML = `<div class="text-[10px] text-gray-400 text-center py-2 animate-pulse">Loading teams...</div>`;

    try {
        const response = await fetch(`${API_URL}/teams?seasonId=${seasonId}`);
        const result = await response.json();

        if (result.data.length === 0) {
            teamsContainer.innerHTML = `<div class="text-[10px] text-gray-400 text-center py-2">No active teams metrics found.</div>`;
            return;
        }

        teamsContainer.innerHTML = result.data.map(t => `
                    <button onclick="selectTeam(${t.id}, '${t.name.replace(/'/g, "\\'")}')"
                        id="team-card-${t.id}"
                        class="w-full text-left bg-white border border-gray-150 hover:border-blue-300 hover:bg-gray-50/80 px-2 py-1 rounded transition-all flex items-center gap-1.5 group">
                        <img src="${t.logo_url || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22><rect width=%22100%%22 height=%22100%%22 fill=%22%23f3f4f6%22/></svg>'" class="w-3.5 h-3.5 object-contain shrink-0" />
                        <span class="text-[11px] font-medium text-gray-600 truncate group-hover:text-blue-600">${t.name}</span>
                    </button>
                `).join('');
    } catch (err) {
        teamsContainer.innerHTML = `<div class="text-[10px] text-red-500 text-center p-1">Error processing array maps.</div>`;
    }
}


async function handleStreakPopUp(homeData, awayData) {
    const container = document.getElementById('twoTeamtableViewContent');

    // Create backdrop overlay
    const backdrop = document.createElement('div');
    backdrop.id = 'streakPopupBackdrop';
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';

    backdrop.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col">
            <!-- Header -->
            <div class="flex items-center justify-between p-4 border-b">
                <h2 class="text-lg font-bold text-gray-800">
                    ${homeData.teamName} vs ${awayData.teamName} - Market Comparison
                </h2>
                <button onclick="document.getElementById('streakPopupBackdrop').remove()" 
                        class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                    <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            
            <!-- Scrollable Content -->
            <div class="overflow-y-auto p-6">
                <div class="space-y-4">
                    ${renderMarketComparisonTable(homeData, awayData)}
                </div>
            </div>
            
            <!-- Footer -->
            <div class="flex items-center justify-end p-4 border-t bg-gray-50">
                <button onclick="document.getElementById('streakPopupBackdrop').remove()" 
                        class="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium transition-colors">
                    Close
                </button>
            </div>
        </div>
    `;

    // Append to body instead of container
    document.body.appendChild(backdrop);

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.remove();
        }
    });

    // Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            backdrop.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}
function renderMarketComparisonTable(teamA, teamB) {
    const markets = teamA.averages || [];

    return `
        ${markets.map(avg => {
        const matchDaysA = (avg.matchDays || [])
            .filter(m => m.status === 'FT')
            .sort((a, b) => new Date(b.kickoff_at) - new Date(a.kickoff_at));

        const avgB = (teamB.averages || []).find(a => a.market.slug === avg.market.slug);
        const matchDaysB = avgB ? (avgB.matchDays || [])
            .filter(m => m.status === 'FT')
            .sort((a, b) => new Date(b.kickoff_at) - new Date(a.kickoff_at)) : [];

        const maxLength = Math.max(matchDaysA.length, matchDaysB.length);

        const buildRow = (team, reversedMatches) => {
            const paddedMatches = Array.from({ length: maxLength }, (_, i) => {
                const startIndex = maxLength - reversedMatches.length;
                return i >= startIndex ? reversedMatches[i - startIndex] : null;
            });

            const mdValues = paddedMatches.map(m => {
                if (!m) {
                    return `<td class="border px-2 py-1 text-xs text-center text-gray-400">-</td>`;
                }
                return `
                    <td class="border px-2 py-1 text-xs text-center ${m.rawValue === 0 ? 'text-red-500' : 'text-gray-800'}">
                        ${m.rawValue}
                    </td>
                `;
            }).join('');

            const teamAvg = team === teamA ? avg : avgB;

            return `
                <tr>
                    <td class="border px-2 py-1 font-semibold sticky left-0 bg-white">${team.teamName}</td>
                    <td class="border px-2 py-1 text-center">${teamAvg ? Number(teamAvg.avg_value).toFixed(2) : 'N/A'}</td>
                    <td class="border px-2 py-1 text-center text-red-600 font-bold">${teamAvg?.streak?.length || 0}</td>
                    ${mdValues}
                </tr>
            `;
        };

        return `
            <div class="border rounded-xl overflow-hidden bg-white shadow-sm">
                <div class="px-3 py-2 text-xs font-bold bg-gray-50 border-b sticky top-0">
                    ${avg.market.name}
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs border-collapse">
                        <thead>
                            <tr class="bg-gray-100">
                                <th class="border px-2 py-1 text-left sticky left-0 bg-gray-100">TEAM</th>
                                <th class="border px-2 py-1">AVG</th>
                                <th class="border px-2 py-1">STREAK</th>
                                ${Array.from({ length: maxLength }, (_, i) => `
                                    <th class="border px-2 py-1">MD${maxLength - i}</th>
                                `).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${buildRow(teamA, matchDaysA)}
                            ${buildRow(teamB, matchDaysB)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('')}
    `;
}



async function fetchAndRenderUpcomingMatches({ leagueId, teamId, seasonYear }) {

    const container = document.getElementById('upcoming-matches-container');
    container.innerHTML = `<div class="p-8 text-center text-gray-400"><div class="animate-pulse">Loading analysis...</div></div>`;

    try {
        const params = new URLSearchParams({ season: seasonYear });
        if (leagueId) params.append('leagueId', leagueId);
        if (teamId) params.append('teamId', teamId);
        const response = await fetch(`${API_URL}/upcoming-games?${params.toString()}`);
        const result = await response.json();
        handleUpComingMatchesUi(result);
    } catch (err) {
        console.error("Error loading insights:", err);
        container.innerHTML = `<div class="p-4 text-xs text-red-500">Failed to load insights.</div>`;
    }
}


function handleUpComingMatchesUi(result) {
    console.log('handleUpComingMatchesUi', result)
    const container = document.getElementById('upcoming-matches-container');
    container.innerHTML = `<div class="p-8 text-center text-gray-400"><div class="animate-pulse">Loading analysis...</div></div>`;

    const insights = [];

    // --- Helper: Find the specific odd ---
    const getOddForPrediction = (market, direction, val) => {
        const searchStr = `${direction.toLowerCase()}-${val}`;
        const found = market.odds?.find(o => o.selection.toLowerCase() === searchStr);
        return found ? found.odd : null;
    };

    // 1. Flatten Data
    result.data.forEach(match => {
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

    // 2. Sort by Streak
    insights.sort((a, b) => b.streakCount - a.streakCount);

    if (insights.length === 0) {
        container.innerHTML = `<div class="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 italic">No insights found.</div>`;
        return;
    }

    // 3. Get master unique lists for markets
    const allMarkets = [...new Set(insights.map(i => i.market.marketSlug.replace(/-/g, ' ').toUpperCase()))].sort();

    // State for selected filters and pagination
    let selectedMarkets = [];
    let currentPage = 1;
    const itemsPerPage = 10;

    // Keep track of the external league filter to know when it changes
    let lastLeagueFilter = typeof filterByLeague !== 'undefined' ? filterByLeague : null;

    // 4. Reactive Render Function
    const render = () => {
        // --- Reset page to 1 if the external league filter changed ---
        if (typeof filterByLeague !== 'undefined' && filterByLeague !== lastLeagueFilter) {
            currentPage = 1;
            lastLeagueFilter = filterByLeague;
        }

        // --- Dynamic Summary Count Calculations ---
        const marketCounts = {};
        allMarkets.forEach(m => marketCounts[m] = 0);

        // Calculate Market counts (respecting the global filterByLeague)
        insights.forEach(i => {
            const leagueId = i.match.league_id || i.match.league?.id;
            if (typeof filterByLeague === 'undefined' || filterByLeague === null || filterByLeague === leagueId) {
                const marketName = i.market.marketSlug.replace(/-/g, ' ').toUpperCase();
                marketCounts[marketName]++;
            }
        });

        // Get final list matching BOTH criteria (Markets + Global League Filter)
        const filteredInsights = insights.filter(i => {
            const marketName = i.market.marketSlug.replace(/-/g, ' ').toUpperCase();
            const leagueId = i.match.league_id || i.match.league?.id;

            const matchesMarket = selectedMarkets.length === 0 || selectedMarkets.includes(marketName);
            const matchesLeague = typeof filterByLeague === 'undefined' || filterByLeague === null || filterByLeague === leagueId;

            return matchesMarket && matchesLeague;
        });

        // --- Pagination Logic ---
        const totalItems = filteredInsights.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

        // Safety check just in case current page goes out of bounds
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedInsights = filteredInsights.slice(startIndex, endIndex);

        const isAnyFilterActive = selectedMarkets.length > 0 || (typeof filterByLeague !== 'undefined' && filterByLeague !== null);

        globalInsightVariable = insights;
        const summaryHtml = `
            <div class="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-3 mb-4 relative">
                <!-- Market Row -->
                <div class="flex flex-wrap gap-2 items-center">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider w-24">Markets:</span>
                    <div class="flex flex-wrap gap-2 flex-grow">
                        ${Object.entries(marketCounts).map(([name, count]) => {
            const isSelected = selectedMarkets.includes(name);
            const badgeClass = isSelected
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : count === 0
                    ? 'bg-white border-gray-100 text-gray-300 opacity-40 pointer-events-none'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100';
            const countClass = isSelected ? 'bg-white text-blue-600' : 'bg-blue-600 text-white';

            return `
                                <div data-market-name="${name}" class="market-badge border rounded-full px-3 py-1 flex items-center gap-2 text-[10px] font-black cursor-pointer select-none transition-all ${badgeClass}">
                                    <span>${name}</span>
                                    <span class="${countClass} px-1.5 py-0.5 rounded-full text-[9px]">${count}</span>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>

                ${isAnyFilterActive ? `
                    <button id="btn-show-all" class="absolute top-4 right-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-[10px] px-3 py-1 rounded-full shadow-sm transition-all uppercase tracking-wider">
                        Show All
                    </button>
                ` : ''}
            </div>
        `;

        // Render card layout elements (Now using paginatedInsights)
        container.innerHTML = `
            <div class="space-y-4">
                ${summaryHtml}
                ${paginatedInsights.length === 0 ? `
                    <div class="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 italic">No matches match the selected criteria.</div>
                ` : paginatedInsights.map(i => {
            const marketName = i.market.marketSlug.replace(/-/g, ' ').toUpperCase();
            const teamName = i.isHome ? i.match.homeTeam.name : i.match.awayTeam.name;
            const fullPrediction = `${i.direction} ${i.suggestedValue}`;
            const leagueLabel = i.match.league?.name || i.match.league_name || '';

            return `
                        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                                <div class="md:col-span-2 flex items-center justify-between bg-gray-50/50 p-4 rounded-lg relative">
                                    ${leagueLabel ? `<span class="absolute top-1 left-2 text-[8px] font-bold text-gray-400 uppercase tracking-wider">${leagueLabel}</span>` : ''}
                                    
                                    <div class="flex flex-col items-center w-1/3 mt-2">
                                        <img src="${i.match.homeTeam.logo_url || ''}" class="w-8 h-8 object-contain mb-1" />
                                        <div class="text-[10px] font-bold text-gray-700 truncate w-full text-center">${i.match.homeTeam.name}</div>
                                        <div class="mt-1 text-[10px] font-bold ${i.isHome ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded">${i.homeOdd}</div>
                                    </div>
                                    <div
                                     data-home-id="${i.match.homeTeam.id}" data-away-id="${i.match.awayTeam.id}"
                                     data-market="${i.market.marketSlug}"
                                     data-is-home="${i.isHome}"
                                     data-home-streak='${JSON.stringify(i.market.home.streak || [])}'
                                     data-away-streak='${JSON.stringify(i.market.away.streak || [])}'
                                     data-season-id="${i.match.season_id}"
                                    class="streak-container flex flex-col items-center flex-grow cursor-pointer mt-2">
                                        <div class="text-xs font-black text-red-600">${i.streakCount} IN A ROW</div>
                                        <div class="text-[9px] text-gray-400 mt-1 uppercase">${new Date(i.match.kickoff_at).toLocaleDateString()}</div>
                                    </div>
                                    <div class="flex flex-col items-center w-1/3 mt-2">
                                        <img src="${i.match.awayTeam.logo_url || ''}" class="w-8 h-8 object-contain mb-1" />
                                        <div class="text-[10px] font-bold text-gray-700 truncate w-full text-center">${i.match.awayTeam.name}</div>
                                        <div class="mt-1 text-[10px] font-bold ${!i.isHome ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded">${i.awayOdd}</div>
                                    </div>
                                </div>

                                <div class="pl-2">
                                    <div class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Prediction: ${marketName}</div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="text-xl font-black text-gray-800">${fullPrediction}</div>
                                        ${i.specificOdd ? `<div class="bg-green-600 text-white text-[10px] px-2 py-1 rounded font-bold">${i.specificOdd}</div>` : ''}
                                    </div>
                                    <p class="text-[10px] text-gray-500 italic">
                                        In the last <b>${i.streakCount}</b> matches, <b>${marketName} ${fullPrediction}</b> of <b>${teamName}</b> were ${i.direction == 'OVER' ? 'under' : 'over'} average of <b>${i.avgValue.toFixed(2)}</b>.
                                    </p>
                                </div>
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>

            <!-- Pagination Controls -->
            ${totalPages > 1 ? `
                <div class="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 mt-6 shadow-sm">
                    <button id="btn-prev-page" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-[11px] uppercase tracking-wider rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === 1 ? 'disabled' : ''}>
                        Previous
                    </button>
                    <span class="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                        Page ${currentPage} of ${totalPages}
                    </span>
                    <button id="btn-next-page" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-[11px] uppercase tracking-wider rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === totalPages ? 'disabled' : ''}>
                        Next
                    </button>
                </div>
            ` : ''}
        `;

        // Bind Market clicks
        container.querySelectorAll('.market-badge').forEach(badge => {
            badge.addEventListener('click', () => {
                const marketName = badge.dataset.marketName;
                if (selectedMarkets.includes(marketName)) {
                    selectedMarkets = selectedMarkets.filter(m => m !== marketName);
                } else {
                    selectedMarkets.push(marketName);
                }
                currentPage = 1; // Reset to first page when filtering
                render();
            });
        });

        // Bind "Show All" click
        const showAllBtn = container.querySelector('#btn-show-all');
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                // 1. Reset local market state
                selectedMarkets = [];
                // 2. Reset global league state
                if (typeof filterByLeague !== 'undefined') {
                    filterByLeague = null;
                    lastLeagueFilter = null;
                }
                // 3. Reset pagination
                currentPage = 1;

                // 4. Uncheck all UI checkboxes in the sidebar
                document.querySelectorAll('.league-filter-chk').forEach(chk => {
                    chk.checked = false;
                });

                // 5. Re-render UI
                render();
            });
        }

        // Bind Pagination Clicks
        const prevPageBtn = container.querySelector('#btn-prev-page');
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    render();
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Scroll back to top of container
                }
            });
        }

        const nextPageBtn = container.querySelector('#btn-next-page');
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    render();
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Scroll back to top of container
                }
            });
        }

        // Bind Pop-up handlers
        container.querySelectorAll('.streak-container').forEach(el => {
            el.addEventListener('click', async () => {
                let awayId = el.dataset.awayId;
                let homeId = el.dataset.homeId;
                let currentSeasonId = el.dataset.seasonId;
                const market = el.dataset.market;
                const homeStreak = JSON.parse(el.dataset.homeStreak);
                const awayStreak = JSON.parse(el.dataset.awayStreak);

                const awayTeamData = await fetch(`${API_URL}/dashboard?teamId=${awayId}&seasonId=${currentSeasonId}`);
                const awayTeamResults = await awayTeamData.json();

                const homeTeamData = await fetch(`${API_URL}/dashboard?teamId=${homeId}&seasonId=${currentSeasonId}`);
                const homeTeamResults = await homeTeamData.json();

                if (typeof handleStreakPopUp === 'function') {
                    handleStreakPopUp(homeTeamResults?.data, awayTeamResults?.data);
                }
            });
        });
    };

    // Attach the render to the window object so the checkbox listener can trigger it
    window.refreshInsightsDashboard = render;

    // Initial render
    render();
}


const getOddForPrediction = (market, direction, val) => {
    const searchStr = `${direction.toLowerCase()}-${val}`;
    const found = market.odds?.find(o => o.selection.toLowerCase() === searchStr);
    return found ? found.odd : null;
};



