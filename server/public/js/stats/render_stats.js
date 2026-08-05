

import { state } from "./state_stats.js";

import { fetchTeamDashboardData, fetchSeasonsForLeague, fetchTeamsForSeason, fetchAndRenderUpcomingMatches } from "../main.js";

import { prepareInsightsData, calculateLeagueMarketCounts, getColorForValue, getOddForPrediction } from "./utils_stats.js";
// admin.js is a plain script, not a module - it can't `export`, so getApiToken is
// exposed on window instead (see admin.js) and picked up here as a global rather
// than an ES import.
const getApiToken = () => window.getApiToken();

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
            total_corners: (m.home_corners !== null && m.away_corners !== null) ? m.home_corners + m.away_corners : null,
            total_goals_1st_half: m.total_1st_half,
            total_goals_2nd_half: m.total_2nd_half,
            // Match-level (not team-specific), derived straight from the score -
            // same formula pop-db.js uses when it writes these to the DB.
            team_odd_even: (m.home_score !== null && m.away_score !== null)
                ? (((m.home_score ?? 0) + (m.away_score ?? 0)) % 2 === 1 ? 1 : 0)
                : null,
            both_teams_score: (m.home_score !== null && m.away_score !== null)
                ? (((m.home_score ?? 0) > 0 && (m.away_score ?? 0) > 0) ? 1 : 0)
                : null
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
        'corners-over-under': 'TOTAL CORNERS',
        'goals-overunder': 'TOTAL GOALS',
        'red-cards-over-under': 'TOTAL RED CARDS',
        'yellow-overunder': 'TOTAL YELLOW CARDS',
        'home-team-yellow-cards': 'TEAM YELLOW CARDS',
        'away-team-yellow-cards': 'TEAM YELLOW CARDS',
        'team-red-cards': 'TEAM RED CARDS',
        'goals-overunder-first-half': 'TOTAL GOALS 1ST HALF',
        'goals-overunder-second-half': 'TOTAL GOALS 2ND HALF',
        'oddeven': 'ODD/EVEN',
        'both-teams-score': 'BOTH TEAMS TO SCORE',
    };

    // Boolean/categorical markets have no numeric threshold, so "OVER 0.5" /
    // "UNDER 0.5" (what the generic over/under template would otherwise show)
    // doesn't read as anything meaningful - swap in the real outcome labels.
    const BINARY_MARKET_LABELS = {
        'oddeven': { OVER: 'ODD', UNDER: 'EVEN' },
        'both-teams-score': { OVER: 'YES', UNDER: 'NO' },
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
    // ⭐ Fixed category order instead of alphabetical: goals → corners → yellows → reds
    const MARKET_ORDER = ['GOALS', 'CORNERS', 'YELLOW', 'RED'];
    const marketRank = (label) => {
        const idx = MARKET_ORDER.findIndex(k => (label || '').includes(k));
        return idx === -1 ? 999 : idx;
    };
    const allMarkets = [...new Set(insights.map(i => getMarketLabel(i.market.marketSlug)))]
        .sort((a, b) => {
            const r = marketRank(a) - marketRank(b);
            return r !== 0 ? r : a.localeCompare(b); // within a category, TEAM before TOTAL
        });

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
            const binaryLabels = BINARY_MARKET_LABELS[(i.market.marketSlug || '').toLowerCase()];
            // i.direction is already the SUGGESTED bet - the opposite of what the
            // streak has actually been doing (same reversion-to-mean convention every
            // other market uses: predict OVER because the team's been running UNDER).
            // So the sentence describing the streak itself needs the opposite label,
            // not i.direction directly - that's what was showing e.g. "has been EVEN"
            // right next to a prediction that *also* said EVEN, which can't both be true.
            const fullPrediction = binaryLabels ? binaryLabels[i.direction] : `${i.direction} ${i.suggestedValue}`;
            const streakLabel = binaryLabels ? binaryLabels[i.direction === 'OVER' ? 'UNDER' : 'OVER'] : null;
            // avgValue is always the rate of the "positive" outcome (odd / yes) by
            // definition (see pop-db.js) - label it with that outcome specifically,
            // not whatever the current prediction happens to be, or the % is ambiguous.
            const positiveRateLabel = binaryLabels ? binaryLabels.OVER : null;
            const leagueLabel = i.match.league?.name || i.match.league_name || '';

            return `
                        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                                <div class="md:col-span-2 flex items-center justify-between bg-gray-50/50 p-4 rounded-lg relative">
                                    ${leagueLabel ? `<span class="absolute top-1 left-2 text-[8px] font-bold text-gray-400 uppercase tracking-wider">${leagueLabel}</span>` : ''}
                                    
                                    <div class="flex flex-col items-center w-1/3 mt-2">
                                        <img src="${i.match.homeTeam.logo_url || ''}" class="w-8 h-8 object-contain mb-1" />
                                        <div class="text-[10px] font-bold text-gray-700 truncate w-full text-center">${i.match.homeTeam.name}</div>
                                        <div class="text-[8px] font-black uppercase tracking-wider ${i.isHome ? 'text-blue-600' : 'text-gray-300'}">HOME</div>
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
                                        ${binaryLabels
                    ? `<b>${teamName}</b>  <b>${marketName} </b>   has been  <b>${streakLabel}</b> for <b>${i.streakCount}</b> matches in a row `
                    : `In the last <b>${i.streakCount}</b> matches, <b>${marketName} </b> of <b>${teamName}</b> were ${i.direction == 'OVER' ? 'under' : 'over'} average of <b>${i.avgValue.toFixed(3)}</b>.`
                }
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
                const isHome = el.dataset.isHome === 'true';

                // This card's prediction belongs to whichever side isHome points at - the
                // other side can have its own (unrelated, possibly too-short) streak for
                // the same market, so it's never safe to just prefer home's id.
                let streakId = isHome ? homeStreak?.id : awayStreak?.id;
                if (streakId) streakId = `streak_${streakId}`
                console.log('streakId', streakId);

                const awayTeamData = await fetch(`${API_TEAM_URL}/dashboard?teamId=${awayId}&seasonId=${currentSeasonId}`);
                const awayTeamResults = await awayTeamData.json();

                const homeTeamData = await fetch(`${API_TEAM_URL}/dashboard?teamId=${homeId}&seasonId=${currentSeasonId}`);
                const homeTeamResults = await homeTeamData.json();

                //old popup
                // if (typeof handleStreakPopUp === 'function') {
                //     handleStreakPopUp(homeTeamResults?.data, awayTeamResults?.data);
                // }
                openTab('streak-detail-container', streakId)

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

function ordinal(n) {
    if (n === null || n === undefined) return '';
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function renderOddPill(odd) {
    if (!odd) return `<div class="mt-1 text-[10px] font-bold bg-gray-100 text-gray-400 px-2 py-0.5 rounded inline-block">No odds yet</div>`;
    // Real bookmaker logo when we have one (same field every other odds widget in the
    // app already uses); only fall back to a plain text badge when no logo file matched.
    const bookmakerPart = odd.bookmaker_logo
        ? `<span class="px-2 py-1.5 bg-white flex items-center"><img src="${odd.bookmaker_logo}" alt="${odd.bookmaker_label}" class="h-7 max-w-[80px] object-contain" /></span>`
        : `<span class="px-1.5 py-1 text-[10px] font-bold bg-blue-800 text-white">${odd.bookmaker_label}</span>`;
    return `
        <div class="inline-flex items-center rounded overflow-hidden text-xs font-bold mt-1 border border-gray-200">
            <span class="px-2 py-1 text-white bg-blue-600">${odd.value}</span>
            ${bookmakerPart}
        </div>
    `;
}

// oddeven/both-teams-score are 1/0 outcomes, not a continuous quantity, so a bar
// chart (height = magnitude) doesn't carry any information a bar chart normally
// would - every bar is either full or empty. A two-lane step chart reads much
// better for a binary sequence: each match is a dot on whichever lane it landed
// on, connected point-to-point, so a run of same-lane dots is instantly visible
// as a flat, thick, filled segment instead of an alternating bar spike pattern.
const BINARY_CHART_CONFIG = {
    odd_even: { positive: 'ODD', negative: 'EVEN' },
    both_teams_score: { positive: 'YES', negative: 'NO' }
};
// side.avg_for ('odd'/'yes', see matchup.service.js) -> the positive/negative
// label pair, keyed the other way round from BINARY_CHART_CONFIG since
// renderMatchdayTable only has avg_for to go on, not the market key.
const BINARY_LABELS_BY_AVG_FOR = {
    odd: { 1: 'ODD', 0: 'EVEN' },
    yes: { 1: 'YES', 0: 'NO' }
};
// Same blue/red pair the rest of the app already uses for over/under average
// (buildChartSVG below, the confidence ring, renderMatchdayTable).
const CHART_BLUE = '#2563eb';
const CHART_ROSE = '#ef4444';

// chartData.data is most-recent-first (see matchup.service.js), matching every
// other chart/table on this page - latest match is index 0, drawn leftmost.
function buildTwoLaneTrackSVG(chartData, config, streakCount) {
    const points_ = chartData.data;
    const n = points_.length;
    if (n === 0) return '';

    const slot = 68;
    const padLeft = 96, padRight = 24, padTop = 46, padBottom = 34;
    const laneGap = 92;
    const topLaneY = padTop + 22;
    const bottomLaneY = topLaneY + laneGap;
    const width = padLeft + padRight + slot * Math.max(n - 1, 1) + 20;
    const height = padTop + laneGap + 46 + padBottom;

    // The streak always sits against the most recent (leftmost) point here -
    // that's the one fixed anchor streak-tracker.js counts backward from - so
    // the highlighted run is always the first `streakCount` points.
    const streakEnd = Math.min(n, streakCount);
    const latestValue = Number(points_[0].value);
    const streakIsPositive = latestValue === 1;
    const streakColor = streakIsPositive ? CHART_BLUE : CHART_ROSE;

    const laneBands = `
        <rect x="${padLeft - 16}" y="${topLaneY - 20}" width="${width - padLeft - padRight + 16}" height="40" fill="${CHART_BLUE}0d" rx="8"/>
        <rect x="${padLeft - 16}" y="${bottomLaneY - 20}" width="${width - padLeft - padRight + 16}" height="40" fill="${CHART_ROSE}0d" rx="8"/>
        <text x="${padLeft - 24}" y="${topLaneY + 3}" font-size="11" font-weight="800" fill="${CHART_BLUE}" text-anchor="end">${config.positive}</text>
        <text x="${padLeft - 24}" y="${bottomLaneY + 3}" font-size="11" font-weight="800" fill="${CHART_ROSE}" text-anchor="end">${config.negative}</text>
    `;

    const points = points_.map((d, i) => {
        const x = padLeft + slot * i;
        const isPositive = Number(d.value) === 1;
        const y = isPositive ? topLaneY : bottomLaneY;
        return { x, y, isPositive, date: d.date, inStreak: i < streakEnd };
    });

    const segments = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const bothInStreak = a.inStreak && b.inStreak;
        const color = bothInStreak ? streakColor : '#cbd5e1';
        const strokeWidth = bothInStreak ? 4 : 1.5;
        segments.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`);
    }

    const dots = points.map((p, i) => {
        const isLatest = i === 0;
        const laneColor = p.isPositive ? CHART_BLUE : CHART_ROSE;
        const r = isLatest ? 9 : (p.inStreak ? 7 : 5.5);
        const fill = p.inStreak ? laneColor : '#ffffff';
        const ring = isLatest && p.inStreak
            ? `<circle cx="${p.x}" cy="${p.y}" r="${r + 4}" fill="none" stroke="${laneColor}" stroke-width="2" opacity="0.35"/>`
            : '';
        const dateLabel = `<text x="${p.x}" y="${bottomLaneY + 46}" font-size="9" fill="#94a3b8" text-anchor="middle">${p.date}</text>`;
        const latestLabel = isLatest
            ? `<text x="${p.x}" y="${bottomLaneY + 58}" font-size="9" font-weight="700" fill="#2563eb" text-anchor="middle">latest</text>`
            : '';
        return `
            ${ring}
            <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="${laneColor}" stroke-width="2.5"/>
            ${dateLabel}${latestLabel}
        `;
    }).join('');

    // Badge sits above the midpoint of the highlighted streak segment, which is
    // always the leftmost points since the streak is anchored to the most recent match.
    const badgeMidX = (points[0].x + points[streakEnd - 1].x) / 2;
    const badgeText = `CURRENT STREAK: ${streakCount}`;
    const badgeWidth = 34 + badgeText.length * 5.6;
    const badge = streakCount > 0 ? `
        <rect x="${(badgeMidX - badgeWidth / 2).toFixed(1)}" y="6" width="${badgeWidth.toFixed(1)}" height="20" rx="10" fill="${streakColor}"/>
        <text x="${badgeMidX.toFixed(1)}" y="20" font-size="10" font-weight="800" fill="#ffffff" text-anchor="middle">${badgeText}</text>
    ` : '';

    return {
        svg: `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">${laneBands}${segments.join('')}${dots}${badge}</svg>`
    };
}

function renderBinaryChartSection(chartData, config, streakCount) {
    if (!chartData || !chartData.data.length) return '';
    const { svg } = buildTwoLaneTrackSVG(chartData, config, streakCount);
    return `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div class="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div class="text-sm font-bold text-gray-800">${chartData.title}</div>
                <div class="text-xs text-gray-400">${chartData.subtitle}</div>
            </div>
            <div class="px-5 pt-4 pb-2 overflow-x-auto">${svg}</div>
        </div>
    `;
}

// The reference line here is the team's season AVERAGE (chartData.avg), not a
// betting threshold - a bar is "over"/"under" purely relative to that average.
function buildChartSVG(chartData) {
    const { avg, data } = chartData;
    const values = data.map(d => Number(d.value));
    const rawMax = Math.max(...values, Number(avg) || 0, 1);
    const niceMax = Math.ceil(rawMax * 1.15) || 1;

    // Fixed width PER bar (not the whole chart divided by bar count) - every bar and
    // every date label always gets the same, fully-readable amount of room. The chart
    // grows wider as more games are shown instead of squeezing existing bars thinner;
    // the wrapping container scrolls horizontally once it doesn't fit.
    const barSlot = 42;
    const barWidth = 22;
    const height = 190;
    const padLeft = 34, padRight = 34, padTop = 22, padBottom = 34;
    const n = data.length || 1;
    const width = padLeft + padRight + barSlot * n;
    const chartH = height - padTop - padBottom;
    const yFor = (v) => padTop + chartH - (v / niceMax) * chartH;

    const ticks = [0, niceMax / 3, (niceMax * 2) / 3, niceMax];
    const gridLines = ticks.map(t => {
        const y = yFor(t).toFixed(1);
        return `
            <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>
            <text x="${padLeft - 6}" y="${(Number(y) + 3).toFixed(1)}" font-size="10" fill="#94a3b8" text-anchor="end">${Math.round(t * 10) / 10}</text>
        `;
    }).join('');

    const avgY = yFor(Number(avg) || 0).toFixed(1);
    const avgLine = `
        <line x1="${padLeft}" y1="${avgY}" x2="${width - padRight}" y2="${avgY}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5,3"/>
        <text x="${width - padRight + 4}" y="${(Number(avgY) + 3).toFixed(1)}" font-size="9" fill="#94a3b8">${avg}</text>
    `;

    // Value label sits just above each bar. Near the very top of the chart there's
    // not much headroom before padTop, so the label flips to sit just inside the
    // bar's top edge instead of floating above it, rather than clipping off-canvas.
    const bars = data.map((d, i) => {
        const cx = padLeft + barSlot * i + barSlot / 2;
        const val = Number(d.value);
        const barH = Math.max(2, (val / niceMax) * chartH);
        const y = padTop + chartH - barH;
        const color = val > Number(avg) ? '#2563eb' : '#ef4444';
        const labelAbove = y - padTop > 12;
        const labelY = labelAbove ? y - 5 : y + 12;
        const labelColor = labelAbove ? '#334155' : '#ffffff';
        return `
            <rect x="${(cx - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="3"/>
            <text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="9" font-weight="700" fill="${labelColor}" text-anchor="middle">${d.value}</text>
        `;
    }).join('');

    // Every game gets its own date label now - no thinning needed since each bar
    // already has a fixed, fully-readable slot width.
    const xLabels = data.map((d, i) => {
        const cx = padLeft + barSlot * i + barSlot / 2;
        return `<text x="${cx.toFixed(1)}" y="${height - padBottom + 16}" font-size="9" fill="#94a3b8" text-anchor="middle">${d.date}</text>`;
    }).join('');

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; display:block;">${gridLines}${avgLine}${bars}${xLabels}</svg>`;
}

function renderChartSection(chartData) {
    if (!chartData || !chartData.data.length) return '';
    return `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div class="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div class="text-sm font-bold text-gray-800">${chartData.title}</div>
                <div class="text-xs text-gray-400">${chartData.subtitle}</div>
            </div>
            <div class="px-5 pt-4 pb-2 overflow-x-auto">${buildChartSVG(chartData)}</div>
            <div class="px-5 py-2.5 border-t border-gray-100 flex gap-4 text-[11px] text-gray-500">
                <span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-600 mr-1 align-[-1px]"></span>Over average</span>
                <span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 mr-1 align-[-1px]"></span>Under average</span>
                <span><span class="inline-block w-4 border-t-2 border-dashed border-gray-400 mr-1 align-middle"></span>Average (${chartData.avg})</span>
            </div>
        </div>
    `;
}

function renderBookmakersWidget(availableBookmakers) {
    const rows = (availableBookmakers || []).map(b => {
        const badge = b.bookmaker_logo
            ? `<img src="${b.bookmaker_logo}" alt="${b.bookmaker_label}" class="h-6 max-w-[64px] object-contain" />`
            : `<span class="text-[10px] font-bold bg-blue-800 text-white px-2 py-1 rounded">${b.bookmaker_label}</span>`;
        return `
            <div class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0">
                ${badge}
                <span class="text-sm font-medium text-gray-700 flex-1 truncate">${b.bookmaker_label}</span>
                <a class="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                    Visit
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                </a>
            </div>
        `;
    }).join('');

    return `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div class="px-4 py-3.5 border-b border-gray-100 text-sm font-bold text-gray-800">Available bookmakers</div>
            ${rows || '<div class="px-4 py-4 text-xs text-gray-400">No bookmakers currently pricing this prediction.</div>'}
        </div>
    `;
}

function renderStandingsWidget(leagueStandings, leagueName, homeTeamId, awayTeamId) {
    if (!leagueStandings || !leagueStandings.rows.length) return '';
    const rows = leagueStandings.rows.map(r => {
        const isMatchTeam = r.team.id === homeTeamId || r.team.id === awayTeamId;
        return `
            <div class="flex items-center gap-2.5 px-4 py-2 border-b border-gray-100 last:border-b-0 text-xs ${isMatchTeam ? 'bg-blue-50' : ''}">
                <span class="w-5 text-center font-semibold text-gray-400">${r.position}</span>
                <img src="${r.team.logo_url || ''}" class="w-5 h-5 object-contain flex-shrink-0" />
                <span class="flex-1 truncate font-medium ${isMatchTeam ? 'text-blue-700 font-bold' : 'text-gray-700'}">${r.team.name}</span>
                <span class="font-bold text-gray-800">${r.points}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mt-4">
            <div class="flex items-center justify-between px-4 py-3.5 border-b border-gray-100">
                <div class="text-sm font-bold text-gray-800">League standings</div>
                <div class="text-xs text-gray-400">${leagueName || ''}</div>
            </div>
            ${rows}

            <!-- Footer -->
            <div class="border-t border-gray-200 px-4 py-3.5 bg-white">
                <a class="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors">
                    Full table
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </a>
            </div>
        </div>
    `;
}

function renderSimilarStreaks(similarStreaks) {
    // Return empty state if no items exist
    if (!similarStreaks || !similarStreaks.items || similarStreaks.items.length === 0) {
        return `
            <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm max-w-sm font-sans">
                <div class="px-4 py-3.5 border-b border-gray-100 flex items-center gap-2 text-sm font-bold text-gray-800">
                    <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    Similar streaks
                </div>
                <div class="px-4 py-6 text-sm text-gray-400 text-center">
                    No Similar markets currently available
                </div>
            </div>
        `;
    }

    // Map through the streaks to create the individual cards
    const similarStreaksHtml = similarStreaks.items
        .map(streak => {
            // Format market text (e.g., "Goals 2nd half - under 1.5")
            const marketText = `${streak.market.label} - ${streak.prediction.direction} ${streak.prediction.threshold}`;

            return `
                <div class="bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm">
                    <div class="flex items-center justify-between mb-3">
                        <!-- Home Team -->
                        <div class="flex flex-col items-center w-1/3 gap-1.5">
                            <img src="${streak.home.logo_url}" alt="${streak.home.name}" class="w-8 h-8 object-contain" onerror="this.style.display='none'">
                            <span class="text-xs font-bold text-gray-800 text-center leading-tight">${streak.home.name}</span>
                        </div>

                        <!-- Streak Count -->
                        <div class="flex flex-col items-center w-1/3">
                            <span class="text-[28px] font-black text-blue-500 leading-none">${streak.streak_count}</span>
                            <span class="text-[9px] font-extrabold text-gray-400 tracking-wider mt-1 uppercase">Streaks</span>
                        </div>

                        <!-- Away Team -->
                        <div class="flex flex-col items-center w-1/3 gap-1.5">
                            <img src="${streak.away.logo_url}" alt="${streak.away.name}" class="w-8 h-8 object-contain" onerror="this.style.display='none'">
                            <span class="text-xs font-bold text-gray-800 text-center leading-tight">${streak.away.name}</span>
                        </div>
                    </div>

                    <!-- Divider -->
                    <div class="h-px bg-gray-100 w-full mb-2.5"></div>

                    <!-- Market details and Confidence -->
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-medium text-gray-400">${marketText}</span>
                        <span class="text-xs font-bold text-blue-500">${streak.confidence}%</span>
                    </div>
                </div>
            `;
        })
        .join("");


    // Render the final component
    return `
        <div class="bg-slate-50 border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col w-full max-w-sm font-sans">
            
            <!-- Header -->
            <div class="px-4 py-3.5 border-b border-gray-200 bg-white flex items-center justify-between">
                <div class="flex items-center gap-2 text-[15px] font-extrabold text-gray-800">
                    Similar streaks
                </div>
                <span class="text-xs font-semibold text-gray-400">Same market</span>
            </div>

            <!-- Streaks List -->
            <div class="p-3.5 flex flex-col gap-3">
                ${similarStreaksHtml}
            </div>

            <!-- Footer -->
            <div class="border-t border-gray-200 px-4 py-3.5 bg-white">
                <a class="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors">
                    View all ${similarStreaks.otherSimilarStreakCounts} similar streaks
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </a>
            </div>
            
        </div>
    `;
}

// Matchday-by-matchday table for both sides of the market this streak is about.
// home.matches/away.matches are already most-recent-first, so columns read
// left-to-right newest-to-oldest with no reordering needed. Column headers are
// abstract "game N back" labels rather than real matchday numbers - matchdays
// can be out of chronological order (rescheduled fixtures), and home/away play
// on different dates anyway, so there's no single date that fits one column
// for both rows.
function renderMatchdayTable(home, away, marketLabel) {
    const maxLength = Math.min(20, Math.max(home.matches.length, away.matches.length));
    if (maxLength === 0) return '';

    // avg_for is set by the backend only for oddeven/both-teams-score (see
    // matchup.service.js) - season_avg there is an occurrence rate, not a
    // literal average, so the column header needs to say what it's a rate OF.
    const avgFor = home.avg_for ?? away.avg_for ?? null;
    const avgHeaderLabel = avgFor ? `Avg (${avgFor})` : 'Avg';

    // Same right-aligned padding renderMarketComparisonTable already used: both rows
    // share one set of columns, most recent on the left. A team with fewer games
    // played (games in hand, joined a competition later, etc.) gets '-' padded into
    // its leftmost/most-recent-labeled columns instead of its data sliding out of
    // alignment with the other row.
    const headerCells = Array.from({ length: maxLength }, (_, i) =>
        `<th class="px-2.5 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap">MD${maxLength - i}</th>`
    ).join('');

    const renderRow = (side) => {
        const startIndex = maxLength - side.matches.length;
        const binaryLabels = side.avg_for ? BINARY_LABELS_BY_AVG_FOR[side.avg_for] : null;
        const cells = Array.from({ length: maxLength }, (_, i) => {
            const m = i >= startIndex ? side.matches[i - startIndex] : null;
            if (!m) return `<td class="text-center px-2.5 py-2 text-xs text-gray-300">-</td>`;
            const isOver = side.season_avg !== null && m.value > side.season_avg;
            const cls = isOver ? 'text-blue-600 bg-blue-50' : 'text-red-600 bg-red-50';
            const display = binaryLabels ? binaryLabels[m.value] : m.value;
            return `<td class="text-center px-2.5 py-2"><span class="inline-block min-w-[22px] px-1.5 py-0.5 rounded text-xs font-bold ${cls}">${display}</span></td>`;
        }).join('');

        return `
            <tr class="border-b border-gray-100 last:border-b-0">
                <td class="px-4 py-2 sticky left-0 bg-white">
                    <div class="flex items-center gap-2 whitespace-nowrap">
                        <img src="${side.team.logo_url || ''}" class="w-5 h-5 object-contain flex-shrink-0" />
                        <span class="text-xs font-bold text-gray-800">${side.team.name}</span>
                    </div>
                </td>
                <td class="px-3 py-2 text-center text-xs font-semibold text-gray-600 whitespace-nowrap">${side.season_avg ?? '&mdash;'}</td>
                <td class="px-3 py-2 text-center text-xs font-bold text-blue-600 whitespace-nowrap">${side.streak?.count ?? '&mdash;'}</td>
                ${cells}
            </tr>
        `;
    };

    return `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mt-4">
            <div class="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div class="text-sm font-bold text-gray-800">${marketLabel} &mdash; matchday by matchday</div>
                <div class="text-xs text-gray-400">Scroll for more &rarr;</div>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full border-collapse min-w-[700px]">
                    <thead>
                        <tr class="bg-gray-50 border-b border-gray-100">
                            <th class="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 sticky left-0 bg-gray-50">Team</th>
                            <th class="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">${avgHeaderLabel}</th>
                            <th class="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Streak</th>
                            ${headerCells}
                        </tr>
                    </thead>
                    <tbody>
                        ${renderRow(home)}
                        ${renderRow(away)}
                    </tbody>
                </table>
            </div>
            <div class="px-5 py-2.5 border-t border-gray-100 flex gap-4 text-[11px] text-gray-500">
                <span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-50 border border-blue-200 mr-1 align-[-1px]"></span>Over that team's own average</span>
                <span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-red-50 border border-red-200 mr-1 align-[-1px]"></span>At or under that team's own average</span>
            </div>
        </div>
    `;
}

const TEAM_STAT_ROWS = [
    { key: 'goals_scored', label: 'Goals scored / game', higherIsBetter: true },
    { key: 'goals_conceded', label: 'Goals conceded / game', higherIsBetter: false },
    { key: 'goals_1st_half', label: 'Goals 1st half / game', higherIsBetter: true },
    { key: 'goals_2nd_half', label: 'Goals 2nd half / game', higherIsBetter: true },
    { key: 'corners', label: 'Corners / game', higherIsBetter: true },
    { key: 'yellow_cards', label: 'Yellow cards / game', higherIsBetter: false },
    { key: 'possession', label: 'Avg possession', higherIsBetter: true, isPercent: true },
    { key: 'shots', label: 'Shots / game', higherIsBetter: true },
    { key: 'clean_sheets', label: 'Clean sheets', higherIsBetter: true }
];

function renderTeamStatsSection(statistics, match, leagueStandings) {
    if (!statistics) return '';
    const { home, away, league_avg } = statistics;

    const homeStanding = leagueStandings?.rows.find(r => r.team.id === match.home.id);
    const awayStanding = leagueStandings?.rows.find(r => r.team.id === match.away.id);

    const rows = TEAM_STAT_ROWS.map(({ key, label, higherIsBetter, isPercent }) => {
        const h = home[key], a = away[key], lg = league_avg[key];
        if (h === null || a === null) {
            return `
                <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-100 last:border-b-0">
                    <div class="w-16 text-right text-sm font-bold text-gray-300">&mdash;</div>
                    <div class="flex-1 text-center">
                        <div class="text-xs font-semibold text-gray-500">${label}</div>
                    </div>
                    <div class="w-16 text-sm font-bold text-gray-300">&mdash;</div>
                </div>
            `;
        }
        const hWins = higherIsBetter ? h > a : h < a;
        const aWins = higherIsBetter ? a > h : a < h;
        const total = h + a || 1;
        const hPct = Math.round((h / total) * 100);
        const suffix = isPercent ? '%' : '';

        return `
            <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-100 last:border-b-0">
                <div class="w-16 text-right text-sm font-bold ${hWins ? 'text-blue-600' : 'text-gray-800'}">${h}${suffix}</div>
                <div class="flex-1 text-center">
                    <div class="text-xs font-semibold text-gray-600">${label}</div>
                    <div class="text-[10px] text-gray-400 mt-0.5">League avg: ${lg ?? '&mdash;'}${lg !== null ? suffix : ''}</div>
                    <div class="flex h-1 rounded-full overflow-hidden mt-1.5 bg-gray-100">
                        <div class="bg-blue-500" style="width:${hPct}%"></div>
                        <div class="bg-gray-700" style="width:${100 - hPct}%"></div>
                    </div>
                </div>
                <div class="w-16 text-sm font-bold ${aWins ? 'text-blue-600' : 'text-gray-800'}">${a}${suffix}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mt-4">
            <div class="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                <div class="text-sm font-bold text-gray-800">Team statistics</div>
                <div class="text-xs text-gray-400">Season averages per market</div>
            </div>
            <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-4 border-b border-gray-100">
                <div class="flex items-center gap-2.5">
                    <img src="${match.home.logo_url || ''}" class="w-9 h-9 object-contain" />
                    <div>
                        <div class="text-sm font-bold text-gray-800">${match.home.name}</div>
                        <div class="text-[11px] text-gray-400">${homeStanding ? `${ordinal(homeStanding.position)} &middot; ${homeStanding.points} pts` : ''}</div>
                    </div>
                </div>
                <div class="text-center">
                    <div class="text-xs font-bold text-gray-400">VS</div>
                    <div class="text-[10px] text-gray-400">with league average</div>
                </div>
                <div class="flex items-center gap-2.5 justify-end text-right">
                    <div>
                        <div class="text-sm font-bold text-gray-800">${match.away.name}</div>
                        <div class="text-[11px] text-gray-400">${awayStanding ? `${ordinal(awayStanding.position)} &middot; ${awayStanding.points} pts` : ''}</div>
                    </div>
                    <img src="${match.away.logo_url || ''}" class="w-9 h-9 object-contain" />
                </div>
            </div>
            ${rows}
        </div>
    `;
}

export const showStreakDetailView = async (streakId) => {
    const streakDetailContainer = document.getElementById('streak-detail-container');
    streakDetailContainer.innerHTML = `
        <div class="p-8 text-center text-gray-400"><div class="animate-pulse">Loading streak detail...</div></div>
    `;

    let data;
    try {
        const apiToken = await getApiToken();
        const res = await fetch(`/api/matchup/${streakId}`, {
            headers: { Authorization: `Bearer ${apiToken?.token}` }
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.message || 'Failed to load streak detail');
        data = result.data;
    } catch (error) {
        console.error(error);
        streakDetailContainer.innerHTML = `
            <button id="closeContainerBtn" class="mb-3 text-sm text-gray-500 hover:text-gray-800">&larr; Back</button>
            <div class="p-4 text-xs text-red-500">Failed to load streak detail.</div>
        `;
        document.getElementById('closeContainerBtn').addEventListener('click', () => openTab(prevTab));
        return;
    }

    const { match, market, streak_count, prediction, confidence, confidence_label, odds, availableBookmakers, leagueStandings, similarStreaks, streak_side } = data;
    const isHomeStreakTeam = streak_side === 'home';
    const isAwayStreakTeam = streak_side === 'away';
    const circumference = 2 * Math.PI * 21;
    const dashOffset = circumference * (1 - confidence / 100);

    // Available bookmakers should cover match-winner odds too, not just whoever is
    // pricing this one prediction - merge in home_win/away_win's bookmakers,
    // deduping by bookmaker identity so one already in the list isn't repeated.
    const allBookmakers = [...availableBookmakers];
    const seenBookmakers = new Set(availableBookmakers.map(b => b.bookmaker));
    for (const odd of [odds.home_win, odds.away_win]) {
        if (odd && !seenBookmakers.has(odd.bookmaker)) {
            const { value, ...rest } = odd;
            allBookmakers.push(rest);
            seenBookmakers.add(odd.bookmaker);
        }
    }

    streakDetailContainer.innerHTML = `
        <button id="closeContainerBtn" class="mb-3 text-sm text-gray-500 hover:text-gray-800">&larr; Back</button>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div class="grid grid-cols-1 md:grid-cols-[190px_1fr_190px_1.4fr]">
                <div class="flex flex-col items-center justify-center gap-2 p-6 border-r border-gray-100 relative ${isHomeStreakTeam ? 'bg-blue-50/60 ring-2 ring-inset ring-blue-500' : ''}">
                    ${isHomeStreakTeam ? `<div class="absolute top-2 left-2 text-[8px] font-black uppercase tracking-wider text-white bg-blue-600 px-1.5 py-0.5 rounded">Streak Team</div>` : ''}
                    <img src="${match.home.logo_url || ''}" class="w-14 h-14 object-contain" />
                    <div class="text-sm font-bold text-gray-800 text-center">${match.home.name}</div>
                    <div class="text-[11px] text-gray-400">Home &middot; <strong class="text-blue-600">${ordinal(match.home.position)} place</strong></div>
                    ${renderOddPill(odds.home_win)}
                </div>

                <div class="flex flex-col items-center justify-center text-center gap-1 p-5">
                    <div class="text-5xl font-extrabold text-blue-600 leading-none">${streak_count}</div>
                    <div class="text-xs font-bold uppercase tracking-wide text-gray-800 mt-1">Streaks</div>
                    <div class="text-[11px] text-gray-400 mt-1">${market.label}</div>
                    <div class="text-[11px] text-gray-400 mt-1">${match.date_display}</div>
                    <div class="text-[11px] text-blue-600 font-semibold mt-0.5">${match.league.name}</div>
                </div>

                <div class="flex flex-col items-center justify-center gap-2 p-6 border-l border-r border-gray-100 relative ${isAwayStreakTeam ? 'bg-blue-50/60 ring-2 ring-inset ring-blue-500' : ''}">
                    ${isAwayStreakTeam ? `<div class="absolute top-2 left-2 text-[8px] font-black uppercase tracking-wider text-white bg-blue-600 px-1.5 py-0.5 rounded">Streak Team</div>` : ''}
                    <img src="${match.away.logo_url || ''}" class="w-14 h-14 object-contain" />
                    <div class="text-sm font-bold text-gray-800 text-center">${match.away.name}</div>
                    <div class="text-[11px] text-gray-400">Away &middot; <strong class="text-blue-600">${ordinal(match.away.position)} place</strong></div>
                    ${renderOddPill(odds.away_win)}
                </div>

                <div class="p-6 flex flex-col justify-center gap-1">
                    <div class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Prediction Market &middot; ${market.label}</div>
                    <div class="flex items-start gap-2 flex-wrap my-1">
                        <div class="text-[15px] font-bold text-gray-800 flex-1">${prediction.text}</div>
                        ${renderOddPill(odds.recommended)}
                    </div>
                    <div class="text-xs text-gray-500 leading-relaxed">${prediction.description}</div>

                    <div class="flex items-center gap-3 mt-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
                        <div class="relative w-[52px] h-[52px] flex-shrink-0">
                            <svg width="52" height="52" viewBox="0 0 52 52" class="-rotate-90">
                                <circle cx="26" cy="26" r="21" fill="none" stroke="#e2e8f0" stroke-width="4.5"/>
                                <circle cx="26" cy="26" r="21" fill="none" stroke="#2563eb" stroke-width="4.5"
                                    stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"/>
                            </svg>
                            <div class="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-blue-600">${confidence}%</div>
                        </div>
                        <div>
                            <div class="text-[17px] font-bold text-gray-800 leading-none">${confidence}% Confidence</div>
                           <!-- <div class="text-[11px] text-gray-400 mt-1">${confidence_label} &mdash; strong signal across ${streak_count} matches</div> -->
                        </div>
                    </div>

                    ${odds.recommended ? `
                        <div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                            <a 
                                class="inline-flex items-center gap-1.5 bg-blue-600 text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-blue-700">
                                Bet on ${odds.recommended.bookmaker_label}
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4 items-start">
            <div>
                ${BINARY_CHART_CONFIG[market.key] ? renderBinaryChartSection(data.chartData, BINARY_CHART_CONFIG[market.key], streak_count) : renderChartSection(data.chartData)}
                ${renderMatchdayTable(data.home, data.away, market.label)}
                ${renderTeamStatsSection(data.statistics, match, leagueStandings)}
            </div>
            <div>
                ${renderBookmakersWidget(allBookmakers)}
                ${renderStandingsWidget(leagueStandings, match.league.name, match.home.id, match.away.id)}
                ${renderSimilarStreaks(similarStreaks)}
            </div>
        </div>
    `;

    document.getElementById('closeContainerBtn').addEventListener('click', () => {
        openTab(prevTab);
    });
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

                // rawNumericValue is what color-coding needs (Number("ODD") is NaN) -
                // falls back to rawValue for markets that never set it.
                const cellClass = getColorForValue(
                    m.rawNumericValue ?? rawValue,
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
            let colorValue = '-'; // numeric value for getColorForValue - separate from
            // rawValue for boolean markets, since "ODD"/"YES" isn't a Number().

            switch (slug) {
                case 'team-goals':
                    rawValue = colorValue = match.team_goals ?? '-';
                    break;
                case 'total-goals':
                    rawValue = colorValue = match.total_goals ?? '-';
                    break;
                case 'team-yellow-cards':
                    rawValue = colorValue = match.team_yellows ?? '-';
                    break;
                case 'total-yellow-cards':
                    rawValue = colorValue = match.total_yellows ?? '-';
                    break;
                case 'team-red-cards':
                    rawValue = colorValue = match.team_reds ?? '-';
                    break;
                case 'total-red-cards':
                    rawValue = colorValue = match.total_reds ?? '-';
                    break;
                case 'team-corner-kicks':
                    rawValue = colorValue = match.team_corners ?? '-';
                    break;
                case 'total-corner-kicks':
                    rawValue = colorValue = match.total_corners ?? '-';
                    break;
                case 'total-goals-1st-half':
                    rawValue = colorValue = match.total_goals_1st_half ?? '-';
                    break;
                case 'total-goals-2nd-half':
                    rawValue = colorValue = match.total_goals_2nd_half ?? '-';
                    break;
                case 'oddeven':
                    colorValue = match.team_odd_even;
                    rawValue = match.team_odd_even === 1 ? 'ODD' : (match.team_odd_even === 0 ? 'EVEN' : '-');
                    break;
                case 'both-teams-score':
                    colorValue = match.both_teams_score;
                    rawValue = match.both_teams_score === 1 ? 'YES' : (match.both_teams_score === 0 ? 'NO' : '-');
                    break;
                default:
                    rawValue = '-';
            }

            const cellClass = getColorForValue(colorValue, avgValue);

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
export function openTab(tabName, customProp = null) {
    state.activeTab = tabName;

    const finishedMatchesView = document.getElementById('matchday-container');
    const thisTeamMarketAvgsView = document.getElementById('team-avgs-container');
    const upcomingMatchesContainer = document.getElementById('upcoming-matches-container');
    const inDepthContainer = document.getElementById('in-depth-container');
    const streakDetailContainer = document.getElementById('streak-detail-container');

    finishedMatchesView.style.display = 'none';
    thisTeamMarketAvgsView.style.display = 'none';
    upcomingMatchesContainer.style.display = 'none';
    inDepthContainer.style.display = 'none';
    streakDetailContainer.style.display = 'none'
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
    if (tabName == 'streak-detail-container') {
        showStreakDetailView(customProp)
        streakDetailContainer.style.display = 'block'
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