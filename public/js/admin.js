
const API_URL = '/api/admin';
const API_BOOKMAKER_URL = '/api/bookmaker';

//states
let leaguesCache = [];
let currentFilter = 'all';
let leagueSortableInstance = null;
let searchQuery = '';

const countries = [
    { name: "United States", code: "US" },
    { name: "Armenia", code: "AM" },
    { name: "France", code: "FR" },
    { name: "Germany", code: "DE" },
    { name: "United Kingdom", code: "GB" },
    { name: "Spain", code: "ES" },
    { name: "Italy", code: "IT" },
    { name: "Brazil", code: "BR" },
    { name: "Argentina", code: "AR" },
    { name: "Japan", code: "JP" },
];


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

const setupFilterListeners = () => {
    const filterButtons = document.querySelectorAll('#filter-container button');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // UI Toggle
            filterButtons.forEach(b => b.classList.remove('bg-teal-50', 'text-teal-700', 'font-medium'));
            btn.classList.add('bg-teal-50', 'text-teal-700', 'font-medium');

            // Set Filter
            const id = e.target.id;
            if (id === 'filter-all') currentFilter = 'all';
            else if (id === 'filter-active') currentFilter = 'active';
            else if (id === 'filter-inactive') currentFilter = 'inactive';
            else if (id === 'filter-included') currentFilter = 'included';
            else if (id === 'filter-excluded') currentFilter = 'excluded';

            renderLeaguesListUI(); // Re-render with filter
        });
    });
}

const setupSearchListener = () => {
    document.getElementById('league-search-input').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderLeaguesListUI(); // Re-render when user types
    });
}

const setupBookmkerConfigListeners = () => {
    let affiliateLinks = document.querySelectorAll('.affiliate-links-input')
    affiliateLinks.forEach(input => {
        input.addEventListener('input', (e) => {
            let { name, value } = e.target;
            console.log(e.target.name, e.target.value)
            changeAffiliateLink(name, value)
        });
    });

    let setDeafultBtns = document.querySelectorAll('.set-default-btn')
    setDeafultBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            let bookMakerId = btn.dataset.bookmakerId
            console.log(bookMakerId)
            const result = await setDefaultBookmaker(bookMakerId)
            if (result?.data?.success) {
                renderBookmakers();
            }
        })
    })

    let activeCHeckBoxs = document.querySelectorAll('.active-checkbox-input')
    activeCHeckBoxs.forEach(input => {
        input.addEventListener('click', (e) => {

            setNewBookmakerStatus(input.dataset.bookmakerId, e.target.checked)
        })
    })

    document.getElementById('close-region-modal')
        .addEventListener('click', () => {
            document.getElementById('region-modal')
                .classList.add('hidden');
        });
}






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
        return response.data?.data || response.data;
        console.log(response?.data);
    } catch (error) {
        console.log(error);
    }
}


const getAllBookmakers = async () => {
    try {
        const response = await axios.get(`${API_BOOKMAKER_URL}/bookmakers`);
        return response.data?.data;
    } catch (error) {
        console.log(error)
    }
}
const changeAffiliateLink = async (name, value) => {
    try {
        axios.post(`${API_BOOKMAKER_URL}/affiliate-link`, {
            name: name,
            value: value
        })
    } catch (error) {
        console.log(error)
    }
}
const setDefaultBookmaker = async (bookmakerId) => {
    try {
        const result = await axios.post(`${API_BOOKMAKER_URL}/set-default`, {
            id: Number(bookmakerId)
        })
        return result;
    } catch (error) {
        console.log(error)
    }
}

const setNewBookmakerStatus = async (bookmakerId, newStatus) => {
    try {
        axios.post(`${API_BOOKMAKER_URL}/change-active-status`, {
            id: Number(bookmakerId),
            status: newStatus
        })
    } catch (error) {
        console.log(error)
    }
}

const changeBookmakerRegions = async (bookmakerId, regionCode) => {
    try {
        const result = axios.post(`${API_BOOKMAKER_URL}/change-bookmaker-region`, {
            id: Number(bookmakerId),
            regionCode: regionCode
        })
        return result;
    } catch (error) {
        console.log(error)
    }
}

const removeRegionFromBookmaker = async (bookmakerId, regionCode) => {
    try {
        console.log(bookmakerId, regionCode)
        const result = await axios.post(`${API_BOOKMAKER_URL}/remove-bookmaker-region`, {
            id: Number(bookmakerId),
            regionCode: regionCode
        })
        if (result?.data?.success) {
            renderBookmakers();
            console.log('dddddddd')
        }
    } catch (error) {
        console.log(error)
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

    // --- CLEANUP: Destroy existing instance before re-rendering ---
    if (leagueSortableInstance) {
        leagueSortableInstance.destroy();
        leagueSortableInstance = null;
    }

    // 1. FILTERING LOGIC
    let displayList = [...leaguesCache];
    if (currentFilter === 'active') displayList = leaguesCache.filter(l => l.is_active);
    else if (currentFilter === 'inactive') displayList = leaguesCache.filter(l => !l.is_active);
    else if (currentFilter === 'included') displayList = leaguesCache.filter(l => l.is_visible);
    else if (currentFilter === 'excluded') displayList = leaguesCache.filter(l => !l.is_visible);

    if (searchQuery) {
        displayList = displayList.filter(l => l.name.toLowerCase().includes(searchQuery));
    }

    // 2. RENDER THE FILTERED LIST
    leagueContainer.innerHTML = displayList.map((league, index) => `
        <div data-id="${league.id}" class="flex items-center p-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors group ${currentFilter === 'all' ? 'cursor-move' : 'cursor-default'}">
            <div class="text-gray-300 mr-2 opacity-50 ${currentFilter === 'all' ? 'group-hover:opacity-100' : 'hidden'}">⋮⋮</div>
            
            <div class="row-number w-8 text-gray-400 font-bold text-sm text-center">${index + 1}</div>
            
            <div class="flex-1 pl-4">
                <h4 class="font-semibold text-sm text-gray-900 mb-1">${league.name}  </h4
                <span> active streaks : ${league.streakCount} </span> 
                <div class="flex items-center gap-3 text-xs text-gray-500">
                    <span class="border border-teal-600 text-teal-700 px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-50">
                        Season 25/26 • ${league.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span>${league.country || 'International'}</span>
                </div>
            </div>
            
            <div class="flex items-center gap-4 cursor-default" onmousedown="event.stopPropagation()">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer" 
                        ${league.is_visible ? 'checked' : ''} 
                        onchange="changeLeagueVisibility(${league.id}, this.checked)">
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
            </div>
        </div>
    `).join('');

    // 3. SORTABLE LOGIC: Only initialize if currentFilter is 'all'
    if (currentFilter === 'all' && !searchQuery) {
        leagueSortableInstance = Sortable.create(leagueContainer, {
            animation: 150,
            ghostClass: 'opacity-50',
            onEnd: async function () {
                const previousLeagues = [...leaguesCache];
                const rowElements = leagueContainer.querySelectorAll('div[data-id]');
                const newOrderIds = Array.from(rowElements).map(el => parseInt(el.dataset.id));

                rowElements.forEach((row, idx) => row.querySelector('.row-number').innerText = idx + 1);
                leaguesCache.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));

                try {
                    const updatedLeagues = await changeLeagueOrder(newOrderIds);
                    if (updatedLeagues) leaguesCache = updatedLeagues;
                } catch (error) {
                    alert("Failed to save new order.");
                    leaguesCache = previousLeagues;
                    renderLeaguesListUI();
                }
            }
        });
    }
}

const renderLeagues = async () => {
    // Fresh fetch call only handles initial component loading state
    leaguesCache = await getAllLeagues();
    renderLeagueSummery(leaguesCache);
    renderLeaguesListUI();
}


const renderBookmakers = async () => {
    const response = await getAllBookmakers();
    console.log(response)
    renderBookmakersUi(response);
}

const renderBookmakersUi = (response) => {
    const bookmakerContainer = document.getElementById('bookmaker-config-container');

    // Added a container grid class here
    bookmakerContainer.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6";

    bookmakerContainer.innerHTML = response.map((bookmaker) => `
        <div class="bg-white border ${bookmaker?.is_default ? 'border-teal-500 ring-2 ring-teal-100' : 'border-gray-200'} rounded-xl p-6 shadow-sm flex flex-col gap-4">
            
            <div class="flex items-center gap-3">
                <img src="${bookmaker?.logo_url}" alt="${bookmaker?.name}" class="w-10 h-10 object-contain rounded border border-gray-100"/>
                
                <div class="flex items-center gap-2">
                    <span class="text-lg font-bold text-gray-800">${bookmaker?.name}</span>

                    ${bookmaker?.is_default ? `
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
                            ★ Default
                        </span>
                    ` : ''}
                </div>

                <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="active-checkbox-input sr-only peer toggle-active-btn" data-bookmaker-id="${bookmaker.id}" ${bookmaker.is_active ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
                </label>
            </div>

            <div class="flex flex-col space-y-1">
                <label class="text-sm font-medium text-gray-500">Affiliate Link</label>
                <input name="${bookmaker?.name}" type="text" value="${bookmaker?.affiliate_link || ''}" 
                    class="affiliate-links-input w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
            </div>

            <div class="flex flex-col space-y-1">
                <label class="text-sm font-medium text-gray-500">Set as default</label>

                <button 
                    data-bookmaker-id="${bookmaker?.id}"
                    class="set-default-btn w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition
                    ${bookmaker?.is_default
            ? 'bg-teal-100 text-teal-700 border border-teal-300 cursor-default'
            : 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm'}"
                >
                    ${bookmaker?.is_default
            ? `
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                            </svg>
                            Current Default
                        `
            : `
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                            </svg>
                            Set as Default
                        `
        }
                </button>
            </div>

            <div class="bg-gray-50 p-4 rounded-lg mt-2">
                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Regions</label>
                <div class="flex flex-wrap gap-2 mt-2">
                    ${bookmaker?.regions.map((val) => `
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                            <img 
                                src="https://flagcdn.com/w20/${val?.region_code?.toLowerCase()}.png" 
                                alt="${val?.region_code || 'region'} flag"
                                class="w-5 h-5 mr-1"
                            >
                            ${val?.region_code || 'No region'} 
                            <span 
                            onclick="removeRegionFromBookmaker(${bookmaker?.id}, '${val?.region_code}')"
                            style="color:red; margin:10px; cursor:pointer;">
                            X
                            </span>
                        </span>
                    `).join('')}
                </div>
                
                <button 
                    onclick="openRegionModal(${bookmaker?.id})"
                    class="w-full mt-4 flex items-center justify-center gap-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2 rounded-lg transition shadow-sm">
                    
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>

                    Add region
                </button>
            </div>
        </div>
    `).join('');

    setupBookmkerConfigListeners();
}

const openRegionModal = (bookmakerId) => {
    const modal = document.getElementById('region-modal');
    const container = document.getElementById('country-list');

    container.innerHTML = countries.map(country => `
        <button 
            class="flex items-center gap-2 p-2 border rounded hover:bg-gray-100"
            data-region-code="${country.code}">
            
            <img 
                src="https://flagcdn.com/w20/${country.code.toLowerCase()}.png"
                class="w-5 h-5"
            >

            ${country.name}
        </button>
    `).join('');

    modal.classList.remove('hidden');


    // Add click listeners
    container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
            console.log(btn.dataset.regionCode, bookmakerId);


            const result = await changeBookmakerRegions(bookmakerId, btn.dataset.regionCode)

            if (result.data.success) {
                document.getElementById('close-region-modal').click();
                renderBookmakers();
            }
            // later you can call your API here
            // addBookmakerRegion(btn.dataset.regionCode)
        });
    });
};

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
        setupFilterListeners()
        leagueConfig.classList.remove('hidden');
        leagueBtn.className = "px-6 py-2.5 text-sm font-semibold bg-teal-50 text-teal-700 border-r-4 border-teal-600 cursor-pointer";
        renderLeagues();
        setupSearchListener()
    }

    if (containerId === 'bookmaker-config-container') {
        bookmakerConfig.classList.remove('hidden');
        bookmakerBtn.className = "px-6 py-2.5 text-sm font-semibold bg-teal-50 text-teal-700 border-r-4 border-teal-600 cursor-pointer";
        renderBookmakers();
    }
}
