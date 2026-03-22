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

const LIST_BUILD_VERSION = "2026-03-22-02-23";
const CARD_BUILD_VERSION = "2026-03-19-11-23";

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

        // load other lists on demand
    } catch (error) {
    }
}

// Load custom tags
async function loadCustomTags() {
    try {
        // Load all tag files from the tags directory
        const tagFiles = ['hand_trap', 'board_breaker'];
        
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
    isBrowseView = force !== null ? force : !isBrowseView;
    
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
        
        // Update browse toggle button state
        browseToggleBtn.classList.add('bg-blue-600', 'border-blue-400', 'shadow-lg', 'shadow-blue-500/30');
        browseToggleBtn.classList.remove('bg-gray-700', 'border-gray-600');
        
        renderCategoryBrowser();
    } else {
        // Reset to main view
        categoryBrowser.classList.add('hidden');
        showAllCards();
        
        // Reset filters
        resetAllFilters();
        
        // Show filters, card grid, and loading sentinel
        if (window.innerWidth >= 768) { // Only on desktop
            filtersSidebar.classList.remove('hidden');
        } else {
            // On mobile, keep filters hidden by default but available via toggle
            filtersSidebar.classList.add('hidden');
        }
        cardGrid.classList.remove('hidden');
        loadingSentinel.classList.remove('hidden');
        
        // Update browse toggle button state
        browseToggleBtn.classList.remove('bg-blue-600', 'border-blue-400', 'shadow-lg', 'shadow-blue-500/30');
        browseToggleBtn.classList.add('bg-gray-700', 'border-gray-600');
    }
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
    currentList = listId;
    const listData = availableLists[listId];

    // Hide browser and sidebar
    categoryBrowser.classList.add('hidden');
    filtersSidebar.classList.add('hidden');

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

    // Update list toggle button appearance - active state
    if (listToggle) {
        if (currentList === '0-point-staples') {
            listToggle.classList.add('bg-blue-600', 'border-blue-400', 'shadow-lg', 'shadow-blue-500/30');
            listToggle.classList.remove('bg-gray-700', 'border-gray-600');
        } else {
            listToggle.classList.remove('bg-blue-600', 'border-blue-400', 'shadow-lg', 'shadow-blue-500/30');
            listToggle.classList.add('bg-gray-700', 'border-gray-600');
        }
    }
}

// Show all cards (exit list view)
function showAllCards() {
    currentList = null;
    searchInput.placeholder = 'Search cards...';
    
    // Hide list info header
    listInfoHeader.classList.add('hidden');

    // Show sidebar on desktop
    if (!isBrowseView && window.innerWidth >= 768) {
        filtersSidebar.classList.remove('hidden');
    } else if (!isBrowseView && window.innerWidth < 768) {
        // On mobile, keep filters hidden by default but available via toggle
        filtersSidebar.classList.add('hidden');
    }

    // Update list toggle button appearance - inactive state
    if (listToggle) {
        listToggle.classList.remove('bg-blue-600', 'border-blue-400', 'shadow-lg', 'shadow-blue-500/30');
        listToggle.classList.add('bg-gray-700', 'border-gray-600');
    }

    // Show tag filter bar in main browsing view (not in category view)
    if (!isBrowseView) {
        tagFilterBar.classList.remove('hidden');
    } else {
        tagFilterBar.classList.add('hidden');
    }

    applyFiltersAndSort();
}

// Cache for loaded chunks to avoid repeated fetches
const chunkCache = new Map();
let recentlyViewedChunks = new Set(); // Track recently accessed chunks

// Cache expiration time
const CACHE_EXPIRATION_TIME = 30 * 60 * 1000;

// Enhanced cache entry with timestamp
class CacheEntry {
    constructor(data, timestamp = Date.now()) {
        this.data = data;
        this.timestamp = timestamp;
    }
    
    isExpired() {
        return (Date.now() - this.timestamp) > CACHE_EXPIRATION_TIME;
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
        if (!cacheEntry || cacheEntry.isExpired()) {
            try {
                const response = await fetch(`${chunkFile}?v=${CARD_BUILD_VERSION}`);
                if (response.ok) {
                    const chunk = await response.json();
                    chunkCache.set(chunkFile, new CacheEntry(chunk));
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
            chunkCache.set(chunkPath, new CacheEntry(chunk));
            
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
    document.getElementById('home-link').addEventListener('click', (e) => {
        e.preventDefault();
        showAllCards();
        searchInput.value = '';
        searchQuery = '';
    });

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
    rootMargin: '200px', // Start loading when 200px away from viewport
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

// Start the app
init();

// Set up mobile filters after initialization and handle responsive behavior
document.addEventListener('DOMContentLoaded', () => {
    handleResize(); // Set initial state based on screen size
    
    // Listen for resize events to handle orientation changes and window resizing
    window.addEventListener('resize', handleResize);
});
