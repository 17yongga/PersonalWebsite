// Complete Trading Page - Production Ready

import { api } from '../api.js';
import { store, portfolioHelpers, quoteHelpers } from '../store.js';
import { toast } from '../components/toast.js';
import { createSymbolSearch } from '../components/symbol-search.js';
import { createOrderForm } from '../components/order-form.js';
import { 
    formatCurrency, 
    formatPercent, 
    formatNumber, 
    formatDate, 
    formatTime,
    escapeHtml, 
    debounce,
    getPriceChangeColor,
    formatLargeNumber,
    parseNumber
} from '../utils.js';

function TradingPage() {
    let isDestroyed = false;
    let currentSymbol = null;
    let currentQuote = null;
    let portfolios = [];
    let selectedPortfolio = null;
    let positions = [];
    let orders = [];
    let orderHistory = [];
    let historyFilter = 'all';
    let quoteRefreshTimer = null;
    let symbolSearchInstance = null;
    let orderFormInstance = null;

    async function render(container, params = {}) {
        // Extract symbol from params
        if (params.symbol) {
            currentSymbol = params.symbol.toUpperCase();
        }

        // Render initial structure
        container.innerHTML = `
            <div class="trading-page">
                ${renderTradingHeader()}
                <div class="trading-layout">
                    <div class="trading-main">
                        ${renderQuoteSection()}
                        ${renderPositionsSection()}
                        ${renderOrderHistorySection()}
                    </div>
                    <div class="trading-sidebar">
                        ${renderOrderFormSection()}
                        ${renderOpenOrdersSection()}
                    </div>
                </div>
            </div>
        `;

        // Load initial data and initialize components
        await initializeComponents(container);
        await loadInitialData();
        setupEventListeners(container);
        
        // Start quote refresh if symbol is selected
        if (currentSymbol) {
            startQuoteRefresh();
        }
        
        // Apply styles
        applyStyles();
    }

    function renderTradingHeader() {
        return `
            <div class="trading-header">
                <div class="trading-title">
                    <h1>Trade</h1>
                    <p class="trading-subtitle">Search for stocks and place buy/sell orders with your virtual portfolios</p>
                </div>
                <div class="symbol-search-container" id="symbol-search-container">
                    <!-- Symbol search will be rendered here -->
                </div>
            </div>
        `;
    }

    function renderQuoteSection() {
        return `
            <div class="quote-section" id="quote-section">
                ${renderQuoteContent()}
            </div>
        `;
    }

    function renderQuoteContent() {
        if (!currentSymbol || !currentQuote) {
            return `
                <div class="quote-empty">
                    <div class="quote-empty-content">
                        <i class="fas fa-search"></i>
                        <h3>Search for a stock to start trading</h3>
                        <p>Use the search bar above to find stocks, ETFs, and other securities</p>
                    </div>
                </div>
            `;
        }

        const quote = currentQuote;
        const change = quote.change || 0;
        const changePercent = quote.changePercent || quote.change_percent || 0;
        const changeClass = change >= 0 ? 'positive' : 'negative';
        const changeIcon = change >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';

        return `
            <div class="quote-header">
                <div class="quote-main">
                    <div class="quote-symbol">
                        <div class="symbol-info">
                            <div class="symbol-ticker">${escapeHtml(quote.symbol)}</div>
                            <div class="symbol-name">${escapeHtml(quote.company_name || quote.name || 'Unknown Company')}</div>
                        </div>
                        <div class="symbol-exchange">${escapeHtml(quote.exchange || 'NASDAQ')}</div>
                    </div>

                    <div class="quote-price">
                        <div class="current-price">$${formatNumber(quote.price, 2)}</div>
                        <div class="price-change ${changeClass}">
                            <i class="fas ${changeIcon}"></i>
                            <span class="change-amount">${change >= 0 ? '+' : ''}$${formatNumber(Math.abs(change), 2)}</span>
                            <span class="change-percent">(${changePercent >= 0 ? '+' : ''}${formatNumber(changePercent, 2)}%)</span>
                        </div>
                    </div>
                </div>

                <div class="quote-stats">
                    <div class="quote-stat">
                        <div class="stat-label">Previous Close</div>
                        <div class="stat-value">$${formatNumber(quote.previousClose || quote.previous_close || quote.price, 2)}</div>
                    </div>
                    <div class="quote-stat">
                        <div class="stat-label">Volume</div>
                        <div class="stat-value">${formatLargeNumber(quote.volume || 0)}</div>
                    </div>
                    <div class="quote-stat">
                        <div class="stat-label">Market Cap</div>
                        <div class="stat-value">${quote.marketCap || quote.market_cap ? formatLargeNumber(quote.marketCap || quote.market_cap) : 'N/A'}</div>
                    </div>
                </div>

                ${renderDayRangeBar(quote)}
            </div>
        `;
    }

    function renderDayRangeBar(quote) {
        const dayLow = quote.dayLow || quote.day_low || quote.price * 0.95;
        const dayHigh = quote.dayHigh || quote.day_high || quote.price * 1.05;
        const currentPrice = quote.price;
        
        let position = 50; // Default to middle if no range data
        if (dayHigh && dayLow && dayHigh !== dayLow) {
            position = ((currentPrice - dayLow) / (dayHigh - dayLow)) * 100;
            position = Math.max(0, Math.min(100, position));
        }

        return `
            <div class="day-range-section">
                <div class="day-range-label">Day Range</div>
                <div class="day-range-bar">
                    <div class="day-range-track">
                        <div class="day-range-fill" style="width: ${position}%"></div>
                        <div class="day-range-current" style="left: ${position}%">
                            <div class="range-tooltip">$${formatNumber(currentPrice, 2)}</div>
                        </div>
                    </div>
                    <div class="day-range-labels">
                        <span class="range-low">$${formatNumber(dayLow, 2)}</span>
                        <span class="range-high">$${formatNumber(dayHigh, 2)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function renderPositionsSection() {
        return `
            <div class="positions-section">
                <div class="section-header">
                    <h2>Your Positions</h2>
                    <div class="portfolio-selector-mini" id="positions-portfolio-selector">
                        ${renderPortfolioSelector()}
                    </div>
                </div>
                <div class="positions-content" id="positions-content">
                    ${renderPositionsLoading()}
                </div>
            </div>
        `;
    }

    function renderPortfolioSelector() {
        if (portfolios.length === 0) {
            return `
                <select class="form-select form-select-sm" disabled>
                    <option>Loading portfolios...</option>
                </select>
            `;
        }

        return `
            <select class="form-select form-select-sm" id="positions-portfolio-select">
                ${portfolios.map(portfolio => `
                    <option value="${portfolio.id}" ${portfolio.id === selectedPortfolio?.id ? 'selected' : ''}>
                        ${escapeHtml(portfolio.name)} (${formatCurrency(portfolio.cash_balance || 0)})
                    </option>
                `).join('')}
            </select>
        `;
    }

    function renderPositionsLoading() {
        return `
            <div class="loading-skeleton">
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            </div>
        `;
    }

    function renderPositions() {
        // Filter positions for current symbol if one is selected
        const displayPositions = currentSymbol 
            ? positions.filter(p => p.symbol === currentSymbol)
            : positions;

        if (displayPositions.length === 0) {
            const message = currentSymbol 
                ? `No positions in ${currentSymbol}`
                : 'No positions in this portfolio';
            
            return `
                <div class="empty-state">
                    <i class="fas fa-chart-pie"></i>
                    <h3>${message}</h3>
                    <p>${currentSymbol ? 'You don\'t own any shares of this stock.' : 'Start trading to build your portfolio.'}</p>
                </div>
            `;
        }

        return `
            <div class="positions-table">
                <div class="table-header">
                    <div class="header-cell">Symbol</div>
                    <div class="header-cell">Shares</div>
                    <div class="header-cell">Avg Cost</div>
                    <div class="header-cell">Current</div>
                    <div class="header-cell">Market Value</div>
                    <div class="header-cell">P&L</div>
                    <div class="header-cell">Actions</div>
                </div>
                ${displayPositions.map(position => renderPositionRow(position)).join('')}
            </div>
        `;
    }

    function renderPositionRow(position) {
        const currentPrice = position.current_price || position.price || 0;
        const avgCost = position.avg_cost_basis || position.avg_cost || position.average_cost || 0;
        const quantity = position.quantity || position.shares || 0;
        const marketValue = currentPrice * quantity;
        const totalCost = avgCost * quantity;
        const pnlAmount = marketValue - totalCost;
        const pnlPercent = totalCost > 0 ? (pnlAmount / totalCost) * 100 : 0;
        const pnlClass = pnlAmount >= 0 ? 'positive' : 'negative';

        return `
            <div class="table-row">
                <div class="table-cell">
                    <div class="position-symbol">${escapeHtml(position.symbol)}</div>
                </div>
                <div class="table-cell">${formatNumber(quantity, 0)}</div>
                <div class="table-cell">$${formatNumber(avgCost, 2)}</div>
                <div class="table-cell">$${formatNumber(currentPrice, 2)}</div>
                <div class="table-cell">$${formatNumber(marketValue, 2)}</div>
                <div class="table-cell ${pnlClass}">
                    <div class="pnl-amount">${pnlAmount >= 0 ? '+' : ''}$${formatNumber(Math.abs(pnlAmount), 2)}</div>
                    <div class="pnl-percent">(${pnlPercent >= 0 ? '+' : ''}${formatNumber(pnlPercent, 2)}%)</div>
                </div>
                <div class="table-cell">
                    <button class="btn btn-sm btn-danger" onclick="window.sellPosition('${position.symbol}', ${quantity})">
                        <i class="fas fa-minus"></i> Sell
                    </button>
                </div>
            </div>
        `;
    }

    function renderOrderHistorySection() {
        return `
            <div class="order-history-section">
                <div class="section-header">
                    <h2>Order History</h2>
                    <div class="order-history-filters">
                        <button class="btn btn-sm filter-btn ${historyFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
                        <button class="btn btn-sm filter-btn ${historyFilter === 'open' ? 'active' : ''}" data-filter="open">Open</button>
                        <button class="btn btn-sm filter-btn ${historyFilter === 'filled' ? 'active' : ''}" data-filter="filled">Filled</button>
                        <button class="btn btn-sm filter-btn ${historyFilter === 'cancelled' ? 'active' : ''}" data-filter="cancelled">Cancelled</button>
                    </div>
                </div>
                <div class="order-history-content" id="order-history-content">
                    ${renderOrderHistoryLoading()}
                </div>
            </div>
        `;
    }

    function renderOrderHistoryLoading() {
        return `
            <div class="loading-skeleton">
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            </div>
        `;
    }

    function renderOrderHistory() {
        let filteredOrders = orderHistory;
        
        // Filter by symbol if one is selected
        if (currentSymbol) {
            filteredOrders = filteredOrders.filter(order => order.symbol === currentSymbol);
        }
        
        // Filter by status
        if (historyFilter !== 'all') {
            filteredOrders = filteredOrders.filter(order => order.status === historyFilter);
        }

        if (filteredOrders.length === 0) {
            const message = currentSymbol 
                ? `No ${historyFilter === 'all' ? '' : historyFilter + ' '}orders for ${currentSymbol}`
                : `No ${historyFilter === 'all' ? 'order history' : historyFilter + ' orders'}`;
            
            return `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <h3>${message}</h3>
                    <p>Your order history will appear here.</p>
                </div>
            `;
        }

        return `
            <div class="history-table">
                <div class="table-header">
                    <div class="header-cell">Date</div>
                    <div class="header-cell">Symbol</div>
                    <div class="header-cell">Side</div>
                    <div class="header-cell">Type</div>
                    <div class="header-cell">Qty</div>
                    <div class="header-cell">Price</div>
                    <div class="header-cell">Status</div>
                </div>
                ${filteredOrders.slice(0, 20).map(order => renderOrderHistoryRow(order)).join('')}
            </div>
        `;
    }

    function renderOrderHistoryRow(order) {
        const sideClass = order.side === 'buy' ? 'buy' : 'sell';
        const statusClass = {
            'open': 'status-open',
            'filled': 'status-filled',
            'cancelled': 'status-cancelled',
            'partial': 'status-partial'
        }[order.status] || 'status-open';

        const displayPrice = order.fill_price || order.limit_price || order.stop_price;

        return `
            <div class="table-row">
                <div class="table-cell">${formatDate(order.created_at, 'compact')}</div>
                <div class="table-cell">${escapeHtml(order.symbol)}</div>
                <div class="table-cell ${sideClass}">${order.side.toUpperCase()}</div>
                <div class="table-cell">${order.type.toUpperCase()}</div>
                <div class="table-cell">${formatNumber(order.quantity)}</div>
                <div class="table-cell">
                    ${displayPrice ? `$${formatNumber(displayPrice, 2)}` : 'Market'}
                </div>
                <div class="table-cell">
                    <span class="status-badge ${statusClass}">${order.status.toUpperCase()}</span>
                </div>
            </div>
        `;
    }

    function renderOrderFormSection() {
        return `
            <div class="order-form-section">
                <div class="section-header">
                    <h2>Place Order</h2>
                </div>
                <div id="order-form-container">
                    <!-- Order form will be rendered here -->
                </div>
            </div>
        `;
    }

    function renderOpenOrdersSection() {
        return `
            <div class="open-orders-section">
                <div class="section-header">
                    <h2>Open Orders</h2>
                </div>
                <div class="open-orders-content" id="open-orders-content">
                    ${renderOpenOrdersLoading()}
                </div>
            </div>
        `;
    }

    function renderOpenOrdersLoading() {
        return `
            <div class="loading-skeleton">
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            </div>
        `;
    }

    function renderOpenOrders() {
        const openOrders = orders.filter(order => order.status === 'open');
        
        // Filter by symbol if one is selected
        const displayOrders = currentSymbol 
            ? openOrders.filter(order => order.symbol === currentSymbol)
            : openOrders;

        if (displayOrders.length === 0) {
            const message = currentSymbol 
                ? `No open orders for ${currentSymbol}`
                : 'No open orders';
                
            return `
                <div class="empty-state">
                    <i class="fas fa-list-alt"></i>
                    <h3>${message}</h3>
                    <p>Your open orders will appear here.</p>
                </div>
            `;
        }

        return `
            <div class="orders-list">
                ${displayOrders.map(order => renderOpenOrderCard(order)).join('')}
            </div>
        `;
    }

    function renderOpenOrderCard(order) {
        const sideClass = order.side === 'buy' ? 'buy' : 'sell';
        
        return `
            <div class="order-card">
                <div class="order-header">
                    <div class="order-symbol">${escapeHtml(order.symbol)}</div>
                    <div class="order-side ${sideClass}">${order.side.toUpperCase()}</div>
                    <div class="order-status status-open">OPEN</div>
                </div>
                <div class="order-details">
                    <div class="order-detail">
                        <span class="detail-label">Type:</span>
                        <span class="detail-value">${order.type.toUpperCase()}</span>
                    </div>
                    <div class="order-detail">
                        <span class="detail-label">Quantity:</span>
                        <span class="detail-value">${formatNumber(order.quantity)}</span>
                    </div>
                    ${order.limit_price ? `
                        <div class="order-detail">
                            <span class="detail-label">Limit Price:</span>
                            <span class="detail-value">$${formatNumber(order.limit_price, 2)}</span>
                        </div>
                    ` : ''}
                    ${order.stop_price ? `
                        <div class="order-detail">
                            <span class="detail-label">Stop Price:</span>
                            <span class="detail-value">$${formatNumber(order.stop_price, 2)}</span>
                        </div>
                    ` : ''}
                    <div class="order-detail">
                        <span class="detail-label">Created:</span>
                        <span class="detail-value">${formatTime(order.created_at)}</span>
                    </div>
                </div>
                <div class="order-actions">
                    <button class="btn btn-sm btn-outline-danger" onclick="window.cancelOrder('${order.id}')">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                </div>
            </div>
        `;
    }

    async function initializeComponents(container) {
        // Initialize symbol search
        const symbolSearchContainer = container.querySelector('#symbol-search-container');
        if (symbolSearchContainer) {
            symbolSearchInstance = createSymbolSearch(symbolSearchContainer, {
                onSelect: onSymbolSelected,
                placeholder: 'Search stocks, ETFs, crypto...'
            });
            
            // Set initial symbol if provided
            if (currentSymbol) {
                symbolSearchContainer.querySelector('input').value = currentSymbol;
            }
        }

        // Initialize order form
        const orderFormContainer = container.querySelector('#order-form-container');
        if (orderFormContainer) {
            orderFormInstance = createOrderForm(orderFormContainer, {
                portfolios: portfolios,
                onOrderPlaced: onOrderPlaced,
                currentSymbol: currentSymbol,
                currentPrice: currentQuote?.price
            });
        }
    }

    async function loadInitialData() {
        try {
            // Load portfolios
            const portfoliosResponse = await api.get('/portfolios');
            portfolios = portfoliosResponse.portfolios || portfoliosResponse || [];
            selectedPortfolio = portfolios[0] || null;

            // Update portfolio selector
            updatePortfolioSelector();

            // Update order form with portfolios
            if (orderFormInstance) {
                orderFormInstance.updatePortfolios(portfolios);
            }

            // Load quote if symbol is provided
            if (currentSymbol) {
                await loadQuote(currentSymbol);
            }

            // Load portfolio data
            if (selectedPortfolio) {
                await loadPortfolioData();
            }

        } catch (error) {
            console.error('Error loading initial data:', error);
            toast.error('Failed to load trading data. Please refresh the page.');
        }
    }

    async function loadQuote(symbol) {
        if (!symbol) return null;

        try {
            const response = await api.get(`/market/quote/${symbol}`);
            currentQuote = response.quote || response;
            
            // Update quote display
            updateQuoteDisplay();
            
            // Update order form with new symbol and price
            if (orderFormInstance) {
                orderFormInstance.updateSymbol(symbol, currentQuote.price);
            }

            // Cache quote in store
            quoteHelpers.setQuote(symbol, currentQuote);

            return currentQuote;
        } catch (error) {
            console.error('Error loading quote:', error);
            toast.error(`Failed to load quote for ${symbol}`);
            currentQuote = null;
            updateQuoteDisplay();
            return null;
        }
    }

    async function loadPortfolioData() {
        if (!selectedPortfolio) return;

        try {
            await Promise.all([
                loadPositions(),
                loadOrders()
            ]);
            updateDataDisplays();
        } catch (error) {
            console.error('Error loading portfolio data:', error);
        }
    }

    async function loadPositions() {
        if (!selectedPortfolio) return;
        
        try {
            const response = await api.get(`/trading/positions/${selectedPortfolio.id}`);
            positions = response.positions || response || [];
        } catch (error) {
            console.error('Error loading positions:', error);
            positions = [];
        }
    }

    async function loadOrders() {
        if (!selectedPortfolio) return;
        
        try {
            // Load all orders for the portfolio
            const response = await api.get('/trading/orders', {
                portfolio_id: selectedPortfolio.id
            });
            const allOrders = response.orders || response || [];
            
            // Separate open orders from history
            orders = allOrders.filter(order => order.status === 'open');
            orderHistory = allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
        } catch (error) {
            console.error('Error loading orders:', error);
            orders = [];
            orderHistory = [];
        }
    }

    function updateQuoteDisplay() {
        const quoteSection = document.querySelector('#quote-section');
        if (quoteSection) {
            quoteSection.innerHTML = renderQuoteContent();
        }
    }

    function updatePortfolioSelector() {
        const portfolioSelectorElement = document.querySelector('#positions-portfolio-selector');
        if (portfolioSelectorElement) {
            portfolioSelectorElement.innerHTML = renderPortfolioSelector();
        }
    }

    function updateDataDisplays() {
        // Update positions
        const positionsContent = document.querySelector('#positions-content');
        if (positionsContent) {
            positionsContent.innerHTML = renderPositions();
        }

        // Update open orders
        const openOrdersContent = document.querySelector('#open-orders-content');
        if (openOrdersContent) {
            openOrdersContent.innerHTML = renderOpenOrders();
        }

        // Update order history
        const orderHistoryContent = document.querySelector('#order-history-content');
        if (orderHistoryContent) {
            orderHistoryContent.innerHTML = renderOrderHistory();
        }
    }

    function setupEventListeners(container) {
        // Portfolio selector change
        container.addEventListener('change', async (e) => {
            if (e.target.id === 'positions-portfolio-select') {
                const portfolioId = e.target.value;
                selectedPortfolio = portfolios.find(p => p.id === portfolioId);
                
                if (selectedPortfolio) {
                    await loadPortfolioData();
                }
            }
        });

        // Order history filter buttons
        container.addEventListener('click', async (e) => {
            if (e.target.classList.contains('filter-btn')) {
                const filter = e.target.dataset.filter;
                if (filter === historyFilter) return;

                // Update active state
                container.querySelectorAll('.filter-btn').forEach(btn => 
                    btn.classList.remove('active'));
                e.target.classList.add('active');

                // Update filter and re-render
                historyFilter = filter;
                const orderHistoryContent = container.querySelector('#order-history-content');
                if (orderHistoryContent) {
                    orderHistoryContent.innerHTML = renderOrderHistory();
                }
            }
        });
    }

    async function onSymbolSelected(symbol, symbolData) {
        currentSymbol = symbol.toUpperCase();
        
        // Update URL without triggering navigation
        const currentPath = window.location.hash.slice(1);
        const newPath = `/trade/${currentSymbol}`;
        if (currentPath !== newPath) {
            window.history.replaceState(null, '', `#${newPath}`);
        }

        // Load quote
        await loadQuote(currentSymbol);
        
        // Refresh data displays to filter by symbol
        updateDataDisplays();

        // Start quote refresh
        startQuoteRefresh();
    }

    async function onOrderPlaced(order) {
        // Show success message
        const action = order.side === 'buy' ? 'Buy' : 'Sell';
        const priceText = order.fill_price 
            ? `at $${formatNumber(order.fill_price, 2)}`
            : order.limit_price 
                ? `with limit $${formatNumber(order.limit_price, 2)}`
                : 'at market price';
                
        toast.success(`${action} order for ${order.quantity} shares of ${order.symbol} placed ${priceText}`);
        
        // Reload data
        await loadPortfolioData();
        
        // Update portfolio balance in store if order was filled
        if (order.status === 'filled' && selectedPortfolio) {
            const cost = (order.fill_price || order.limit_price) * order.quantity;
            const newBalance = order.side === 'buy' 
                ? selectedPortfolio.cash_balance - cost
                : selectedPortfolio.cash_balance + cost;
            
            selectedPortfolio.cash_balance = newBalance;
            portfolioHelpers.updatePortfolio(selectedPortfolio.id, { cash_balance: newBalance });
        }
    }

    function startQuoteRefresh() {
        stopQuoteRefresh();
        
        if (currentSymbol && !isDestroyed) {
            quoteRefreshTimer = setInterval(async () => {
                if (!isDestroyed && currentSymbol) {
                    await loadQuote(currentSymbol);
                }
            }, 30000); // Refresh every 30 seconds
        }
    }

    function stopQuoteRefresh() {
        if (quoteRefreshTimer) {
            clearInterval(quoteRefreshTimer);
            quoteRefreshTimer = null;
        }
    }

    // Global functions for button handlers
    window.sellPosition = async function(symbol, maxQuantity) {
        if (orderFormInstance) {
            // Set symbol and side
            await onSymbolSelected(symbol);
            orderFormInstance.setSide('sell');
            orderFormInstance.setMaxQuantity(maxQuantity);
            
            // Scroll to order form
            const orderFormSection = document.querySelector('.order-form-section');
            if (orderFormSection) {
                orderFormSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    window.cancelOrder = async function(orderId) {
        const confirmed = await toast.confirm(
            'Are you sure you want to cancel this order?',
            {
                title: 'Cancel Order',
                confirmText: 'Yes, Cancel',
                cancelText: 'Keep Order',
                confirmVariant: 'danger'
            }
        );

        if (!confirmed) return;

        try {
            await api.delete(`/trading/orders/${orderId}`);
            toast.success('Order cancelled successfully');
            
            // Reload orders
            await loadOrders();
            updateDataDisplays();
            
        } catch (error) {
            console.error('Error cancelling order:', error);
            toast.error('Failed to cancel order. Please try again.');
        }
    };

    function applyStyles() {
        // Styles are already applied via the CSS file
        // This function can be used for dynamic styling if needed
    }

    async function destroy() {
        isDestroyed = true;
        
        // Stop quote refresh
        stopQuoteRefresh();

        // Cleanup symbol search
        if (symbolSearchInstance && typeof symbolSearchInstance === 'function') {
            symbolSearchInstance();
        }

        // Cleanup order form
        if (orderFormInstance && orderFormInstance.destroy) {
            orderFormInstance.destroy();
        }

        // Cleanup global functions
        if (window.sellPosition) {
            delete window.sellPosition;
        }
        if (window.cancelOrder) {
            delete window.cancelOrder;
        }
    }

    return { render, destroy };
}

export default TradingPage;