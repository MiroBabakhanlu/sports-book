const API_URL = '/api/admin';
const API_BOOKMAKER_URL = '/api/bookmaker';
//states
let leaguesCache = [];
let currentFilter = 'all';
let leagueSortableInstance = null;
let unpinnedSortableInstance = null;
let searchQuery = '';

let countries = [];
let availbleRegions = []


//events
document.addEventListener('DOMContentLoaded', async () => {
    openConfigContainer('league-config-container');
    getAllInuseRegions();
    console.log('loaddded')
    countries = await getAvailableRegions();
    holdRegionCodes = [];
});

document.getElementById('leagueViewBtn').addEventListener('click', () => {
    openConfigContainer('league-config-container');
});

document.getElementById('bookmakerViewBtn').addEventListener('click', () => {
    openConfigContainer('bookmaker-config-container');
});

document.getElementById('recordsViewBtn').addEventListener('click', () => {
    openConfigContainer('records-container');
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
            else if (id === 'filter-pinned') currentFilter = 'pinned';

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
            const bookmakerId = input.dataset?.bookmakerId;
            console.log(e.target.name, e.target.value)
            changeAffiliateLink(bookmakerId, value)
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

    let addBookmakerBtn = document.getElementById('addBookmakerBtn');
    addBookmakerBtn.addEventListener('click', () => {
        // Prevent opening multiple "new" rows at once
        if (document.getElementById('new-bookmaker-row')) return;

        const container = document.getElementById('bookmaker-config-container');
        const headerRow = container.querySelector('.hidden.lg\\:grid');

        // Create the new inline row
        const newRow = document.createElement('div');
        newRow.id = 'new-bookmaker-row';
        newRow.className = "bg-blue-50 border-2 border-blue-400 rounded-xl p-4 shadow-sm flex flex-col lg:grid lg:grid-cols-[200px_1fr_280px_160px_80px] gap-4 items-center mb-2";

        // 1. UPDATED HTML: Added the file input and image preview inside the first column
        newRow.innerHTML = `
        <div class="w-full flex items-center gap-3">
            <label class="cursor-pointer relative flex items-center justify-center min-w-[40px] w-10 h-10 rounded-lg border border-dashed border-gray-400 bg-white hover:bg-gray-50 transition overflow-hidden group" title="Upload Logo">
                <input type="file" id="new-bm-logo-input" accept="image/*" class="hidden" />
                <span id="new-bm-logo-text" class="text-gray-400 text-[9px] uppercase font-bold text-center leading-tight">Add<br>Logo</span>
                <img id="new-bm-logo-preview" src="" class="absolute inset-0 w-full h-full object-contain p-0.5 hidden bg-white z-10" />
            </label>
            <div class="flex flex-col w-full">
                <input type="text" id="new-bm-name" placeholder="Bookmaker Name *" required class="w-full border border-gray-300 rounded-lg p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-inner" />
            </div>
        </div>

        <div class="w-full">
            <input type="text" id="new-bm-link" placeholder="https://..." class="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-inner" />
        </div>

        <div class="w-full relative">
            <div class="flex flex-wrap items-center gap-1.5 p-1.5 border border-dashed border-gray-300 rounded-lg min-h-[42px] bg-gray-50/50">
                <div id="regionCodes-container-when-creating">${renderRegionCodesWHenCreating()}</div>
                <button 
                    onclick="toggleRegionDropdown(null)"
                    class="inline-flex items-center text-xs font-medium text-gray-400 hover:text-teal-600 px-2 py-1 rounded hover:bg-gray-100 transition gap-1"
                >
                    + Select GEOs
                </button>
            </div>
            
            <div id="region-dropdown-container" class="region-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; margin-top:4px; z-index:20; background:white; border:1px solid #e5e7eb; border-radius:8px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); overflow:hidden;">
                <div class="p-2 border-b border-gray-100">
                    <input 
                        type="text" 
                        id="region-search-input" 
                        placeholder="Search countries..." 
                        class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    >
                </div>
                <div id="country-list-inline" class="max-h-60 overflow-y-auto" style="max-height:240px; overflow-y:auto;">
                </div>
            </div>
        </div>

        <div class="w-full flex flex-col space-y-2">
            <button id="save-new-bm-btn" class="w-full bg-blue-600 text-white hover:bg-blue-700 font-bold py-2 rounded-lg text-xs transition shadow-sm">
                Create
            </button>
            <button id="cancel-new-bm-btn" class="text-xs font-medium text-gray-500 hover:text-gray-800">
                Cancel
            </button>
        </div>

        <div class="w-full flex justify-center items-center">
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="new-bm-active" class="sr-only peer" checked>
                <div class="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
            </label>
        </div>
    `;

        // Insert the new row directly below the table header
        headerRow.after(newRow);

        // 2. IMAGE PREVIEW LISTENER
        let selectedLogoFile = null;
        const logoInput = document.getElementById('new-bm-logo-input');
        const logoPreview = document.getElementById('new-bm-logo-preview');
        const logoText = document.getElementById('new-bm-logo-text');

        logoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                selectedLogoFile = file;
                // Create a temporary URL to preview the image locally
                logoPreview.src = URL.createObjectURL(file);
                logoPreview.classList.remove('hidden');
                logoText.classList.add('hidden');
            }
        });

        // Cancel Button Action
        document.getElementById('cancel-new-bm-btn').addEventListener('click', () => {
            newRow.remove();
            holdRegionCodes = [];
        });

        // Save Button Action
        document.getElementById('save-new-bm-btn').addEventListener('click', async () => {
            const name = document.getElementById('new-bm-name').value.trim();
            const affiliate_link = document.getElementById('new-bm-link').value.trim();
            const is_active = document.getElementById('new-bm-active').checked;

            if (!name) {
                alert("Bookmaker name is required!");
                document.getElementById('new-bm-name').focus();
                return;
            }

            try {
                document.getElementById('save-new-bm-btn').innerText = "Creating...";

                // 3. UPDATED NETWORK REQUEST: Build FormData instead of JSON
                const formData = new FormData();
                formData.append('name', name);
                formData.append('affiliate_link', affiliate_link);
                formData.append('is_active', is_active); // Note: this will send as string "true" or "false"

                if (selectedLogoFile) {
                    // 'logo' is the key your backend will look for in req.files or req.file
                    formData.append('logo', selectedLogoFile);
                }

                const res = await fetch(`${API_BOOKMAKER_URL}/add-bookmaker`, {
                    method: 'POST',
                    // IMPORTANT: Do NOT set 'Content-Type' manually when using FormData. 
                    // The browser automatically sets it to multipart/form-data with the correct boundaries.
                    body: formData
                });

                const data = await res.json();
                console.log('addedBookmaker', data)

                if (data.success || res.ok) {
                    newRow.remove();
                    if (typeof renderBookmakers === 'function') {
                        for (let i = 0; i < holdRegionCodes.length; i++) {
                            changeBookmakerRegions(data?.data?.id, holdRegionCodes[i]);
                        }
                        holdRegionCodes = [];
                        countries = await getAvailableRegions();
                        renderBookmakers();
                    }
                } else {
                    alert(data.message || "Failed to create bookmaker");
                    document.getElementById('save-new-bm-btn').innerText = "Create";
                }
            } catch (error) {
                console.error("Error creating bookmaker:", error);
                alert("A network error occurred.");
                document.getElementById('save-new-bm-btn').innerText = "Create";
            }
        });
    });

    let deleteBookmakerBtns = document.querySelectorAll('.delete-bookmaker-btn');
    deleteBookmakerBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.bookmakerId;
            const name = btn.dataset.bookmakerName;

            if (confirm(`Are you absolutely sure you want to completely delete ${name}? This action will permanently erase this bookmaker and all assigned country records.`)) {
                try {
                    const response = await fetch(`${API_BOOKMAKER_URL}/delete-bookmaker/${id}`, {
                        method: 'POST'
                    });
                    const result = await response.json();

                    if (result.success) {
                        renderBookmakers(); // Re-trigger fetch and layout refresh
                    } else {
                        alert(result.message || "Failed to complete deletion routine");
                    }
                } catch (error) {
                    console.error("Error executing network deletion request:", error);
                    alert("A transmission error occurred while communication with the core server.");
                }
            }
        });
    });

    document.getElementById('close-region-modal')
        .addEventListener('click', () => {
            document.getElementById('region-modal')
                .classList.add('hidden');
        });
}






//async opp
const getAllCountries = async () => {
    try {
        const response = await fetch('https://cdn.jsdelivr.net/npm/world-countries@4.0.0/countries.json');
        const data = await response.json();

        const formattedCountries = data
            .map(country => ({
                name: country.name.common,
                code: country.cca2
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return formattedCountries;
    } catch (error) {
        console.error('Error fetching country list:', error);
        return [];
    }
};


const getAvailableRegions = async () => {
    try {
        const allCountries = await getAllCountries();
        const inUseRegions = await getAllInuseRegions();

        // Add holdRegionCodes to inUseRegions
        holdRegionCodes.forEach(code => {
            if (!inUseRegions.includes(code)) {
                inUseRegions.push(code);
            }
        });

        const availableRegions = allCountries.filter(
            country => !inUseRegions.includes(country.code)
        );

        return availableRegions;
    } catch (error) {
        console.error("Error filtering regions:", error);
        return [];
    }
};

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
// Fire-and-await the write only for error detection - the caller has already applied
// the reorder optimistically, and the response has no streak/round data to merge back in.
const changeLeagueOrder = async (pinnedIds, unpinnedIds) => {
    await axios.post(`${API_URL}/change-order`, {
        pinnedIds: pinnedIds,
        unpinnedIds: unpinnedIds
    });
}

const changeLeaguePinStatus = async (leagueId) => {
    const league = leaguesCache.find(l => l.id === leagueId);
    if (!league) return;

    const previousLeagues = leaguesCache.map(l => ({ ...l }));
    const nextPinned = !league.is_pinned;

    // Mirror the backend: land at the end of whichever zone it's entering.
    const maxOrderInTargetGroup = leaguesCache
        .filter(l => l.is_pinned === nextPinned && l.id !== leagueId)
        .reduce((max, l) => Math.max(max, l.display_order ?? -1), -1);

    league.is_pinned = nextPinned;
    league.display_order = maxOrderInTargetGroup + 1;

    renderLeagueSummery(leaguesCache);
    renderLeaguesListUI();

    try {
        await axios.post(`${API_URL}/change-pin-status`, {
            leagueId: leagueId
        });
    } catch (error) {
        console.log(error);
        leaguesCache = previousLeagues;
        renderLeagueSummery(leaguesCache);
        renderLeaguesListUI();
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

const getAllInuseRegions = async () => {
    try {
        const response = await axios.get(`${API_BOOKMAKER_URL}/inuse-regions`);
        console.log('hello')
        return response?.data?.data;
    } catch (error) {
        console.log(error);
    }
}

const changeAffiliateLink = async (bookmakerId, value) => {
    try {
        axios.post(`${API_BOOKMAKER_URL}/affiliate-link`, {
            id: bookmakerId,
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
        countries = await getAvailableRegions();

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
    console.log(bookmakerId, regionCode)
    try {
        const result = axios.post(`${API_BOOKMAKER_URL}/change-bookmaker-region`, {
            id: Number(bookmakerId),
            regionCode: regionCode
        })
        countries = await getAvailableRegions();

        return result;
    } catch (error) {
        console.log(error)
    }
}

const removeRegionFromBookmaker = async (bookmakerId, regionCode) => {

    if (!bookmakerId) {
        holdRegionCodes.filter(region => region != regionCode);
        document.getElementById('regionCodes-container-when-creating').innerHTML = renderRegionCodesWHenCreating();
    }

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
        countries = await getAvailableRegions();
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
    const pinnedCount = leagueData.filter(league => league.is_pinned).length;
    const totalCount = leagueData.length;

    document.getElementById('active-count').innerText = activeCount;
    document.getElementById('inactive-count').innerText = inactiveCount;
    document.getElementById('pinned-count').innerText = pinnedCount;
    document.getElementById('total-count').innerText = totalCount;
};

const renderLeagueRow = (league, index, draggable) => `
    <div data-id="${league.id}" class="flex items-center p-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors group ${draggable ? 'cursor-move' : 'cursor-default'}">
        <div class="text-gray-300 mr-2 opacity-50 ${draggable ? 'group-hover:opacity-100' : 'hidden'}">⋮⋮</div>

        <div class="row-number w-8 text-gray-400 font-bold text-sm text-center">${index + 1}</div>

        <div class="flex-1 pl-4 flex flex-col gap-1">
            <!-- 1. Country & League Title Line -->
            <h4 class="text-sm text-gray-900 font-medium">
                ${league.country ? `<span class="text-gray-800 font-semibold">${league.country}:</span>` : ''}
                <span class="font-bold text-gray-950">${league.name}</span>
            </h4>

            <!-- 2. Round/Matchday Pill Badge (Matches image_2e45be.png) -->
            <div class="flex items-center">
                <span class="inline-flex items-center border border-teal-500/40 text-teal-700 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-teal-50/50">
                    Round: ${league.currentMatchday ?? 0}
                </span>
            </div>

            <!-- 3. Active Streaks Counter -->
            <div class="text-sm text-gray-500 font-medium mt-0.5">
                Active Streaks: <span class="text-gray-700 font-bold ml-1">${league.streakCount ?? 0}</span>
            </div>
        </div>

        <!-- Actions: Pin toggle + Visibility Toggle Switch -->
        <div class="flex items-center gap-4 cursor-default" onmousedown="event.stopPropagation()">
            <button type="button" title="${league.is_pinned ? 'Unpin league' : 'Pin league'}"
                onclick="changeLeaguePinStatus(${league.id})"
                class="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors ${league.is_pinned ? 'bg-amber-50 border-amber-300 text-amber-500' : 'bg-white border-gray-200 text-gray-300 hover:text-gray-400'}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${league.is_pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.348 14.652 3 21m6.348-6.348 4.242-9.899a1 1 0 0 1 1.65-.312l4.319 4.319a1 1 0 0 1-.312 1.65l-9.899 4.242Z" />
                </svg>
            </button>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer"
                    ${league.is_visible ? 'checked' : ''}
                    onchange="changeLeagueVisibility(${league.id}, this.checked)">
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
        </div>
    </div>
`;

const renderLeaguesListUI = () => {
    const leagueContainer = document.getElementById('league-byorder-container');
    if (!leaguesCache) return;

    // --- CLEANUP: Destroy existing instances before re-rendering ---
    if (leagueSortableInstance) {
        leagueSortableInstance.destroy();
        leagueSortableInstance = null;
    }
    if (unpinnedSortableInstance) {
        unpinnedSortableInstance.destroy();
        unpinnedSortableInstance = null;
    }

    // 1. FILTERING LOGIC
    let displayList = [...leaguesCache];
    if (currentFilter === 'active') displayList = leaguesCache.filter(l => l.is_active);
    else if (currentFilter === 'inactive') displayList = leaguesCache.filter(l => !l.is_active);
    else if (currentFilter === 'included') displayList = leaguesCache.filter(l => l.is_visible);
    else if (currentFilter === 'excluded') displayList = leaguesCache.filter(l => !l.is_visible);
    else if (currentFilter === 'pinned') displayList = leaguesCache.filter(l => l.is_pinned);

    if (searchQuery) {
        displayList = displayList.filter(l => l.name.toLowerCase().includes(searchQuery));
    }

    // 2. DRAG-AND-DROP IS ONLY MEANINGFUL ON THE UNFILTERED "ALL" VIEW, SPLIT INTO
    //    A PINNED ZONE AND AN "OTHERS" ZONE. Which zone a row is dropped into is what
    //    decides its pinned state - dragging across the divider pins/unpins it.
    const zonesEnabled = currentFilter === 'all' && !searchQuery;

    if (zonesEnabled) {
        const pinnedList = displayList.filter(l => l.is_pinned);
        const unpinnedList = displayList.filter(l => !l.is_pinned);

        leagueContainer.innerHTML = `
            <div class="px-4 py-2 bg-amber-50/60 border-b border-amber-100 text-xs font-semibold text-amber-700 uppercase tracking-wider">
                📌 Pinned leagues
            </div>
            <div id="pinned-leagues-list" class="min-h-[3rem]">
                ${pinnedList.map((league, index) => renderLeagueRow(league, index, true)).join('') || `<div class="p-4 text-sm text-gray-400 italic">Drag a league here to pin it</div>`}
            </div>
            <div class="px-4 py-2 bg-gray-50 border-y border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                All other leagues
            </div>
            <div id="unpinned-leagues-list" class="min-h-[3rem]">
                ${unpinnedList.map((league, index) => renderLeagueRow(league, index, true)).join('')}
            </div>
        `;

        const pinnedContainer = document.getElementById('pinned-leagues-list');
        const unpinnedContainer = document.getElementById('unpinned-leagues-list');

        leagueSortableInstance = Sortable.create(pinnedContainer, {
            group: 'leagues-zones',
            animation: 150,
            ghostClass: 'opacity-50',
            onEnd: handleLeagueDragEnd
        });
        unpinnedSortableInstance = Sortable.create(unpinnedContainer, {
            group: 'leagues-zones',
            animation: 150,
            ghostClass: 'opacity-50',
            onEnd: handleLeagueDragEnd
        });
    } else {
        leagueContainer.innerHTML = displayList.map((league, index) => renderLeagueRow(league, index, false)).join('');
    }
}

const handleLeagueDragEnd = async () => {
    const previousLeagues = [...leaguesCache];

    const pinnedContainer = document.getElementById('pinned-leagues-list');
    const unpinnedContainer = document.getElementById('unpinned-leagues-list');
    const pinnedIds = Array.from(pinnedContainer.querySelectorAll('div[data-id]')).map(el => parseInt(el.dataset.id));
    const unpinnedIds = Array.from(unpinnedContainer.querySelectorAll('div[data-id]')).map(el => parseInt(el.dataset.id));

    // Optimistically update local state: zone membership determines is_pinned.
    pinnedIds.forEach((id, idx) => {
        const league = leaguesCache.find(l => l.id === id);
        if (league) { league.is_pinned = true; league.display_order = idx; }
    });
    unpinnedIds.forEach((id, idx) => {
        const league = leaguesCache.find(l => l.id === id);
        if (league) { league.is_pinned = false; league.display_order = idx; }
    });
    renderLeagueSummery(leaguesCache);
    renderLeaguesListUI();

    try {
        await changeLeagueOrder(pinnedIds, unpinnedIds);
    } catch (error) {
        alert("Failed to save new order.");
        leaguesCache = previousLeagues;
        renderLeagueSummery(leaguesCache);
        renderLeaguesListUI();
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
    holdRegionCodes = [];
}

const renderBookmakersUi = (response) => {
    const bookmakerContainer = document.getElementById('bookmaker-config-container');

    // 1. Sort: Keep the default bookmaker on top
    const sortedBookmakers = [...response].sort((a, b) => {
        if (a?.is_default && !b?.is_default) return -1;
        if (!a?.is_default && b?.is_default) return 1;
        return 0;
    });

    bookmakerContainer.className = "flex flex-col gap-3 p-6 max-w-7xl mx-auto";

    // 2. Table Headers - Restored the addBookmakerBtn right here
    let htmlContent = `
        <div class="hidden lg:grid grid-cols-[200px_1fr_280px_160px_120px] gap-4 px-6 text-xs font-bold text-gray-400 uppercase tracking-wider items-center">
            <div>Bookmaker</div>
            <div>Affiliate Link</div>
            <div>Geos</div>
            <div>Default Settings</div>
            <div class="flex items-center justify-between gap-1">
                <span>Actions</span>
                <button id="addBookmakerBtn" class="bg-teal-600 hover:bg-teal-700 text-white px-2 py-1 rounded text-[10px] font-bold normal-case tracking-normal transition shadow-sm">
                    + Add
                </button>
            </div>
        </div>
    `;

    // 3. Render rows with all original elements + Delete Button preserved
    htmlContent += sortedBookmakers.map((bookmaker) => {
        const isDefault = bookmaker?.is_default;

        return `
            <div class="bg-white border ${isDefault ? 'border-teal-500 ring-2 ring-teal-50 bg-teal-50/5' : 'border-gray-200'} rounded-xl p-4 shadow-sm flex flex-col lg:grid lg:grid-cols-[200px_1fr_280px_160px_120px] gap-4 items-center">
                
                <div class="w-full flex items-center gap-3">
                    <img src="${bookmaker?.logo_url}" alt="${bookmaker?.name}" class="w-9 h-9 object-contain rounded-lg border border-gray-100 p-1 bg-gray-50"/>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-800">${bookmaker?.name}</span>
                        ${isDefault ? `
                            <span class="mt-0.5 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-100 text-teal-700 w-max">
                                ★ Default
                            </span>
                        ` : ''}
                    </div>
                </div>

                <div class="w-full">
                    <input 
                        name="${bookmaker?.name}" 
                        type="text" 
                        data-bookmaker-id = "${bookmaker?.id}"
                        value="${bookmaker?.affiliate_link || ''}" 
                        placeholder="https://..."
                        class="affiliate-links-input w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition" 
                    />
                </div>


<div class="w-full relative">
    <div class="flex flex-wrap items-center gap-1.5 p-1.5 border border-dashed border-gray-200 rounded-lg min-h-[42px] bg-gray-50/30">
        ${isDefault ? `
            <span class="text-xs font-semibold text-teal-600 px-2 py-1">
                default for all geo
            </span>
        ` : `
            ${bookmaker?.regions?.map((val) => `
                <span class="inline-flex items-center pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100 gap-1 shadow-sm">
                    <img 
                        src="https://flagcdn.com/w20/${val?.region_code?.toLowerCase()}.png" 
                        alt="${val?.region_code || 'region'} flag"
                        class="w-4 h-3 object-cover rounded-sm"
                    >
                    <span class="uppercase font-semibold">${val?.region_code || '??'}</span> 
                    <span 
                        onclick="removeRegionFromBookmaker(${bookmaker?.id}, '${val?.region_code}')"
                        style="color:red; margin-left:6px; cursor:pointer; font-weight:bold;">
                        X
                     </span>
                </span>
            `).join('')}

            <button 
                onclick="toggleRegionDropdown(${bookmaker?.id})"
                class="inline-flex items-center text-xs font-medium text-gray-400 hover:text-teal-600 px-2 py-1 rounded hover:bg-gray-100 transition gap-1"
            >
                + Select GEOs
            </button>
        `}
    </div>
    
    <div id="region-dropdown-${bookmaker?.id}" class="region-dropdown" style="display:none; position:absolute; top:100%; left:0; right:0; margin-top:4px; z-index:20; background:white; border:1px solid #e5e7eb; border-radius:8px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); overflow:hidden;">
        <div class="p-2 border-b border-gray-100">
            <input 
                type="text" 
                id="region-search-${bookmaker?.id}" 
                placeholder="Search countries..." 
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
        </div>
        <div id="country-list-inline-${bookmaker?.id}" class="max-h-60 overflow-y-auto" style="max-height:240px; overflow-y:auto;">
        </div>
    </div>
</div>

                <div class="w-full flex flex-col space-y-1">
                    <label class="lg:hidden text-xs font-medium text-gray-400 uppercase">Set as default</label>
                    <button 
                        data-bookmaker-id="${bookmaker?.id}"
                        class="set-default-btn w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition
                        ${isDefault
                ? 'bg-teal-100 text-teal-700 border border-teal-300 cursor-default'
                : 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm'}"
                    >
                        ${isDefault ? `
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                            </svg>
                            Current Default
                        ` : `
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                            </svg>
                            Set as Default
                        `}
                    </button>
                </div>

                <div class="w-full lg:w-auto flex justify-between lg:justify-center items-center border-t lg:border-t-0 pt-3 lg:pt-0 border-gray-100 gap-3">
                    <span class="lg:hidden text-xs font-medium text-gray-400 uppercase">Actions</span>
                    <div class="flex items-center gap-3">
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" class="active-checkbox-input sr-only peer toggle-active-btn" data-bookmaker-id="${bookmaker.id}" ${bookmaker.is_active ? 'checked' : ''}>
                            <div class="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
                        </label>
                        
                        <button 
                            style= "display: none;"
                            data-bookmaker-id="${bookmaker?.id}" 
                            data-bookmaker-name="${bookmaker?.name}"
                            class="delete-bookmaker-btn p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 transition"
                            title="Delete Bookmaker"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                </div>

            </div>
        `;
    }).join('');

    bookmakerContainer.innerHTML = htmlContent;
    setupBookmkerConfigListeners();
}

let holdRegionCodes = [];
let currentBookmakerIdForRegion = null;

// REPLACE the openRegionModal function with these:

const toggleRegionDropdown = async (bookmakerId) => {
    // Close any open dropdown first
    document.querySelectorAll('.region-dropdown').forEach(d => d.classList.remove('show'));

    const dropdownId = bookmakerId ? `region-dropdown-${bookmakerId}` : 'region-dropdown-container';
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    // Toggle
    if (dropdown.classList.contains('show')) {
        dropdown.classList.remove('show');
        return;
    }

    currentBookmakerIdForRegion = bookmakerId;
    dropdown.classList.add('show');

    // Populate countries
    const containerId = bookmakerId ? `country-list-inline-${bookmakerId}` : 'country-list-inline';
    const searchId = bookmakerId ? `region-search-${bookmakerId}` : 'region-search-input';

    countries = await getAvailableRegions();
    const container = document.getElementById(containerId);
    const searchInput = document.getElementById(searchId);

    if (!container) return;

    const renderCountries = (countryList) => {
        container.innerHTML = countryList.map(country => `
            <button 
                class="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-50 border-b border-gray-50 text-sm transition-colors text-left"
                data-region-code="${country.code}"
            >
                <img 
                    src="https://flagcdn.com/w20/${country.code.toLowerCase()}.png"
                    class="w-5 h-4 object-cover rounded-sm"
                >
                <span class="font-medium">${country.name}</span>
                <span class="text-gray-400 text-xs ml-auto">${country.code}</span>
            </button>
        `).join('');

        if (countryList.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-400 text-sm">
                    No countries available
                </div>
            `;
        }

        container.querySelectorAll('button[data-region-code]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const regionCode = btn.dataset.regionCode;

                if (!bookmakerId) {
                    if (!holdRegionCodes.includes(regionCode)) {
                        holdRegionCodes.push(regionCode);
                        document.getElementById('regionCodes-container-when-creating').innerHTML = renderRegionCodesWHenCreating();
                        dropdown.classList.remove('show');
                        if (searchInput) searchInput.value = '';
                    }
                    return;
                }

                const result = await changeBookmakerRegions(bookmakerId, regionCode);
                if (result?.data?.success) {
                    dropdown.classList.remove('show');
                    if (searchInput) searchInput.value = '';
                    renderBookmakers();
                }
            });
        });
    };

    renderCountries(countries);

    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = countries.filter(c =>
                c.name.toLowerCase().includes(query) ||
                c.code.toLowerCase().includes(query)
            );
            renderCountries(filtered);
        };
    }
};

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.region-dropdown') && !e.target.closest('[onclick*="toggleRegionDropdown"]')) {
        document.querySelectorAll('.region-dropdown').forEach(d => d.classList.remove('show'));
    }
});

// REMOVE the old openRegionModal function completely
const renderRegionCodesWHenCreating = () => {
    console.log('renderRegionCodesWHenCreating', holdRegionCodes)
    let html = `${holdRegionCodes.map((val, index) => `
                            <span class="inline-flex items-center pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100 gap-1 shadow-sm">
                                <img 
                                    src="https://flagcdn.com/w20/${val.toLowerCase()}.png" 
                                    alt="${val.toLowerCase() || 'region'} flag"
                                    class="w-4 h-3 object-cover rounded-sm"
                                >
                                <span class="uppercase font-semibold">${val.toLowerCase() || '??'}</span> 
                                <span 
                                    onclick="removeRegionFromBookmaker(null, '${val.toLowerCase()}')"
                                    style="color:red; margin-left:6px; cursor:pointer; font-weight:bold;">
                                    X
                                 </span>
                            </span>
                        `).join('')}`

    return html;
}

//helper
const openConfigContainer = (containerId) => {
    const leagueConfig = document.getElementById('league-config-container');
    const bookmakerConfig = document.getElementById('bookmaker-config-container');
    const recordsView = document.getElementById('records-container');
    const leagueBtn = document.getElementById('leagueViewBtn');
    const bookmakerBtn = document.getElementById('bookmakerViewBtn');
    const recordsBtn = document.getElementById('recordsViewBtn');

    leagueConfig.classList.add('hidden');
    bookmakerConfig.classList.add('hidden');
    document.getElementById('leaguesContainer').style.display = 'none'
    document.getElementById('openAllMArketsBtn').style.display = 'none'
    document.getElementById('records-container').style.display = 'none'

    leagueBtn.className = "px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors";
    bookmakerBtn.className = "px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors";
    recordsViewBtn.className = "px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors";


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

    if (containerId === 'records-container') {
        recordsView.classList.remove('hidden');
        document.getElementById('leaguesContainer').style.display = 'block'
        recordsViewBtn.className = "px-6 py-2.5 text-sm font-semibold bg-teal-50 text-teal-700 border-r-4 border-teal-600 cursor-pointer";
        document.getElementById('openAllMArketsBtn').style.display = 'block'
        document.getElementById('records-container').style.display = 'block'
    }
}

