

import { state } from "./state_stats.js";

import { fetchTeamDashboardData, fetchSeasonsForLeague, fetchTeamsForSeason, fetchAndRenderUpcomingMatches } from "../main.js";

import { prepareInsightsData, calculateLeagueMarketCounts, getColorForValue, getOddForPrediction } from "./utils_stats.js";

const API_TEAM_URL = '/api/teams';



let prevTab = null;

export function renderTeamDashboard(data, teamId, teamName) {
    const { averages } = data;
    const finishedMatches = data.matches.filter(m =>
        ['FT', 'AET', 'PEN'].includes(m.status)
    );
    state.currentAveragesData = averages;
    const matches = finishedMatches;

    // Capture game objects sequence logs indices
    state.currentMatchdaysData = matches.map((m, index) => {
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
            const val = avg.avg_value !== null ? Number(avg.avg_value).toFixed(3) : '-';
            const hVal = avg.avg_value_home !== null ? Number(avg.avg_value_home).toFixed(3) : '-';
            const aVal = avg.avg_value_away !== null ? Number(avg.avg_value_away).toFixed(3) : '-';

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
    }
}
export async function selectTeam(teamId, teamName) {
    state.selectedTeamId = teamId;
    console.log('state.filterByLeague ', state.filterByLeague)
    state.filterByLeague = null;
    console.log('state.filterByLeague ', state.filterByLeague)

    // 3. Uncheck all UI checkboxes in the sidebar
    document.querySelectorAll('.league-filter-chk').forEach(chk => {
        chk.checked = false;
    });

    console.log('Selected Team ID:', teamId, 'Selected Season ID:', state.selectedSeasonId);
    document.getElementById('navContainer').style.display = 'block'
    document.querySelectorAll('[id^="team-card-"]').forEach(b => b.classList.remove('border-blue-500', 'bg-blue-50/50', 'text-blue-600'));
    const selectedBlock = document.getElementById(`team-card-${teamId}`);
    if (selectedBlock) selectedBlock.classList.add('border-blue-500', 'bg-blue-50/50', 'text-blue-600');

    const data = await fetchTeamDashboardData(teamId, teamName);
    if (data) {
        renderTeamDashboard(data, teamId, teamName);
        await fetchAndRenderUpcomingMatches({ teamId: state.selectedTeamId, seasonYear: state.selectedSeasonYear });
        state.activeUpcomingFilter = 'team';
        updateUpcomingFilterUI('team');
    }

    if (!prevTab) {
        openTab('upcoming-matches-container');
        prevTab = 'upcoming-matches-container';
    } else {
        openTab(prevTab)
    }
}
window.selectTeam = selectTeam;

export function renderSeasonsDropdown(dropdown, seasons, leagueName) {
    if (!seasons) {
        dropdown.innerHTML = `<div class="text-xs text-red-500 p-1">Failed to fetch periods.</div>`;
        return null;
    }

    dropdown.innerHTML = seasons.map(s => `
    <div class="space-y-1 mb-1">
        <button style= "display: none;" onclick="selectSeason(event, ${s.id}, '${s.year || s.name}', '${leagueName.replace(/'/g, "\\'")}')"
            id="season-sub-btn-${s.id}"
            class="w-full text-left bg-white hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded text-[11px] font-medium text-gray-600 flex justify-between items-center transition-colors">
            <span>Season ${s.year || s.name}</span>
            <span id="season-arrow-${s.id}" class="text-gray-400 text-[9px] font-mono">&rarr;</span>
        </button>
        <div id="season-teams-container-${s.id}" class="hidden pl-1.5 py-1 space-y-1 flex flex-col bg-gray-100/40 border border-gray-100/70 rounded"></div>
    </div>
`).join('');

    // Return the default season (2026) if found
    const defaultSeason = seasons.find(s => s.year == '2026');
    return defaultSeason;
}
export async function toggleLeagueDropdown(leagueId, leagueName) {
    const dropdown = document.getElementById(`dropdown-seasons-${leagueId}`);
    const arrow = document.getElementById(`arrow-${leagueId}`);
    if (state.activeOpenLeagueId === leagueId && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
        arrow.classList.remove('rotate-180');
        return;
    }

    if (state.activeOpenLeagueId && state.activeOpenLeagueId !== leagueId) {
        const oldDropdown = document.getElementById(`dropdown-seasons-${state.activeOpenLeagueId}`);
        const oldArrow = document.getElementById(`arrow-${state.activeOpenLeagueId}`);
        if (oldDropdown) oldDropdown.classList.add('hidden');
        if (oldArrow) oldArrow.classList.remove('rotate-180');
    }

    state.activeOpenLeagueId = leagueId;
    dropdown.classList.remove('hidden');
    arrow.classList.add('rotate-180');
    // document.getElementById('navigationBreadcrumb').textContent = `League: ${leagueName} > Select Season`;

    const seasons = await fetchSeasonsForLeague(leagueId);
    const defaultSeason = renderSeasonsDropdown(dropdown, seasons, leagueName);

    // Automatically click 2026 season
    if (defaultSeason) {
        console.log(defaultSeason)
        selectSeason(null, defaultSeason?.id, defaultSeason?.year, leagueName)
    }
}
window.toggleLeagueDropdown = toggleLeagueDropdown;

export function renderTeamsList(teamsContainer, teams) {
    if (!teams) {
        teamsContainer.innerHTML = `<div class="text-[10px] text-red-500 text-center p-1">Error processing array maps.</div>`;
        return;
    }

    if (teams.length === 0) {
        teamsContainer.innerHTML = `<div class="text-[10px] text-gray-400 text-center py-2">No active teams metrics found.</div>`;
        return;
    }

    teamsContainer.innerHTML = teams.map(t => `
                    <button onclick="selectTeam(${t.id}, '${t.name.replace(/'/g, "\\'")}')"
                        id="team-card-${t.id}"
                        class="w-full text-left bg-white border border-gray-150 hover:border-blue-300 hover:bg-gray-50/80 px-2 py-1 rounded transition-all flex items-center gap-1.5 group">
                        <img src="${t.logo_url || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22><rect width=%22100%%22 height=%22100%%22 fill=%22%23f3f4f6%22/></svg>'" class="w-3.5 h-3.5 object-contain shrink-0" />
                        <span class="text-[11px] font-medium text-gray-600 truncate group-hover:text-blue-600">${t.name}</span>
                    </button>
                `).join('');
}
export async function selectSeason(event, seasonId, seasonName, leagueName) {

    if (event) event.stopPropagation();
    state.selectedSeasonId = seasonId;
    state.selectedSeasonYear = seasonName;
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

    // document.getElementById('navigationBreadcrumb').textContent = `League: ${leagueName} > Season: ${seasonName} > Select Team`;

    teamsContainer.innerHTML = `<div class="text-[10px] text-gray-400 text-center py-2 animate-pulse">Loading teams...</div>`;

    const teams = await fetchTeamsForSeason(seasonId);
    renderTeamsList(teamsContainer, teams);
}


export function renderInsightsDashboard(insights) {
    console.log(' renderInsightsDashboard insights', insights)

    // ⭐ FIX: Ensure team specific markets match the team executing the streak line
    insights = insights.filter(i => {
        const slug = i.market.marketSlug.toLowerCase();
        if (slug.includes('home') && !i.isHome) return false;
        if (slug.includes('away') && i.isHome) return false;
        return true;
    });

    // Collapses team home/away odds slugs into one canonical UI label.
    const MARKET_DISPLAY = {
        'total-home': 'TEAM GOALS',
        'total-away': 'TEAM GOALS',
        'home-corners-overunder': 'TEAM CORNERS',
        'away-corners-overunder': 'TEAM CORNERS',
        'corners-over-under': 'CORNERS OVER UNDER',
        'goals-overunder': 'GOALS OVER UNDER',
        'red-cards-over-under': 'RED CARDS OVER UNDER',
        'yellow-cards-over-under': 'YELLOW CARDS OVER UNDER',
        'team-yellow-cards': 'TEAM YELLOW CARDS',
        'team-red-cards': 'TEAM RED CARDS',
    };

    const getMarketLabel = (slug) =>
        MARKET_DISPLAY[(slug || '').toLowerCase()] ||
        (slug || '').replace(/-/g, ' ').toUpperCase();

    // ⭐ NEW: any merged team label starts with "TEAM"
    const isTeamMarket = (label) => (label || '').startsWith('TEAM');

    const container = document.getElementById('upcoming-matches-container');
    container.innerHTML = `<div class="p-8 text-center text-gray-400"><div class="animate-pulse">Loading analysis...</div></div>`;

    if (insights.length === 0) {
        container.innerHTML = `<div class="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 italic">No insights found.</div>`;
        return;
    }

    // 3. Get master unique lists for markets
    const allMarkets = [...new Set(insights.map(i => getMarketLabel(i.market.marketSlug)))].sort();

    // State for selected filters and pagination
    let selectedMarkets = [];
    let selectedSide = null;   // ⭐ NEW: 'home' | 'away' | null
    let sortBy = 'confidence-desc';
    let currentPage = 1;
    const itemsPerPage = 10;
    let lastLeagueFilter = typeof state.filterByLeague !== 'undefined' ? state.filterByLeague : null;

    // ==========================================
    // ⭐ NEW: The Modal Render Function
    // ==========================================
    const openOddsModal = (insight) => {
        const teamName = insight.isHome ? insight.match.homeTeam.name : insight.match.awayTeam.name;
        const marketName = getMarketLabel(insight.market.marketSlug)

        // Get ALL odds (not filtered)
        const allOdds = insight.market.odds || [];

        // Group odds by bookmaker
        const bookmakerGroups = {};
        allOdds.forEach(odd => {
            const bookmakerId = odd.bookmaker?.id || 'unknown';
            const bookmakerName = odd.bookmaker?.name || 'Unknown';
            const bookmakerLogo = odd.bookmaker?.logo_url || '';

            if (!bookmakerGroups[bookmakerId]) {
                bookmakerGroups[bookmakerId] = {
                    name: bookmakerName,
                    logo: bookmakerLogo,
                    odds: []
                };
            }
            bookmakerGroups[bookmakerId].odds.push(odd);
        });

        // Create the Modal Container if it doesn't exist
        let modal = document.getElementById('odds-compare-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'odds-compare-modal';
            modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm opacity-0 pointer-events-none transition-opacity duration-300';
            document.body.appendChild(modal);
        }

        // Generate HTML for each bookmaker's odds
        const bookmakersHtml = Object.values(bookmakerGroups).map(bookmaker => {
            // Sort odds numerically
            bookmaker.odds.sort((a, b) => {
                const aNum = parseFloat(a.odd);
                const bNum = parseFloat(b.odd);
                return aNum - bNum;
            });

            return `
            <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                <!-- Bookmaker Header -->
                <div class="flex items-center gap-3 mb-3 pb-3 border-b border-gray-100">
                    ${bookmaker.logo
                    ? `<img src="${bookmaker.logo}" class="h-8 max-w-[100px] object-contain" alt="${bookmaker.name}" />`
                    : `<span class="text-sm font-bold text-gray-700">${bookmaker.name}</span>`
                }
                </div>
                
                <!-- Odds Grid -->
                <div class="grid grid-cols-2 gap-2">
                    ${bookmaker.odds.map(odd => {
                    const isPredictedSelection = odd.selection.toLowerCase() === `${insight.direction.toLowerCase()}-${insight.suggestedValue}`;

                    return `
                            <div class="flex items-center justify-between p-2 rounded-lg ${isPredictedSelection
                            ? 'bg-blue-50 border border-blue-200'
                            : 'bg-gray-50 border border-gray-100'
                        }">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-[11px] font-bold ${isPredictedSelection
                            ? 'text-blue-700'
                            : 'text-gray-700'
                        }">${odd.selection.replace('-', ' ').toUpperCase()}</span>
                                    ${isPredictedSelection
                            ? ''
                            : ''}
                                </div>
                                <span class="text-sm font-black ${isPredictedSelection
                            ? 'text-blue-600'
                            : 'text-gray-800'
                        }">${odd.odd}</span>
                            </div>
                        `;
                }).join('')}
                </div>
            </div>
        `;
        }).join('');

        // Inject HTML into the modal
        modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden transform scale-95 transition-transform duration-300" id="odds-modal-content">
            <!-- Modal Header -->
            <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-6 flex justify-between items-center">
                <div>
                    <div class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">
                        ${insight.match.homeTeam.name} vs ${insight.match.awayTeam.name}
                    </div>
                    <h2 class="text-2xl font-black">${marketName} - All Bookmaker Odds</h2>
                    <div class="flex items-center gap-2 mt-2">
                        <span class="text-sm text-blue-400 font-bold">
                            Prediction: ${insight.direction} ${insight.suggestedValue} for ${teamName}
                        </span>
                    </div>
                </div>
                <button id="close-odds-modal" class="text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-full p-2 transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <!-- Modal Body -->
            <div class="p-6 bg-gray-50 max-h-[65vh] overflow-y-auto">
                ${allOdds.length === 0 ? `
                    <div class="text-center text-gray-400 italic py-12">
                        <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <p class="text-lg font-bold">No odds data available</p>
                        <p class="text-sm mt-1">Check back later for updated odds</p>
                    </div>
                ` : `
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${bookmakersHtml}
                    </div>
                `}
            </div>
        </div>
    `;

        // Open Animation
        modal.classList.remove('opacity-0', 'pointer-events-none');
        setTimeout(() => {
            modal.querySelector('#odds-modal-content').classList.remove('scale-95');
        }, 10);

        // Close logic
        const closeModal = () => {
            modal.classList.add('opacity-0', 'pointer-events-none');
            modal.querySelector('#odds-modal-content').classList.add('scale-95');
        };

        modal.querySelector('#close-odds-modal').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    };
    // ==========================================

    const openMatchWinnerModal = (insight, highlightSelection = null) => {
        const allOdds = insight.matchWinnerOdds || [];

        // Group by bookmaker
        const bookmakerGroups = {};
        allOdds.forEach(odd => {
            const id = odd.bookmaker?.id || 'unknown';
            if (!bookmakerGroups[id]) {
                bookmakerGroups[id] = {
                    name: odd.bookmaker?.name || 'Unknown',
                    logo: odd.bookmaker?.logo_url || '',
                    odds: []
                };
            }
            bookmakerGroups[id].odds.push(odd);
        });

        let modal = document.getElementById('odds-compare-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'odds-compare-modal';
            modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm opacity-0 pointer-events-none transition-opacity duration-300';
            document.body.appendChild(modal);
        }

        const order = { home: 0, draw: 1, away: 2 }; // keep 1-X-2 ordering per bookmaker

        const bookmakersHtml = Object.values(bookmakerGroups).map(bk => {
            bk.odds.sort((a, b) =>
                (order[(a.selection || '').toLowerCase()] ?? 99) -
                (order[(b.selection || '').toLowerCase()] ?? 99)
            );

            return `
        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
            <div class="flex items-center gap-3 mb-3 pb-3 border-b border-gray-100">
                ${bk.logo
                    ? `<img src="${bk.logo}" class="h-8 max-w-[100px] object-contain" alt="${bk.name}" />`
                    : `<span class="text-sm font-bold text-gray-700">${bk.name}</span>`}
            </div>
            <div class="grid grid-cols-3 gap-2">
                ${bk.odds.map(odd => {
                        const sel = (odd.selection || '').toLowerCase();
                        const isHighlight = highlightSelection && sel === highlightSelection.toLowerCase();
                        return `
                        <div class="flex flex-col items-center justify-center p-2 rounded-lg ${isHighlight
                                ? 'bg-blue-50 border border-blue-200'
                                : 'bg-gray-50 border border-gray-100'}">
                            <span class="text-[10px] font-bold uppercase ${isHighlight ? 'text-blue-700' : 'text-gray-500'}">${sel}</span>
                            <span class="text-sm font-black ${isHighlight ? 'text-blue-600' : 'text-gray-800'}">${odd.odd}</span>
                        </div>`;
                    }).join('')}
            </div>
        </div>`;
        }).join('');

        modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden transform scale-95 transition-transform duration-300" id="odds-modal-content">
        <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-6 flex justify-between items-center">
            <div>
                <div class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">
                    ${insight.match.homeTeam.name} vs ${insight.match.awayTeam.name}
                </div>
                <h2 class="text-2xl font-black">Match Winner - All Bookmaker Odds</h2>
            </div>
            <button id="close-odds-modal" class="text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-full p-2 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
        <div class="p-6 bg-gray-50 max-h-[65vh] overflow-y-auto">
            ${allOdds.length === 0 ? `
                <div class="text-center text-gray-400 italic py-12">
                    <p class="text-lg font-bold">No match winner odds available</p>
                </div>
            ` : `
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${bookmakersHtml}
                </div>
            `}
        </div>
    </div>`;

        modal.classList.remove('opacity-0', 'pointer-events-none');
        setTimeout(() => modal.querySelector('#odds-modal-content').classList.remove('scale-95'), 10);

        const closeModal = () => {
            modal.classList.add('opacity-0', 'pointer-events-none');
            modal.querySelector('#odds-modal-content').classList.add('scale-95');
        };
        modal.querySelector('#close-odds-modal').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    };

    // 4. Reactive Render Function
    const render = () => {
        // --- Reset page to 1 if the external league filter changed ---
        if (typeof state.filterByLeague !== 'undefined' && state.filterByLeague !== lastLeagueFilter) {
            currentPage = 1;
            lastLeagueFilter = state.filterByLeague;
        }

        const marketCounts = {};
        allMarkets.forEach(m => marketCounts[m] = 0);

        insights.forEach(i => {
            const leagueId = i.match.league_id || i.match.league?.id;
            if (typeof state.filterByLeague === 'undefined' || state.filterByLeague === null || state.filterByLeague === leagueId) {
                const marketName = getMarketLabel(i.market.marketSlug)
                marketCounts[marketName]++;
            }
        });

        // ⭐ NEW: home/away counts for the selected TEAM market(s)
        const hasTeamSelected = selectedMarkets.some(isTeamMarket);
        const sideCounts = { home: 0, away: 0 };

        if (hasTeamSelected) {
            insights.forEach(i => {
                const leagueId = i.match.league_id || i.match.league?.id;
                const leagueOk = typeof state.filterByLeague === 'undefined' || state.filterByLeague === null || state.filterByLeague === leagueId;
                const marketName = getMarketLabel(i.market.marketSlug);
                if (leagueOk && selectedMarkets.includes(marketName) && isTeamMarket(marketName)) {
                    if (i.isHome) sideCounts.home++; else sideCounts.away++;
                }
            });
        }

        const filteredInsights = insights.filter(i => {
            const marketName = getMarketLabel(i.market.marketSlug)
            const leagueId = i.match.league_id || i.match.league?.id;
            const matchesMarket = selectedMarkets.length === 0 || selectedMarkets.includes(marketName);
            const matchesLeague = typeof state.filterByLeague === 'undefined' || state.filterByLeague === null || state.filterByLeague === leagueId;
            // ⭐ NEW: side only affects team markets
            const matchesSide = !selectedSide || !isTeamMarket(marketName) ||
                (selectedSide === 'home' ? i.isHome : !i.isHome);
            return matchesMarket && matchesLeague && matchesSide;
        });
        filteredInsights.sort((a, b) => {
            switch (sortBy) {
                case 'confidence-desc': return (b.confidence ?? 0) - (a.confidence ?? 0);
                case 'confidence-asc': return (a.confidence ?? 0) - (b.confidence ?? 0);
                case 'streak-desc': return (b.streakCount ?? 0) - (a.streakCount ?? 0);
                case 'streak-asc': return (a.streakCount ?? 0) - (b.streakCount ?? 0);
                default: return 0;
            }
        });


        const totalItems = filteredInsights.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedInsights = filteredInsights.slice(startIndex, endIndex);

        const isAnyFilterActive = selectedMarkets.length > 0 || selectedSide !== null || (typeof state.filterByLeague !== 'undefined' && state.filterByLeague !== null);
        state.globalInsightVariable = insights;

        const summaryHtml = `
            <div class="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-3 mb-4 relative">
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

                ${hasTeamSelected ? `
                    <div class="flex flex-wrap gap-2 items-center">
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider w-24">Side:</span>
                        <div class="flex flex-wrap gap-2 flex-grow">
                            ${['home', 'away'].map(side => {
            const count = sideCounts[side];
            const isSelected = selectedSide === side;
            const badgeClass = isSelected
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : count === 0
                    ? 'bg-white border-gray-100 text-gray-300 opacity-40 pointer-events-none'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100';
            const countClass = isSelected ? 'bg-white text-blue-600' : 'bg-blue-600 text-white';
            return `
                                    <div data-side="${side}" class="side-badge border rounded-full px-3 py-1 flex items-center gap-2 text-[10px] font-black cursor-pointer select-none transition-all ${badgeClass}">
                                        <span>${side.toUpperCase()}</span>
                                        <span class="${countClass} px-1.5 py-0.5 rounded-full text-[9px]">${count}</span>
                                    </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                ` : ''}

                ${isAnyFilterActive ? `
                    <button id="btn-show-all" class="absolute top-4 right-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-[10px] px-3 py-1 rounded-full shadow-sm transition-all uppercase tracking-wider">
                        Show All
                    </button>
                ` : ''}

                <div class="flex items-center gap-2">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider w-24">Sort by:</span>
                    <select id="sort-select" class="text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-full px-3 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400">
                        <option value="confidence-desc" ${sortBy === 'confidence-desc' ? 'selected' : ''}>Confidence (high → low)</option>
                        <option value="confidence-asc"  ${sortBy === 'confidence-asc' ? 'selected' : ''}>Confidence (low → high)</option>
                        <option value="streak-desc"     ${sortBy === 'streak-desc' ? 'selected' : ''}>Streak length (long → short)</option>
                        <option value="streak-asc"      ${sortBy === 'streak-asc' ? 'selected' : ''}>Streak length (short → long)</option>
                    </select>
                </div>
            </div>
        `;

        // Render card layout elements 
        // ⭐ FIX: Added (i, index) so we can map the button click to the exact insight data
        container.innerHTML = `
            <div class="space-y-4">
                ${summaryHtml}
                ${paginatedInsights.length === 0 ? `
                    <div class="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 italic">No matches match the selected criteria.</div>
                ` : paginatedInsights.map((i, index) => {
            const marketName = getMarketLabel(i.market.marketSlug)
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
                                        <div class="text-[8px] font-black uppercase tracking-wider ${i.isHome ? 'text-blue-600' : 'text-black-300'}">HOME</div>
                                ${(i.matchWinnerOdds && i.matchWinnerOdds.length)
                    ? `<button data-insight-index="${index}" data-mw-selection="home"
                                                    class="mw-odd-trigger mt-1 flex items-center gap-1 ${i.isHome ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded hover:ring-2 hover:ring-blue-400 transition-all cursor-pointer">
                                                    ${i.homeOddLogo ? `<img src="${i.homeOddLogo}" class="h-3 max-w-[40px] object-contain" alt="bk" />` : ''}
                                                    <span class="text-[10px] font-bold">${i.homeOdd}</span>
                                                </button>`
                    : `<div class="mt-1 text-[10px] font-bold ${i.isHome ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded">${i.homeOdd}</div>`}
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
                                        <div class="text-[8px] font-black uppercase tracking-wider ${!i.isHome ? 'text-blue-600' : 'text-gray-300'}">AWAY</div>

                                   ${(i.matchWinnerOdds && i.matchWinnerOdds.length)
                    ? `<button data-insight-index="${index}" data-mw-selection="away"
                                            class="mw-odd-trigger mt-1 flex items-center gap-1 ${!i.isHome ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded hover:ring-2 hover:ring-blue-400 transition-all cursor-pointer">
                                            ${i.awayOddLogo ? `<img src="${i.awayOddLogo}" class="h-3 max-w-[40px] object-contain" alt="bk" />` : ''}
                                            <span class="text-[10px] font-bold">${i.awayOdd}</span>
                                        </button>`
                    : `<div class="mt-1 text-[10px] font-bold ${!i.isHome ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'} px-2 py-0.5 rounded">${i.awayOdd}</div>`}
                                    </div>
                                </div>

                                <div class="pl-2">
                                    <div class="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Prediction: ${marketName}</div>
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="text-xl font-black text-gray-800">${fullPrediction}</div>
                                        
                                        <!-- ⭐ NEW: Converted to a clickable button with hover effects and data-index -->
                                        ${i.specificOdd ? `
                                            <button data-insight-index="${index}" class="odd-popup-trigger flex items-center gap-1.5 bg-gray-50 border border-gray-200 hover:border-blue-400 hover:bg-blue-50 px-2 py-1 rounded shadow-sm transition-all cursor-pointer group">
                                                ${i.bookmakerLogoUrl ? `<img src="${i.bookmakerLogoUrl}" class="h-4 max-w-[60px] object-contain group-hover:scale-105 transition-transform" alt="bookmaker" />` : ''}
                                                <span class="text-[11px] font-black text-gray-700 group-hover:text-blue-600">${i.specificOdd}</span>
                                                <svg class="w-3 h-3 text-gray-400 group-hover:text-blue-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                                            </button>
                                        ` : ''}
                                    </div>
                                    <p class="text-[10px] text-gray-500 italic">
                                        In the last <b>${i.streakCount}</b> matches, <b>${marketName} </b> of <b>${teamName}</b> were ${i.direction == 'OVER' ? 'under' : 'over'} average of <b>${i.avgValue.toFixed(3)}</b>.
                                        ${i.confidence != null ? `<span class="not-italic font-bold text-blue-600 ml-1">Confidence: ${Number(i.confidence).toFixed(3)}%</span>` : ''}
                                    </p>
                                </div>
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>

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

        // ==========================================
        // ⭐ NEW: Bind the click event to the new odds buttons
        // ==========================================
        container.querySelectorAll('.odd-popup-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Prevent the click from bubbling up if you have other handlers
                e.stopPropagation();

                // Get the exact index from the paginated data
                const idx = parseInt(btn.dataset.insightIndex);
                const insightData = paginatedInsights[idx];

                // Fire the modal function
                openOddsModal(insightData);
            });
        });

        // Bind Market clicks
        container.querySelectorAll('.market-badge').forEach(badge => {
            badge.addEventListener('click', () => {
                const marketName = badge.dataset.marketName;
                if (selectedMarkets.includes(marketName)) {
                    selectedMarkets = selectedMarkets.filter(m => m !== marketName);
                } else {
                    selectedMarkets.push(marketName);
                }
                // ⭐ NEW: drop stale side filter when no team market remains selected
                if (!selectedMarkets.some(isTeamMarket)) selectedSide = null;
                currentPage = 1;
                render();
            });
        });

        // ⭐ NEW: Bind Side clicks
        container.querySelectorAll('.side-badge').forEach(badge => {
            badge.addEventListener('click', () => {
                const side = badge.dataset.side;
                selectedSide = selectedSide === side ? null : side; // toggle off if re-clicked
                currentPage = 1;
                render();
            });
        });

        // Bind "Show All" click
        const showAllBtn = container.querySelector('#btn-show-all');
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                selectedMarkets = [];
                selectedSide = null;   // ⭐ NEW
                if (typeof state.filterByLeague !== 'undefined') {
                    state.filterByLeague = null;
                    lastLeagueFilter = null;
                }
                currentPage = 1;
                document.querySelectorAll('.league-filter-chk').forEach(chk => chk.checked = false);
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
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }

        const nextPageBtn = container.querySelector('#btn-next-page');
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    render();
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

                const awayTeamData = await fetch(`${API_TEAM_URL}/dashboard?teamId=${awayId}&seasonId=${currentSeasonId}`);
                const awayTeamResults = await awayTeamData.json();

                const homeTeamData = await fetch(`${API_TEAM_URL}/dashboard?teamId=${homeId}&seasonId=${currentSeasonId}`);
                const homeTeamResults = await homeTeamData.json();

                if (typeof handleStreakPopUp === 'function') {
                    handleStreakPopUp(homeTeamResults?.data, awayTeamResults?.data);
                }
            });
        });

        container.querySelectorAll('.mw-odd-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.insightIndex);
                const insightData = paginatedInsights[idx];
                openMatchWinnerModal(insightData, btn.dataset.mwSelection);
            });
        });

        const sortSelect = container.querySelector('#sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                sortBy = e.target.value;
                currentPage = 1;   // reset to first page after re-sorting
                render();
            });
        }
    };



    window.refreshInsightsDashboard = render;
    render();
}

export async function handleStreakPopUp(homeData, awayData) {
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
export function renderMarketComparisonTable(teamA, teamB) {
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

            const teamAvg = team === teamA ? avg : avgB;

            const mdValues = paddedMatches.map(m => {
                if (!m) {
                    return `<td class="border px-2 py-1 text-xs text-center text-gray-400">-</td>`;
                }

                const rawValue = m.rawValue;

                const cellClass = getColorForValue(
                    rawValue,
                    teamAvg?.avg_value ?? 0
                );

                return `
        <td class="border px-2 py-1 text-xs text-center ${cellClass}">
            ${rawValue}
        </td>
    `;
            }).join('');

            return `
                <tr>
                    <td class="border px-2 py-1 font-semibold sticky left-0 bg-white">${team.teamName}</td>
                    <td class="border px-2 py-1 text-center">${teamAvg ? Number(teamAvg.avg_value).toFixed(3) : 'N/A'}</td>
                    <td class="border px-2 py-1 text-center text-600 font-bold">${teamAvg?.streak?.length || 0}</td>
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

export function openTableView() {
    const container = document.getElementById('in-depth-container');

    if (state.currentAveragesData.length === 0 || state.currentMatchdaysData.length === 0) {
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
    state.currentAveragesData.forEach(avg => {
        avgLookup[avg.market.slug.toLowerCase()] = avg.avg_value;
    });

    const finishedMatches = state.currentMatchdaysData.filter(match => {
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
<div class="overflow-x-auto xl:overflow-visible">
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

    state.currentAveragesData.forEach((avg, index) => {
        const slug = avg.market.slug.toLowerCase();
        const val = avg.avg_value !== null ? Number(avg.avg_value).toFixed(3) : '-';
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



///////////// toogles or effects
export function updateUpcomingFilterUI(activeFilter) {
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
export function toggleAuditPanel(marketSlug) {
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
export function openTab(tabName) {
    state.activeTab = tabName;

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
        prevTab = 'matchday-container';
    }
    if (tabName === 'team-avgs-container') {
        thisTeamMarketAvgsView.style.display = 'block';
        prevTab = 'team-avgs-container';
    }
    if (tabName === 'upcoming-matches-container') {
        upcomingMatchesContainer.style.display = 'block';
        prevTab = 'upcoming-matches-container';
        document.getElementById('upComingGamesSwitchContainer').style.display = 'block'
    }
    if (tabName === 'in-depth-container') {
        prevTab = 'in-depth-container';
        openTableView();
        inDepthContainer.style.display = 'block';
    }

    setActiveTabButton(tabName);
}
export function setActiveTabButton(activeId) {
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

export function closeTableView() {
    document.getElementById('tableViewOverlay').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}