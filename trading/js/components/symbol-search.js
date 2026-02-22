// Advanced Symbol Search Component - Production Ready

import { api } from '../api.js';
import { debounce, escapeHtml } from '../utils.js';

export function createSymbolSearch(container, { 
    onSelect, 
    placeholder = 'Search stocks, ETFs, crypto...',
    showRecent = true,
    maxResults = 10
}) {
    let isDestroyed = false;
    let searchResults = [];
    let recentSearches = [];
    let selectedIndex = -1;
    let isLoading = false;
    let currentQuery = '';
    let cache = new Map();
    let cacheExpiry = new Map();
    
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    const RECENT_SEARCHES_KEY = 'trading_recent_searches';
    
    // Load recent searches from localStorage
    loadRecentSearches();
    
    // Create the search HTML structure
    const searchHTML = `
        <div class="symbol-search">
            <div class="symbol-search__input-wrapper">
                <i class="fas fa-search symbol-search__icon"></i>
                <input 
                    type="text" 
                    class="symbol-search__input form-input" 
                    placeholder="${escapeHtml(placeholder)}"
                    autocomplete="off"
                    spellcheck="false"
                >
                <div class="symbol-search__spinner" style="display: none;">
                    <div class="spinner spinner-sm"></div>
                </div>
                <button type="button" class="symbol-search__clear" style="display: none;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="symbol-search__dropdown" style="display: none;">
                <div class="symbol-search__results"></div>
            </div>
        </div>
    `;
    
    container.innerHTML = searchHTML;
    
    // Get DOM elements
    const searchWrapper = container.querySelector('.symbol-search');
    const input = container.querySelector('.symbol-search__input');
    const dropdown = container.querySelector('.symbol-search__dropdown');
    const resultsContainer = container.querySelector('.symbol-search__results');
    const spinner = container.querySelector('.symbol-search__spinner');
    const icon = container.querySelector('.symbol-search__icon');
    const clearBtn = container.querySelector('.symbol-search__clear');
    
    // Debounced search function
    const debouncedSearch = debounce(async (query) => {
        if (isDestroyed) return;
        
        currentQuery = query.trim();
        
        if (!currentQuery) {
            if (showRecent) {
                showRecentSearches();
            } else {
                hideDropdown();
            }
            return;
        }
        
        // Check cache first
        const cacheKey = currentQuery.toLowerCase();
        if (cache.has(cacheKey) && cacheExpiry.get(cacheKey) > Date.now()) {
            searchResults = cache.get(cacheKey);
            selectedIndex = -1;
            renderResults();
            showDropdown();
            return;
        }
        
        try {
            setLoading(true);
            const response = await api.get('/market/search', { 
                q: currentQuery,
                limit: maxResults
            });
            
            if (isDestroyed) return;
            
            searchResults = (response.symbols || response || [])
                .slice(0, maxResults)
                .map(symbol => ({
                    symbol: symbol.symbol,
                    name: symbol.name || symbol.company_name || 'Unknown Company',
                    exchange: symbol.exchange || 'NASDAQ',
                    type: symbol.type || 'stock',
                    ...symbol
                }));
                
            selectedIndex = -1;
            
            // Cache the results
            cache.set(cacheKey, searchResults);
            cacheExpiry.set(cacheKey, Date.now() + CACHE_DURATION);
            
            renderResults();
            showDropdown();
            
        } catch (error) {
            if (isDestroyed) return;
            
            console.error('Symbol search error:', error);
            searchResults = [];
            renderError('Search failed. Please check your connection and try again.');
            showDropdown();
        } finally {
            if (!isDestroyed) {
                setLoading(false);
            }
        }
    }, 300);
    
    // Event listeners
    input.addEventListener('input', (e) => {
        const query = e.target.value;
        updateClearButton(query);
        debouncedSearch(query);
    });
    
    input.addEventListener('focus', () => {
        if (currentQuery) {
            if (searchResults.length > 0) {
                showDropdown();
            }
        } else if (showRecent && recentSearches.length > 0) {
            showRecentSearches();
        }
    });
    
    input.addEventListener('keydown', handleKeyDown);
    
    clearBtn.addEventListener('click', () => {
        input.value = '';
        currentQuery = '';
        searchResults = [];
        updateClearButton('');
        hideDropdown();
        input.focus();
    });
    
    // Click outside to close dropdown
    document.addEventListener('click', handleOutsideClick);
    
    function loadRecentSearches() {
        try {
            const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
            recentSearches = stored ? JSON.parse(stored) : [];
        } catch (error) {
            recentSearches = [];
        }
    }
    
    function saveRecentSearches() {
        try {
            localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches));
        } catch (error) {
            // Ignore storage errors
        }
    }
    
    function addToRecent(symbolData) {
        if (!showRecent) return;
        
        // Remove if already exists
        recentSearches = recentSearches.filter(item => item.symbol !== symbolData.symbol);
        
        // Add to beginning
        recentSearches.unshift({
            symbol: symbolData.symbol,
            name: symbolData.name,
            exchange: symbolData.exchange,
            timestamp: Date.now()
        });
        
        // Keep only last 10
        recentSearches = recentSearches.slice(0, 10);
        
        saveRecentSearches();
    }
    
    function clearRecentSearches() {
        recentSearches = [];
        saveRecentSearches();
        hideDropdown();
    }
    
    function handleKeyDown(e) {
        if (!dropdown.style.display || dropdown.style.display === 'none') {
            return;
        }
        
        const results = getCurrentResults();
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
                updateSelection();
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                updateSelection();
                break;
                
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < results.length) {
                    selectSymbol(results[selectedIndex]);
                }
                break;
                
            case 'Escape':
                hideDropdown();
                input.blur();
                break;
                
            case 'Tab':
                // Allow tab to close dropdown but don't prevent default
                hideDropdown();
                break;
        }
    }
    
    function handleOutsideClick(e) {
        if (!searchWrapper.contains(e.target)) {
            hideDropdown();
        }
    }
    
    function getCurrentResults() {
        return currentQuery ? searchResults : recentSearches;
    }
    
    function setLoading(loading) {
        isLoading = loading;
        if (loading) {
            spinner.style.display = 'flex';
            icon.style.display = 'none';
        } else {
            spinner.style.display = 'none';
            icon.style.display = 'block';
        }
    }
    
    function updateClearButton(query) {
        clearBtn.style.display = query ? 'flex' : 'none';
    }
    
    function showDropdown() {
        dropdown.style.display = 'block';
        searchWrapper.classList.add('active');
    }
    
    function hideDropdown() {
        dropdown.style.display = 'none';
        searchWrapper.classList.remove('active');
        selectedIndex = -1;
    }
    
    function showRecentSearches() {
        if (recentSearches.length === 0) return;
        
        searchResults = [];
        selectedIndex = -1;
        renderRecentSearches();
        showDropdown();
    }
    
    function renderResults() {
        if (searchResults.length === 0) {
            renderEmpty();
            return;
        }
        
        const resultsHTML = searchResults.map((symbol, index) => `
            <div class="symbol-search__result ${index === selectedIndex ? 'selected' : ''}" 
                 data-index="${index}"
                 role="option"
                 tabindex="-1">
                <div class="symbol-search__result-main">
                    <div class="symbol-search__result-symbol">
                        ${escapeHtml(symbol.symbol)}
                        <span class="symbol-search__result-type">${escapeHtml(symbol.type?.toUpperCase() || 'STOCK')}</span>
                    </div>
                    <div class="symbol-search__result-name">${escapeHtml(symbol.name)}</div>
                </div>
                <div class="symbol-search__result-meta">
                    <span class="symbol-search__result-exchange">${escapeHtml(symbol.exchange)}</span>
                    <i class="fas fa-plus symbol-search__result-add"></i>
                </div>
            </div>
        `).join('');
        
        resultsContainer.innerHTML = resultsHTML;
        bindResultEvents();
    }
    
    function renderRecentSearches() {
        const resultsHTML = `
            <div class="symbol-search__section-header">
                <span class="section-title">
                    <i class="fas fa-history"></i>
                    Recent Searches
                </span>
                <button class="section-action" id="clear-recent">
                    <i class="fas fa-trash-alt"></i>
                    Clear
                </button>
            </div>
            ${recentSearches.map((symbol, index) => `
                <div class="symbol-search__result recent-result ${index === selectedIndex ? 'selected' : ''}" 
                     data-index="${index}"
                     role="option"
                     tabindex="-1">
                    <div class="symbol-search__result-main">
                        <div class="symbol-search__result-symbol">
                            ${escapeHtml(symbol.symbol)}
                        </div>
                        <div class="symbol-search__result-name">${escapeHtml(symbol.name)}</div>
                    </div>
                    <div class="symbol-search__result-meta">
                        <span class="symbol-search__result-exchange">${escapeHtml(symbol.exchange)}</span>
                        <i class="fas fa-clock symbol-search__result-recent"></i>
                    </div>
                </div>
            `).join('')}
        `;
        
        resultsContainer.innerHTML = resultsHTML;
        bindResultEvents();
        
        // Bind clear recent button
        const clearRecentBtn = resultsContainer.querySelector('#clear-recent');
        if (clearRecentBtn) {
            clearRecentBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearRecentSearches();
            });
        }
    }
    
    function renderEmpty() {
        resultsContainer.innerHTML = `
            <div class="symbol-search__empty">
                <i class="fas fa-search"></i>
                <span>No symbols found for "${escapeHtml(currentQuery)}"</span>
                <small>Try a different search term or stock symbol</small>
            </div>
        `;
    }
    
    function renderError(message) {
        resultsContainer.innerHTML = `
            <div class="symbol-search__error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${escapeHtml(message)}</span>
                <button class="retry-search" onclick="this.parentElement.parentElement.previousElementSibling.querySelector('input').dispatchEvent(new Event('input'))">
                    <i class="fas fa-redo"></i>
                    Try Again
                </button>
            </div>
        `;
    }
    
    function bindResultEvents() {
        const resultElements = resultsContainer.querySelectorAll('.symbol-search__result');
        resultElements.forEach((el, index) => {
            el.addEventListener('click', () => {
                const results = getCurrentResults();
                if (results[index]) {
                    selectSymbol(results[index]);
                }
            });
            
            el.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateSelection();
            });
        });
    }
    
    function updateSelection() {
        const resultElements = resultsContainer.querySelectorAll('.symbol-search__result');
        resultElements.forEach((el, index) => {
            el.classList.toggle('selected', index === selectedIndex);
        });
        
        // Scroll selected item into view
        if (selectedIndex >= 0 && selectedIndex < resultElements.length) {
            resultElements[selectedIndex].scrollIntoView({
                block: 'nearest',
                behavior: 'smooth'
            });
        }
    }
    
    function selectSymbol(symbolData) {
        hideDropdown();
        input.value = symbolData.symbol;
        currentQuery = symbolData.symbol;
        searchResults = [];
        updateClearButton(symbolData.symbol);
        
        // Add to recent searches
        addToRecent(symbolData);
        
        // Call the selection callback
        if (onSelect) {
            onSelect(symbolData.symbol, symbolData);
        }
        
        // Clear the input after a short delay for better UX
        setTimeout(() => {
            if (!isDestroyed) {
                input.value = '';
                currentQuery = '';
                updateClearButton('');
            }
        }, 1000);
    }
    
    // Public methods
    function setQuery(query) {
        if (isDestroyed) return;
        
        input.value = query;
        currentQuery = query;
        updateClearButton(query);
        
        if (query) {
            debouncedSearch(query);
        }
    }
    
    function focus() {
        if (!isDestroyed) {
            input.focus();
        }
    }
    
    function blur() {
        if (!isDestroyed) {
            input.blur();
            hideDropdown();
        }
    }
    
    // Return cleanup function
    function destroy() {
        isDestroyed = true;
        document.removeEventListener('click', handleOutsideClick);
        
        // Clear cache and timers
        cache.clear();
        cacheExpiry.clear();
    }
    
    return destroy;
}

// Enhanced styles for the symbol search component
if (!document.getElementById('symbol-search-enhanced-styles')) {
    const enhancedStyles = `
        .symbol-search {
            position: relative;
            width: 100%;
            font-family: var(--font-family);
        }

        .symbol-search__input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
        }

        .symbol-search__icon {
            position: absolute;
            left: var(--space-3);
            color: var(--text-secondary);
            z-index: 1;
            pointer-events: none;
            transition: color var(--duration-fast);
        }

        .symbol-search.active .symbol-search__icon {
            color: var(--accent);
        }

        .symbol-search__input {
            width: 100%;
            padding: var(--space-3) var(--space-12) var(--space-3) calc(var(--space-3) + 1.25rem + var(--space-2));
            border: 2px solid var(--border);
            border-radius: var(--radius-lg);
            font-size: 1rem;
            font-weight: 500;
            background: var(--input-bg);
            color: var(--text-primary);
            transition: all var(--duration-medium);
        }

        .symbol-search__input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
            background: var(--card-bg);
        }

        .symbol-search__input::placeholder {
            color: var(--text-secondary);
            opacity: 0.7;
        }

        .symbol-search__spinner {
            position: absolute;
            right: calc(var(--space-10) + var(--space-2));
            color: var(--accent);
            display: flex;
            align-items: center;
        }

        .symbol-search__clear {
            position: absolute;
            right: var(--space-3);
            width: 32px;
            height: 32px;
            border: none;
            background: var(--bg-secondary);
            color: var(--text-secondary);
            border-radius: var(--radius-md);
            cursor: pointer;
            display: none;
            align-items: center;
            justify-content: center;
            transition: all var(--duration-fast);
        }

        .symbol-search__clear:hover {
            background: var(--border);
            color: var(--text-primary);
        }

        .symbol-search__dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            z-index: var(--z-dropdown);
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-xl);
            margin-top: var(--space-2);
            max-height: 400px;
            overflow-y: auto;
            backdrop-filter: blur(8px);
        }

        .symbol-search__dropdown::-webkit-scrollbar {
            width: 6px;
        }

        .symbol-search__dropdown::-webkit-scrollbar-track {
            background: var(--bg-secondary);
            border-radius: var(--radius-sm);
        }

        .symbol-search__dropdown::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: var(--radius-sm);
        }

        .symbol-search__dropdown::-webkit-scrollbar-thumb:hover {
            background: var(--text-secondary);
        }

        .symbol-search__section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-3) var(--space-4);
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .section-title {
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .section-action {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-1) var(--space-2);
            border: none;
            background: transparent;
            color: var(--text-secondary);
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 0.75rem;
            transition: all var(--duration-fast);
        }

        .section-action:hover {
            background: var(--border);
            color: var(--danger);
        }

        .symbol-search__results {
            padding: var(--space-2) 0;
        }

        .symbol-search__result {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-3) var(--space-4);
            cursor: pointer;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            transition: all var(--duration-fast);
            position: relative;
        }

        .symbol-search__result:last-child {
            border-bottom: none;
        }

        .symbol-search__result:hover,
        .symbol-search__result.selected {
            background: var(--bg-secondary);
        }

        .symbol-search__result.selected {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.2);
        }

        .symbol-search__result.recent-result {
            border-left: 3px solid var(--warning);
            background: rgba(251, 191, 36, 0.05);
        }

        .symbol-search__result-main {
            flex: 1;
            min-width: 0;
        }

        .symbol-search__result-symbol {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-weight: 700;
            color: var(--text-primary);
            font-size: 0.875rem;
            margin-bottom: var(--space-1);
        }

        .symbol-search__result-type {
            background: var(--accent);
            color: white;
            padding: 2px var(--space-1);
            border-radius: var(--radius-sm);
            font-size: 0.625rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .symbol-search__result-name {
            font-size: 0.75rem;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.2;
        }

        .symbol-search__result-meta {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            flex-shrink: 0;
        }

        .symbol-search__result-exchange {
            font-size: 0.75rem;
            color: var(--text-secondary);
            background: var(--bg-secondary);
            padding: var(--space-1) var(--space-2);
            border-radius: var(--radius-sm);
            font-weight: 500;
        }

        .symbol-search__result-add,
        .symbol-search__result-recent {
            color: var(--text-secondary);
            opacity: 0.5;
            transition: all var(--duration-fast);
        }

        .symbol-search__result:hover .symbol-search__result-add {
            color: var(--accent);
            opacity: 1;
            transform: scale(1.1);
        }

        .symbol-search__result-recent {
            color: var(--warning);
            opacity: 0.7;
        }

        .symbol-search__empty,
        .symbol-search__error {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
            padding: var(--space-8) var(--space-4);
            color: var(--text-secondary);
            font-size: 0.875rem;
            text-align: center;
        }

        .symbol-search__error {
            color: var(--danger);
        }

        .symbol-search__empty i,
        .symbol-search__error i {
            font-size: 2rem;
            opacity: 0.3;
            margin-bottom: var(--space-2);
        }

        .symbol-search__empty small {
            font-size: 0.75rem;
            opacity: 0.7;
            margin-top: var(--space-1);
        }

        .retry-search {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            margin-top: var(--space-2);
            padding: var(--space-2) var(--space-3);
            border: 1px solid var(--danger);
            background: transparent;
            color: var(--danger);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 0.75rem;
            font-weight: 500;
            transition: all var(--duration-fast);
        }

        .retry-search:hover {
            background: var(--danger);
            color: white;
        }

        /* Animation for result appearance */
        .symbol-search__result {
            animation: slideInUp 0.2s ease-out;
        }

        @keyframes slideInUp {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* Responsive adjustments */
        @media (max-width: 640px) {
            .symbol-search__dropdown {
                max-height: 300px;
                border-radius: var(--radius-md);
            }
            
            .symbol-search__result {
                padding: var(--space-3);
            }

            .symbol-search__result-name {
                font-size: 0.7rem;
            }

            .symbol-search__input {
                font-size: 16px; /* Prevents zoom on iOS */
                padding: var(--space-3) var(--space-10) var(--space-3) calc(var(--space-3) + 1rem + var(--space-2));
            }
        }

        /* Dark mode enhancements */
        [data-theme="dark"] .symbol-search__dropdown {
            border-color: var(--border);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
        }

        [data-theme="dark"] .symbol-search__result:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        [data-theme="dark"] .symbol-search__result.selected {
            background: rgba(59, 130, 246, 0.15);
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'symbol-search-enhanced-styles';
    styleEl.textContent = enhancedStyles;
    document.head.appendChild(styleEl);
}