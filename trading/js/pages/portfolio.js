// Portfolio Detail Page

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import modal from '../components/modal.js';
import { formatCurrency, formatPercent, escapeHtml, formatDate, formatTime } from '../utils.js';

function PortfolioPage() {
    let unsubscribers = [];
    let portfolioId = null;
    let portfolioData = null;
    let positions = [];
    let orders = [];
    let transactions = [];
    let activeOrderTab = 'all';
    let isEditing = false;
    let refreshInterval = null;

    async function render(container, params) {
        portfolioId = params?.id;
        
        if (!portfolioId) {
            container.innerHTML = '<div class="error-state">Portfolio not found</div>';
            return;
        }

        // Initial render with loading state
        container.innerHTML = `
            <div class="portfolio-page">
                <div class="portfolio-header-loading">
                    <div class="skeleton skeleton-text" style="width: 300px; height: 32px;"></div>
                    <div class="skeleton skeleton-text" style="width: 200px; height: 24px;"></div>
                    <div class="skeleton skeleton-button"></div>
                </div>
                
                <div class="portfolio-layout">
                    <div class="portfolio-main">
                        <div class="portfolio-summary-loading">
                            ${Array(4).fill(0).map(() => `
                                <div class="summary-card loading">
                                    <div class="skeleton skeleton-text"></div>
                                    <div class="skeleton skeleton-text" style="width: 60%;"></div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <div class="portfolio-section">
                            <div class="section-header">
                                <h3>Positions</h3>
                            </div>
                            <div class="positions-loading">
                                ${Array(3).fill(0).map(() => `
                                    <div class="skeleton skeleton-text"></div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    
                    <div class="portfolio-sidebar">
                        <div class="sidebar-section">
                            <h3>Performance</h3>
                            <div class="skeleton skeleton-text"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Load data
        await loadPortfolioData();
        
        // Bind event listeners
        bindEventListeners();
        
        // Set up real-time updates
        setupStoreSubscriptions();
        
        // Start auto-refresh
        startAutoRefresh();
    }

    async function loadPortfolioData() {
        try {
            const [portfolioRes, positionsRes, ordersRes, transactionsRes] = await Promise.all([
                api.get(`/portfolios/${portfolioId}`),
                api.get(`/trading/positions/${portfolioId}`),
                api.get(`/trading/orders`, { portfolio_id: portfolioId }),
                api.get(`/trading/transactions`, { portfolio_id: portfolioId })
            ]);

            portfolioData = portfolioRes.portfolio;
            positions = positionsRes.positions || [];
            orders = ordersRes.orders || [];
            transactions = transactionsRes.transactions || [];

            renderPortfolio();
        } catch (error) {
            console.error('Failed to load portfolio data:', error);
            renderError();
        }
    }

    function renderPortfolio() {
        if (!portfolioData) return;

        const container = document.querySelector('.portfolio-page');
        if (!container) return;

        const totalReturn = portfolioData.total_value - portfolioData.starting_balance;
        const totalReturnPct = (totalReturn / portfolioData.starting_balance) * 100;
        const investedAmount = portfolioData.total_value - portfolioData.cash_balance;
        const todaysPnl = positions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);

        container.innerHTML = `
            <div class="portfolio-header">
                <div class="portfolio-title-section">
                    <div class="portfolio-title-content">
                        ${isEditing ? `
                            <form id="edit-portfolio-form" class="edit-form">
                                <input type="text" id="portfolio-name-input" 
                                       class="portfolio-name-input" 
                                       value="${escapeHtml(portfolioData.name)}" 
                                       maxlength="50" required>
                                <div class="edit-actions">
                                    <button type="submit" class="btn btn-sm btn-primary">Save</button>
                                    <button type="button" class="btn btn-sm btn-secondary" onclick="cancelEdit()">Cancel</button>
                                </div>
                            </form>
                        ` : `
                            <div class="portfolio-title-display">
                                <h1 class="portfolio-name" onclick="startEdit()">${escapeHtml(portfolioData.name)}</h1>
                                <button class="edit-btn" onclick="startEdit()" aria-label="Edit portfolio name">
                                    <i class="fas fa-edit"></i>
                                </button>
                            </div>
                        `}
                        
                        <div class="portfolio-value">
                            <div class="total-value">${formatCurrency(portfolioData.total_value)}</div>
                            <div class="value-change ${totalReturn >= 0 ? 'positive' : 'negative'}">
                                ${totalReturn >= 0 ? '+' : ''}${formatCurrency(totalReturn)} 
                                (${formatPercent(totalReturnPct, 2, false)})
                            </div>
                        </div>
                    </div>

                    <div class="portfolio-actions">
                        <button class="btn btn-primary" onclick="goToTrade()">
                            <i class="fas fa-chart-line"></i>
                            Trade
                        </button>
                        <button class="btn btn-warning" onclick="confirmReset()">
                            <i class="fas fa-redo"></i>
                            Reset
                        </button>
                        <button class="btn btn-danger" onclick="confirmDelete()">
                            <i class="fas fa-trash"></i>
                            Delete
                        </button>
                    </div>
                </div>

                <div class="portfolio-stats">
                    <div class="stat-item">
                        <label>Cash Available</label>
                        <value>${formatCurrency(portfolioData.cash_balance)}</value>
                    </div>
                    <div class="stat-item">
                        <label>Invested</label>
                        <value>${formatCurrency(investedAmount)}</value>
                    </div>
                    <div class="stat-item">
                        <label>Today's P&L</label>
                        <value class="${todaysPnl >= 0 ? 'positive' : 'negative'}">
                            ${todaysPnl >= 0 ? '+' : ''}${formatCurrency(todaysPnl)}
                        </value>
                    </div>
                </div>
            </div>

            <div class="portfolio-layout">
                <div class="portfolio-main">
                    <div class="portfolio-summary">
                        <div class="summary-card">
                            <div class="summary-label">Total Value</div>
                            <div class="summary-value">${formatCurrency(portfolioData.total_value)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Cash Available</div>
                            <div class="summary-value">${formatCurrency(portfolioData.cash_balance)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Today's P&L</div>
                            <div class="summary-value ${todaysPnl >= 0 ? 'positive' : 'negative'}">
                                ${todaysPnl >= 0 ? '+' : ''}${formatCurrency(todaysPnl)}
                            </div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Total Return</div>
                            <div class="summary-value ${totalReturn >= 0 ? 'positive' : 'negative'}">
                                ${formatPercent(totalReturnPct, 2, false)}
                            </div>
                        </div>
                    </div>

                    <div class="portfolio-section">
                        <div class="section-header">
                            <h3>Positions</h3>
                            <span class="section-count">${positions.length} position${positions.length !== 1 ? 's' : ''}</span>
                        </div>
                        ${renderPositions()}
                    </div>

                    <div class="portfolio-section">
                        <div class="section-header">
                            <h3>Order History</h3>
                            <div class="order-tabs">
                                <button class="tab-btn ${activeOrderTab === 'all' ? 'active' : ''}" 
                                        onclick="switchOrderTab('all')">All</button>
                                <button class="tab-btn ${activeOrderTab === 'open' ? 'active' : ''}" 
                                        onclick="switchOrderTab('open')">Open</button>
                                <button class="tab-btn ${activeOrderTab === 'filled' ? 'active' : ''}" 
                                        onclick="switchOrderTab('filled')">Filled</button>
                                <button class="tab-btn ${activeOrderTab === 'cancelled' ? 'active' : ''}" 
                                        onclick="switchOrderTab('cancelled')">Cancelled</button>
                            </div>
                        </div>
                        ${renderOrders()}
                    </div>
                </div>

                <div class="portfolio-sidebar">
                    <div class="sidebar-section">
                        <h3>Performance Summary</h3>
                        <div class="performance-summary">
                            <div class="perf-item">
                                <label>Starting Balance</label>
                                <value>${formatCurrency(portfolioData.starting_balance)}</value>
                            </div>
                            <div class="perf-item">
                                <label>Current Value</label>
                                <value>${formatCurrency(portfolioData.total_value)}</value>
                            </div>
                            <div class="perf-item">
                                <label>Total Return</label>
                                <value class="${totalReturn >= 0 ? 'positive' : 'negative'}">
                                    ${totalReturn >= 0 ? '+' : ''}${formatCurrency(totalReturn)} 
                                    (${formatPercent(totalReturnPct, 2, false)})
                                </value>
                            </div>
                            <div class="perf-item">
                                <label>Number of Trades</label>
                                <value>${transactions.length}</value>
                            </div>
                        </div>
                    </div>

                    <div class="sidebar-section">
                        <h3>Recent Activity</h3>
                        ${renderRecentActivity()}
                    </div>

                    <div class="sidebar-section">
                        <h3>Quick Trade</h3>
                        <div class="quick-trade">
                            <input type="text" id="quick-symbol" 
                                   class="form-input" 
                                   placeholder="Enter symbol (e.g., AAPL)"
                                   maxlength="10">
                            <button class="btn btn-primary" onclick="quickTrade()">
                                Go to Trade
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderPositions() {
        if (positions.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-icon">📊</div>
                    <h4>No positions yet</h4>
                    <p>Start trading to build your portfolio</p>
                    <button class="btn btn-primary" onclick="goToTrade()">
                        Start Trading
                    </button>
                </div>
            `;
        }

        return `
            <div class="positions-table-container">
                <table class="positions-table">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Shares</th>
                            <th>Avg Cost</th>
                            <th>Current Price</th>
                            <th>Market Value</th>
                            <th>P&L ($)</th>
                            <th>P&L (%)</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${positions.map(position => renderPositionRow(position)).join('')}
                    </tbody>
                </table>
            </div>

            <div class="positions-mobile">
                ${positions.map(position => renderPositionCard(position)).join('')}
            </div>
        `;
    }

    function renderPositionRow(position) {
        const unrealizedPnl = position.unrealized_pnl || 0;
        const totalReturnPct = position.total_return_pct || 0;
        const pnlClass = unrealizedPnl >= 0 ? 'positive' : 'negative';

        return `
            <tr class="position-row">
                <td class="position-symbol">
                    <button class="symbol-link" onclick="goToSymbol('${position.symbol}')">
                        ${escapeHtml(position.symbol)}
                    </button>
                </td>
                <td>${position.quantity}</td>
                <td>${formatCurrency(position.avg_cost_basis)}</td>
                <td>${formatCurrency(position.current_price)}</td>
                <td>${formatCurrency(position.market_value)}</td>
                <td class="${pnlClass}">
                    ${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}
                </td>
                <td class="${pnlClass}">
                    ${formatPercent(totalReturnPct, 2, false)}
                </td>
                <td class="position-actions">
                    <button class="btn btn-sm btn-danger" 
                            onclick="sellPosition('${position.symbol}', ${position.quantity})">
                        Sell
                    </button>
                </td>
            </tr>
        `;
    }

    function renderPositionCard(position) {
        const unrealizedPnl = position.unrealized_pnl || 0;
        const totalReturnPct = position.total_return_pct || 0;
        const pnlClass = unrealizedPnl >= 0 ? 'positive' : 'negative';

        return `
            <div class="position-card">
                <div class="position-card-header">
                    <button class="symbol-link" onclick="goToSymbol('${position.symbol}')">
                        <strong>${escapeHtml(position.symbol)}</strong>
                    </button>
                    <div class="position-pnl ${pnlClass}">
                        ${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}
                        <small>(${formatPercent(totalReturnPct, 2, false)})</small>
                    </div>
                </div>
                <div class="position-card-details">
                    <div class="detail-row">
                        <span>Shares:</span>
                        <span>${position.quantity}</span>
                    </div>
                    <div class="detail-row">
                        <span>Avg Cost:</span>
                        <span>${formatCurrency(position.avg_cost_basis)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Current:</span>
                        <span>${formatCurrency(position.current_price)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Value:</span>
                        <span>${formatCurrency(position.market_value)}</span>
                    </div>
                </div>
                <div class="position-card-actions">
                    <button class="btn btn-sm btn-danger" 
                            onclick="sellPosition('${position.symbol}', ${position.quantity})">
                        Sell Position
                    </button>
                </div>
            </div>
        `;
    }

    function renderOrders() {
        const filteredOrders = filterOrders(orders);

        if (filteredOrders.length === 0) {
            return `
                <div class="empty-state small">
                    <div class="empty-icon">📋</div>
                    <p>No ${activeOrderTab === 'all' ? '' : activeOrderTab + ' '}orders found</p>
                </div>
            `;
        }

        return `
            <div class="orders-table-container">
                <table class="orders-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Symbol</th>
                            <th>Type</th>
                            <th>Side</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredOrders.map(order => renderOrderRow(order)).join('')}
                    </tbody>
                </table>
            </div>

            <div class="orders-mobile">
                ${filteredOrders.map(order => renderOrderCard(order)).join('')}
            </div>
        `;
    }

    function renderOrderRow(order) {
        const displayPrice = order.fill_price || order.limit_price || 'Market';
        const priceText = typeof displayPrice === 'number' ? formatCurrency(displayPrice) : displayPrice;

        return `
            <tr class="order-row">
                <td>${formatDate(order.created_at, 'compact')}</td>
                <td>
                    <button class="symbol-link" onclick="goToSymbol('${order.symbol}')">
                        ${escapeHtml(order.symbol)}
                    </button>
                </td>
                <td>${order.type.charAt(0).toUpperCase() + order.type.slice(1)}</td>
                <td class="order-side ${order.side}">
                    ${order.side.toUpperCase()}
                </td>
                <td>${order.quantity}</td>
                <td>${priceText}</td>
                <td>
                    <span class="order-status status-${order.status}">
                        ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </span>
                </td>
                <td>
                    ${order.status === 'open' ? `
                        <button class="btn btn-sm btn-danger" 
                                onclick="cancelOrder('${order.id}')">
                            Cancel
                        </button>
                    ` : '-'}
                </td>
            </tr>
        `;
    }

    function renderOrderCard(order) {
        const displayPrice = order.fill_price || order.limit_price || 'Market';
        const priceText = typeof displayPrice === 'number' ? formatCurrency(displayPrice) : displayPrice;

        return `
            <div class="order-card">
                <div class="order-card-header">
                    <div>
                        <button class="symbol-link" onclick="goToSymbol('${order.symbol}')">
                            <strong>${escapeHtml(order.symbol)}</strong>
                        </button>
                        <span class="order-side ${order.side}">
                            ${order.side.toUpperCase()}
                        </span>
                        <span class="order-status status-${order.status}">
                            ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                        </span>
                    </div>
                    <div class="order-date">
                        ${formatDate(order.created_at, 'compact')}
                    </div>
                </div>
                <div class="order-card-details">
                    <div class="detail-row">
                        <span>Type:</span>
                        <span>${order.type.charAt(0).toUpperCase() + order.type.slice(1)}</span>
                    </div>
                    <div class="detail-row">
                        <span>Quantity:</span>
                        <span>${order.quantity}</span>
                    </div>
                    <div class="detail-row">
                        <span>Price:</span>
                        <span>${priceText}</span>
                    </div>
                </div>
                ${order.status === 'open' ? `
                    <div class="order-card-actions">
                        <button class="btn btn-sm btn-danger" 
                                onclick="cancelOrder('${order.id}')">
                            Cancel Order
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderRecentActivity() {
        const recentTransactions = transactions.slice(0, 5);

        if (recentTransactions.length === 0) {
            return `
                <div class="empty-state small">
                    <div class="empty-icon">📈</div>
                    <p>No trading activity yet</p>
                </div>
            `;
        }

        return `
            <div class="activity-list">
                ${recentTransactions.map(transaction => `
                    <div class="activity-item">
                        <div class="activity-content">
                            <div class="activity-text">
                                <span class="activity-action ${transaction.side}">
                                    ${transaction.side === 'buy' ? 'Bought' : 'Sold'}
                                </span>
                                ${transaction.quantity} ${escapeHtml(transaction.symbol)} 
                                @ ${formatCurrency(transaction.price)}
                            </div>
                            <div class="activity-time">
                                ${formatDate(transaction.created_at, 'relative')}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <button class="btn btn-sm btn-secondary full-width" onclick="viewFullHistory()">
                View Full History
            </button>
        `;
    }

    function renderError() {
        const container = document.querySelector('.portfolio-page');
        if (!container) return;

        container.innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Failed to load portfolio</h3>
                <p>There was an error loading this portfolio. Please try again.</p>
                <div class="error-actions">
                    <button class="btn btn-primary" onclick="retryLoad()">
                        <i class="fas fa-redo"></i>
                        Retry
                    </button>
                    <button class="btn btn-secondary" onclick="goToDashboard()">
                        <i class="fas fa-arrow-left"></i>
                        Back to Dashboard
                    </button>
                </div>
            </div>
        `;
    }

    function filterOrders(orders) {
        switch (activeOrderTab) {
            case 'open':
                return orders.filter(order => order.status === 'open');
            case 'filled':
                return orders.filter(order => order.status === 'filled');
            case 'cancelled':
                return orders.filter(order => order.status === 'cancelled');
            default:
                return orders;
        }
    }

    function bindEventListeners() {
        // Quick symbol search
        const quickSymbol = document.getElementById('quick-symbol');
        if (quickSymbol) {
            quickSymbol.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    quickTrade();
                }
            });
        }

        // Portfolio name editing
        const editForm = document.getElementById('edit-portfolio-form');
        if (editForm) {
            editForm.addEventListener('submit', handleSavePortfolioName);
        }
    }

    async function handleSavePortfolioName(e) {
        e.preventDefault();
        
        const nameInput = document.getElementById('portfolio-name-input');
        const newName = nameInput.value.trim();

        if (!newName) {
            toast.error('Portfolio name cannot be empty');
            return;
        }

        if (newName === portfolioData.name) {
            cancelEdit();
            return;
        }

        try {
            await api.patch(`/portfolios/${portfolioId}`, { name: newName });
            portfolioData.name = newName;
            isEditing = false;
            renderPortfolio();
            toast.success('Portfolio name updated');
        } catch (error) {
            console.error('Failed to update portfolio name:', error);
            toast.error('Failed to update portfolio name');
        }
    }

    function setupStoreSubscriptions() {
        // Subscribe to portfolio updates if needed
        unsubscribers.push(
            store.subscribe('portfolios', (portfolios) => {
                const updatedPortfolio = portfolios?.find(p => p.id === portfolioId);
                if (updatedPortfolio) {
                    portfolioData = updatedPortfolio;
                    renderPortfolio();
                }
            })
        );
    }

    function startAutoRefresh() {
        // Refresh data every 30 seconds
        refreshInterval = setInterval(async () => {
            try {
                const [positionsRes] = await Promise.all([
                    api.get(`/trading/positions/${portfolioId}`)
                ]);
                
                positions = positionsRes.positions || [];
                
                // Update the displayed positions
                const positionsSection = document.querySelector('.portfolio-section');
                if (positionsSection) {
                    const newPositionsHtml = renderPositions();
                    positionsSection.innerHTML = `
                        <div class="section-header">
                            <h3>Positions</h3>
                            <span class="section-count">${positions.length} position${positions.length !== 1 ? 's' : ''}</span>
                        </div>
                        ${newPositionsHtml}
                    `;
                }
            } catch (error) {
                console.error('Failed to refresh positions:', error);
            }
        }, 30000);
    }

    // Global event handlers
    window.startEdit = () => {
        isEditing = true;
        renderPortfolio();
        setTimeout(() => {
            const input = document.getElementById('portfolio-name-input');
            if (input) {
                input.focus();
                input.select();
            }
        }, 100);
    };

    window.cancelEdit = () => {
        isEditing = false;
        renderPortfolio();
    };

    window.goToTrade = () => {
        window.location.hash = '#/trade';
    };

    window.goToSymbol = (symbol) => {
        window.location.hash = `#/trade/${symbol}`;
    };

    window.quickTrade = () => {
        const symbolInput = document.getElementById('quick-symbol');
        const symbol = symbolInput?.value.trim().toUpperCase();
        
        if (!symbol) {
            toast.warning('Please enter a symbol');
            return;
        }

        window.location.hash = `#/trade/${symbol}`;
    };

    window.sellPosition = (symbol, quantity) => {
        window.location.hash = `#/trade/${symbol}?side=sell&quantity=${quantity}`;
    };

    window.switchOrderTab = (tab) => {
        activeOrderTab = tab;
        
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[onclick="switchOrderTab('${tab}')"]`)?.classList.add('active');
        
        // Re-render orders
        const ordersContainer = document.querySelector('.portfolio-section:nth-of-type(2)');
        if (ordersContainer) {
            ordersContainer.innerHTML = `
                <div class="section-header">
                    <h3>Order History</h3>
                    <div class="order-tabs">
                        <button class="tab-btn ${activeOrderTab === 'all' ? 'active' : ''}" 
                                onclick="switchOrderTab('all')">All</button>
                        <button class="tab-btn ${activeOrderTab === 'open' ? 'active' : ''}" 
                                onclick="switchOrderTab('open')">Open</button>
                        <button class="tab-btn ${activeOrderTab === 'filled' ? 'active' : ''}" 
                                onclick="switchOrderTab('filled')">Filled</button>
                        <button class="tab-btn ${activeOrderTab === 'cancelled' ? 'active' : ''}" 
                                onclick="switchOrderTab('cancelled')">Cancelled</button>
                    </div>
                </div>
                ${renderOrders()}
            `;
        }
    };

    window.cancelOrder = async (orderId) => {
        const confirmed = await modal.confirm(
            'Are you sure you want to cancel this order?',
            'Cancel Order'
        );

        if (confirmed) {
            try {
                await api.delete(`/trading/orders/${orderId}`);
                toast.success('Order cancelled');
                await loadPortfolioData();
            } catch (error) {
                console.error('Failed to cancel order:', error);
                toast.error('Failed to cancel order');
            }
        }
    };

    window.confirmReset = async () => {
        const confirmed = await modal.confirm(
            'This will reset your portfolio to the starting balance and remove all positions. This action cannot be undone.',
            'Reset Portfolio'
        );

        if (confirmed) {
            try {
                await api.post(`/portfolios/${portfolioId}/reset`);
                toast.success('Portfolio reset successfully');
                await loadPortfolioData();
            } catch (error) {
                console.error('Failed to reset portfolio:', error);
                toast.error('Failed to reset portfolio');
            }
        }
    };

    window.confirmDelete = async () => {
        const confirmed = await modal.confirm(
            'This will permanently delete this portfolio and all its data. This action cannot be undone.',
            'Delete Portfolio'
        );

        if (confirmed) {
            try {
                await api.delete(`/portfolios/${portfolioId}`);
                toast.success('Portfolio deleted successfully');
                window.location.hash = '#/dashboard';
            } catch (error) {
                console.error('Failed to delete portfolio:', error);
                toast.error('Failed to delete portfolio');
            }
        }
    };

    window.viewFullHistory = () => {
        // Could navigate to a dedicated history page or show a modal
        toast.info('Full history view coming soon!');
    };

    window.retryLoad = () => {
        loadPortfolioData();
    };

    window.goToDashboard = () => {
        window.location.hash = '#/dashboard';
    };

    function destroy() {
        // Clear auto-refresh
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }

        // Clean up subscriptions
        unsubscribers.forEach(unsub => unsub());
        unsubscribers = [];

        // Clean up global functions
        const globalFunctions = [
            'startEdit', 'cancelEdit', 'goToTrade', 'goToSymbol', 'quickTrade',
            'sellPosition', 'switchOrderTab', 'cancelOrder', 'confirmReset',
            'confirmDelete', 'viewFullHistory', 'retryLoad', 'goToDashboard'
        ];

        globalFunctions.forEach(funcName => {
            if (window[funcName]) delete window[funcName];
        });
    }

    return { render, destroy };
}

export default PortfolioPage;

// Add portfolio page specific styles
if (!document.getElementById('portfolio-page-styles')) {
    const portfolioPageStyles = `
        .portfolio-page {
            max-width: var(--max-width-2xl);
            margin: 0 auto;
            padding: var(--space-6) var(--space-4);
        }

        /* Header */
        .portfolio-header {
            margin-bottom: var(--space-8);
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
        }

        .portfolio-header-loading {
            margin-bottom: var(--space-8);
            padding: var(--space-6);
        }

        .portfolio-title-section {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: var(--space-6);
            gap: var(--space-4);
        }

        .portfolio-title-content {
            flex: 1;
        }

        .portfolio-title-display {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-2);
        }

        .portfolio-name {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0;
            cursor: pointer;
            border-radius: var(--radius-sm);
            padding: var(--space-1) var(--space-2);
            transition: background var(--transition-fast);
        }

        .portfolio-name:hover {
            background: var(--bg-secondary);
        }

        .edit-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: var(--space-2);
            border-radius: var(--radius-sm);
            opacity: 0;
            transition: all var(--transition-fast);
        }

        .portfolio-title-display:hover .edit-btn {
            opacity: 1;
        }

        .edit-btn:hover {
            background: var(--bg-secondary);
            color: var(--text-primary);
        }

        .edit-form {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            margin-bottom: var(--space-2);
        }

        .portfolio-name-input {
            font-size: 2rem;
            font-weight: 700;
            background: var(--input-bg);
            border: 2px solid var(--accent);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            color: var(--text-primary);
            font-family: var(--font-family);
        }

        .edit-actions {
            display: flex;
            gap: var(--space-2);
        }

        .portfolio-value {
            margin-bottom: var(--space-4);
        }

        .total-value {
            font-size: 2.5rem;
            font-weight: 800;
            color: var(--text-primary);
            margin-bottom: var(--space-1);
        }

        .value-change {
            font-size: 1.25rem;
            font-weight: 600;
        }

        .value-change.positive {
            color: var(--success);
        }

        .value-change.negative {
            color: var(--danger);
        }

        .portfolio-actions {
            display: flex;
            gap: var(--space-3);
            flex-shrink: 0;
        }

        .portfolio-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: var(--space-6);
            border-top: 1px solid var(--border);
            padding-top: var(--space-6);
        }

        .stat-item {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
        }

        .stat-item label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .stat-item value {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
        }

        .stat-item value.positive {
            color: var(--success);
        }

        .stat-item value.negative {
            color: var(--danger);
        }

        /* Layout */
        .portfolio-layout {
            display: grid;
            gap: var(--space-8);
            align-items: start;
        }

        @media (min-width: 1024px) {
            .portfolio-layout {
                grid-template-columns: 2fr 1fr;
            }
        }

        /* Summary cards */
        .portfolio-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--space-4);
            margin-bottom: var(--space-8);
        }

        .portfolio-summary-loading {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--space-4);
            margin-bottom: var(--space-8);
        }

        .summary-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: var(--space-5);
            text-align: center;
        }

        .summary-card.loading {
            padding: var(--space-6);
        }

        .summary-label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            font-weight: 500;
            margin-bottom: var(--space-2);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .summary-value {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text-primary);
        }

        .summary-value.positive {
            color: var(--success);
        }

        .summary-value.negative {
            color: var(--danger);
        }

        /* Sections */
        .portfolio-section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
            margin-bottom: var(--space-6);
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-6);
        }

        .section-header h3 {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0;
        }

        .section-count {
            font-size: 0.875rem;
            color: var(--text-secondary);
            background: var(--bg-secondary);
            padding: var(--space-1) var(--space-3);
            border-radius: var(--radius-full);
        }

        /* Order tabs */
        .order-tabs {
            display: flex;
            gap: var(--space-1);
            background: var(--bg-secondary);
            border-radius: var(--radius-md);
            padding: var(--space-1);
        }

        .tab-btn {
            background: none;
            border: none;
            padding: var(--space-2) var(--space-4);
            border-radius: var(--radius-sm);
            color: var(--text-secondary);
            font-weight: 500;
            cursor: pointer;
            transition: all var(--transition-fast);
            font-size: 0.875rem;
        }

        .tab-btn.active,
        .tab-btn:hover {
            background: var(--card-bg);
            color: var(--text-primary);
            box-shadow: var(--shadow-sm);
        }

        /* Tables */
        .positions-table-container,
        .orders-table-container {
            overflow-x: auto;
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
        }

        .positions-table,
        .orders-table {
            width: 100%;
            border-collapse: collapse;
        }

        .positions-table thead th,
        .orders-table thead th {
            background: var(--bg-secondary);
            padding: var(--space-3) var(--space-4);
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }

        .positions-table tbody td,
        .orders-table tbody td {
            padding: var(--space-4);
            border-bottom: 1px solid var(--border);
            font-size: 0.875rem;
            color: var(--text-primary);
        }

        .position-row:hover,
        .order-row:hover {
            background: var(--bg-secondary);
        }

        .position-row:last-child td,
        .order-row:last-child td {
            border-bottom: none;
        }

        .symbol-link {
            background: none;
            border: none;
            color: var(--accent);
            font-weight: 600;
            cursor: pointer;
            padding: 0;
            text-decoration: underline;
            font-size: inherit;
        }

        .symbol-link:hover {
            color: var(--accent-hover);
        }

        .position-actions,
        .position-card-actions,
        .order-card-actions {
            display: flex;
            gap: var(--space-2);
        }

        .positive {
            color: var(--success);
        }

        .negative {
            color: var(--danger);
        }

        .order-side.buy {
            color: var(--success);
            font-weight: 600;
        }

        .order-side.sell {
            color: var(--danger);
            font-weight: 600;
        }

        .order-status {
            padding: var(--space-1) var(--space-2);
            border-radius: var(--radius-sm);
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .status-open {
            background: rgba(59, 130, 246, 0.1);
            color: var(--accent);
        }

        .status-filled {
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
        }

        .status-cancelled {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }

        /* Mobile cards */
        .positions-mobile,
        .orders-mobile {
            display: none;
        }

        .position-card,
        .order-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: var(--space-4);
            margin-bottom: var(--space-3);
        }

        .position-card-header,
        .order-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-3);
        }

        .position-pnl {
            text-align: right;
            font-weight: 600;
        }

        .position-pnl small {
            display: block;
            font-size: 0.75rem;
            opacity: 0.8;
        }

        .position-card-details,
        .order-card-details {
            margin-bottom: var(--space-4);
        }

        .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-1) 0;
            font-size: 0.875rem;
        }

        .detail-row:first-child {
            border-top: 1px solid var(--border);
            padding-top: var(--space-2);
        }

        .detail-row span:first-child {
            color: var(--text-secondary);
        }

        .detail-row span:last-child {
            font-weight: 500;
            color: var(--text-primary);
        }

        .order-date {
            font-size: 0.75rem;
            color: var(--text-secondary);
        }

        /* Sidebar */
        .portfolio-sidebar {
            position: sticky;
            top: var(--space-6);
        }

        .sidebar-section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
            margin-bottom: var(--space-6);
        }

        .sidebar-section h3 {
            font-size: 1.125rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 var(--space-4) 0;
        }

        .performance-summary {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
        }

        .perf-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-2) 0;
            border-bottom: 1px solid var(--border);
        }

        .perf-item:last-child {
            border-bottom: none;
        }

        .perf-item label {
            font-size: 0.875rem;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .perf-item value {
            font-weight: 600;
            color: var(--text-primary);
            text-align: right;
        }

        .activity-list {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
            margin-bottom: var(--space-4);
        }

        .activity-item {
            border-bottom: 1px solid var(--border);
            padding-bottom: var(--space-3);
        }

        .activity-item:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .activity-content {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
        }

        .activity-text {
            font-size: 0.875rem;
            line-height: 1.4;
            color: var(--text-primary);
        }

        .activity-action.buy {
            color: var(--success);
            font-weight: 600;
        }

        .activity-action.sell {
            color: var(--danger);
            font-weight: 600;
        }

        .activity-time {
            font-size: 0.75rem;
            color: var(--text-secondary);
        }

        .quick-trade {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
        }

        .full-width {
            width: 100%;
        }

        /* Empty states */
        .empty-state {
            text-align: center;
            padding: var(--space-12) var(--space-4);
        }

        .empty-state.small {
            padding: var(--space-8) var(--space-4);
        }

        .empty-icon {
            font-size: 3rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-4);
            opacity: 0.5;
        }

        .empty-state h4 {
            font-size: 1.25rem;
            color: var(--text-primary);
            margin-bottom: var(--space-2);
        }

        .empty-state p {
            color: var(--text-secondary);
            margin-bottom: var(--space-6);
        }

        .empty-state.small .empty-icon {
            font-size: 2rem;
        }

        .empty-state.small p {
            margin-bottom: 0;
            font-size: 0.875rem;
        }

        /* Error states */
        .error-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-4);
            padding: var(--space-12);
            text-align: center;
        }

        .error-state i {
            font-size: 3rem;
            color: var(--danger);
            opacity: 0.7;
        }

        .error-state h3 {
            font-size: 1.5rem;
            color: var(--text-primary);
            margin: 0;
        }

        .error-state p {
            color: var(--text-secondary);
            margin: 0;
            max-width: 400px;
        }

        .error-actions {
            display: flex;
            gap: var(--space-3);
        }

        /* Responsive design */
        @media (max-width: 1023px) {
            .portfolio-sidebar {
                position: static;
                order: 2;
            }
        }

        @media (max-width: 767px) {
            .portfolio-page {
                padding: var(--space-4) var(--space-3);
            }

            .portfolio-header {
                padding: var(--space-4);
            }

            .portfolio-title-section {
                flex-direction: column;
                align-items: flex-start;
                gap: var(--space-4);
            }

            .total-value {
                font-size: 2rem;
            }

            .value-change {
                font-size: 1rem;
            }

            .portfolio-actions {
                width: 100%;
                justify-content: center;
            }

            .portfolio-stats {
                grid-template-columns: repeat(2, 1fr);
                gap: var(--space-4);
            }

            .portfolio-summary {
                grid-template-columns: repeat(2, 1fr);
            }

            .portfolio-section {
                padding: var(--space-4);
            }

            .sidebar-section {
                padding: var(--space-4);
            }

            /* Show mobile cards, hide tables */
            .positions-table-container,
            .orders-table-container {
                display: none;
            }

            .positions-mobile,
            .orders-mobile {
                display: block;
            }

            .order-tabs {
                flex-wrap: wrap;
                gap: var(--space-2);
                padding: var(--space-2);
            }

            .tab-btn {
                flex: 1;
                min-width: 0;
                padding: var(--space-2);
                font-size: 0.75rem;
            }
        }

        @media (max-width: 480px) {
            .portfolio-summary {
                grid-template-columns: 1fr;
            }

            .portfolio-stats {
                grid-template-columns: 1fr;
            }

            .edit-form {
                flex-direction: column;
                align-items: flex-start;
            }

            .portfolio-name-input {
                font-size: 1.5rem;
                width: 100%;
            }

            .error-actions {
                flex-direction: column;
                width: 100%;
            }
        }

        /* Loading states */
        .skeleton {
            background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-highlight) 50%, var(--skeleton-base) 75%);
            background-size: 200% 100%;
            animation: loading var(--duration-slow) infinite;
        }

        .skeleton-text {
            height: 1rem;
            border-radius: var(--radius-sm);
            margin-bottom: var(--space-2);
        }

        .skeleton-button {
            height: 2.5rem;
            border-radius: var(--radius-md);
            width: 120px;
        }

        @keyframes loading {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'portfolio-page-styles';
    styleEl.textContent = portfolioPageStyles;
    document.head.appendChild(styleEl);
}