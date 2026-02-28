// Strategies Page

import { api } from '../api.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import modal from '../components/modal.js';
import { formatCurrency, formatPercent, escapeHtml, formatDate } from '../utils.js';

function StrategiesPage() {
    let unsubscribers = [];
    let strategies = [];
    let selectedStrategy = null;

    async function render(container, params) {
        // Check if this is a strategy detail route
        if (params.id) {
            await renderStrategyDetail(container, params.id);
            return;
        }

        // Initial render with loading state
        container.innerHTML = `
            <div class="strategies">
                <div class="strategies-header">
                    <div class="strategies-title">
                        <h1>Trading Strategies</h1>
                        <p class="strategies-subtitle">Automated algorithmic trading strategies</p>
                    </div>
                    <button class="btn btn-primary" id="create-strategy-btn">
                        <i class="fas fa-plus"></i>
                        Create Strategy
                    </button>
                </div>

                <div class="strategies-content">
                    <div class="strategies-grid" id="strategies-grid">
                        ${renderLoadingSkeleton()}
                    </div>
                </div>
            </div>
        `;

        // Load strategies data
        await loadStrategies();

        // Bind event listeners
        bindEventListeners();

        // Set up real-time updates
        setupStoreSubscriptions();
    }

    async function renderStrategyDetail(container, strategyId) {
        container.innerHTML = `
            <div class="strategy-detail">
                <div class="strategy-detail-header">
                    <button class="btn btn-ghost" onclick="window.history.back()">
                        <i class="fas fa-arrow-left"></i>
                        Back to Strategies
                    </button>
                </div>
                <div class="strategy-detail-content" id="strategy-detail-content">
                    <div class="loading-skeleton">
                        <div class="skeleton skeleton-title"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                    </div>
                </div>
            </div>
        `;

        try {
            const strategy = await api.get(`/strategies/${strategyId}`);
            selectedStrategy = strategy;
            renderStrategyDetailContent();
        } catch (error) {
            console.error('Failed to load strategy:', error);
            toast.error('Failed to load strategy details');
            window.history.back();
        }
    }

    function renderStrategyDetailContent() {
        const container = document.getElementById('strategy-detail-content');
        if (!container || !selectedStrategy) return;

        const strategy = selectedStrategy;
        const metrics = strategy.performance || {};
        
        container.innerHTML = `
            <div class="strategy-detail-grid">
                <div class="strategy-detail-main">
                    <div class="strategy-header-card">
                        <div class="strategy-title-section">
                            <h1>${escapeHtml(strategy.name)}</h1>
                            <div class="strategy-meta">
                                ${renderStrategyTypeBadge(strategy.type)}
                                ${renderStrategyStatusBadge(strategy.status)}
                                <span class="strategy-created">Created ${formatDate(strategy.created_at)}</span>
                            </div>
                        </div>
                        <div class="strategy-controls">
                            <button class="btn btn-secondary" onclick="toggleStrategyStatus('${strategy.id}', '${strategy.status}')">
                                <i class="fas fa-${strategy.status === 'active' ? 'pause' : 'play'}"></i>
                                ${strategy.status === 'active' ? 'Pause' : 'Activate'}
                            </button>
                            <button class="btn btn-primary" onclick="runBacktest('${strategy.id}')">
                                <i class="fas fa-chart-bar"></i>
                                Run Backtest
                            </button>
                            <button class="btn btn-ghost" onclick="editStrategy('${strategy.id}')">
                                <i class="fas fa-edit"></i>
                                Edit
                            </button>
                        </div>
                    </div>

                    <div class="performance-metrics-card">
                        <h3>Performance Metrics</h3>
                        <div class="metrics-grid">
                            <div class="metric-item">
                                <div class="metric-label">Total Return</div>
                                <div class="metric-value ${metrics.total_return >= 0 ? 'positive' : 'negative'}">
                                    ${formatPercent(metrics.total_return || 0, 2, false)}
                                </div>
                            </div>
                            <div class="metric-item">
                                <div class="metric-label">Sharpe Ratio</div>
                                <div class="metric-value">${(metrics.sharpe_ratio || 0).toFixed(2)}</div>
                            </div>
                            <div class="metric-item">
                                <div class="metric-label">Win Rate</div>
                                <div class="metric-value">${formatPercent(metrics.win_rate || 0, 1, false)}</div>
                            </div>
                            <div class="metric-item">
                                <div class="metric-label">Max Drawdown</div>
                                <div class="metric-value negative">
                                    ${formatPercent(metrics.max_drawdown || 0, 2, false)}
                                </div>
                            </div>
                            <div class="metric-item">
                                <div class="metric-label">Total Trades</div>
                                <div class="metric-value">${metrics.total_trades || 0}</div>
                            </div>
                            <div class="metric-item">
                                <div class="metric-label">Avg Trade</div>
                                <div class="metric-value ${metrics.avg_trade >= 0 ? 'positive' : 'negative'}">
                                    ${formatPercent(metrics.avg_trade || 0, 2, false)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="equity-curve-card">
                        <h3>Equity Curve</h3>
                        <div class="chart-placeholder" id="equity-curve-chart">
                            <div class="chart-placeholder-content">
                                <i class="fas fa-chart-line"></i>
                                <p>Chart integration coming soon</p>
                                <small>Equity curve visualization will be added with Chart.js</small>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="strategy-detail-sidebar">
                    <div class="strategy-config-card">
                        <h3>Configuration</h3>
                        <div class="config-display" id="config-display">
                            ${renderStrategyConfig(strategy.config)}
                        </div>
                        <button class="btn btn-secondary btn-sm w-full" onclick="editStrategyConfig('${strategy.id}')">
                            <i class="fas fa-cog"></i>
                            Edit Configuration
                        </button>
                    </div>

                    <div class="backtest-history-card">
                        <h3>Backtest History</h3>
                        <div class="backtest-list" id="backtest-list">
                            <div class="loading-placeholder">
                                <div class="skeleton skeleton-text"></div>
                                <div class="skeleton skeleton-text"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="trade-log-section">
                <h3>Recent Trades</h3>
                <div class="trade-log-table" id="trade-log">
                    <div class="loading-placeholder">
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text"></div>
                    </div>
                </div>
            </div>
        `;

        // Load additional data
        loadBacktestHistory(strategy.id);
        loadTradeHistory(strategy.id);
    }

    async function loadStrategies() {
        try {
            const response = await api.get('/strategies');
            strategies = response.strategies || [];
            
            // Update store
            store.setState('strategies', strategies);
            
            renderStrategies();
        } catch (error) {
            console.error('Failed to load strategies:', error);
            renderStrategiesError();
        }
    }

    async function loadBacktestHistory(strategyId) {
        try {
            const response = await api.get(`/strategies/${strategyId}/runs`);
            const runs = response.runs || [];
            
            const container = document.getElementById('backtest-list');
            if (container) {
                if (runs.length === 0) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <p>No backtests run yet</p>
                        </div>
                    `;
                } else {
                    container.innerHTML = runs.map(run => `
                        <div class="backtest-item">
                            <div class="backtest-date">${formatDate(run.created_at)}</div>
                            <div class="backtest-return ${run.total_return >= 0 ? 'positive' : 'negative'}">
                                ${formatPercent(run.total_return, 2, false)}
                            </div>
                            <div class="backtest-trades">${run.trades_count} trades</div>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            console.warn('Failed to load backtest history:', error);
        }
    }

    async function loadTradeHistory(strategyId) {
        try {
            // This would load recent trades from the strategy
            const container = document.getElementById('trade-log');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>No recent trades</p>
                        <small>Trades will appear here when the strategy is active</small>
                    </div>
                `;
            }
        } catch (error) {
            console.warn('Failed to load trade history:', error);
        }
    }

    function renderStrategies() {
        const container = document.getElementById('strategies-grid');
        
        if (strategies.length === 0) {
            container.innerHTML = renderEmptyStrategies();
        } else {
            container.innerHTML = strategies.map(strategy => renderStrategyCard(strategy)).join('');
        }
    }

    function renderStrategyCard(strategy) {
        const metrics = strategy.performance || {};
        const totalReturn = metrics.total_return || 0;
        const sharpeRatio = metrics.sharpe_ratio || 0;
        const winRate = metrics.win_rate || 0;
        const totalTrades = metrics.total_trades || 0;

        return `
            <div class="strategy-card" data-strategy-id="${strategy.id}">
                <div class="strategy-card-header">
                    <div class="strategy-title">
                        <h3>${escapeHtml(strategy.name)}</h3>
                        <div class="strategy-badges">
                            ${renderStrategyTypeBadge(strategy.type)}
                            ${renderStrategyStatusBadge(strategy.status)}
                        </div>
                    </div>
                </div>

                <div class="strategy-metrics">
                    <div class="metric-row">
                        <div class="metric">
                            <span class="metric-label">Return</span>
                            <span class="metric-value ${totalReturn >= 0 ? 'positive' : 'negative'}">
                                ${formatPercent(totalReturn, 1, false)}
                            </span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Sharpe</span>
                            <span class="metric-value">${sharpeRatio.toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="metric-row">
                        <div class="metric">
                            <span class="metric-label">Win Rate</span>
                            <span class="metric-value">${formatPercent(winRate, 1, false)}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Trades</span>
                            <span class="metric-value">${totalTrades}</span>
                        </div>
                    </div>
                </div>

                <div class="strategy-actions">
                    <button class="toggle-btn ${strategy.status === 'active' ? 'active' : ''}" 
                            onclick="toggleStrategyStatus('${strategy.id}', '${strategy.status}')">
                        <i class="fas fa-${strategy.status === 'active' ? 'pause' : 'play'}"></i>
                        ${strategy.status === 'active' ? 'Pause' : strategy.status === 'paused' ? 'Resume' : 'Activate'}
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="viewStrategyDetails('${strategy.id}')">
                        View Details
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="runBacktest('${strategy.id}')">
                        <i class="fas fa-chart-bar"></i>
                        Backtest
                    </button>
                </div>
            </div>
        `;
    }

    function renderStrategyTypeBadge(type) {
        const types = {
            'momentum': { label: 'Momentum', icon: 'fas fa-arrow-trend-up', color: 'accent' },
            'mean_reversion': { label: 'Mean Reversion', icon: 'fas fa-arrows-left-right', color: 'warning' },
            'sentiment': { label: 'Sentiment', icon: 'fas fa-comments', color: 'info' }
        };

        const typeInfo = types[type] || { label: type, icon: 'fas fa-robot', color: 'secondary' };
        
        return `
            <span class="badge badge-${typeInfo.color}">
                <i class="${typeInfo.icon}"></i>
                ${typeInfo.label}
            </span>
        `;
    }

    function renderStrategyStatusBadge(status) {
        const statuses = {
            'active': { label: 'Active', icon: '🟢', color: 'success' },
            'paused': { label: 'Paused', icon: '🟡', color: 'warning' },
            'backtest': { label: 'Backtest Only', icon: '🔵', color: 'info' }
        };

        const statusInfo = statuses[status] || { label: status, icon: '⚪', color: 'secondary' };
        
        return `
            <span class="badge badge-${statusInfo.color}">
                ${statusInfo.icon} ${statusInfo.label}
            </span>
        `;
    }

    function renderStrategyConfig(config) {
        if (!config || typeof config !== 'object') {
            return '<div class="config-item"><span class="config-empty">No configuration</span></div>';
        }

        return Object.entries(config).map(([key, value]) => `
            <div class="config-item">
                <span class="config-key">${escapeHtml(key)}:</span>
                <span class="config-value">${escapeHtml(String(value))}</span>
            </div>
        `).join('');
    }

    function renderLoadingSkeleton() {
        return Array(4).fill(0).map(() => `
            <div class="strategy-card loading">
                <div class="strategy-card-header">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-text" style="width: 60%;"></div>
                </div>
                <div class="strategy-metrics">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text"></div>
                </div>
                <div class="strategy-actions">
                    <div class="skeleton skeleton-button"></div>
                    <div class="skeleton skeleton-button"></div>
                </div>
            </div>
        `).join('');
    }

    function renderEmptyStrategies() {
        return `
            <div class="empty-strategies">
                <div class="empty-icon">🤖</div>
                <h3>No strategies yet</h3>
                <p>Create your first automated trading strategy to start algorithmic trading</p>
                <button class="btn btn-primary" onclick="showCreateStrategyModal()">
                    <i class="fas fa-plus"></i>
                    Create Your First Strategy
                </button>
            </div>
        `;
    }

    function renderStrategiesError() {
        document.getElementById('strategies-grid').innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load strategies</p>
                <button class="btn btn-secondary" onclick="retryLoadStrategies()">
                    Retry
                </button>
            </div>
        `;
    }

    function bindEventListeners() {
        // Create strategy button
        const createStrategyBtn = document.getElementById('create-strategy-btn');
        if (createStrategyBtn) {
            createStrategyBtn.addEventListener('click', showCreateStrategyModal);
        }
    }

    function setupStoreSubscriptions() {
        // Subscribe to strategy changes
        unsubscribers.push(
            store.subscribe('strategies', (newStrategies) => {
                strategies = newStrategies || [];
                renderStrategies();
            })
        );
    }

    function showCreateStrategyModal() {
        modal.show({
            title: 'Create New Strategy',
            content: `
                <form id="create-strategy-form" class="create-strategy-form">
                    <div class="form-group">
                        <label class="form-label" for="strategy-name">Strategy Name</label>
                        <input type="text" 
                               id="strategy-name" 
                               class="form-input" 
                               required 
                               placeholder="Enter strategy name"
                               maxlength="50">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="strategy-type">Strategy Type</label>
                        <select id="strategy-type" class="form-input" required>
                            <option value="">Select strategy type...</option>
                            <option value="momentum">Momentum</option>
                            <option value="mean_reversion">Mean Reversion</option>
                            <option value="sentiment">Sentiment</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="strategy-portfolio">Assign to Portfolio</label>
                        <select id="strategy-portfolio" class="form-input" required>
                            <option value="">Select portfolio...</option>
                            <!-- Portfolios will be populated dynamically -->
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="starting-balance">Starting Balance</label>
                        <input type="number" 
                               id="starting-balance" 
                               class="form-input" 
                               required 
                               placeholder="10000"
                               value="10000"
                               min="1000"
                               max="1000000"
                               step="1000">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Symbol Universe</label>
                        <div class="symbol-universe-section">
                            <div class="symbol-checkboxes" id="symbol-universe">
                                <label class="checkbox-item"><input type="checkbox" value="SPY"> SPY</label>
                                <label class="checkbox-item"><input type="checkbox" value="QQQ"> QQQ</label>
                                <label class="checkbox-item"><input type="checkbox" value="IWM"> IWM</label>
                                <label class="checkbox-item"><input type="checkbox" value="AAPL"> AAPL</label>
                                <label class="checkbox-item"><input type="checkbox" value="MSFT"> MSFT</label>
                                <label class="checkbox-item"><input type="checkbox" value="GOOGL"> GOOGL</label>
                                <label class="checkbox-item"><input type="checkbox" value="TSLA"> TSLA</label>
                                <label class="checkbox-item"><input type="checkbox" value="NVDA"> NVDA</label>
                            </div>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="strategy-config">Configuration (JSON)</label>
                        <textarea id="strategy-config" 
                                  class="form-textarea" 
                                  rows="6"
                                  placeholder='{"lookback_period": 20, "threshold": 0.02}'></textarea>
                        <div class="form-help">Strategy-specific parameters in JSON format</div>
                    </div>
                </form>
            `,
            actions: [
                {
                    text: 'Cancel',
                    variant: 'secondary'
                },
                {
                    text: 'Create Strategy',
                    variant: 'primary',
                    onClick: async () => {
                        return await handleCreateStrategy();
                    }
                }
            ],
            size: 'lg'
        });

        // Populate portfolios dropdown
        populatePortfoliosDropdown();

        // Focus the name input
        setTimeout(() => {
            const nameInput = document.getElementById('strategy-name');
            if (nameInput) nameInput.focus();
        }, 100);
    }

    function populatePortfoliosDropdown() {
        const portfolios = store.getState('portfolios') || [];
        const select = document.getElementById('strategy-portfolio');
        
        if (select && portfolios.length > 0) {
            // Clear existing options except the first one
            select.innerHTML = '<option value="">Select portfolio...</option>';
            
            portfolios.forEach(portfolio => {
                const option = document.createElement('option');
                option.value = portfolio.id;
                option.textContent = portfolio.name;
                select.appendChild(option);
            });
        }
    }

    async function handleCreateStrategy() {
        const nameInput = document.getElementById('strategy-name');
        const typeSelect = document.getElementById('strategy-type');
        const portfolioSelect = document.getElementById('strategy-portfolio');
        const balanceInput = document.getElementById('starting-balance');
        const configTextarea = document.getElementById('strategy-config');
        
        const name = nameInput.value.trim();
        const type = typeSelect.value;
        const portfolioId = portfolioSelect.value;
        const startingBalance = parseFloat(balanceInput.value);
        const configText = configTextarea.value.trim();

        // Get selected symbols
        const symbolCheckboxes = document.querySelectorAll('#symbol-universe input[type="checkbox"]:checked');
        const symbols = Array.from(symbolCheckboxes).map(cb => cb.value);

        // Validation
        if (!name) {
            toast.error('Strategy name is required');
            return false;
        }

        if (!type) {
            toast.error('Strategy type is required');
            return false;
        }

        if (!portfolioId) {
            toast.error('Please select a portfolio');
            return false;
        }

        if (symbols.length === 0) {
            toast.error('Please select at least one symbol');
            return false;
        }

        // Parse config JSON
        let config = {};
        if (configText) {
            try {
                config = JSON.parse(configText);
            } catch (error) {
                toast.error('Invalid JSON configuration');
                return false;
            }
        }

        try {
            const response = await api.post('/strategies', {
                name,
                type,
                portfolio_id: portfolioId,
                starting_balance: startingBalance,
                config: { ...config, symbols },
                status: 'backtest' // Start as backtest only
            });

            const newStrategy = response.strategy;
            strategies = [...strategies, newStrategy];
            store.setState('strategies', strategies);

            toast.success(`Strategy "${name}" created successfully!`);
            
            return true; // Close modal
        } catch (error) {
            console.error('Failed to create strategy:', error);
            toast.error('Failed to create strategy. Please try again.');
            return false;
        }
    }

    // Global functions for event handlers
    window.showCreateStrategyModal = showCreateStrategyModal;
    
    window.viewStrategyDetails = (strategyId) => {
        window.location.hash = `#/strategies/${strategyId}`;
    };
    
    window.toggleStrategyStatus = async (strategyId, currentStatus) => {
        const newStatus = currentStatus === 'active' ? 'paused' : 'active';
        
        try {
            await api.patch(`/strategies/${strategyId}`, { status: newStatus });
            
            // Update local state
            const updatedStrategies = strategies.map(s => 
                s.id === strategyId ? { ...s, status: newStatus } : s
            );
            store.setState('strategies', updatedStrategies);
            
            toast.success(`Strategy ${newStatus === 'active' ? 'activated' : 'paused'}`);
            
            // Reload strategies to get fresh data
            await loadStrategies();
        } catch (error) {
            console.error('Failed to update strategy status:', error);
            toast.error('Failed to update strategy status');
        }
    };
    
    window.runBacktest = async (strategyId) => {
        try {
            toast.info('Starting backtest...');
            
            await api.post(`/strategies/${strategyId}/backtest`);
            
            toast.success('Backtest started! Results will be available shortly.');
            
            // Reload strategy data after a delay
            setTimeout(() => loadStrategies(), 2000);
        } catch (error) {
            console.error('Failed to run backtest:', error);
            toast.error('Failed to start backtest');
        }
    };
    
    window.editStrategy = (strategyId) => {
        // This would open the edit modal - for now just show a placeholder
        toast.info('Strategy editing coming soon');
    };
    
    window.editStrategyConfig = (strategyId) => {
        // This would open config editor - for now just show a placeholder
        toast.info('Configuration editor coming soon');
    };
    
    window.retryLoadStrategies = () => {
        loadStrategies();
    };

    function destroy() {
        // Clean up subscriptions
        unsubscribers.forEach(unsub => unsub());
        unsubscribers = [];

        // Clean up global functions
        if (window.showCreateStrategyModal) delete window.showCreateStrategyModal;
        if (window.viewStrategyDetails) delete window.viewStrategyDetails;
        if (window.toggleStrategyStatus) delete window.toggleStrategyStatus;
        if (window.runBacktest) delete window.runBacktest;
        if (window.editStrategy) delete window.editStrategy;
        if (window.editStrategyConfig) delete window.editStrategyConfig;
        if (window.retryLoadStrategies) delete window.retryLoadStrategies;
    }

    return { render, destroy };
}

// Export the page function
export default StrategiesPage;

// Add strategies page specific styles
if (!document.getElementById('strategies-page-styles')) {
    const strategiesPageStyles = `
        .strategies {
            max-width: var(--max-width-2xl);
            margin: 0 auto;
            padding: var(--space-6) var(--space-4);
        }

        .strategies-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-8);
            gap: var(--space-4);
        }

        .strategies-title h1 {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0 0 var(--space-1) 0;
        }

        .strategies-subtitle {
            color: var(--text-secondary);
            font-size: 1rem;
            margin: 0;
        }

        .strategies-grid {
            display: grid;
            gap: var(--space-6);
            grid-template-columns: 1fr;
        }

        @media (min-width: 768px) {
            .strategies-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (min-width: 1200px) {
            .strategies-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }

        .strategy-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
            transition: all var(--transition-medium);
            position: relative;
            overflow: hidden;
        }

        .strategy-card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
            border-color: var(--accent);
        }

        .strategy-card-header {
            margin-bottom: var(--space-4);
        }

        .strategy-title h3 {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 var(--space-2) 0;
        }

        .strategy-badges {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-1) var(--space-2);
            font-size: 0.75rem;
            font-weight: 500;
            border-radius: var(--radius-full);
            text-transform: uppercase;
            letter-spacing: 0.025em;
        }

        .badge-success {
            background: rgba(34, 197, 94, 0.1);
            color: var(--success);
            border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .badge-warning {
            background: rgba(245, 158, 11, 0.1);
            color: var(--warning);
            border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .badge-info {
            background: rgba(59, 130, 246, 0.1);
            color: var(--info);
            border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .badge-accent {
            background: rgba(59, 130, 246, 0.1);
            color: var(--accent);
            border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .badge-secondary {
            background: rgba(156, 163, 175, 0.1);
            color: var(--text-secondary);
            border: 1px solid var(--border);
        }

        .strategy-metrics {
            margin-bottom: var(--space-4);
        }

        .metric-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: var(--space-3);
        }

        .metric-row:last-child {
            margin-bottom: 0;
        }

        .metric {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }

        .metric-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-1);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 500;
        }

        .metric-value {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-primary);
        }

        .metric-value.positive {
            color: var(--success);
        }

        .metric-value.negative {
            color: var(--danger);
        }

        .strategy-actions {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .toggle-btn {
            flex: 1;
            padding: var(--space-2) var(--space-3);
            border: 1px solid var(--border);
            background: var(--bg-primary);
            color: var(--text-secondary);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--transition-fast);
            font-size: 0.875rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-1);
        }

        .toggle-btn:hover {
            border-color: var(--accent);
            color: var(--accent);
        }

        .toggle-btn.active {
            background: var(--success);
            border-color: var(--success);
            color: white;
        }

        .btn-sm {
            padding: var(--space-1) var(--space-2);
            font-size: 0.75rem;
        }

        /* Empty state */
        .empty-strategies {
            grid-column: 1 / -1;
            text-align: center;
            padding: var(--space-12) var(--space-4);
        }

        .empty-icon {
            font-size: 4rem;
            margin-bottom: var(--space-4);
            opacity: 0.3;
        }

        .empty-strategies h3 {
            font-size: 1.5rem;
            color: var(--text-primary);
            margin-bottom: var(--space-2);
        }

        .empty-strategies p {
            color: var(--text-secondary);
            margin-bottom: var(--space-6);
            max-width: 400px;
            margin-left: auto;
            margin-right: auto;
        }

        /* Strategy Detail Page */
        .strategy-detail {
            max-width: var(--max-width-2xl);
            margin: 0 auto;
            padding: var(--space-6) var(--space-4);
        }

        .strategy-detail-header {
            margin-bottom: var(--space-6);
        }

        .strategy-detail-grid {
            display: grid;
            gap: var(--space-6);
            margin-bottom: var(--space-8);
        }

        @media (min-width: 1024px) {
            .strategy-detail-grid {
                grid-template-columns: 2fr 1fr;
            }
        }

        .strategy-header-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: var(--space-4);
            margin-bottom: var(--space-6);
        }

        .strategy-title-section h1 {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0 0 var(--space-2) 0;
        }

        .strategy-meta {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            flex-wrap: wrap;
        }

        .strategy-created {
            font-size: 0.875rem;
            color: var(--text-secondary);
        }

        .strategy-controls {
            display: flex;
            gap: var(--space-2);
            flex-shrink: 0;
        }

        .performance-metrics-card,
        .equity-curve-card,
        .strategy-config-card,
        .backtest-history-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
            margin-bottom: var(--space-6);
        }

        .performance-metrics-card h3,
        .equity-curve-card h3,
        .strategy-config-card h3,
        .backtest-history-card h3 {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 var(--space-4) 0;
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: var(--space-4);
        }

        @media (max-width: 767px) {
            .metrics-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        .metric-item {
            text-align: center;
        }

        .metric-item .metric-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-1);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .metric-item .metric-value {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
        }

        .chart-placeholder {
            height: 300px;
            border: 2px dashed var(--border);
            border-radius: var(--radius-lg);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .chart-placeholder-content {
            text-align: center;
            color: var(--text-secondary);
        }

        .chart-placeholder-content i {
            font-size: 3rem;
            margin-bottom: var(--space-2);
            opacity: 0.3;
        }

        .config-display {
            margin-bottom: var(--space-4);
        }

        .config-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-2) 0;
            border-bottom: 1px solid var(--border);
        }

        .config-item:last-child {
            border-bottom: none;
        }

        .config-key {
            font-weight: 500;
            color: var(--text-primary);
        }

        .config-value {
            color: var(--text-secondary);
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.875rem;
        }

        .config-empty {
            color: var(--text-secondary);
            font-style: italic;
        }

        .backtest-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-3) 0;
            border-bottom: 1px solid var(--border);
        }

        .backtest-item:last-child {
            border-bottom: none;
        }

        .backtest-date {
            font-size: 0.875rem;
            color: var(--text-secondary);
        }

        .backtest-return {
            font-weight: 600;
        }

        .backtest-trades {
            font-size: 0.75rem;
            color: var(--text-secondary);
        }

        .trade-log-section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
        }

        .trade-log-section h3 {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 var(--space-4) 0;
        }

        /* Create Strategy Form */
        .create-strategy-form .form-group {
            margin-bottom: var(--space-4);
        }

        .symbol-universe-section {
            margin-top: var(--space-2);
        }

        .symbol-checkboxes {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: var(--space-2);
        }

        @media (max-width: 767px) {
            .symbol-checkboxes {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        .checkbox-item {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--transition-fast);
            font-size: 0.875rem;
        }

        .checkbox-item:hover {
            border-color: var(--accent);
            background: rgba(59, 130, 246, 0.05);
        }

        .checkbox-item input[type="checkbox"] {
            margin: 0;
        }

        /* Responsive Design */
        @media (max-width: 1023px) {
            .strategy-detail-grid {
                grid-template-columns: 1fr;
            }
            
            .strategy-detail-sidebar {
                order: -1;
            }
        }

        @media (max-width: 767px) {
            .strategies {
                padding: var(--space-4) var(--space-3);
            }
            
            .strategies-header {
                flex-direction: column;
                align-items: flex-start;
                gap: var(--space-3);
            }
            
            .strategies-title h1 {
                font-size: 1.5rem;
            }
            
            .strategies-grid {
                grid-template-columns: 1fr;
            }
            
            .strategy-header-card {
                flex-direction: column;
                align-items: stretch;
            }
            
            .strategy-controls {
                justify-content: stretch;
            }
            
            .strategy-controls .btn {
                flex: 1;
            }
        }

        /* Loading and Error States */
        .loading-placeholder,
        .empty-state,
        .error-state {
            padding: var(--space-6);
            text-align: center;
            color: var(--text-secondary);
        }

        .error-state i {
            font-size: 2rem;
            color: var(--danger);
            opacity: 0.7;
            margin-bottom: var(--space-2);
        }

        .w-full {
            width: 100%;
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'strategies-page-styles';
    styleEl.textContent = strategiesPageStyles;
    document.head.appendChild(styleEl);
}