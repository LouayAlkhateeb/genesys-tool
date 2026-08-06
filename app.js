class ImageCache {
  constructor(maxSize = 500) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(cardId) {
    return this.cache.get(cardId) || null;
  }

  set(cardId, imageData) {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(cardId, imageData);
  }

  size() {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
  }

  clearExpired() {}
}

const CARDS_PER_PAGE = 50;
const IMAGE_BASE_URL = 'https://ik.imagekit.io/louaykh/cards/';
//const IMAGE_BASE_URL = 'https://images.ygoprodeck.com/images/cards_small/';
const DATA_BASE_URL = './data/';

const LIST_BUILD_VERSION = "2026-07-24-20-52";
const CARD_BUILD_VERSION = "2026-08-06-08-31";

const imageCache = new ImageCache();

// test if files exist
async function testFileAccess() {
    try {
        const testFiles = [
            `${DATA_BASE_URL}index.json`,
            `${DATA_BASE_URL}attributes.json`,
            `${DATA_BASE_URL}types.json`,
            `${DATA_BASE_URL}levels.json`
        ];
        
        for (const file of testFiles) {
            const response = await fetch(file);
            if (!response.ok) {
                console.error(`File not found: ${file} - Status: ${response.status}`);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('File access failed:', error);
        return false;
    }
}

// test list available files
async function debugFileAccess() {
    const testFiles = [
        `${DATA_BASE_URL}index.json`,
        `${DATA_BASE_URL}attributes.json`,
        `${DATA_BASE_URL}types.json`,
        `${DATA_BASE_URL}levels.json`
    ];
    
    for (const file of testFiles) {
        try {
            const response = await fetch(file);
        } catch (error) {
        }
    }
}

// State
let allCards = [];
let cardMap = new Map();
let filteredCards = [];
let displayedCount = 0;
let viewMode = 'grid'; // 'grid' or 'list'
let activeFilters = {
    cardType: null,
    attributes: new Set(),
    monsterFrames: new Set(),
    races: new Set(),
    levels: new Set(),
    tags: new Set()
};
let searchQuery = '';
let currentSort = 'points-desc';
let searchDebounceTimer = null;
let renderTimeout = null;

// Custom tags management
let availableTags = {}; // Store loaded tag definitions

// List management
let currentList = null;
let availableLists = {};
let listToggle = null;
let browseToggle = null;

// Category management
let categories = [];
let isBrowseView = false;
let navigationPath = []; // track position in the hierarchy [categoryIndex, subcategoryIndex]
let trackedCardsData = { additional_card_ids: [] };

// Spell and Trap race options
const SPELL_RACES = ['Normal', 'Quick-Play', 'Continuous', 'Equip', 'Field', 'Ritual'];
const TRAP_RACES = ['Normal', 'Continuous', 'Counter'];

// Load categories
async function loadCategories() {
    try {
        const response = await fetch(`${DATA_BASE_URL}categories.json?v=${CARD_BUILD_VERSION}`);
        if (response.ok) {
            categories = await response.json();
        }
    } catch (error) {
        console.error('Failed to load categories:', error);
    }
}

// Load available lists
async function loadAvailableLists() {
    try {
        // Load the staples list by default
        const staplesResponse = await fetch(`${DATA_BASE_URL}lists/0-point-staples.json?v=${LIST_BUILD_VERSION}`);
        if (staplesResponse.ok) {
            availableLists['0-point-staples'] = await staplesResponse.json();
            if (listToggle) listToggle.classList.remove('hidden');
        }

    } catch (error) {
    }
}

// Load custom tags
async function loadCustomTags() {
    try {
        // Load all tag files from the tags directory
        const tagFiles = ['hand_trap', 'board_breaker', 'floodgates'];
        
        for (const tagFile of tagFiles) {
            const response = await fetch(`${DATA_BASE_URL}tags/${tagFile}.json?v=${LIST_BUILD_VERSION}`);
            if (response.ok) {
                const tagData = await response.json();
                availableTags[tagFile] = tagData;
            }
        }
        
        applyTagsToCards();
        
        setupTagFilterBar();
    } catch (error) {
    }
}

// Load tracked cards data
async function loadTrackedCardsData() {
    try {
        const response = await fetch(`${DATA_BASE_URL}tracked_cards.json?v=${LIST_BUILD_VERSION}`);
        if (response.ok) {
            trackedCardsData = await response.json();
        }
    } catch (error) {
        console.error('Failed to load tracked cards data:', error);
    }
}

// Apply loaded tags to card objects
function applyTagsToCards() {
    // Initialize custom_tags property for all cards
    allCards.forEach(card => {
        card.custom_tags = [];
    });
    
    // Apply each tag to the appropriate cards
    Object.values(availableTags).forEach(tag => {
        tag.card_ids.forEach(cardId => {
            const card = allCards.find(c => c.id === cardId);
            if (card) {
                card.custom_tags.push(tag.name);
            }
        });
    });
}

// Toggle the browse view
function toggleBrowseView(force = null) {
    if (isDeckBuilder) exitDeckBuilder();
    isBrowseView = force !== null ? force : !isBrowseView;
    
    // Hide card usage view when browsing engine lists
    cardUsageView.classList.add('hidden');
    
    if (isBrowseView) {
        // Reset navigation path and current list
        navigationPath = [];
        currentList = null;
        
        // Hide filters, card grid, loading sentinel, and tag filter bar
        filtersSidebar.classList.add('hidden');
        cardGrid.classList.add('hidden');
        listInfoHeader.classList.add('hidden');
        loadingSentinel.classList.add('hidden');
        tagFilterBar.classList.add('hidden');
        
        // Show category browser
        categoryBrowser.classList.remove('hidden');
        
        renderCategoryBrowser();
    } else {
        // Reset to main view
        categoryBrowser.classList.add('hidden');
        showAllCards();
        
        // Reset filters
        resetAllFilters();
        
        // Show filters, card grid, and loading sentinel
        if (window.innerWidth >= 768) {
            filtersSidebar.classList.remove('hidden');
        } else {
            // On mobile, keep filters hidden by default but available via toggle
            filtersSidebar.classList.add('hidden');
        }
        cardGrid.classList.remove('hidden');
        loadingSentinel.classList.remove('hidden');
    }

    updateNavButtonStates();
}

// Render the category browser content based on current navigationPath
function renderCategoryBrowser() {
    categoryButtons.innerHTML = '';
    categoryPath.innerHTML = '';
    
    // Create Back button if nested
    if (navigationPath.length > 0) {
        const backBtn = document.createElement('button');
        backBtn.className = 'flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors mb-4 group';
        backBtn.innerHTML = `
            <i data-lucide="arrow-left" class="w-4 h-4 transition-transform group-hover:-translate-x-1"></i>
            <span>Back</span>
        `;
        backBtn.onclick = navigateBack;
        categoryButtons.appendChild(backBtn);
    }
    
    let currentLevel = categories;
    let pathNames = ['All Categories'];
    
    // Navigate into the categories according to path
    if (navigationPath.length >= 1) {
        const catIndex = navigationPath[0];
        const category = categories[catIndex];
        pathNames.push(category.name);
        currentLevel = category.subcategories;
        
        if (navigationPath.length >= 2) {
            const subcatIndex = navigationPath[1];
            const subcategory = category.subcategories[subcatIndex];
            pathNames.push(subcategory.name);
            currentLevel = subcategory.lists;
        }
    }
    
    // Show breadcrumbs
    pathNames.forEach((name, i) => {
        if (i > 0) {
            const separator = document.createElement('span');
            separator.textContent = '›';
            separator.className = 'mx-1';
            categoryPath.appendChild(separator);
        }
        const span = document.createElement('span');
        span.textContent = name;
        if (i === pathNames.length - 1) {
            span.className = 'text-white font-medium';
        }
        categoryPath.appendChild(span);
    });
    
    // Render buttons for current level
    currentLevel.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left p-4 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 hover:border-blue-500 transition-all font-bold flex items-center justify-between group';
        
        const label = document.createElement('span');
        label.textContent = item.name.toUpperCase();
        btn.appendChild(label);
        
        const icon = document.createElement('i');
        // If it's a list (has id), show a grid icon, else show a right arrow
        icon.setAttribute('data-lucide', item.id ? 'layout-grid' : 'chevron-right');
        icon.className = 'w-5 h-5 text-gray-500 group-hover:text-blue-400 transition-all';
        btn.appendChild(icon);
        
        btn.onclick = () => {
            if (item.id) {
                // It's a list
                selectListFromBrowser(item.id);
            } else if (navigationPath.length === 0) {
                // It's a category
                navigationPath.push(index);
                renderCategoryBrowser();
            } else if (navigationPath.length === 1) {
                // It's a subcategory
                navigationPath.push(index);
                renderCategoryBrowser();
            }
        };
        
        categoryButtons.appendChild(btn);
    });
    
    lucide.createIcons();
}

function navigateBack() {
    navigationPath.pop();
    renderCategoryBrowser();
}

async function selectListFromBrowser(listId) {
    // Check if list data is already loaded
    if (!availableLists[listId]) {
        try {
            const response = await fetch(`${DATA_BASE_URL}lists/${listId}.json?v=${LIST_BUILD_VERSION}`);
            if (response.ok) {
                availableLists[listId] = await response.json();
            } else {
                throw new Error('Failed to load list');
            }
        } catch (error) {
            console.error('Error loading list:', error);
            alert('Failed to load the selected list.');
            return;
        }
    }
    
    // Hide browser and show the list
    categoryBrowser.classList.add('hidden');
    cardGrid.classList.remove('hidden');
    showList(listId);
}

function resetAllFilters() {
    // Reset state
    activeFilters.cardType = null;
    activeFilters.attributes.clear();
    activeFilters.monsterFrames.clear();
    activeFilters.races.clear();
    activeFilters.levels.clear();
    activeFilters.tags.clear();
    searchQuery = '';
    searchInput.value = '';
    
    // Reset UI
    document.querySelectorAll('input[name="cardType"]').forEach(radio => radio.checked = false);
    document.querySelectorAll('#attribute-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#monster-frame-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#race-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#level-filters button').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'border-blue-400');
        btn.classList.add('bg-gray-700');
    });
    
    // Reset tag filter buttons
    document.querySelectorAll('#tag-filter-bar button').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'border-blue-400');
        btn.classList.add('bg-gray-700');
    });
    
    // Hide filter containers that depend on card type
    document.getElementById('attribute-filter-container').classList.add('hidden');
    document.getElementById('monster-frame-filter-container').classList.add('hidden');
    document.getElementById('race-filter-container').classList.add('hidden');
    document.getElementById('level-filter-container').classList.add('hidden');
}

// Show a specific list
function showList(listId) {
    if (isDeckBuilder) exitDeckBuilder();
    currentList = listId;
    const listData = availableLists[listId];

    // Hide browser and sidebar
    categoryBrowser.classList.add('hidden');
    filtersSidebar.classList.add('hidden');
    
    // Hide card usage view
    cardUsageView.classList.add('hidden');

    // Update UI to show we're viewing a list
    searchInput.placeholder = `Search in ${listData.name}...`;
    
    // Show list info header
    listTitle.textContent = listData.name;
    // Convert newlines to HTML line breaks for description
    const description = listData.description || '';
    listDescription.innerHTML = description.replace(/\n/g, '<br>');
    listInfoHeader.classList.remove('hidden');
    
    // Show back button if we're in browse view
    if (isBrowseView) {
        listBackBtn.classList.remove('hidden');
    } else {
        listBackBtn.classList.add('hidden');
    }

    // Show tag filter bar only for 0-point staples list
    if (listId === '0-point-staples') {
        tagFilterBar.classList.remove('hidden');
    } else {
        tagFilterBar.classList.add('hidden');
    }

    // Filter cards to only show those in the list
    const cardMap = new Map();
    allCards.forEach(card => cardMap.set(card.id, card));
    
    // sort staples list by card type
    if (listId === '0-point-staples') {
        const typeOrder = [
            'Effect Monster',
            'Tuner Monster',
            'Fusion Monster',
            'Synchro Monster',
            'Synchro Tuner Monster',
            'XYZ Monster',
            'Spell Card',
            'Trap Card'
        ];
        
        filteredCards = listData.card_ids
            .map(id => cardMap.get(id))
            .filter(card => card !== undefined)
            .sort((a, b) => {
                const indexA = typeOrder.indexOf(a.type);
                const indexB = typeOrder.indexOf(b.type);
                
                if (indexA !== -1 && indexB !== -1) {
                    return indexA - indexB;
                }
                
                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                
                return a.type.localeCompare(b.type);
            });
    } else {
        // preserve the card order from JSON
        filteredCards = listData.card_ids
            .map(id => cardMap.get(id))
            .filter(card => card !== undefined);
    }

    // Reset display and render
    displayedCount = 0;
    renderAllListCards();

    // Update stats
    statsEl.textContent =
        `${filteredCards.length} cards in "${listData.name}"`;
    if (statsMobileEl) {
        statsMobileEl.textContent = `${filteredCards.length} cards in "${listData.name}"`;
    }

    updateNavButtonStates();
}

// Render all cards from the current list
function renderAllListCards() {
    const cardGrid = document.getElementById('card-grid');
    cardGrid.innerHTML = '';

    filteredCards.forEach((card, index) => {
        const cardElement = createCardElement(card, index);
        cardGrid.appendChild(cardElement);
    });

    // Update displayed count to prevent infinite scroll from re-rendering
    displayedCount = filteredCards.length;
    loadingSentinel.classList.add('hidden');
}

// Show all cards (exit list view)
function showAllCards() {
    if (isDeckBuilder) exitDeckBuilder();
    currentList = null;
    isBrowseView = false;
    navigationPath = [];
    searchInput.placeholder = 'Search cards...';
    
    // Hide other views
    listInfoHeader.classList.add('hidden');
    cardUsageView.classList.add('hidden');
    categoryBrowser.classList.add('hidden');
    
    // Show main card grid and related elements
    cardGrid.classList.remove('hidden');
    loadingSentinel.classList.remove('hidden');
    
    // Show sidebar on desktop
    if (window.innerWidth >= 768) {
        filtersSidebar.classList.remove('hidden');
    } else {
        // On mobile, keep filters hidden by default but available via toggle
        filtersSidebar.classList.add('hidden');
    }

    // Show tag filter bar
    tagFilterBar.classList.remove('hidden');

    updateNavButtonStates();
    applyFiltersAndSort();
}

// Cache for loaded chunks to avoid repeated fetches
const chunkCache = new Map();
let recentlyViewedChunks = new Set(); // Track recently accessed chunks

// Cache expiration time
const CACHE_EXPIRATION_TIME = 30 * 60 * 1000;

// Enhanced cache entry with timestamp and version
class CacheEntry {
    constructor(data, version, timestamp = Date.now()) {
        this.data = data;
        this.version = version;
        this.timestamp = timestamp;
    }
    
    isExpired() {
        return (Date.now() - this.timestamp) > CACHE_EXPIRATION_TIME;
    }

    isValid(currentVersion) {
        return this.version === currentVersion && !this.isExpired();
    }
}

// Preload chunks in background
let chunkFilesMap = null;

function initializeChunkFilesMap() {
    if (chunkFilesMap === null) {
        chunkFilesMap = new Set();
        allCards.forEach(card => {
            if (card.location && card.location.file) {
                chunkFilesMap.add(card.location.file);
            }
        });
    }
}

async function preloadChunks() {
    // Initialize the chunk files map
    initializeChunkFilesMap();
    
    // Preload first few chunks in background plus recently viewed
    const chunksToPreload = new Set();
    
    // Add first few chunks
    const firstChunks = Array.from(chunkFilesMap).slice(0, 3);
    firstChunks.forEach(chunk => chunksToPreload.add(chunk));
    
    // Add recently viewed chunks
    recentlyViewedChunks.forEach(chunk => chunksToPreload.add(chunk));
    
    // Limit to 8 total chunks to prevent excessive preloading
    const limitedChunks = Array.from(chunksToPreload).slice(0, 8);
    
    for (const chunkFile of limitedChunks) {
        // Check if cache entry exists and is not expired
        const cacheEntry = chunkCache.get(chunkFile);
        if (!cacheEntry || !cacheEntry.isValid(CARD_BUILD_VERSION)) {
            try {
                const response = await fetch(`${chunkFile}?v=${CARD_BUILD_VERSION}`);
                if (response.ok) {
                    const chunk = await response.json();
                    chunkCache.set(chunkFile, new CacheEntry(chunk, CARD_BUILD_VERSION));
                }
            } catch (error) {
            }
        }
    }
}

// track recently viewed chunks
function trackChunkAccess(chunkFile) {
    recentlyViewedChunks.add(chunkFile);
    // Keep only last 5 accessed chunks
    if (recentlyViewedChunks.size > 5) {
        const first = recentlyViewedChunks.values().next().value;
        recentlyViewedChunks.delete(first);
    }
}

// DOM Elements
const cardGrid = document.getElementById('card-grid');
const searchInput = document.getElementById('search-input');
const viewToggle = document.getElementById('view-toggle');
const browseToggleBtn = document.getElementById('browse-toggle');
const categoryBrowser = document.getElementById('category-browser');
const categoryPath = document.getElementById('category-path');
const categoryButtons = document.getElementById('category-buttons');
const listInfoHeader = document.getElementById('list-info-header');
const listTitle = document.getElementById('list-title');
const listDescription = document.getElementById('list-description');
const listBackBtn = document.getElementById('list-back-btn');
const filtersSidebar = document.getElementById('filters-sidebar');
const viewIcon = document.getElementById('view-icon');
const statsEl = document.getElementById('stats');
const statsMobileEl = document.getElementById('stats-mobile');
const sortSelect = document.getElementById('sort-select');
const loadingSentinel = document.getElementById('loading-sentinel');
const noResults = document.getElementById('no-results');
const modal = document.getElementById('modal');
const closeModal = document.getElementById('close-modal');
const modalImage = document.getElementById('modal-image');
const modalContent = document.getElementById('modal-content');
const monsterFrameContainer = document.getElementById('monster-frame-filter-container');
const monsterFrameFilters = document.getElementById('monster-frame-filters');
const tagFilterBar = document.getElementById('tag-filter-bar');
const cardUsageBtn = document.getElementById('card-usage-btn');
const cardUsageBtnMobile = document.getElementById('card-usage-btn-mobile');
const cardUsageView = document.getElementById('card-usage-view');
const cardUsageTagFilters = document.getElementById('card-usage-tag-filters');
const formatDropdown = document.getElementById('format-dropdown');
const cardUsageTableBody = document.getElementById('card-usage-table-body');

// Sync nav button active states with the current view
function updateNavButtonStates() {
    const inDeckBuilder = isDeckBuilder;
    const inCardUsage = !cardUsageView.classList.contains('hidden');
    const browseActive = isBrowseView && !inDeckBuilder && !inCardUsage;
    const staplesActive = currentList === '0-point-staples' && !inDeckBuilder && !inCardUsage;

    if (browseToggleBtn) {
        browseToggleBtn.classList.toggle('bg-blue-600', browseActive);
        browseToggleBtn.classList.toggle('border-blue-400', browseActive);
        browseToggleBtn.classList.toggle('shadow-lg', browseActive);
        browseToggleBtn.classList.toggle('shadow-blue-500/30', browseActive);
        browseToggleBtn.classList.toggle('bg-gray-700', !browseActive);
        browseToggleBtn.classList.toggle('border-gray-600', !browseActive);
    }
    if (listToggle) {
        listToggle.classList.toggle('bg-blue-600', staplesActive);
        listToggle.classList.toggle('border-blue-400', staplesActive);
        listToggle.classList.toggle('shadow-lg', staplesActive);
        listToggle.classList.toggle('shadow-blue-500/30', staplesActive);
        listToggle.classList.toggle('bg-gray-700', !staplesActive);
        listToggle.classList.toggle('border-gray-600', !staplesActive);
    }
}

// Card usage tracking state
let cardUsageData = {};
let trackedCardIds = new Set();

// Initialization
async function init() {
    try {
        statsEl.textContent = 'Loading card data...';
        if (statsMobileEl) {
            statsMobileEl.textContent = 'Loading card data...';
        }
        
        // Debug file access
        await debugFileAccess();
        
        // Test file access
        const canAccessFiles = await testFileAccess();
        if (!canAccessFiles) {
            throw new Error('Cannot access required data files. Check if files exist in correct location.');
        }

        // Get list toggle element
        listToggle = document.getElementById('list-toggle');

        // Load index and filters in parallel
        const [indexData, attributes, levels, races, frameTypes] = await Promise.all([
            fetch(`${DATA_BASE_URL}index.json?v=${CARD_BUILD_VERSION}`).then(r => {
                if (!r.ok) throw new Error(`Failed to load index: ${r.status}`);
                return r.json();
            }),
            fetch(`${DATA_BASE_URL}attributes.json?v=${CARD_BUILD_VERSION}`).then(r => {
                if (!r.ok) throw new Error(`Failed to load attributes: ${r.status}`);
                return r.json();
            }),
            fetch(`${DATA_BASE_URL}levels.json?v=${CARD_BUILD_VERSION}`).then(r => {
                if (!r.ok) throw new Error(`Failed to load levels: ${r.status}`);
                return r.json();
            }),
            fetch(`${DATA_BASE_URL}races.json?v=${CARD_BUILD_VERSION}`).then(r => {
                if (!r.ok) throw new Error(`Failed to load races: ${r.status}`);
                return r.json();
            }),
            fetch(`${DATA_BASE_URL}frame_types.json?v=${CARD_BUILD_VERSION}`).then(r => {
                if (!r.ok) throw new Error(`Failed to load frame types: ${r.status}`);
                return r.json();
            })
        ]);

        // Convert optimized index to full card objects for frontend
        allCards = Object.entries(indexData).map(([id, card]) => ({
            id: parseInt(id),
            name: card.n,  // name
            type: card.t,  // type
            race: card.r,  // race
            attribute: card.a, // attribute
            level: card.l, // level
            genesys_points: card.g, // genesys_points
            location: card.loc // location
        }));
        cardMap = new Map(allCards.map(c => [c.id, c]));

        setupCardTypeFilters();
        setupLevels(levels);
        setupMonsterFrameFilters(frameTypes);

        applyFiltersAndSort();
        setupEventListeners();
        setupInfiniteScroll();
        
        // preload chunks in background
        initializeChunkFilesMap();
        preloadChunks();
        
        statsEl.textContent = `${allCards.length.toLocaleString()} cards loaded`;
        if (statsMobileEl) {
            statsMobileEl.textContent = `${allCards.length.toLocaleString()} cards loaded`;
        }

        // Load available lists
        await loadAvailableLists();
        await loadCategories();
        await loadCustomTags();
        await loadTrackedCardsData();
        
        // Ensure tag filter bar is shown in main view after tags are loaded
        if (!currentList && !isBrowseView) {
            tagFilterBar.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        statsEl.textContent = `Error loading data: ${error.message}`;
        if (statsMobileEl) {
            statsMobileEl.textContent = `Error loading data: ${error.message}`;
        }
    }
}

// clear expired cache periodically
function cleanupCache() {
    const now = Date.now();
    for (const [key, cacheEntry] of chunkCache.entries()) {
        if (cacheEntry.isExpired()) {
            chunkCache.delete(key);
        }
    }
}

// Run cache cleanup every hour
setInterval(cleanupCache, 60 * 60 * 1000);

function setupCardTypeFilters() {
    const container = document.getElementById('card-type-filters');
    container.innerHTML = '';
    
    const cardTypes = [
        { value: 'monster', label: 'Monster' },
        { value: 'spell', label: 'Spell' },
        { value: 'trap', label: 'Trap' }
    ];
    
    cardTypes.forEach(type => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer py-0.5';
        label.innerHTML = `
            <input type="radio" name="cardType" value="${type.value}" class="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500">
            <span>${type.label}</span>
        `;
        const input = label.querySelector('input');
        input.addEventListener('click', (e) => {
            // If clicking the already selected option, deselect it
            if (activeFilters.cardType === type.value) {
                activeFilters.cardType = null;
                e.target.checked = false;
                // Hide attribute/race/level/monster-frame filters when card type is cleared
                document.getElementById('attribute-filter-container').classList.add('hidden');
                document.getElementById('race-filter-container').classList.add('hidden');
                document.getElementById('level-filter-container').classList.add('hidden');
                document.getElementById('monster-frame-filter-container').classList.add('hidden');
                // Clear all sub-filters
                activeFilters.attributes.clear();
                activeFilters.monsterFrames.clear();
                activeFilters.races.clear();
                activeFilters.levels.clear();
                // Clear checkbox/radio states
                document.querySelectorAll('#attribute-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
                document.querySelectorAll('#monster-frame-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
                document.querySelectorAll('#race-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
                document.querySelectorAll('#level-filters button').forEach(btn => {
                    btn.classList.remove('bg-blue-600', 'border-blue-400');
                    btn.classList.add('bg-gray-700');
                });
                applyFiltersAndSort();
            } else {
                activeFilters.cardType = type.value;
                // Clear other filters when card type changes
                activeFilters.attributes.clear();
                activeFilters.monsterFrames.clear();
                activeFilters.races.clear();
                activeFilters.levels.clear();
                updateFilterVisibility();
                setupAttributeAndRaceFilters(type.value);
                applyFiltersAndSort();
            }
        });
        container.appendChild(label);
    });
}

function updateFilterVisibility() {
    const attributeContainer = document.getElementById('attribute-filter-container');
    const raceContainer = document.getElementById('race-filter-container');
    const levelContainer = document.getElementById('level-filter-container');
    const monsterFrameContainer = document.getElementById('monster-frame-filter-container');

    // Show attribute, level, and monster frame filters only for monsters
    if (activeFilters.cardType === 'monster') {
        attributeContainer.classList.remove('hidden');
        levelContainer.classList.remove('hidden');
        monsterFrameContainer.classList.remove('hidden');
    } else {
        attributeContainer.classList.add('hidden');
        levelContainer.classList.add('hidden');
        monsterFrameContainer.classList.add('hidden');
    }

    // Show race filter for all types
    if (activeFilters.cardType) {
        raceContainer.classList.remove('hidden');
    } else {
        raceContainer.classList.add('hidden');
    }
}

function setupAttributeAndRaceFilters(cardType) {
    // Setup attribute filters (only for monsters)
    const attributeContainer = document.getElementById('attribute-filters');
    attributeContainer.innerHTML = '';
    
    if (cardType === 'monster') {
        const attributes = ['DARK', 'DIVINE', 'EARTH', 'FIRE', 'LIGHT', 'WATER', 'WIND'];
        attributes.forEach(attr => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer py-0.5';
            label.innerHTML = `
                <input type="checkbox" value="${attr}" class="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500">
                <span>${attr}</span>
            `;
            label.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) activeFilters.attributes.add(attr);
                else activeFilters.attributes.delete(attr);
                applyFiltersAndSort();
            });
            attributeContainer.appendChild(label);
        });
    }
    
    // Setup race filters based on card type
    const raceContainer = document.getElementById('race-filters');
    raceContainer.innerHTML = '';
    
    let races;
    if (cardType === 'spell') {
        races = SPELL_RACES;
    } else if (cardType === 'trap') {
        races = TRAP_RACES;
    } else {
        // Monster races - load from data file and filter out spell/trap types
        const spellTrapRaces = new Set([...SPELL_RACES, ...TRAP_RACES]);
        fetch(`${DATA_BASE_URL}races.json?v=${CARD_BUILD_VERSION}`)
            .then(r => r.json())
            .then(raceList => {
                const monsterRaces = raceList.filter(race => !spellTrapRaces.has(race));
                monsterRaces.forEach(race => {
                    const label = document.createElement('label');
                    label.className = 'flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer py-0.5';
                    label.innerHTML = `
                        <input type="checkbox" value="${race}" class="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500">
                        <span>${race}</span>
                    `;
                    label.querySelector('input').addEventListener('change', (e) => {
                        if (e.target.checked) activeFilters.races.add(race);
                        else activeFilters.races.delete(race);
                        applyFiltersAndSort();
                    });
                    raceContainer.appendChild(label);
                });
            });
        return;
    }
    
    races.forEach(race => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer py-0.5';
        label.innerHTML = `
            <input type="checkbox" value="${race}" class="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500">
            <span>${race}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) activeFilters.races.add(race);
            else activeFilters.races.delete(race);
            applyFiltersAndSort();
        });
        raceContainer.appendChild(label);
    });
}

function setupLevels(levels) {
    const container = document.getElementById('level-filters');
    // Clear existing levels first
    container.innerHTML = '';
    levels.sort((a, b) => a - b).forEach(lvl => {
        const btn = document.createElement('button');
        btn.className = 'px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors border border-transparent';
        btn.textContent = lvl;
        btn.addEventListener('click', () => {
            if (activeFilters.levels.has(lvl)) {
                activeFilters.levels.delete(lvl);
                btn.classList.remove('bg-blue-600', 'border-blue-400');
                btn.classList.add('bg-gray-700');
            } else {
                activeFilters.levels.add(lvl);
                btn.classList.add('bg-blue-600', 'border-blue-400');
                btn.classList.remove('bg-gray-700');
            }
            applyFiltersAndSort();
        });
        container.appendChild(btn);
    });
}

function setupMonsterFrameFilters(frameTypes) {
    const container = document.getElementById('monster-frame-filters');
    container.innerHTML = '';
    
    // Filter to only monster frame types
    const monsterFrameTypes = frameTypes.filter(type =>
        type === 'normal' || type === 'effect' || type === 'fusion' || type === 'synchro' || type === 'xyz'
    );
    
    monsterFrameTypes.forEach(frameType => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm text-gray-400 hover:text-white cursor-pointer py-0.5';
        label.innerHTML = `
            <input type="checkbox" value="${frameType}" class="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500">
            <span>${frameType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) activeFilters.monsterFrames.add(frameType);
            else activeFilters.monsterFrames.delete(frameType);
            applyFiltersAndSort();
        });
        container.appendChild(label);
    });
}

// Setup tag filter bar
function setupTagFilterBar() {
    tagFilterBar.innerHTML = '';
    
    Object.values(availableTags).forEach(tag => {
        const button = document.createElement('button');
        button.className = 'px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors border border-transparent';
        button.textContent = tag.name;
        button.addEventListener('click', () => {
            if (activeFilters.tags.has(tag.name)) {
                activeFilters.tags.delete(tag.name);
                button.classList.remove('bg-blue-600', 'border-blue-400');
                button.classList.add('bg-gray-700');
            } else {
                activeFilters.tags.add(tag.name);
                button.classList.add('bg-blue-600', 'border-blue-400');
                button.classList.remove('bg-gray-700');
            }
            applyFiltersAndSort();
        });
        tagFilterBar.appendChild(button);
    });
}

function getCardTypeFromTypeName(typeName) {
    // Spell and Trap are direct, everything else is Monster
    if (typeName === 'Spell Card') return 'spell';
    if (typeName === 'Trap Card') return 'trap';
    return 'monster';
}

function getFrameTypeFromTypeName(typeName) {
    // Map card type to frame type
    const lowerType = typeName.toLowerCase();
    if (lowerType.includes('normal') && !lowerType.includes('pendulum')) return 'normal';
    if (lowerType.includes('effect')) return 'effect';
    if (lowerType.includes('fusion')) return 'fusion';
    if (lowerType.includes('synchro')) return 'synchro';
    if (lowerType.includes('xyz') || lowerType.includes('cxyz')) return 'xyz';
    if (lowerType.includes('ritual')) return 'ritual';
    if (lowerType.includes('pendulum')) return 'effect_pendulum';
    if (lowerType.includes('spell')) return 'spell';
    if (lowerType.includes('trap')) return 'trap';
    return 'normal';
}

function applyFiltersAndSort() {
    displayedCount = 0;

    // Start with appropriate base set
    let baseCards;
    if (currentList) {
        // For lists, preserve the order from JSON card_ids array
        const listData = availableLists[currentList];
        const cardMap = new Map();
        allCards.forEach(card => cardMap.set(card.id, card));
        baseCards = listData.card_ids
            .map(id => cardMap.get(id))
            .filter(card => card !== undefined);
    } else {
        baseCards = allCards;
    }

    filteredCards = baseCards.filter(card => {
        // Search filter
        if (searchQuery && !card.name.toLowerCase().includes(searchQuery.toLowerCase())) {
            return false;
        }

        // Card Type filter (single select - based on type property)
        if (activeFilters.cardType) {
            const cardType = getCardTypeFromTypeName(card.type);
            if (activeFilters.cardType !== cardType) {
                return false;
            }
        }

        // Attribute filter (multi select, only for monsters)
        if (activeFilters.attributes.size > 0 && !activeFilters.attributes.has(card.attribute)) {
            return false;
        }

        // Race filter (multi select)
        if (activeFilters.races.size > 0 && !activeFilters.races.has(card.race)) {
            return false;
        }

        // Level filter (multi select, only for monsters with levels)
        if (activeFilters.levels.size > 0 && !activeFilters.levels.has(card.level)) {
            return false;
        }

        // Monster Frame filter (multi select, only for monsters)
        if (activeFilters.monsterFrames.size > 0) {
            const cardFrameType = getFrameTypeFromTypeName(card.type);
            if (!activeFilters.monsterFrames.has(cardFrameType)) {
                return false;
            }
        }

        // Tag filter (multi select)
        if (activeFilters.tags.size > 0) {
            // Check if card has at least one of the selected tags
            const hasSelectedTag = Array.from(activeFilters.tags).some(tag =>
                card.custom_tags && card.custom_tags.includes(tag)
            );
            if (!hasSelectedTag) {
                return false;
            }
        }

        return true;
    });

    // Sort logic: regular view uses current sort, 0-point staples uses type-based sorting
    if (!currentList) {
        // Regular browsing view - use selected sort
        const [field, direction] = currentSort.split('-');
        filteredCards.sort((a, b) => {
            let valA = field === 'points' ? (a.genesys_points || 0) : a.name;
            let valB = field === 'points' ? (b.genesys_points || 0) : b.name;

            if (field === 'points') {
                return direction === 'desc' ? valB - valA : valA - valB;
            } else {
                return direction === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
            }
        });
    } else if (currentList === '0-point-staples') {
        // 0-point staples list - always use type-based sorting
        const typeOrder = [
            'Effect Monster',
            'Tuner Monster',
            'Fusion Monster',
            'Synchro Monster',
            'Synchro Tuner Monster',
            'XYZ Monster',
            'Spell Card',
            'Trap Card'
        ];
        
        filteredCards.sort((a, b) => {
            const indexA = typeOrder.indexOf(a.type);
            const indexB = typeOrder.indexOf(b.type);
            
            if (indexA !== -1 && indexB !== -1) {
                return indexA - indexB;
            }
            
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            
            return a.type.localeCompare(b.type);
        });
    }

    cardGrid.innerHTML = '';
    noResults.classList.toggle('hidden', filteredCards.length > 0);
    
    // For lists, render all cards at once; for regular view, use infinite scroll
    if (currentList) {
        renderAllListCards();
    } else {
        // Reset displayed count when filters change
        displayedCount = 0;
        renderMoreCards();
    }

    // Update stats to show filtered results
    statsEl.textContent = `${filteredCards.length.toLocaleString()} of ${allCards.length.toLocaleString()} cards`;
    if (statsMobileEl) {
        statsMobileEl.textContent = `${filteredCards.length.toLocaleString()} of ${allCards.length.toLocaleString()} cards`;
    }
    
}

function renderMoreCards() {
    // For lists, we render all cards at once, so no need for infinite scroll
    if (currentList) {
        loadingSentinel.classList.add('hidden');
        return;
    }

    // Cancel any pending render to prevent duplicates
    if (renderTimeout) {
        clearTimeout(renderTimeout);
        renderTimeout = null;
    }
    
    // Clear any existing loading indicator to prevent duplicates
    const existingIndicator = document.getElementById('batch-loading-indicator');
    if (existingIndicator) existingIndicator.remove();

    const nextBatch = filteredCards.slice(displayedCount, displayedCount + CARDS_PER_PAGE);
    if (nextBatch.length === 0) {
        loadingSentinel.classList.add('hidden');
        return;
    }

    loadingSentinel.classList.remove('hidden');
    
    // Show loading indicator for the batch
    const loadingMessage = document.createElement('div');
    loadingMessage.id = 'batch-loading-indicator';
    loadingMessage.className = 'col-span-full py-4 text-center text-gray-400';
    loadingMessage.innerHTML = `<div class="inline-flex items-center gap-2">
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
        <span>Loading ${nextBatch.length} more cards...</span>
    </div>`;
    
    cardGrid.appendChild(loadingMessage);
    
    // Process cards with slight delay to allow UI update
    renderTimeout = setTimeout(() => {
        const fragment = document.createDocumentFragment();
        nextBatch.forEach((card, idx) => {
            const cardEl = createCardElement(card, idx);
            fragment.appendChild(cardEl);
        });
        
        // Remove the loading indicator and append cards
        const indicator = document.getElementById('batch-loading-indicator');
        if (indicator) indicator.remove();
        
        cardGrid.appendChild(fragment);
        displayedCount += nextBatch.length;
        renderTimeout = null;

        if (displayedCount >= filteredCards.length) {
            loadingSentinel.classList.add('hidden');
        }
    }, 10);
}


async function showCardDetails(card) {
    modal.classList.remove('hidden');
    
    // Check if image is in cache
    const cachedImage = imageCache.get(card.id);
    if (cachedImage) {
        modalImage.src = cachedImage;
    } else {
        modalImage.src = `$https://images.ygoprodeck.com/images/assets/CardBack.jpg`;
        
        // Load the image
        const img = new Image();
        img.src = `${IMAGE_BASE_URL}${card.id}.webp`;
        
        img.onload = () => {
            // Update modal image
            modalImage.src = img.src;
            
            // Cache the image for future use
            imageCache.set(card.id, img.src);
        };
        
        img.onerror = () => {
            console.warn(`Failed to load modal image for card ID: ${card.id}`);
        };
    }
    
    modalContent.innerHTML = `<div class="animate-pulse flex space-y-4 flex-col">
        <div class="h-8 bg-gray-700 rounded w-3/4"></div>
        <div class="h-4 bg-gray-700 rounded w-1/2"></div>
        <div class="h-24 bg-gray-700 rounded"></div>
    </div>`;

    try {
        const chunkPath = card.location.file;
        
        // Track chunk access for prefetching
        trackChunkAccess(chunkPath);
        
        // Check cache first with expiration check
        let chunk;
        const cacheEntry = chunkCache.get(chunkPath);
        if (cacheEntry && !cacheEntry.isExpired()) {
            chunk = cacheEntry.data;
        } else {
            const response = await fetch(`${chunkPath}?v=${CARD_BUILD_VERSION}`);
            if (!response.ok) throw new Error(`Failed to load chunk: ${response.status}`);
            chunk = await response.json();
            
            // Cache the chunk for future use with timestamp
            chunkCache.set(chunkPath, new CacheEntry(chunk, CARD_BUILD_VERSION));
            
            // Trigger additional prefetching after loading a new chunk
            setTimeout(() => {
                preloadChunks();
            }, 100);
        }
        
        const fullCard = chunk[card.location.idx];

        modalContent.innerHTML = `
            <div class="space-y-4">
                <div>
                    <h2 class="text-3xl font-bold text-white mb-1">${fullCard.name}</h2>
                    <p class="text-blue-400 font-medium uppercase tracking-widest text-sm">
                        ${fullCard.type} ${fullCard.level ? `• Level ${fullCard.level}` : ''}
                    </p>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                        <p class="text-xs text-gray-400 uppercase">Genesys Points</p>
                        <p class="text-2xl font-black text-blue-400">${fullCard.genesys_points || 0}</p>
                    </div>
                    <div class="bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                        <p class="text-xs text-gray-400 uppercase">Archetype</p>
                        <p class="text-xl font-bold">${fullCard.archetype || 'N/A'}</p>
                    </div>
                </div>

                <div class="bg-gray-900/50 p-4 rounded-lg border border-gray-700 italic text-gray-300 leading-relaxed">
                    ${fullCard.desc.replace(/\n/g, '<br>') || 'No description available'}
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    ${fullCard.atk !== undefined ? `<div class="bg-gray-800 p-2 rounded text-center"><span class="text-gray-500 block text-[10px] uppercase">ATK</span><span class="font-bold">${fullCard.atk === -1 ? '?' : fullCard.atk}</span></div>` : ''}
                    ${fullCard.def !== undefined ? `<div class="bg-gray-800 p-2 rounded text-center"><span class="text-gray-500 block text-[10px] uppercase">DEF</span><span class="font-bold">${fullCard.def === -1 ? '?' : fullCard.def}</span></div>` : ''}
                    <div class="bg-gray-800 p-2 rounded text-center"><span class="text-gray-500 block text-[10px] uppercase">Attribute</span><span class="font-bold">${fullCard.attribute || 'N/A'}</span></div>
                    <div class="bg-gray-800 p-2 rounded text-center"><span class="text-gray-500 block text-[10px] uppercase">Race</span><span class="font-bold">${fullCard.race}</span></div>
                </div>

                <div class="pt-4 flex gap-4">
                    <a href="${fullCard.ygoprodeck_url || '#'}" target="_blank" class="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-bold text-center transition-colors">
                        View on YGOPRODeck
                    </a>
                </div>
            </div>
        `;
    } catch (error) {
        modalContent.innerHTML = `<p class="text-red-400">Error loading details: ${error.message}</p>`;
    }
}

function setupEventListeners() {
    searchInput.addEventListener('input', (e) => {
        handleSearchInput(e.target.value);
    });

    viewToggle.addEventListener('click', () => {
        viewMode = viewMode === 'grid' ? 'list' : 'grid';
        cardGrid.classList.toggle('card-list-view', viewMode === 'list');
        viewIcon.setAttribute('data-lucide', viewMode === 'grid' ? 'layout-grid' : 'list');
        lucide.createIcons();
        applyFiltersAndSort();
    });

    // Home link - reset to main page
    const homeLinkMobile = document.getElementById('home-link-mobile');
    const homeLinkDesktop = document.getElementById('home-link');
    
    const setupHomeLink = (element) => {
        if (element) {
            element.addEventListener('click', (e) => {
                e.preventDefault();
                showAllCards();
                searchInput.value = '';
                searchQuery = '';
            });
        }
    };
    
    setupHomeLink(homeLinkMobile);
    setupHomeLink(homeLinkDesktop);

    // List toggle functionality
    if (listToggle) {
        listToggle.addEventListener('click', () => {
            if (currentList) {
                showAllCards();
            } else {
                // If we're in browse view, exit it first before showing staples list
                if (isBrowseView) {
                    toggleBrowseView(false);
                }
                showList('0-point-staples');
            }
        });
    }

    // Browse toggle functionality
    if (browseToggleBtn) {
        browseToggleBtn.addEventListener('click', () => {
            toggleBrowseView();
        });
    }

    // List view back button functionality
    if (listBackBtn) {
        listBackBtn.addEventListener('click', () => {
            // Hide list view and show category browser again
            listInfoHeader.classList.add('hidden');
            cardGrid.classList.add('hidden');
            categoryBrowser.classList.remove('hidden');
            currentList = null;
            renderCategoryBrowser();
            updateNavButtonStates();
        });
    }

    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        applyFiltersAndSort();
    });

    document.getElementById('reset-filters').addEventListener('click', () => {
        // Reset card type filter
        activeFilters.cardType = null;
        document.querySelectorAll('input[name="cardType"]').forEach(radio => {
            radio.checked = false;
        });

        // Reset attribute filters
        activeFilters.attributes.clear();
        document.querySelectorAll('#attribute-filters input[type="checkbox"]').forEach(cb => cb.checked = false);

        // Reset monster frame filters
        activeFilters.monsterFrames.clear();
        document.querySelectorAll('#monster-frame-filters input[type="checkbox"]').forEach(cb => cb.checked = false);

        // Reset race filters
        activeFilters.races.clear();
        document.querySelectorAll('#race-filters input[type="checkbox"]').forEach(cb => cb.checked = false);

        // Reset level filters
        activeFilters.levels.clear();
        document.querySelectorAll('#level-filters button').forEach(btn => {
            btn.classList.remove('bg-blue-600', 'border-blue-400');
            btn.classList.add('bg-gray-700');
        });

        // Hide filter containers that depend on card type
        document.getElementById('attribute-filter-container').classList.add('hidden');
        document.getElementById('monster-frame-filter-container').classList.add('hidden');
        document.getElementById('race-filter-container').classList.add('hidden');
        document.getElementById('level-filter-container').classList.add('hidden');

        applyFiltersAndSort();
    });

    closeModal.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    // Setup mobile filters
    setupMobileFilters();
}

function setupInfiniteScroll() {
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && displayedCount < filteredCards.length) {
            renderMoreCards();
        }
    }, { rootMargin: '400px' });
    
    observer.observe(loadingSentinel);
}

// Non-blocking JSON parser helper to prevent UI freezing
function parseJsonNonBlocking(jsonText) {
    return new Promise((resolve, reject) => {
        // Yield control back to the browser to keep UI responsive
        setTimeout(() => {
            try {
                const parsed = JSON.parse(jsonText);
                resolve(parsed);
            } catch (error) {
                reject(error);
            }
        }, 0);
    });
}

// Debounce function for search input
function debounce(func, delay) {
    return function(...args) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => func.apply(this, args), delay);
    };
}

// Debounced search handler
const handleSearchInput = debounce((value) => {
    searchQuery = value;
    applyFiltersAndSort();
}, 200);


// Card Usage Tracking Functions
function getAdditionalCardIds() {
    return trackedCardsData.additional_card_ids || [];
}

function getTrackedCardsFromTags() {
    const tagCards = new Set();
    Object.values(availableTags).forEach(tag => {
        if (['hand_trap', 'board_breaker', 'floodgates'].includes(tag.name.toLowerCase().replace(/\s+/g, '_'))) {
            tag.card_ids.forEach(id => tagCards.add(id));
        }
    });
    return tagCards;
}

function initializeTrackedCards() {
    getAdditionalCardIds().forEach(id => trackedCardIds.add(id));
    
    // Add cards from the hand_trap, board_breaker, and floodgate tags
    getTrackedCardsFromTags().forEach(id => trackedCardIds.add(id));
}

function getCurrentlyTrackedCards() {
    const currentTracked = new Set();
    
    getAdditionalCardIds().forEach(id => currentTracked.add(id));
    
    getTrackedCardsFromTags().forEach(id => currentTracked.add(id));
    
    return currentTracked;
}

async function loadDecklistFormats() {
    try {
        // Get all format folders from the decklist_formats.json file
        const response = await fetch(`${DATA_BASE_URL}decklist_formats.json?v=${CARD_BUILD_VERSION}`);
        if (response.ok) {
            const formatsData = await response.json();
            
            // Populate the format dropdown
            formatDropdown.innerHTML = '<option value="">Select a format</option>';
            formatsData.formats.forEach(format => {
                const option = document.createElement('option');
                option.value = format.path;
                option.textContent = format.name;
                formatDropdown.appendChild(option);
            });
            
            // Set default format
            let defaultFormatPath = null;
            if (formatsData.defaultFormat) {
                defaultFormatPath = formatsData.defaultFormat;
            } else if (formatsData.formats.length === 1) {
                defaultFormatPath = formatsData.formats[0].path;
            }
            
            if (defaultFormatPath) {
                formatDropdown.value = defaultFormatPath;
                // Trigger change event to load the data for the default format
                formatDropdown.dispatchEvent(new Event('change'));
            }
        } else {
            console.error('Could not load decklist formats');
        }
    } catch (error) {
        console.error('Error loading decklist formats:', error);
    }
}

async function loadDecklistsForFormat(formatPath) {
    try {
        // Load the decklist formats JSON to get the decklists for the selected format
        const response = await fetch(`${DATA_BASE_URL}decklist_formats.json?v=${CARD_BUILD_VERSION}`);
        if (!response.ok) {
            throw new Error('Could not load decklist formats');
        }
        
        const formatsData = await response.json();
        
        // Find the selected format
        const selectedFormat = formatsData.formats.find(f => f.path === formatPath);
        if (!selectedFormat) {
            console.error(`Format not found: ${formatPath}`);
            return [];
        }
        
        // Collect all decklists from all events in the format
        const decklists = [];
        selectedFormat.events.forEach(event => {
            event.decklists.forEach(decklist => {
                decklists.push(decklist.path);
            });
        });
        
        return decklists;
    } catch (error) {
        console.error(`Error loading decklists for format ${formatPath}:`, error);
        return [];
    }
}

async function parseDecklistFile(filePath) {
    try {
        const response = await fetch(`${DATA_BASE_URL}${filePath}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch decklist: ${response.status}`);
        }
        
        const text = await response.text();
        const lines = text.split('\n');
        
        let currentSection = ''; // 'main', 'extra', 'side'
        const decklistData = {
            main: [],
            extra: [],
            side: []
        };
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('#main')) {
                currentSection = 'main';
            } else if (trimmedLine.startsWith('#extra')) {
                currentSection = 'extra';
            } else if (trimmedLine.startsWith('!side')) {
                currentSection = 'side';
            } else if (trimmedLine.match(/^\d+$/)) { // Line contains only digits (card ID)
                const cardId = parseInt(trimmedLine);
                if (!isNaN(cardId)) {
                    if (currentSection) {
                        decklistData[currentSection].push(cardId);
                    }
                }
            }
        }
        
        return decklistData;
    } catch (error) {
        console.error(`Error parsing decklist file ${filePath}:`, error);
        return null;
    }
}

function calculateCardUsageStats(decklistsData) {
    const currentTracked = getCurrentlyTrackedCards();
    const cardStats = new Map();
    
    // Initialize stats for all tracked cards that appear in at least one decklist
    currentTracked.forEach(cardId => {
        cardStats.set(cardId, {
            totalLists: 0, // Number of lists where this card appears
            totalCopies: 0, // Total copies across all lists
            mainExtraCopies: 0, // Total copies in main/extra decks
            sideCopies: 0, // Total copies in side decks
        });
    });
    
    // Process each decklist
    decklistsData.forEach(decklist => {
        // Track unique cards present in *this* decklist, for totalLists calculation
        const uniqueCardsInDecklist = new Set();

        // Process main deck
        decklist.main.forEach(cardId => {
            if (currentTracked.has(cardId)) {
                const stats = cardStats.get(cardId);
                if (stats) {
                    stats.totalCopies++;
                    stats.mainExtraCopies++;
                    uniqueCardsInDecklist.add(cardId);
                }
            }
        });
        
        // Process extra deck
        decklist.extra.forEach(cardId => {
            if (currentTracked.has(cardId)) {
                const stats = cardStats.get(cardId);
                if (stats) {
                    stats.totalCopies++;
                    stats.mainExtraCopies++;
                    uniqueCardsInDecklist.add(cardId);
                }
            }
        });
        
        // Process side deck
        decklist.side.forEach(cardId => {
            if (currentTracked.has(cardId)) {
                const stats = cardStats.get(cardId);
                if (stats) {
                    stats.totalCopies++;
                    stats.sideCopies++;
                    uniqueCardsInDecklist.add(cardId);
                }
            }
        });
        
        // Update list counts for cards that appeared in this decklist
        uniqueCardsInDecklist.forEach(cardId => {
            const stats = cardStats.get(cardId);
            if (stats) {
                stats.totalLists++; // Increment for each decklist where the card appears at least once
            }
        });
    });
    
    // Calculate final averages and percentages
    const finalStats = new Map();
    cardStats.forEach((stats, cardId) => {
        if (stats.totalLists > 0) {
            finalStats.set(cardId, {
                usageRate: (stats.totalLists / decklistsData.length) * 100,
                copiesPerDecklist: stats.totalCopies / stats.totalLists,
                mainExtraCopies: stats.mainExtraCopies / stats.totalLists,
                sideCopies: stats.sideCopies / stats.totalLists,
                listCount: decklistsData.length, // Total number of decklists processed
                totalLists: stats.totalLists, // Number of lists where this card appears
            });
        }
    });
    
    return finalStats;
}

function displayCardUsageStats(finalStats) {
    // Clear the table
    cardUsageTableBody.innerHTML = '';
    
    // Convert map to array and sort by usage rate (descending)
    const sortedStats = Array.from(finalStats.entries())
      .filter(([cardId, stats]) => stats.listCount > 0 && stats.totalLists > 0) // Only show cards that appear in at least one list
      .sort((a, b) => {
        // Primary sort: usage rate
        const usageRateA = b[1].totalLists / b[1].listCount;
        const usageRateB = a[1].totalLists / a[1].listCount;
        const usageDiff = usageRateA - usageRateB;

        // secondary sort: copies per decklist (
        if (usageDiff === 0) {
          return b[1].copiesPerDecklist - a[1].copiesPerDecklist;
        }

        return usageDiff;
      });
    
    // Create table rows
    sortedStats.forEach(([cardId, stats]) => {
        const card = allCards.find(c => c.id === cardId);
        if (!card) return; // Skip if card not found in our database
        
        const usageRate = stats.usageRate || 0;
        const copiesPerDecklist = stats.copiesPerDecklist || 0;
        const mainExtraAvg = stats.mainExtraCopies || 0;
        const sideAvg = stats.sideCopies || 0;
        
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-750';
        
        row.innerHTML = `
            <td class="py-3 px-4">
                <img src="${IMAGE_BASE_URL}${card.id}.webp" alt="${card.name}" class="w-12 h-16 object-contain" onerror="this.src='https://images.ygoprodeck.com/images/assets/CardBack.jpg';">
            </td>
            <td class="py-3 px-4 text-sm font-medium">${card.name}</td>
            <td class="py-3 px-4 text-sm">${usageRate.toFixed(2)}% (${stats.totalLists}/${stats.listCount})</td>
            <td class="py-3 px-4 text-sm">${copiesPerDecklist.toFixed(2)}</td>
            <td class="py-3 px-4 text-sm">${mainExtraAvg.toFixed(2)}</td>
            <td class="py-3 px-4 text-sm">${sideAvg.toFixed(2)}</td>
        `;
        
        cardUsageTableBody.appendChild(row);
    });
}

function showCardUsageView() {
    if (isDeckBuilder) exitDeckBuilder();
    // Hide other views
    cardGrid.classList.add('hidden');
    listInfoHeader.classList.add('hidden');
    categoryBrowser.classList.add('hidden');
    loadingSentinel.classList.add('hidden');
    noResults.classList.add('hidden');
    
    // Show card usage view
    cardUsageView.classList.remove('hidden');

    updateNavButtonStates();

    // Load data if a format is selected, otherwise show message
    if (formatDropdown.value) {
        loadCardUsageData(formatDropdown.value);
    } else {
        cardUsageTableBody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center text-gray-500">Please select a format from the dropdown to view card usage statistics</td></tr>';
    }
}

function hideCardUsageView() {
    // Hide card usage view
    cardUsageView.classList.add('hidden');
    
    // Show main card grid
    cardGrid.classList.remove('hidden');
}


// Event listeners for the card usage buttons
cardUsageBtn?.addEventListener('click', () => {
    showCardUsageView();
});

cardUsageBtnMobile?.addEventListener('click', () => {
    showCardUsageView();
});

// load card usage data with loading indicator
async function loadCardUsageData(formatPath) {
    // Show loading state
    cardUsageTableBody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center"><div class="flex flex-col items-center gap-3"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div><span class="text-sm text-gray-400">Loading decklists...</span></div></td></tr>';
    
    try {
        // Load decklists for the selected format
        const decklistPaths = await loadDecklistsForFormat(formatPath);
        
        if (decklistPaths.length === 0) {
            cardUsageTableBody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center text-gray-500">No decklists found for this format</td></tr>';
            return;
        }
        
        // Process each decklist
        const decklistsData = [];
        for (const decklistPath of decklistPaths) {
            const decklistData = await parseDecklistFile(decklistPath);
            if (decklistData) {
                decklistsData.push(decklistData);
            }
        }
        
        if (decklistsData.length === 0) {
            cardUsageTableBody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center text-gray-500">No valid decklists found</td></tr>';
            return;
        }
        
        // Calculate and display stats
        const cardStats = calculateCardUsageStats(decklistsData);
        displayCardUsageStats(cardStats);
    } catch (error) {
        console.error('Error processing decklists:', error);
        cardUsageTableBody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center text-red-500">Error loading decklist data: ' + error.message + '</td></tr>';
    }
}

// Event listener for the format dropdown
formatDropdown?.addEventListener('change', async (e) => {
    const selectedFormat = e.target.value;
    if (!selectedFormat) {
        cardUsageTableBody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center text-gray-500">Please select a format</td></tr>';
        return;
    }
    
    await loadCardUsageData(selectedFormat);
});

// Periodic cache maintenance
setInterval(() => {
  imageCache.clearExpired();
}, 30000);

// Enhanced createCardElement with caching
// Lazy loading observer for images
let imageObserver = null;

function initImageObserver() {
  if (imageObserver) return;
  
  imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const cardId = img.dataset.cardId;
        const dataSrc = img.dataset.src;
        
        // Check cache first
        const cachedImage = imageCache.get(cardId);
        if (cachedImage) {
          img.src = cachedImage;
        } else {
          // Load the image
          img.src = dataSrc;
          img.onload = function() {
            // Cache the image
            imageCache.set(cardId, this.src);
          };
          
          img.onerror = function() {
            console.warn(`Failed to load image for card ID: ${cardId}`);
          };
        }
        
        imageObserver.unobserve(img);
      }
    });
  }, {
    rootMargin: '200px', // Start loading when 2000px away from viewport
    threshold: 0.1
  });
}

function createCardElement(card, index) {
  const div = document.createElement('div');
  div.className = `card-container relative group cursor-pointer card-animate`;
  div.style.animationDelay = `${(index % 10) * 0.05}s`;

  const points = card.genesys_points || 0;

  // Check if image is in cache first
  const cachedImage = imageCache.get(card.id);
  const imgSrc = cachedImage || `https://images.ygoprodeck.com/images/assets/CardBack.jpg`;
  const dataSrc = `${IMAGE_BASE_URL}${card.id}.webp`;

  // Use data-src for lazy loading, src for cached images
  const finalImgSrc = cachedImage ? imgSrc : `https://images.ygoprodeck.com/images/assets/CardBack.jpg`;
  const shouldLazyLoad = !cachedImage;

  div.innerHTML = `
      <div class="card-image-wrapper relative aspect-[0.68] overflow-visible rounded-lg bg-gradient-to-br from-gray-700 to-gray-800">
          <img src="${finalImgSrc}"
               ${shouldLazyLoad ? `data-src="${dataSrc}"` : ''}
                data-card-id="${card.id}"
                alt="${card.name}"
                decoding="async"
                loading="lazy"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105">

           ${points > 0 ? `<div class="points-badge absolute -top-3 -right-3 px-3 py-1 rounded-md text-white font-bold text-sm z-10 shadow-lg">
               ${points}
           </div>` : ''}

           <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
               <p class="text-xs font-medium text-blue-400 uppercase tracking-tighter">${card.type}</p>
               <p class="text-sm font-bold truncate">${card.name}</p>
           </div>
       </div>
       <div class="card-info mt-2 hidden">
           <h3 class="font-bold text-sm truncate">${card.name}</h3>
           <p class="text-xs text-gray-500">${card.type} • ${card.race}</p>
       </div>
   `;

  // Set up lazy loading for uncached images
  if (shouldLazyLoad) {
    initImageObserver();
    const imgElement = div.querySelector('img');
    imageObserver.observe(imgElement);
  }

  div.addEventListener('click', () => showCardDetails(card));
  return div;
}

// Mobile filter toggle functionality
function setupMobileFilters() {
    const mobileFilterToggle = document.getElementById('mobile-filter-toggle');
    const filtersSidebar = document.getElementById('filters-sidebar');
    const mobileFilterIcon = document.getElementById('mobile-filter-icon');
    const filterBackdrop = document.getElementById('filter-backdrop');

    if (mobileFilterToggle && filtersSidebar && mobileFilterIcon) {
        mobileFilterToggle.addEventListener('click', () => {
            // Toggle visibility of filters on mobile
            const isOpen = filtersSidebar.classList.contains('mobile-open');

            if (isOpen) {
                filtersSidebar.classList.remove('mobile-open');
                filterBackdrop?.classList.remove('active');
                mobileFilterIcon.setAttribute('data-lucide', 'filter');
                mobileFilterToggle.classList.remove('bg-blue-600', 'border-blue-400');
            } else {
                filtersSidebar.classList.add('mobile-open');
                filterBackdrop?.classList.add('active');
                mobileFilterIcon.setAttribute('data-lucide', 'sliders-x');
                mobileFilterToggle.classList.add('bg-blue-600', 'border-blue-400');
            }

            // Update the icon
            lucide.createIcons();
        });

        // Close filter when clicking backdrop
        filterBackdrop?.addEventListener('click', () => {
            filtersSidebar.classList.remove('mobile-open');
            filterBackdrop.classList.remove('active');
            mobileFilterIcon.setAttribute('data-lucide', 'filter');
            mobileFilterToggle.classList.remove('bg-blue-600', 'border-blue-400');
            lucide.createIcons();
        });
    }
}

// Function to handle responsive behavior
function handleResize() {
    const filtersSidebar = document.getElementById('filters-sidebar');
    const mobileFilterToggle = document.getElementById('mobile-filter-toggle');
    const filterBackdrop = document.getElementById('filter-backdrop');
    const mobileFilterIcon = document.getElementById('mobile-filter-icon');

    if (window.innerWidth >= 768) { // Medium screens and up
        // Always show filters on desktop
        filtersSidebar.classList.remove('mobile-open', 'hidden');
        filterBackdrop?.classList.remove('active');
        if (mobileFilterToggle) {
            mobileFilterToggle.classList.add('hidden');
            mobileFilterIcon.setAttribute('data-lucide', 'filter');
            mobileFilterToggle.classList.remove('bg-blue-600', 'border-blue-400');
        }
    } else { // Mobile screens
        // Hide filters by default on mobile
        if (mobileFilterToggle) {
            mobileFilterToggle.classList.remove('hidden');
        }
        filtersSidebar.classList.remove('hidden');
        filtersSidebar.classList.remove('mobile-open');
        filterBackdrop?.classList.remove('active');
        if (mobileFilterIcon) {
            mobileFilterIcon.setAttribute('data-lucide', 'filter');
        }
        if (mobileFilterToggle) {
            mobileFilterToggle.classList.remove('bg-blue-600', 'border-blue-400');
        }
    }
    
    lucide.createIcons();
}

// ==================== DECK BUILDER ====================

const THUMBNAIL_BASE_URL = 'https://ik.imagekit.io/louaykh/cards/thumbnails/';

let isDeckBuilder = false;
let fullCardDataMap = new Map();
let currentDeck = { main: [], extra: [], side: [] };
let deckbuilderSearchQuery = '';
let deckbuilderSortMode = 'name-asc';
let deckbuilderFilteredCards = [];
let deckSortMode = 'default';
let isLoadingChunks = false;
let chunksFullyLoaded = false;
let dbActiveFilters = { cardType: null, attributes: new Set(), frames: new Set(), races: new Set(), levels: new Set(), tags: new Set(), staplesOnly: false, spellTypes: new Set(), trapTypes: new Set(), pointsMin: null, pointsMax: null, atkMin: null, atkMax: null, defMin: null, defMax: null };
let dbDescTerms = [];
let dbDefaultCardOrder = [];
let deckBuilderEventsSetup = false;

function getDBEl(id) {
    return document.getElementById(id);
}

function getDBElements() {
    return {
        view: getDBEl('deckbuilder-view'),
        loading: getDBEl('deckbuilder-loading'),
        loadingProgress: getDBEl('deckbuilder-loading-progress'),
        loadingTotal: getDBEl('deckbuilder-loading-total'),
        loadingBar: getDBEl('deckbuilder-loading-bar'),
        content: getDBEl('deckbuilder-content'),
        backBtn: getDBEl('deckbuilder-back-btn'),
        toggleBtn: getDBEl('deckbuilder-toggle'),
        previewPanel: getDBEl('deckbuilder-preview-panel'),
        previewEmpty: getDBEl('deckbuilder-preview-empty'),
        previewContent: getDBEl('deckbuilder-preview-content'),
        previewImage: getDBEl('deckbuilder-preview-image'),
        previewName: getDBEl('deckbuilder-preview-name'),
        previewType: getDBEl('deckbuilder-preview-type'),
        previewPoints: getDBEl('deckbuilder-preview-points'),
        previewAttribute: getDBEl('deckbuilder-preview-attribute'),
        previewRace: getDBEl('deckbuilder-preview-race'),
        previewLevel: getDBEl('deckbuilder-preview-level'),
        previewStats: getDBEl('deckbuilder-preview-stats'),
        previewAtk: getDBEl('deckbuilder-preview-atk'),
        previewDef: getDBEl('deckbuilder-preview-def'),
        previewDesc: getDBEl('deckbuilder-preview-desc'),
        searchInput: getDBEl('deckbuilder-search-input'),
        searchResults: getDBEl('deckbuilder-search-results'),
        searchEmpty: getDBEl('deckbuilder-search-empty'),
        filterBtn: getDBEl('deckbuilder-filter-btn'),
        filterModal: getDBEl('deckbuilder-filter-modal'),
        filterApply: getDBEl('deckbuilder-filter-apply'),
        filterReset: getDBEl('deckbuilder-filter-reset'),
        addTermBtn: getDBEl('deckbuilder-add-term'),
        descTerms: getDBEl('deckbuilder-desc-terms'),
        sortSelect: getDBEl('db-sort-select'),
        dbCardTypeRadios: document.querySelectorAll('input[name="db-card-type"]'),
        mainCount: getDBEl('deckbuilder-main-count'),
        mainPoints: getDBEl('deckbuilder-main-points'),
        mainGrid: getDBEl('deckbuilder-main-grid'),
        extraCount: getDBEl('deckbuilder-extra-count'),
        extraPoints: getDBEl('deckbuilder-extra-points'),
        extraGrid: getDBEl('deckbuilder-extra-grid'),
        sideCount: getDBEl('deckbuilder-side-count'),
        sidePoints: getDBEl('deckbuilder-side-points'),
        sideGrid: getDBEl('deckbuilder-side-grid'),
        totalCards: getDBEl('deckbuilder-total-cards'),
        totalPts: getDBEl('deckbuilder-total-pts'),
        exportBtn: getDBEl('deckbuilder-export-btn'),
        exportDropdown: getDBEl('deckbuilder-export-dropdown'),
        exportYdk: getDBEl('deckbuilder-export-ydk'),
        exportYdke: getDBEl('deckbuilder-export-ydke'),
        exportTxt: getDBEl('deckbuilder-export-txt'),
        clearBtn: getDBEl('deckbuilder-clear-btn'),
        sortBtn: getDBEl('deckbuilder-sort-btn'),
        sortDropdown: getDBEl('deckbuilder-sort-dropdown'),
        sortType: getDBEl('deckbuilder-sort-type'),
        sortName: getDBEl('deckbuilder-sort-name'),
        mobilePreview: getDBEl('deckbuilder-mobile-preview'),
        mobilePreviewClose: getDBEl('db-mobile-preview-close'),
        mobilePreviewImage: getDBEl('db-mobile-preview-image'),
        mobilePreviewName: getDBEl('db-mobile-preview-name'),
        mobilePreviewType: getDBEl('db-mobile-preview-type'),
        mobilePreviewPoints: getDBEl('db-mobile-preview-points'),
        mobilePreviewAttribute: getDBEl('db-mobile-preview-attribute'),
        mobilePreviewRace: getDBEl('db-mobile-preview-race'),
        mobilePreviewDesc: getDBEl('db-mobile-preview-desc'),
    };
}

function enterDeckBuilder() {
    const els = getDBElements();
    if (isDeckBuilder) return;
    isDeckBuilder = true;

    const fs = document.getElementById('filters-sidebar');
    if (fs) fs.style.display = 'none';
    const wrapper = document.getElementById('card-container-wrapper');
    if (wrapper) wrapper.style.marginLeft = '0';

    document.getElementById('card-grid')?.classList.add('hidden');
    document.getElementById('loading-sentinel')?.classList.add('hidden');
    document.getElementById('no-results')?.classList.add('hidden');
    document.getElementById('tag-filter-bar')?.classList.add('hidden');
    document.getElementById('list-info-header')?.classList.add('hidden');
    document.getElementById('card-usage-view')?.classList.add('hidden');
    document.getElementById('category-browser')?.classList.add('hidden');

    els.view.classList.remove('hidden');
    els.loading.classList.remove('hidden');
    els.content.classList.add('hidden');

    els.toggleBtn.classList.add('deckbuilder-nav-btn-active');
    document.getElementById('view-toggle')?.classList.add('hidden');

    const mainEl = document.getElementById('card-container-wrapper');
    if (mainEl) {
        mainEl.style.overflow = 'hidden';
        mainEl.style.position = 'relative';
        mainEl.style.scrollbarGutter = 'auto';
    }

    updateNavButtonStates();

    loadAllChunks();
}

function exitDeckBuilder() {
    const els = getDBElements();
    if (!isDeckBuilder) return;
    isDeckBuilder = false;

    els.view.classList.add('hidden');
    els.toggleBtn.classList.remove('deckbuilder-nav-btn-active');
    document.getElementById('view-toggle')?.classList.remove('hidden');

    const fs = document.getElementById('filters-sidebar');
    if (fs) fs.style.display = '';
    const wrapper = document.getElementById('card-container-wrapper');
    if (wrapper) {
        wrapper.style.marginLeft = '';
        wrapper.style.overflow = '';
        wrapper.style.position = '';
        wrapper.style.scrollbarGutter = '';
    }

    saveDeck();
    showAllCards();
}

function showToast(message, type) {
    const existing = document.querySelector('.deckbuilder-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `deckbuilder-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

async function loadAllChunks() {
    const els = getDBElements();
    if (isLoadingChunks) return;

    if (chunksFullyLoaded && fullCardDataMap.size > 0) {
        initializeChunkFilesMap();
        let allValid = true;
        for (const file of chunkFilesMap) {
            const entry = chunkCache.get(file);
            if (!entry || !entry.isValid(CARD_BUILD_VERSION)) {
                allValid = false;
                break;
            }
        }
        if (allValid) {
            loadDeck();
            dbDefaultCardOrder = [...allCards];
            deckbuilderFilteredCards = [...allCards];
            deckbuilderSearchQuery = '';
            deckbuilderSortMode = els.sortSelect.value;
            els.loading.classList.add('hidden');
            els.content.classList.remove('hidden');
            renderSearchResults();
            renderDeck();
            setupDeckBuilderEvents();
            lucide.createIcons();
            return;
        }
        chunksFullyLoaded = false;
        chunkCache.clear();
        fullCardDataMap = new Map();
    }

    isLoadingChunks = true;

    initializeChunkFilesMap();
    const chunkFiles = Array.from(chunkFilesMap);
    const total = chunkFiles.length;
    els.loadingTotal.textContent = total;
    els.loadingProgress.textContent = '0';

    fullCardDataMap = new Map();
    let loaded = 0;

    const BATCH_SIZE = 8;
    for (let i = 0; i < chunkFiles.length; i += BATCH_SIZE) {
        const batch = chunkFiles.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async (file) => {
                const cacheEntry = chunkCache.get(file);
        if (cacheEntry && cacheEntry.isValid(CARD_BUILD_VERSION)) {
                    return { file, data: cacheEntry.data };
                }
                const response = await fetch(`${file}?v=${CARD_BUILD_VERSION}`);
                if (!response.ok) throw new Error(`Failed: ${response.status}`);
                const data = await response.json();
                chunkCache.set(file, new CacheEntry(data, CARD_BUILD_VERSION));
                return { file, data };
            })
        );

        for (const result of results) {
            if (result.status === 'fulfilled') {
                const { data } = result.value;
                for (const card of data) {
                    if (card.id) {
                        fullCardDataMap.set(card.id, card);
                    }
                }
            }
            loaded++;
            els.loadingProgress.textContent = loaded;
            els.loadingBar.style.width = `${(loaded / total) * 100}%`;
        }

        await new Promise(r => setTimeout(r, 0));
    }

    isLoadingChunks = false;
    chunksFullyLoaded = true;

    loadDeck();
    dbDefaultCardOrder = [...allCards];
    deckbuilderFilteredCards = [...allCards];
    deckbuilderSearchQuery = '';
    deckbuilderSortMode = els.sortSelect.value;

    els.loading.classList.add('hidden');
    els.content.classList.remove('hidden');

    renderSearchResults();
    renderDeck();
    setupDeckBuilderEvents();
    lucide.createIcons();
}

function getAutoZone(card) {
    const type = card.type || '';
    if (type.includes('Fusion') || type.includes('Synchro') || type.includes('XYZ') || type.includes('Link')) {
        return 'extra';
    }
    return 'main';
}

function getCardCountInDeck(cardId) {
    let count = 0;
    for (const zone of ['main', 'extra', 'side']) {
        for (const id of currentDeck[zone]) {
            if (id === cardId) count++;
        }
    }
    return count;
}

function addToDeck(card, targetZone) {
    const count = getCardCountInDeck(card.id);
    if (count >= 3) return 'limit';

    if (currentDeck.main.length + currentDeck.extra.length + currentDeck.side.length >= 80) return 'max';

    const zone = targetZone || getAutoZone(card);
    if (zone === 'main' && currentDeck.main.length >= 60) return 'main_full';
    if (zone === 'extra' && currentDeck.extra.length >= 15) return 'extra_full';
    if (zone === 'side' && currentDeck.side.length >= 15) return 'side_full';

    currentDeck[zone].push(card.id);
    return true;
}

function removeFromDeck(cardId, zone) {
    const idx = currentDeck[zone].indexOf(cardId);
    if (idx !== -1) {
        currentDeck[zone].splice(idx, 1);
        return true;
    }
    return false;
}

function moveCard(cardId, fromZone, toZone) {
    const idx = currentDeck[fromZone].indexOf(cardId);
    if (idx === -1) return false;

    if (toZone === 'main' && currentDeck.main.length >= 60) return false;
    if (toZone === 'extra' && currentDeck.extra.length >= 15) return false;
    if (toZone === 'side' && currentDeck.side.length >= 15) return false;

    currentDeck[fromZone].splice(idx, 1);
    currentDeck[toZone].push(cardId);
    return true;
}

function clearDeck() {
    currentDeck = { main: [], extra: [], side: [] };
    deckSortMode = 'default';
}

function getDeckTypeSortRank(card) {
    const cat = getCardTypeFromTypeName(card.type);
    if (cat === 'monster') {
        const t = card.type;
        if (t.includes('Normal')) return 0;
        if (t.includes('Ritual')) return 2;
        if (t.includes('Fusion')) return 3;
        if (t.includes('Synchro')) return 4;
        if (t.includes('XYZ')) return 5;
        if (t.includes('Link')) return 6;
        return 1;
    }
    if (cat === 'spell') {
        const raceOrder = { 'Normal': 7, 'Quick-Play': 8, 'Continuous': 9, 'Equip': 10, 'Ritual': 11, 'Field': 12 };
        return raceOrder[card.race] !== undefined ? raceOrder[card.race] : 13;
    }
    const trapOrder = { 'Normal': 14, 'Continuous': 15, 'Counter': 16 };
    return trapOrder[card.race] !== undefined ? trapOrder[card.race] : 17;
}

function sortDeck(mode) {
    for (const zone of ['main', 'extra', 'side']) {
        const arr = currentDeck[zone];
        const sorted = arr.slice().sort((a, b) => {
            const ca = getCardById(a);
            const cb = getCardById(b);
            if (!ca || !cb) return 0;
            if (mode === 'type') {
                const ra = getDeckTypeSortRank(ca);
                const rb = getDeckTypeSortRank(cb);
                if (ra !== rb) return ra - rb;
            }
            return ca.name.localeCompare(cb.name);
        });
        currentDeck[zone] = sorted;
    }
    deckSortMode = mode;
    renderDeck();
}

function getDeckStats() {
    let totalCards = 0;
    let totalPoints = 0;
    const zonePoints = { main: 0, extra: 0, side: 0 };

    for (const zone of ['main', 'extra', 'side']) {
        for (const id of currentDeck[zone]) {
            const card = cardMap.get(id);
            if (card) {
                zonePoints[zone] += card.genesys_points || 0;
                totalPoints += card.genesys_points || 0;
            }
        }
        totalCards += currentDeck[zone].length;
    }

    return { totalCards, totalPoints, zonePoints };
}

function getCardById(cardId) {
    return cardMap.get(cardId) || null;
}

function getFullCardData(cardId) {
    return fullCardDataMap.get(cardId) || null;
}

function renderDeck() {
    const els = getDBElements();
    const zoneConfigs = [
        { name: 'main', grid: els.mainGrid, count: els.mainCount, points: els.mainPoints, limit: 60 },
        { name: 'extra', grid: els.extraGrid, count: els.extraCount, points: els.extraPoints, limit: 15 },
        { name: 'side', grid: els.sideGrid, count: els.sideCount, points: els.sidePoints, limit: 15 },
    ];

    for (const zone of zoneConfigs) {
        zone.grid.innerHTML = '';
        const cards = currentDeck[zone.name];
        const frag = document.createDocumentFragment();

        for (let i = 0; i < cards.length; i++) {
            const id = cards[i];
            const card = getCardById(id);
            if (!card) continue;

            const slot = document.createElement('div');
            slot.className = 'deck-card-slot filled';
            slot.dataset.cardId = id;
            slot.dataset.zone = zone.name;
            slot.draggable = true;

            const thumbSrc = `${THUMBNAIL_BASE_URL}${id}.webp`;
            const pts = card.genesys_points || 0;
            slot.innerHTML = `
                <img src="${thumbSrc}" alt="${card.name}" loading="lazy" onerror="this.src='https://images.ygoprodeck.com/images/assets/CardBack.jpg';">
                ${pts > 0 ? `<span class="deck-card-points">${pts}</span>` : ''}
            `;

            const slotCardId = id;
            const slotZoneName = zone.name;

            slot.addEventListener('click', () => {
                removeFromDeck(slotCardId, slotZoneName);
                renderDeck();
            });

            slot.addEventListener('mouseenter', () => updatePreview(slotCardId));

            frag.appendChild(slot);
        }

        for (let i = cards.length; i < zone.limit; i++) {
            const empty = document.createElement('div');
            empty.className = 'deck-card-slot empty';
            empty.dataset.zone = zone.name;
            frag.appendChild(empty);
        }

        zone.grid.appendChild(frag);
    }

    setupDeckGridDragDrop(zoneConfigs);

    const stats = getDeckStats();
    for (const zone of zoneConfigs) {
        zone.count.textContent = `(${currentDeck[zone.name].length}/${zone.limit})`;
        zone.points.textContent = `${stats.zonePoints[zone.name]} pts`;
    }
    els.totalCards.textContent = stats.totalCards;
    els.totalPts.textContent = stats.totalPoints;
    saveDeck();
}

function saveDeck() {
    try {
        localStorage.setItem('genesys_deckbuilder_deck', JSON.stringify(currentDeck));
    } catch (e) {}
}

function loadDeck() {
    try {
        const saved = localStorage.getItem('genesys_deckbuilder_deck');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object' && 
                Array.isArray(parsed.main) && Array.isArray(parsed.extra) && Array.isArray(parsed.side)) {
                currentDeck = parsed;
            }
        }
    } catch (e) {}
}

function setupDeckGridDragDrop(zoneConfigs) {
    for (const zone of zoneConfigs) {
        if (zone.grid.dataset.dragSetup) continue;
        zone.grid.dataset.dragSetup = '1';

        let hoveredSlot = null;

        zone.grid.addEventListener('dragstart', (e) => {
            const slot = e.target.closest('.deck-card-slot.filled');
            if (!slot) return;
            const idx = Array.from(zone.grid.children).indexOf(slot);
            e.dataTransfer.setData('text/plain', JSON.stringify({
                cardId: slot.dataset.cardId,
                zone: slot.dataset.zone,
                source: 'deck',
                fromIdx: idx
            }));
            e.dataTransfer.effectAllowed = 'move';
        });

        zone.grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const slot = e.target.closest('.deck-card-slot');
            if (!slot) return;
            if (hoveredSlot && hoveredSlot !== slot) {
                hoveredSlot.classList.remove('drag-over');
            }
            slot.classList.add('drag-over');
            hoveredSlot = slot;
        });

        zone.grid.addEventListener('dragleave', (e) => {
            if (!zone.grid.contains(e.relatedTarget)) {
                if (hoveredSlot) {
                    hoveredSlot.classList.remove('drag-over');
                    hoveredSlot = null;
                }
            }
        });

        zone.grid.addEventListener('drop', (e) => {
            e.preventDefault();
            const slot = e.target.closest('.deck-card-slot');
            if (hoveredSlot) {
                hoveredSlot.classList.remove('drag-over');
                hoveredSlot = null;
            }
            if (!slot) return;
            const targetIdx = Array.from(zone.grid.children).indexOf(slot);
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.source === 'search') {
                    const card = getCardById(data.cardId);
                    if (!card) return;
                    const result = addToDeck(card, zone.name);
                    renderDeck();
                } else if (data.source === 'deck') {
                    const fromZone = data.zone;
                    const toZone = zone.name;
                    if (fromZone === toZone) {
                        const arr = currentDeck[toZone];
                        const fromIdx = data.fromIdx;
                        if (fromIdx < 0 || fromIdx >= arr.length) return;
                        const [moved] = arr.splice(fromIdx, 1);
                        const adjusted = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
                        arr.splice(adjusted, 0, moved);
                        renderDeck();
                    } else {
                        const fromArr = currentDeck[fromZone];
                        const fromIdx = data.fromIdx;
                        if (fromIdx < 0 || fromIdx >= fromArr.length) return;
                        const [moved] = fromArr.splice(fromIdx, 1);
                        const toArr = currentDeck[toZone];
                        const limit = toZone === 'main' ? 60 : 15;
                        if (toArr.length >= limit) {
                            fromArr.splice(fromIdx, 0, moved);
                            renderDeck();
                            return;
                        }
                        const insertAt = Math.min(targetIdx, toArr.length);
                        toArr.splice(insertAt, 0, moved);
                        renderDeck();
                    }
                }
            } catch (err) {}
        });

        zone.grid.addEventListener('dragend', () => {
            if (hoveredSlot) {
                hoveredSlot.classList.remove('drag-over');
                hoveredSlot = null;
            }
        });
    }
}

function renderSearchResults() {
    const els = getDBElements();

    let cards = [...allCards];

    if (deckbuilderSearchQuery) {
        const q = deckbuilderSearchQuery.toLowerCase();
        cards = cards.filter(c => c.name.toLowerCase().includes(q));

        if (cards.length === 0 && q.length > 0) {
            cards = allCards.filter(c => {
                const full = getFullCardData(c.id);
                return full && full.desc && full.desc.toLowerCase().includes(q);
            });
        }
    }

    if (dbActiveFilters.cardType) {
        cards = cards.filter(c => getCardTypeFromTypeName(c.type) === dbActiveFilters.cardType);
    }

    if (dbActiveFilters.attributes.size > 0) {
        cards = cards.filter(c => dbActiveFilters.attributes.has(c.attribute));
    }

    if (dbActiveFilters.frames.size > 0) {
        cards = cards.filter(c => {
            const frame = getFrameTypeFromTypeName(c.type);
            return dbActiveFilters.frames.has(frame);
        });
    }

    if (dbActiveFilters.spellTypes.size > 0) {
        cards = cards.filter(c => {
            if (c.type !== 'Spell Card') return false;
            return dbActiveFilters.spellTypes.has(c.race);
        });
    }

    if (dbActiveFilters.trapTypes.size > 0) {
        cards = cards.filter(c => {
            if (c.type !== 'Trap Card') return false;
            return dbActiveFilters.trapTypes.has(c.race);
        });
    }

    if (dbActiveFilters.races.size > 0) {
        cards = cards.filter(c => dbActiveFilters.races.has(c.race));
    }

    if (dbActiveFilters.levels.size > 0) {
        cards = cards.filter(c => dbActiveFilters.levels.has(c.level));
    }

    if (dbActiveFilters.pointsMin !== null) {
        cards = cards.filter(c => c.genesys_points >= dbActiveFilters.pointsMin);
    }
    if (dbActiveFilters.pointsMax !== null) {
        cards = cards.filter(c => c.genesys_points <= dbActiveFilters.pointsMax);
    }

    if (dbActiveFilters.atkMin !== null || dbActiveFilters.atkMax !== null) {
        cards = cards.filter(c => {
            const full = getFullCardData(c.id);
            const atk = full?.atk;
            if (atk === undefined || atk === null) return false;
            if (dbActiveFilters.atkMin !== null && atk < dbActiveFilters.atkMin) return false;
            if (dbActiveFilters.atkMax !== null && atk > dbActiveFilters.atkMax) return false;
            return true;
        });
    }

    if (dbActiveFilters.defMin !== null || dbActiveFilters.defMax !== null) {
        cards = cards.filter(c => {
            const full = getFullCardData(c.id);
            const def = full?.def;
            if (def === undefined || def === null) return false;
            if (dbActiveFilters.defMin !== null && def < dbActiveFilters.defMin) return false;
            if (dbActiveFilters.defMax !== null && def > dbActiveFilters.defMax) return false;
            return true;
        });
    }

    if (dbDescTerms.length > 0) {
        cards = cards.filter(c => {
            const full = getFullCardData(c.id);
            if (!full || !full.desc) return false;
            const desc = full.desc.toLowerCase();
            return dbDescTerms.every(term => {
                const match = desc.includes(term.text.toLowerCase());
                return term.negate ? !match : match;
            });
        });
    }

    if (dbActiveFilters.tags.size > 0) {
        cards = cards.filter(c =>
            Array.from(dbActiveFilters.tags).some(tag =>
                c.custom_tags && c.custom_tags.includes(tag)
            )
        );
    }

    if (dbActiveFilters.staplesOnly && availableLists['0-point-staples']) {
        const stapleIds = new Set(availableLists['0-point-staples'].card_ids);
        cards = cards.filter(c => stapleIds.has(c.id));
    }

    if (deckbuilderSortMode === 'name-asc') {
        cards.sort((a, b) => a.name.localeCompare(b.name));
    } else if (deckbuilderSortMode === 'name-desc') {
        cards.sort((a, b) => b.name.localeCompare(a.name));
    } else if (deckbuilderSortMode === 'points-desc') {
        cards.sort((a, b) => (b.genesys_points || 0) - (a.genesys_points || 0));
    } else if (deckbuilderSortMode === 'points-asc') {
        cards.sort((a, b) => (a.genesys_points || 0) - (b.genesys_points || 0));
    } else if (deckbuilderSortMode === 'type') {
        const typeOrder = ['Effect Monster', 'Normal Monster', 'Tuner Monster', 'Fusion Monster', 'Synchro Monster', 'Synchro Tuner Monster', 'XYZ Monster', 'Link Monster', 'Spell Card', 'Trap Card'];
        cards.sort((a, b) => {
            const ia = typeOrder.indexOf(a.type);
            const ib = typeOrder.indexOf(b.type);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
    }

    deckbuilderFilteredCards = cards;

    els.searchResults.innerHTML = '';

    if (cards.length === 0) {
        els.searchEmpty.classList.remove('hidden');
        return;
    }
    els.searchEmpty.classList.add('hidden');

    const frag = document.createDocumentFragment();
    for (const card of cards) {
        const thumb = document.createElement('div');
        thumb.className = 'db-thumb-card';
        thumb.dataset.cardId = card.id;
        thumb.draggable = true;

        const thumbSrc = `${THUMBNAIL_BASE_URL}${card.id}.webp`;
        const pts = card.genesys_points || 0;

        thumb.innerHTML = `
            <img src="${thumbSrc}" alt="${card.name}" loading="lazy" onerror="this.src='https://images.ygoprodeck.com/images/assets/CardBack.jpg';">
            ${pts > 0 ? `<span class="deck-card-points">${pts}</span>` : ''}
        `;

        thumb.addEventListener('click', (e) => {
            const targetZone = e.shiftKey ? 'side' : undefined;
            const result = addToDeck(card, targetZone);
            if (result === true) {
                renderDeck();
            }
        });

        thumb.addEventListener('mouseenter', () => updatePreview(card.id));

        if (window.innerWidth < 1024) {
            let holdTimer = null;
            thumb.addEventListener('touchstart', (e) => {
                holdTimer = setTimeout(() => {
                    updatePreview(card.id);
                    getDBElements().mobilePreview.classList.add('active');
                }, 500);
            });
            thumb.addEventListener('touchend', () => {
                clearTimeout(holdTimer);
            });
            thumb.addEventListener('touchmove', () => {
                clearTimeout(holdTimer);
            });
        }

        thumb.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ cardId: card.id, source: 'search' }));
            thumb.style.opacity = '0.5';
        });

        thumb.addEventListener('dragend', () => {
            thumb.style.opacity = '1';
        });

        frag.appendChild(thumb);
    }
    els.searchResults.appendChild(frag);
}

function updatePreview(cardId) {
    const els = getDBElements();
    const full = getFullCardData(cardId);
    const card = getCardById(cardId);
    if (!full || !card) return;

    els.previewEmpty.classList.add('hidden');
    els.previewContent.classList.remove('hidden');

    els.previewImage.src = 'https://images.ygoprodeck.com/images/assets/CardBack.jpg';
    const img = new Image();
    img.src = `${IMAGE_BASE_URL}${cardId}.webp`;
    img.onload = () => { els.previewImage.src = img.src; };
    img.onerror = () => {
        els.previewImage.src = 'https://images.ygoprodeck.com/images/assets/CardBack.jpg';
    };
    els.previewName.textContent = full.name || card.name;
    els.previewType.textContent = full.type || card.type;
    els.previewPoints.textContent = `${card.genesys_points || 0} pts`;

    els.previewAttribute.textContent = full.attribute || '';
    els.previewRace.textContent = full.race || card.race || '';
    els.previewLevel.textContent = full.level ? `★${full.level}` : (card.level ? `★${card.level}` : '');
    els.previewDesc.textContent = full.desc || '';

    if (full.atk !== undefined) {
        els.previewStats.classList.remove('hidden');
        els.previewAtk.textContent = `ATK/${full.atk === -1 ? '?' : full.atk}`;
        els.previewDef.textContent = `DEF/${full.def === -1 ? '?' : full.def}`;
    } else {
        els.previewStats.classList.add('hidden');
    }

    const mobileEls = getDBElements();
    mobileEls.mobilePreviewImage.src = 'https://images.ygoprodeck.com/images/assets/CardBack.jpg';
    const mobileImg = new Image();
    mobileImg.src = `${IMAGE_BASE_URL}${cardId}.webp`;
    mobileImg.onload = () => { mobileEls.mobilePreviewImage.src = mobileImg.src; };
    mobileEls.mobilePreviewName.textContent = full.name || card.name;
    mobileEls.mobilePreviewType.textContent = full.type || card.type;
    mobileEls.mobilePreviewPoints.textContent = `${card.genesys_points || 0} pts`;
    mobileEls.mobilePreviewAttribute.textContent = full.attribute || '';
    mobileEls.mobilePreviewRace.textContent = full.race || card.race || '';
    mobileEls.mobilePreviewDesc.textContent = full.desc || '';
}

function clearPreview() {
    const els = getDBElements();
    els.previewEmpty.classList.remove('hidden');
    els.previewContent.classList.add('hidden');
}

function setupDeckBuilderFilterModal() {
    const els = getDBElements();

    const attributes = ['DARK', 'DIVINE', 'EARTH', 'FIRE', 'LIGHT', 'WATER', 'WIND'];
    const attrContainer = document.getElementById('db-attribute-filters');
    attrContainer.innerHTML = '';
    attributes.forEach(attr => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors';
        label.innerHTML = `<input type="checkbox" value="${attr}" class="text-blue-500 focus:ring-blue-500 bg-gray-700 border-gray-600 rounded"><span>${attr}</span>`;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) dbActiveFilters.attributes.add(attr);
            else dbActiveFilters.attributes.delete(attr);
        });
        attrContainer.appendChild(label);
    });

    const frameContainer = document.getElementById('db-frame-filters');
    frameContainer.innerHTML = '';
    const frameTypes = ['normal', 'effect', 'fusion', 'synchro', 'xyz', 'ritual', 'spell', 'trap'];
    frameTypes.forEach(ft => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors';
        const display = ft.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        label.innerHTML = `<input type="checkbox" value="${ft}" class="text-blue-500 focus:ring-blue-500 bg-gray-700 border-gray-600 rounded"><span>${display}</span>`;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) dbActiveFilters.frames.add(ft);
            else dbActiveFilters.frames.delete(ft);
        });
        frameContainer.appendChild(label);
    });

    const raceContainer = document.getElementById('db-race-filters');
    raceContainer.innerHTML = '';
    const uniqueRaces = [...new Set(allCards.map(c => c.race).filter(Boolean))].sort();
    uniqueRaces.forEach(race => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors';
        label.innerHTML = `<input type="checkbox" value="${race}" class="text-blue-500 focus:ring-blue-500 bg-gray-700 border-gray-600 rounded"><span>${race}</span>`;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) dbActiveFilters.races.add(race);
            else dbActiveFilters.races.delete(race);
        });
        raceContainer.appendChild(label);
    });

    const levelContainer = document.getElementById('db-level-filters');
    levelContainer.innerHTML = '';
    const uniqueLevels = [...new Set(allCards.map(c => c.level).filter(l => l != null))].sort((a, b) => a - b);
    uniqueLevels.forEach(lvl => {
        const btn = document.createElement('button');
        btn.className = 'px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors border border-transparent';
        btn.textContent = lvl;
        btn.addEventListener('click', () => {
            if (dbActiveFilters.levels.has(lvl)) {
                dbActiveFilters.levels.delete(lvl);
                btn.classList.remove('bg-blue-600', 'border-blue-400');
                btn.classList.add('bg-gray-700');
            } else {
                dbActiveFilters.levels.add(lvl);
                btn.classList.add('bg-blue-600', 'border-blue-400');
                btn.classList.remove('bg-gray-700');
            }
        });
        levelContainer.appendChild(btn);
    });

    const uniqueSpellTypes = [...new Set(allCards.filter(c => c.type === 'Spell Card').map(c => c.race).filter(Boolean))].sort();
    const spellTypeContainer = document.getElementById('db-spell-type-filters');
    if (spellTypeContainer) {
        spellTypeContainer.innerHTML = '';
        uniqueSpellTypes.forEach(st => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors';
            label.innerHTML = `<input type="checkbox" value="${st}" class="text-blue-500 focus:ring-blue-500 bg-gray-700 border-gray-600 rounded"><span>${st}</span>`;
            label.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) dbActiveFilters.spellTypes.add(st);
                else dbActiveFilters.spellTypes.delete(st);
            });
            spellTypeContainer.appendChild(label);
        });
    }

    const uniqueTrapTypes = [...new Set(allCards.filter(c => c.type === 'Trap Card').map(c => c.race).filter(Boolean))].sort();
    const trapTypeContainer = document.getElementById('db-trap-type-filters');
    if (trapTypeContainer) {
        trapTypeContainer.innerHTML = '';
        uniqueTrapTypes.forEach(tt => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors';
            label.innerHTML = `<input type="checkbox" value="${tt}" class="text-blue-500 focus:ring-blue-500 bg-gray-700 border-gray-600 rounded"><span>${tt}</span>`;
            label.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) dbActiveFilters.trapTypes.add(tt);
                else dbActiveFilters.trapTypes.delete(tt);
            });
            trapTypeContainer.appendChild(label);
        });
    }

    els.sortSelect.addEventListener('change', (e) => {
        deckbuilderSortMode = e.target.value;
        renderSearchResults();
    });

    const tagContainer = document.getElementById('db-tag-filters');
    if (tagContainer) {
        tagContainer.innerHTML = '';
        Object.values(availableTags).forEach(tag => {
            const label = document.createElement('label');
            label.className = 'flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors';
            label.innerHTML = `<input type="checkbox" value="${tag.name}" class="text-blue-500 focus:ring-blue-500 bg-gray-700 border-gray-600 rounded"><span>${tag.name}</span>`;
            label.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) dbActiveFilters.tags.add(tag.name);
                else dbActiveFilters.tags.delete(tag.name);
            });
            tagContainer.appendChild(label);
        });
    }

    const staplesCheckbox = document.getElementById('db-staples-filter');
    if (staplesCheckbox) {
        staplesCheckbox.addEventListener('change', (e) => {
            dbActiveFilters.staplesOnly = e.target.checked;
        });
    }

    const pointsMinInput = document.getElementById('db-points-min');
    const pointsMaxInput = document.getElementById('db-points-max');
    function readPointsInput() {
        const v1 = pointsMinInput?.value;
        const v2 = pointsMaxInput?.value;
        const p1 = v1 !== '' ? parseInt(v1, 10) : null;
        const p2 = v2 !== '' ? parseInt(v2, 10) : null;
        dbActiveFilters.pointsMin = p1 !== null && !isNaN(p1) ? p1 : null;
        dbActiveFilters.pointsMax = p2 !== null && !isNaN(p2) ? p2 : null;
    }
    if (pointsMinInput) {
        pointsMinInput.addEventListener('input', readPointsInput);
    }
    if (pointsMaxInput) {
        pointsMaxInput.addEventListener('input', readPointsInput);
    }

    const atkMinInput = document.getElementById('db-atk-min');
    const atkMaxInput = document.getElementById('db-atk-max');
    const defMinInput = document.getElementById('db-def-min');
    const defMaxInput = document.getElementById('db-def-max');
    function readAtkDefInput() {
        const a1 = atkMinInput?.value;
        const a2 = atkMaxInput?.value;
        const d1 = defMinInput?.value;
        const d2 = defMaxInput?.value;
        const p1 = a1 !== '' ? parseInt(a1, 10) : null;
        const p2 = a2 !== '' ? parseInt(a2, 10) : null;
        const p3 = d1 !== '' ? parseInt(d1, 10) : null;
        const p4 = d2 !== '' ? parseInt(d2, 10) : null;
        dbActiveFilters.atkMin = p1 !== null && !isNaN(p1) ? p1 : null;
        dbActiveFilters.atkMax = p2 !== null && !isNaN(p2) ? p2 : null;
        dbActiveFilters.defMin = p3 !== null && !isNaN(p3) ? p3 : null;
        dbActiveFilters.defMax = p4 !== null && !isNaN(p4) ? p4 : null;
    }
    if (atkMinInput) atkMinInput.addEventListener('input', readAtkDefInput);
    if (atkMaxInput) atkMaxInput.addEventListener('input', readAtkDefInput);
    if (defMinInput) defMinInput.addEventListener('input', readAtkDefInput);
    if (defMaxInput) defMaxInput.addEventListener('input', readAtkDefInput);
}

function setupDeckBuilderEvents() {
    if (deckBuilderEventsSetup) return;
    deckBuilderEventsSetup = true;

    const els = getDBElements();

    if (els.backBtn) els.backBtn.addEventListener('click', exitDeckBuilder);

    els.searchInput.addEventListener('input', (e) => {
        deckbuilderSearchQuery = e.target.value;
        renderSearchResults();
    });

    els.filterBtn.addEventListener('click', () => {
        els.filterModal.classList.remove('hidden');
    });

    if (els.filterApply) {
        els.filterApply.addEventListener('click', () => {
            readDeckBuilderFilters();
            els.filterModal.classList.add('hidden');
            updateDeckBuilderFilterIndicator();
            renderSearchResults();
        });
    }

    function readDeckBuilderFilters() {
        const cardTypeRadio = document.querySelector('input[name="db-card-type"]:checked');
        dbActiveFilters.cardType = cardTypeRadio ? cardTypeRadio.value || null : null;

        dbActiveFilters.attributes = new Set();
        document.querySelectorAll('#db-attribute-filters input[type="checkbox"]:checked').forEach(cb => {
            dbActiveFilters.attributes.add(cb.value);
        });

        dbActiveFilters.frames = new Set();
        document.querySelectorAll('#db-frame-filters input[type="checkbox"]:checked').forEach(cb => {
            dbActiveFilters.frames.add(cb.value);
        });

        dbActiveFilters.races = new Set();
        document.querySelectorAll('#db-race-filters input[type="checkbox"]:checked').forEach(cb => {
            dbActiveFilters.races.add(cb.value);
        });

        dbActiveFilters.levels = new Set();
        document.querySelectorAll('#db-level-filters button.bg-blue-600').forEach(btn => {
            dbActiveFilters.levels.add(parseInt(btn.textContent));
        });

        dbActiveFilters.tags = new Set();
        document.querySelectorAll('#db-tag-filters input[type="checkbox"]:checked').forEach(cb => {
            dbActiveFilters.tags.add(cb.value);
        });

        dbActiveFilters.spellTypes = new Set();
        document.querySelectorAll('#db-spell-type-filters input[type="checkbox"]:checked').forEach(cb => {
            dbActiveFilters.spellTypes.add(cb.value);
        });

        dbActiveFilters.trapTypes = new Set();
        document.querySelectorAll('#db-trap-type-filters input[type="checkbox"]:checked').forEach(cb => {
            dbActiveFilters.trapTypes.add(cb.value);
        });

        dbActiveFilters.staplesOnly = document.getElementById('db-staples-filter')?.checked || false;

        const pointsMin = document.getElementById('db-points-min')?.value;
        const pointsMax = document.getElementById('db-points-max')?.value;
        const p1 = pointsMin !== '' ? parseInt(pointsMin, 10) : null;
        const p2 = pointsMax !== '' ? parseInt(pointsMax, 10) : null;
        dbActiveFilters.pointsMin = p1 !== null && !isNaN(p1) ? p1 : null;
        dbActiveFilters.pointsMax = p2 !== null && !isNaN(p2) ? p2 : null;

        const atkMin = document.getElementById('db-atk-min')?.value;
        const atkMax = document.getElementById('db-atk-max')?.value;
        const a1 = atkMin !== '' ? parseInt(atkMin, 10) : null;
        const a2 = atkMax !== '' ? parseInt(atkMax, 10) : null;
        dbActiveFilters.atkMin = a1 !== null && !isNaN(a1) ? a1 : null;
        dbActiveFilters.atkMax = a2 !== null && !isNaN(a2) ? a2 : null;

        const defMin = document.getElementById('db-def-min')?.value;
        const defMax = document.getElementById('db-def-max')?.value;
        const d1 = defMin !== '' ? parseInt(defMin, 10) : null;
        const d2 = defMax !== '' ? parseInt(defMax, 10) : null;
        dbActiveFilters.defMin = d1 !== null && !isNaN(d1) ? d1 : null;
        dbActiveFilters.defMax = d2 !== null && !isNaN(d2) ? d2 : null;
    }

    els.filterModal.addEventListener('click', (e) => {
        if (e.target === els.filterModal) {
            readDeckBuilderFilters();
            els.filterModal.classList.add('hidden');
            updateDeckBuilderFilterIndicator();
            renderSearchResults();
        }
    });

    els.filterReset.addEventListener('click', () => {
        dbActiveFilters = { cardType: null, attributes: new Set(), frames: new Set(), races: new Set(), levels: new Set(), tags: new Set(), staplesOnly: false, spellTypes: new Set(), trapTypes: new Set(), pointsMin: null, pointsMax: null, atkMin: null, atkMax: null, defMin: null, defMax: null };
        dbDescTerms = [];
        deckbuilderSortMode = 'name-asc';

        document.querySelectorAll('input[name="db-card-type"]').forEach(r => r.checked = r.value === '');
        document.querySelectorAll('#db-attribute-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#db-frame-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#db-race-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#db-level-filters button').forEach(btn => {
            btn.classList.remove('bg-blue-600', 'border-blue-400');
            btn.classList.add('bg-gray-700');
        });
        document.querySelectorAll('#db-tag-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#db-spell-type-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#db-trap-type-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.getElementById('db-staples-filter').checked = false;
        document.getElementById('db-points-min').value = '';
        document.getElementById('db-points-max').value = '';
        document.getElementById('db-atk-min').value = '';
        document.getElementById('db-atk-max').value = '';
        document.getElementById('db-def-min').value = '';
        document.getElementById('db-def-max').value = '';

        els.descTerms.innerHTML = `<div class="flex items-center gap-2 desc-term">
            <input type="text" placeholder="Search term..." class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="and">AND</option>
                <option value="or">OR</option>
                <option value="not">NOT</option>
            </select>
            <button class="deckbuilder-remove-term p-1 hover:bg-gray-700 rounded transition-colors">
                <i data-lucide="x" class="w-3.5 h-3.5 text-gray-500"></i>
            </button>
        </div>`;

        els.sortSelect.value = 'name-asc';

        updateDeckBuilderFilterIndicator();
        renderSearchResults();
        lucide.createIcons();
    });

    document.querySelectorAll('input[name="db-card-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            dbActiveFilters.cardType = e.target.value || null;
        });
    });

    els.addTermBtn.addEventListener('click', () => {
        const termDiv = document.createElement('div');
        termDiv.className = 'flex items-center gap-2 desc-term';
        termDiv.innerHTML = `
            <input type="text" placeholder="Search term..." class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="and">AND</option>
                <option value="or">OR</option>
                <option value="not">NOT</option>
            </select>
            <button class="deckbuilder-remove-term p-1 hover:bg-gray-700 rounded transition-colors">
                <i data-lucide="x" class="w-3.5 h-3.5 text-gray-500"></i>
            </button>
        `;
        termDiv.querySelector('.deckbuilder-remove-term').addEventListener('click', () => {
            termDiv.remove();
        });
        els.descTerms.appendChild(termDiv);
        lucide.createIcons();
    });

    els.descTerms.addEventListener('click', (e) => {
        if (e.target.closest('.deckbuilder-remove-term')) {
            e.target.closest('.desc-term').remove();
        }
    });

    // Export
    els.exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        els.exportDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        els.exportDropdown.classList.add('hidden');
    }, { once: false });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#deckbuilder-export-btn')) {
            els.exportDropdown.classList.add('hidden');
        }
    });

    els.exportYdk.addEventListener('click', exportYDK);
    els.exportYdke.addEventListener('click', exportYDKE);
    els.exportTxt.addEventListener('click', exportTXT);

    function updateSortButtonLabel() {
        els.sortBtn.textContent = deckSortMode === 'type' ? 'Sort: Type ▼' : deckSortMode === 'name' ? 'Sort: A-Z ▼' : 'Sort ▼';
    }

    els.sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        els.sortDropdown.classList.toggle('hidden');
        els.exportDropdown.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#deckbuilder-sort-btn')) {
            els.sortDropdown.classList.add('hidden');
        }
    });

    els.sortType.addEventListener('click', () => {
        els.sortDropdown.classList.add('hidden');
        sortDeck('type');
        updateSortButtonLabel();
    });

    els.sortName.addEventListener('click', () => {
        els.sortDropdown.classList.add('hidden');
        sortDeck('name');
        updateSortButtonLabel();
    });

    updateSortButtonLabel();

    els.clearBtn.addEventListener('click', () => {
        clearDeck();
        renderDeck();
        renderSearchResults();
        updateSortButtonLabel();
    });

    // Mobile preview close
    els.mobilePreviewClose.addEventListener('click', () => {
        els.mobilePreview.classList.remove('active');
    });

    document.addEventListener('dragend', () => {
        document.querySelectorAll('.deck-card-slot.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    });

    function updateDeckBuilderFilterIndicator() {
        const active =
            dbActiveFilters.cardType ||
            dbActiveFilters.attributes.size > 0 ||
            dbActiveFilters.frames.size > 0 ||
            dbActiveFilters.races.size > 0 ||
            dbActiveFilters.levels.size > 0 ||
            dbActiveFilters.tags.size > 0 ||
            dbActiveFilters.spellTypes.size > 0 ||
            dbActiveFilters.trapTypes.size > 0 ||
            dbActiveFilters.pointsMin !== null ||
            dbActiveFilters.pointsMax !== null ||
            dbActiveFilters.atkMin !== null ||
            dbActiveFilters.atkMax !== null ||
            dbActiveFilters.defMin !== null ||
            dbActiveFilters.defMax !== null ||
            dbActiveFilters.staplesOnly ||
            dbDescTerms.length > 0;
        els.filterBtn.classList.toggle('deckbuilder-filter-active', active);
    }

    setupDeckBuilderFilterModal();
    updateDeckBuilderFilterIndicator();
}

function exportYDK() {
    const lines = ['#main'];
    for (const id of currentDeck.main) {
        lines.push(String(id));
    }
    lines.push('#extra');
    for (const id of currentDeck.extra) {
        lines.push(String(id));
    }
    lines.push('!side');
    for (const id of currentDeck.side) {
        lines.push(String(id));
    }

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deck.ydk';
    a.click();
    URL.revokeObjectURL(url);
    getDBElements().exportDropdown.classList.add('hidden');
    showToast('YDK exported', 'success');
}

function exportYDKE() {
    const encodeSection = (cardIds) => {
        if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
            return '';
        }

        const byteArray = new Uint8Array(cardIds.length * 4);

        for (let i = 0; i < cardIds.length; i++) {
            const numId = Number(cardIds[i]);
            if (isNaN(numId)) continue;

            const offset = i * 4;
            byteArray[offset]     = numId & 0xFF;
            byteArray[offset + 1] = (numId >> 8) & 0xFF;
            byteArray[offset + 2] = (numId >> 16) & 0xFF;
            byteArray[offset + 3] = (numId >> 24) & 0xFF;
        }

        let binaryString = '';
        for (let i = 0; i < byteArray.length; i++) {
            binaryString += String.fromCharCode(byteArray[i]);
        }

        return btoa(binaryString);
    };

    const url = `ydke://${encodeSection(currentDeck.main)}!${encodeSection(currentDeck.extra)}!${encodeSection(currentDeck.side)}!`;

    const done = () => {
        getDBElements().exportDropdown.classList.add('hidden');
        showToast('YDKE URL copied', 'success');
    };

    const fallbackCopy = (text) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } catch (e) {}
        document.body.removeChild(textarea);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => {
            fallbackCopy(url);
            done();
        });
    } else {
        fallbackCopy(url);
        done();
    }
}

function exportTXT() {
    const sections = [
        { title: 'Main Deck', cards: currentDeck.main },
        { title: 'Extra Deck', cards: currentDeck.extra },
        { title: 'Side Deck', cards: currentDeck.side },
    ];

    const lines = [];
    for (const section of sections) {
        if (section.cards.length === 0) continue;
        lines.push(`--- ${section.title} ---`);

        const grouped = new Map();
        for (const id of section.cards) {
            const card = getCardById(id);
            if (card) grouped.set(card.name, (grouped.get(card.name) || 0) + 1);
        }

        for (const [name, count] of grouped) {
            lines.push(`${count}x ${name}`);
        }
        lines.push('');
    }

    const content = lines.join('\n').trim();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deck.txt';
    a.click();
    URL.revokeObjectURL(url);
    getDBElements().exportDropdown.classList.add('hidden');
    showToast('TXT exported', 'success');
}

// Deck builder toggle button listener
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('deckbuilder-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            if (isDeckBuilder) {
                exitDeckBuilder();
            } else {
                enterDeckBuilder();
            }
        });
    }
});

// Start the app
init();

// Set up mobile filters after initialization and handle responsive behavior
document.addEventListener('DOMContentLoaded', () => {
    handleResize(); // Set initial state based on screen size
    
    // Listen for resize events to handle orientation changes and window resizing
    window.addEventListener('resize', handleResize);
    
    // Initialize card usage tracking after app initialization
    initializeTrackedCards();
    loadDecklistFormats();
});
