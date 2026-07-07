const API_URL = '/api/admin';

//states
let leaguesCache = [];

//events
document.addEventListener('DOMContentLoaded', async () => {
    openConfigContainer('league-config-container');
});

document.getElementById('leagueViewBtn').addEventListener('click', () => {
    openConfigContainer('league-config-container');
});

document.getElementById('bookmakerViewBtn').addEventListener('click', () => {
    openConfigContainer('bookmaker-config-container');
});

//async opp
const getAllLeagues = async () => {
    try {
        const response = await axios.get(`${API_URL}/leagues`);
        return response.data?.data;
    } catch (error) {
        console.log(error);
        return [];
    }
}

const changeLeagueVisibility = async (leagueId, isChecked) => {
    // 1. Instantly update the local state variable
    const league = leaguesCache.find(l => l.id === leagueId);
    if (league) {
        league.is_visible = isChecked;
    }

    // 2. Refresh the stats components smoothly without re-rendering the whole list
    renderLeagueSummery(leaguesCache);

    // 3. Fire request to back-end silently in background
    try {
        await axios.post(`${API_URL}/change-visibility`, {
            leagueId: leagueId
        });
    } catch (error) {
        console.log(error);
        // Rollback local changes on failure
        if (league) {
            league.is_visible = !isChecked;
        }
        renderLeagueSummery(leaguesCache);
        renderLeaguesListUI();
    }
}

const changeLeagueOrder = async (leagueIds) => {
    try {
        const response = await axios.post(`${API_URL}/change-order`, {
            leagueIds: leagueIds
        });
        console.log(response?.data);
    } catch (error) {
        console.log(error);
    }
}

//rendering
const renderFullLeagueConfig = () => {

}

const renderLeagueSummery = (leagueData) => {
    if (!leagueData) return;

    const activeCount = leagueData.filter(league => league.is_active).length;
    const inactiveCount = leagueData.filter(league => !league.is_visible).length;
    const totalCount = leagueData.length;

    document.getElementById('active-count').innerText = activeCount;
    document.getElementById('inactive-count').innerText = inactiveCount;
    document.getElementById('total-count').innerText = totalCount;
};

const renderLeaguesListUI = () => {
    const leagueContainer = document.getElementById('league-byorder-container');
    if (!leaguesCache) return;

    leagueContainer.innerHTML = leaguesCache.map((league, index) => `
        <div class="flex items-center p-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors group">
            <div class="w-10 text-gray-300 font-bold text-sm text-center">${index + 1}</div>
            
            <div class="flex-1 pl-4">
                <h4 class="font-semibold text-sm text-gray-900 mb-1">${league.name}</h4>
                <div class="flex items-center gap-3 text-xs text-gray-500">
                    <span class="border border-teal-600 text-teal-700 px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-50">
                        Season 25/26 • ${league.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span>${league.country || 'International'}</span>
                    <span>•</span>
                    <span>${league.streakCount || '0'} active streaks</span>
                </div>
            </div>
            
            <div class="flex items-center gap-4">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer" 
                        ${league.is_visible ? 'checked' : ''} 
                        onchange="changeLeagueVisibility(${league.id}, this.checked)">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
            </div>
        </div>
    `).join('');
}

const renderLeagues = async () => {
    // Fresh fetch call only handles initial component loading state
    leaguesCache = await getAllLeagues();
    renderLeagueSummery(leaguesCache);
    renderLeaguesListUI();
}

//helper
const openConfigContainer = (containerId) => {
    const leagueConfig = document.getElementById('league-config-container');
    const bookmakerConfig = document.getElementById('bookmaker-config-container');
    const leagueBtn = document.getElementById('leagueViewBtn');
    const bookmakerBtn = document.getElementById('bookmakerViewBtn');

    leagueConfig.classList.add('hidden');
    bookmakerConfig.classList.add('hidden');

    leagueBtn.className = "px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors";
    bookmakerBtn.className = "px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors";

    if (containerId === 'league-config-container') {
        leagueConfig.classList.remove('hidden');
        leagueBtn.className = "px-6 py-2.5 text-sm font-semibold bg-teal-50 text-teal-700 border-r-4 border-teal-600 cursor-pointer";
        renderLeagues();
    }

    if (containerId === 'bookmaker-config-container') {
        bookmakerConfig.classList.remove('hidden');
        bookmakerBtn.className = "px-6 py-2.5 text-sm font-semibold bg-teal-50 text-teal-700 border-r-4 border-teal-600 cursor-pointer";
    }
}