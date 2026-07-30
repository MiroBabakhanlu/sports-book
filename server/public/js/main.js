import { state } from "./stats/state_stats.js";
import { renderInsightsDashboard } from "./stats/render_stats.js";
import { prepareInsightsData } from "./stats/utils_stats.js";
import { loadStatEvents } from "./stats/events_stats.js";


const API_TEAM_URL = '/api/teams';



export async function fetchTeamDashboardData(teamId, teamName) {
    try {
        const response = await fetch(`${API_TEAM_URL}/dashboard?teamId=${teamId}&seasonId=${state.selectedSeasonId}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        return result.data;
    } catch (error) {
        // alert("Could not load dashboard content blocks");
        console.error(error)
        return null;
    }
}
export async function fetchSeasonsForLeague(leagueId) {
    try {
        const response = await fetch(`${API_TEAM_URL}/seasons?leagueId=${leagueId}`);
        const result = await response.json();
        return result.data;
    } catch (err) {
        return null;
    }
}
export async function fetchTeamsForSeason(seasonId) {
    try {
        const response = await fetch(`${API_TEAM_URL}/teams?seasonId=${seasonId}`);
        const result = await response.json();
        return result.data;
    } catch (err) {
        return null;
    }
}
export async function fetchAndRenderUpcomingMatches({ leagueId, teamId, seasonYear }) {

    const container = document.getElementById('upcoming-matches-container');
    container.innerHTML = `<div class="p-8 text-center text-gray-400"><div class="animate-pulse">Loading analysis...</div></div>`;

    try {
        const params = new URLSearchParams({ season: seasonYear });
        if (leagueId) params.append('leagueId', leagueId);
        if (teamId) params.append('teamId', teamId);
        const response = await fetch(`${API_TEAM_URL}/upcoming-games?${params.toString()}`);
        const result = await response.json();
        handleUpComingMatchesUi(result);
    } catch (err) {
        console.error("Error loading insights:", err);
        container.innerHTML = `<div class="p-4 text-xs text-red-500">Failed to load insights.</div>`;
    }
}
export function handleUpComingMatchesUi(result) {
    console.log('handleUpComingMatchesUi', result)
    const insights = prepareInsightsData(result);
    renderInsightsDashboard(insights);
}

loadStatEvents();



