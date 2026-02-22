// Dashboard Page

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import modal from '../components/modal.js';
import { PortfolioCard } from '../components/portfolio-card.js';
import { createSymbolSearch } from '../components/symbol-search.js';
import { formatCurrency, formatPercent, escapeHtml } from '../utils.js';

function DashboardPage() {
    let unsubscribers = [];
    let symbolSearchCleanup = null;
    let portfolios = [];
    let watchlist = [];

    async function render(container) {
        // Initial render with loading state
        container.innerHTML = `
            <div class="dashboard">
                <div class="dashboard-header">
                    <div class="dashboard-title">
                        <div>
                            <h1>Welcome back, ${getCurrentUserDisplayName()}</h1>
                            <p class="dashboard-subtitle">Track your investments and practice trading</p>
                        </div>
                        <button class="btn btn-primary" id="create-portfolio-btn">
                            <i class="fas fa-plus"></i>
                            Create Portfolio
                        </button>
                    </div>
                </div>

                <div class="dashboard-layout">
                    <div class="main-section">
                        <div class="portfolios-section">
                            <div class="section-header">
                                <h2 class="section-title">Your Portfolios</h2>
                            </div>
                            <div class="portfolios-content" id="portfolios-content">
                                ${renderLoadingSkeleton()}
                            </div>
                        </div>
                    </div>

                    <div class="sidebar-section">
                        <div class="watchlist-section">
                            <div class="watchlist-header">
                                <h3 class="watchlist-title">Watchlist</h3>
                            </div>
                            
                            <div class="watchlist-add" id="watchlist-add-container">
                                <!-- Symbol search will be rendered here -->
                            </div>
                            
                            <div class="watchlist-content" id="watchlist-content">
                                ${renderWatchlistSkeleton()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Load initial data
        await Promise.all([
            loadPortfolios(),
            loadWatchlist()
        ]);

        // Update the welcome message with current user after rendering
        const user = store.getState('user');
        if (user?.display_name) {
            const h1 = container.querySelector('.dashboard h1');
            if (h1) h1.textContent = `Welcome back, ${user.display_name}`;
        }

        // Bind event listeners
        bindEventListeners();

        // Set up real-time updates
        setupStoreSubscriptions();

        // Initialize symbol search
        setupSymbolSearch();
    }

    function getCurrentUserDisplayName() {
        const user = store.getState('user');
        return user?.display_name || 'Trader';
    }

    async function loadPortfolios() {
        try {
            const response = await api.get('/portfolios');
            portfolios = response.portfolios || [];
            
            // Update store
            store.setState('portfolios', portfolios);
            
            renderPortfolios();
        } catch (error) {
            console.error('Failed to load portfolios:', error);
            renderPortfoliosError();
        }
    }

    async function loadWatchlist() {
        try {
            const response = await api.get('/watchlist');
            watchlist = response.watchlist || [];
            
            // Update store
            store.setState('watchlist', watchlist);
            
            await renderWatchlist();
        } catch (error) {
            console.error('Failed to load watchlist:', error);
            renderWatchlistError();
        }
    }

    function renderPortfolios() {
        const container = document.getElementById('portfolios-content');
        
        if (portfolios.length === 0) {
            container.innerHTML = renderEmptyPortfolios();
        } else {
            container.innerHTML = `
                <div class="portfolios-grid">
                    ${portfolios.map(portfolio => PortfolioCard(portfolio)).join('')}
                </div>
            `;
        }
    }

    async function renderWatchlist() {
        const container = document.getElementById('watchlist-content');
        
        if (watchlist.length === 0) {
            container.innerHTML = renderEmptyWatchlist();
        } else {
            // Show loading state first
            container.innerHTML = `
                <div class="watchlist-table-container">
                    <table class="watchlist-table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th>Price</th>
                                <th>Change</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${watchlist.map(item => renderWatchlistItemSkeleton(item)).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // Fetch quotes for all symbols and update display
            const watchlistWithQuotes = await Promise.all(
                watchlist.map(async (item) => {
                    try {
                        const response = await api.get(`/market/quote/${item.symbol}`);
                        return { ...item, quote: response.quote };
                    } catch (error) {
                        console.warn('Failed to fetch quote for', item.symbol, error);
                        return { ...item, quote: null };
                    }
                })
            );

            // Update with actual data
            container.innerHTML = `
                <div class="watchlist-table-container">
                    <table class="watchlist-table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th>Price</th>
                                <th>Change</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${watchlistWithQuotes.map(item => renderWatchlistItemWithData(item)).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    async function renderWatchlistItem(item) {
        // Fetch quote data for this symbol since API returns just symbol and added_at
        let quote = null;
        try {
            const response = await api.get(`/market/quote/${item.symbol}`);
            quote = response.quote;
        } catch (error) {
            console.warn('Failed to fetch quote for', item.symbol, error);
        }

        const price = quote?.price || 0;
        const change = quote?.change || 0;
        const changePercent = quote?.changePercent || 0;
        
        const formattedPrice = formatCurrency(price);
        const formattedChange = formatCurrency(change);
        const formattedPercent = formatPercent(changePercent);
        
        let changeClass = 'neutral';
        if (change > 0) changeClass = 'positive';
        else if (change < 0) changeClass = 'negative';

        return `
            <tr class="watchlist-row" data-symbol="${item.symbol}" onclick="viewSymbol('${item.symbol}')">
                <td class="watchlist-symbol">${escapeHtml(item.symbol)}</td>
                <td class="watchlist-price">${formattedPrice}</td>
                <td class="watchlist-change ${changeClass}">
                    <div class="change-display">
                        <span>${formattedChange}</span>
                        <span>(${formattedPercent.text})</span>
                    </div>
                </td>
                <td class="watchlist-action">
                    <button class="watchlist-remove" 
                            onclick="event.stopPropagation(); removeFromWatchlist('${item.symbol}')"
                            aria-label="Remove from watchlist">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    function renderWatchlistItemSkeleton(item) {
        return `
            <tr class="watchlist-row">
                <td class="watchlist-symbol">${escapeHtml(item.symbol)}</td>
                <td class="watchlist-price"><div class="skeleton skeleton-text"></div></td>
                <td class="watchlist-change"><div class="skeleton skeleton-text"></div></td>
                <td class="watchlist-action">
                    <button class="watchlist-remove" 
                            onclick="event.stopPropagation(); removeFromWatchlist('${item.symbol}')"
                            aria-label="Remove from watchlist">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    function renderWatchlistItemWithData(item) {
        const quote = item.quote;
        const price = quote?.price || 0;
        const change = quote?.change || 0;
        const changePercent = quote?.changePercent || 0;
        
        const formattedPrice = formatCurrency(price);
        const formattedChange = formatCurrency(change);
        const formattedPercent = formatPercent(changePercent);
        
        let changeClass = 'neutral';
        if (change > 0) changeClass = 'positive';
        else if (change < 0) changeClass = 'negative';

        return `
            <tr class="watchlist-row" data-symbol="${item.symbol}" onclick="viewSymbol('${item.symbol}')">
                <td class="watchlist-symbol">${escapeHtml(item.symbol)}</td>
                <td class="watchlist-price">${formattedPrice}</td>
                <td class="watchlist-change ${changeClass}">
                    <div class="change-display">
                        <span>${formattedChange}</span>
                        <span>(${formattedPercent.text})</span>
                    </div>
                </td>
                <td class="watchlist-action">
                    <button class="watchlist-remove" 
                            onclick="event.stopPropagation(); removeFromWatchlist('${item.symbol}')"
                            aria-label="Remove from watchlist">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    function renderLoadingSkeleton() {
        return `
            <div class="portfolios-grid">
                ${Array(3).fill(0).map(() => `
                    <div class="portfolio-card loading">
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text" style="width: 60%;"></div>
                        <div class="skeleton skeleton-button"></div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderWatchlistSkeleton() {
        return `
            <div class="watchlist-table-container">
                <table class="watchlist-table loading">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Price</th>
                            <th>Change</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Array(5).fill(0).map(() => `
                            <tr>
                                <td><div class="skeleton skeleton-text"></div></td>
                                <td><div class="skeleton skeleton-text"></div></td>
                                <td><div class="skeleton skeleton-text"></div></td>
                                <td><div class="skeleton skeleton-text"></div></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderEmptyPortfolios() {
        return `
            <div class="empty-portfolios">
                <div class="empty-portfolios-icon">📊</div>
                <h3>Create your first portfolio to start trading</h3>
                <p>Build and track your investment strategies with virtual money</p>
                <button class="btn btn-primary" onclick="showCreatePortfolioModal()">
                    <i class="fas fa-plus"></i>
                    Create Portfolio
                </button>
            </div>
        `;
    }

    function renderEmptyWatchlist() {
        return `
            <div class="empty-watchlist">
                <div class="empty-watchlist-icon">👀</div>
                <p>Add symbols to track them here</p>
            </div>
        `;
    }

    function renderPortfoliosError() {
        document.getElementById('portfolios-content').innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load portfolios</p>
                <button class="btn btn-secondary" onclick="retryLoadPortfolios()">
                    Retry
                </button>
            </div>
        `;
    }

    function renderWatchlistError() {
        document.getElementById('watchlist-content').innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load watchlist</p>
                <button class="btn btn-secondary" onclick="retryLoadWatchlist()">
                    Retry
                </button>
            </div>
        `;
    }

    function bindEventListeners() {
        // Create portfolio button
        const createPortfolioBtn = document.getElementById('create-portfolio-btn');
        if (createPortfolioBtn) {
            createPortfolioBtn.addEventListener('click', showCreatePortfolioModal);
        }
    }

    function setupStoreSubscriptions() {
        // Subscribe to user changes (update welcome message)
        unsubscribers.push(
            store.subscribe('user', (user) => {
                const h1 = document.querySelector('.dashboard h1');
                if (h1) h1.textContent = `Welcome back, ${user?.display_name || 'Trader'}`;
            })
        );

        // Subscribe to portfolio changes
        unsubscribers.push(
            store.subscribe('portfolios', (newPortfolios) => {
                portfolios = newPortfolios || [];
                renderPortfolios();
            })
        );

        // Subscribe to watchlist changes
        unsubscribers.push(
            store.subscribe('watchlist', async (newWatchlist) => {
                watchlist = newWatchlist || [];
                await renderWatchlist();
            })
        );
    }

    function setupSymbolSearch() {
        const container = document.getElementById('watchlist-add-container');
        if (container) {
            symbolSearchCleanup = createSymbolSearch(container, {
                placeholder: 'Add symbol to watchlist...',
                onSelect: async (symbol) => {
                    await addToWatchlist(symbol);
                }
            });
        }
    }

    function showCreatePortfolioModal() {
        modal.show({
            title: 'Create New Portfolio',
            content: `
                <form id="create-portfolio-form">
                    <div class="form-group">
                        <label class="form-label" for="portfolio-name">Portfolio Name</label>
                        <input type="text" 
                               id="portfolio-name" 
                               class="form-input" 
                               required 
                               placeholder="Enter portfolio name"
                               maxlength="50">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="starting-balance">Starting Balance</label>
                        <input type="number" 
                               id="starting-balance" 
                               class="form-input" 
                               required 
                               placeholder="100000"
                               value="100000"
                               min="1000"
                               max="10000000"
                               step="1000">
                        <div class="form-help">Virtual money for practice trading</div>
                    </div>
                </form>
            `,
            actions: [
                {
                    text: 'Cancel',
                    variant: 'secondary'
                },
                {
                    text: 'Create',
                    variant: 'primary',
                    onClick: async () => {
                        return await handleCreatePortfolio();
                    }
                }
            ]
        });

        // Focus the name input
        setTimeout(() => {
            const nameInput = document.getElementById('portfolio-name');
            if (nameInput) nameInput.focus();
        }, 100);
    }

    async function handleCreatePortfolio() {
        const nameInput = document.getElementById('portfolio-name');
        const balanceInput = document.getElementById('starting-balance');
        
        const name = nameInput.value.trim();
        const startingBalance = parseFloat(balanceInput.value);

        // Validation
        if (!name) {
            toast.error('Portfolio name is required');
            return false; // Don't close modal
        }

        if (name.length > 50) {
            toast.error('Portfolio name must be less than 50 characters');
            return false;
        }

        if (!startingBalance || startingBalance < 1000) {
            toast.error('Starting balance must be at least $1,000');
            return false;
        }

        if (startingBalance > 10000000) {
            toast.error('Starting balance must be less than $10,000,000');
            return false;
        }

        try {
            const response = await api.post('/portfolios', {
                name,
                starting_balance: startingBalance
            });

            // Add to local state
            const newPortfolio = response.portfolio;
            portfolios = [...portfolios, newPortfolio];
            store.setState('portfolios', portfolios);

            // Refresh portfolios display
            await loadPortfolios();

            toast.success(`Portfolio "${name}" created successfully!`);
            
            return true; // Close modal
        } catch (error) {
            console.error('Failed to create portfolio:', error);
            toast.error('Failed to create portfolio. Please try again.');
            return false; // Don't close modal
        }
    }

    async function addToWatchlist(symbol) {
        // Check if already in watchlist
        if (watchlist.find(item => item.symbol === symbol)) {
            toast.warning(`${symbol} is already in your watchlist`);
            return;
        }

        try {
            await api.post('/watchlist', { symbol });
            
            toast.success(`${symbol} added to watchlist`);
            
            // Refresh watchlist
            await loadWatchlist();
        } catch (error) {
            console.error('Failed to add to watchlist:', error);
            toast.error(`Failed to add ${symbol} to watchlist`);
        }
    }

    async function removeFromWatchlist(symbol) {
        try {
            await api.delete(`/watchlist/${symbol}`);
            
            toast.success(`${symbol} removed from watchlist`);
            
            // Update local state
            const updatedWatchlist = watchlist.filter(item => item.symbol !== symbol);
            store.setState('watchlist', updatedWatchlist);
        } catch (error) {
            console.error('Failed to remove from watchlist:', error);
            toast.error(`Failed to remove ${symbol} from watchlist`);
        }
    }

    function viewSymbol(symbol) {
        // Navigate to trading page with the symbol
        window.location.hash = `#/trade/${symbol}`;
    }

    // Global functions for event handlers
    window.showCreatePortfolioModal = showCreatePortfolioModal;
    
    window.removeFromWatchlist = (symbol) => {
        removeFromWatchlist(symbol);
    };
    
    window.viewSymbol = (symbol) => {
        viewSymbol(symbol);
    };
    
    window.retryLoadPortfolios = () => {
        loadPortfolios();
    };
    
    window.retryLoadWatchlist = () => {
        loadWatchlist();
    };

    function destroy() {
        // Clean up subscriptions
        unsubscribers.forEach(unsub => unsub());
        unsubscribers = [];

        // Clean up symbol search
        if (symbolSearchCleanup) {
            symbolSearchCleanup();
            symbolSearchCleanup = null;
        }

        // Clean up global functions
        if (window.showCreatePortfolioModal) delete window.showCreatePortfolioModal;
        if (window.removeFromWatchlist) delete window.removeFromWatchlist;
        if (window.viewSymbol) delete window.viewSymbol;
        if (window.retryLoadPortfolios) delete window.retryLoadPortfolios;
        if (window.retryLoadWatchlist) delete window.retryLoadWatchlist;
    }

    return { render, destroy };
}

// Export the page function
export default DashboardPage;

// Add dashboard page specific styles
if (!document.getElementById('dashboard-page-styles')) {
    const dashboardPageStyles = `
        .dashboard {
            max-width: var(--max-width-2xl);
            margin: 0 auto;
            padding: var(--space-6) var(--space-4);
        }

        .dashboard-header {
            margin-bottom: var(--space-8);
        }

        .dashboard-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-4);
            margin-bottom: var(--space-2);
        }

        .dashboard-title h1 {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0 0 var(--space-1) 0;
        }

        .dashboard-subtitle {
            color: var(--text-secondary);
            font-size: 1rem;
            margin: 0;
        }

        .dashboard-layout {
            display: grid;
            gap: var(--space-6);
            align-items: start;
        }

        @media (min-width: 1024px) {
            .dashboard-layout {
                grid-template-columns: 2fr 1fr;
            }
        }

        .portfolios-section {
            margin-bottom: var(--space-8);
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-6);
        }

        .section-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0;
        }

        .portfolios-grid {
            display: grid;
            gap: var(--space-4);
            grid-template-columns: 1fr;
        }

        @media (min-width: 768px) {
            .portfolios-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (min-width: 1200px) {
            .portfolios-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }

        .sidebar-section {
            position: sticky;
            top: var(--space-6);
        }

        .watchlist-section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
        }

        .watchlist-header {
            margin-bottom: var(--space-4);
        }

        .watchlist-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0;
        }

        .watchlist-add {
            margin-bottom: var(--space-4);
        }

        .watchlist-table-container {
            max-height: 500px;
            overflow-y: auto;
        }

        .watchlist-table {
            width: 100%;
            border-collapse: collapse;
        }

        .watchlist-table thead th {
            position: sticky;
            top: 0;
            background: var(--card-bg);
            padding: var(--space-2) var(--space-1);
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid var(--border);
            text-align: left;
        }

        .watchlist-table tbody td {
            padding: var(--space-3) var(--space-1);
            border-bottom: 1px solid var(--border);
            font-size: 0.875rem;
        }

        .watchlist-row {
            cursor: pointer;
            transition: background var(--transition-fast);
        }

        .watchlist-row:hover {
            background: var(--bg-secondary);
        }

        .watchlist-row:last-child td {
            border-bottom: none;
        }

        .watchlist-symbol {
            font-weight: 600;
            color: var(--text-primary);
        }

        .watchlist-price {
            font-weight: 500;
            color: var(--text-primary);
            text-align: right;
        }

        .watchlist-change {
            text-align: right;
            font-weight: 500;
        }

        .watchlist-change.positive {
            color: var(--success);
        }

        .watchlist-change.negative {
            color: var(--danger);
        }

        .watchlist-change.neutral {
            color: var(--text-secondary);
        }

        .change-display {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 1px;
        }

        .change-display span:last-child {
            font-size: 0.75rem;
            opacity: 0.8;
        }

        .watchlist-action {
            text-align: center;
        }

        .watchlist-remove {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: var(--space-1);
            border-radius: var(--radius-sm);
            transition: all var(--transition-fast);
            opacity: 0;
        }

        .watchlist-row:hover .watchlist-remove {
            opacity: 1;
        }

        .watchlist-remove:hover {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }

        /* Empty states */
        .empty-portfolios {
            grid-column: 1 / -1;
            text-align: center;
            padding: var(--space-12) var(--space-4);
        }

        .empty-portfolios-icon {
            font-size: 4rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-4);
            opacity: 0.3;
        }

        .empty-portfolios h3 {
            font-size: 1.5rem;
            color: var(--text-primary);
            margin-bottom: var(--space-2);
        }

        .empty-portfolios p {
            color: var(--text-secondary);
            margin-bottom: var(--space-6);
        }

        .empty-watchlist {
            text-align: center;
            padding: var(--space-8) var(--space-4);
        }

        .empty-watchlist-icon {
            font-size: 2.5rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-3);
            opacity: 0.3;
        }

        .empty-watchlist p {
            color: var(--text-secondary);
            font-size: 0.875rem;
            margin: 0;
        }

        /* Error state */
        .error-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-8);
            text-align: center;
        }

        .error-state i {
            font-size: 2rem;
            color: var(--danger);
            opacity: 0.7;
        }

        .error-state p {
            color: var(--text-secondary);
            margin: 0;
        }

        /* Responsive design */
        @media (max-width: 1023px) {
            .sidebar-section {
                position: static;
                order: 2;
            }
        }

        @media (max-width: 767px) {
            .dashboard {
                padding: var(--space-4) var(--space-3);
            }
            
            .dashboard-title {
                flex-direction: column;
                align-items: flex-start;
                gap: var(--space-2);
            }
            
            .dashboard-title h1 {
                font-size: 1.5rem;
            }
            
            .portfolios-grid {
                grid-template-columns: 1fr;
            }
            
            .watchlist-section {
                padding: var(--space-4);
            }
            
            .watchlist-table thead th,
            .watchlist-table tbody td {
                padding: var(--space-2);
            }
            
            .change-display {
                align-items: flex-start;
            }
        }

        /* Loading states */
        .portfolios-grid.loading .portfolio-card {
            pointer-events: none;
        }

        .watchlist-table.loading tbody td {
            padding: var(--space-3);
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'dashboard-page-styles';
    styleEl.textContent = dashboardPageStyles;
    document.head.appendChild(styleEl);
}