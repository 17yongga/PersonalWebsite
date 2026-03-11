// Backtest Panel Page
// Inspired by QuantConnect Lean, TradingView Strategy Tester, and Backtrader
// Features: strategy picker, date range presets, equity curve vs SPY, drawdown chart,
//           monthly returns heatmap, key metrics, trade log

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { formatCurrency, formatPercent, formatDate, escapeHtml } from '../utils.js';

// ── Strategy definitions (mirrors server/src/routes/backtest.js) ─────────────

const STRATEGIES = {
    momentum: { name: 'Momentum Rider', icon: '🚀', color: '#3b82f6', description: 'RSI, MACD & EMA trend-following' },
    mean_reversion: { name: 'Contrarian', icon: '🔄', color: '#8b5cf6', description: 'Bollinger Band mean-reversion' },
    sector_rotation: { name: 'Sector Rotator', icon: '🌐', color: '#10b981', description: 'Relative-strength sector ETF rotation' },
    value_dividend: { name: 'Dividend Hunter', icon: '💰', color: '#f59e0b', description: 'Low P/E + high-yield dividends' },
    volatility_breakout: { name: 'Volatility Trader', icon: '⚡', color: '#ef4444', description: 'ATR breakout on high-beta stocks' },
};

const PRESETS = [
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: '1Y', days: 365 },
    { label: '2Y', days: 730 },
    { label: 'Custom', days: null },
];

function BacktestPage() {
    let equityChart = null;
    let drawdownChart = null;
    let currentResults = null;
    let selectedStrategy = 'momentum';
    let selectedPreset = '1Y';
    let customStart = null;
    let customEnd = null;

    // ── Helper: compute date range from preset ────────────────────────────────
    function getDateRange() {
        const preset = PRESETS.find(p => p.label === selectedPreset);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 1); // yesterday (market closed)
        const end = endDate.toISOString().split('T')[0];

        if (preset && preset.days) {
            const startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - preset.days);
            return { start: startDate.toISOString().split('T')[0], end };
        }
        return { start: customStart || '2023-01-01', end: customEnd || end };
    }

    // ── Render ────────────────────────────────────────────────────────────────
    async function render(container) {
        container.innerHTML = buildPageHTML();
        bindEvents(container);
    }

    function buildPageHTML() {
        return `
<div class="backtest-page">
    <!-- Header -->
    <div class="backtest-header">
        <div class="backtest-title-block">
            <h1 class="backtest-title">
                <i class="fas fa-flask"></i>
                Backtesting Lab
            </h1>
            <p class="backtest-subtitle">
                Replay any strategy against historical market data before going live
            </p>
        </div>
    </div>

    <!-- Controls -->
    <div class="backtest-controls card">
        <!-- Strategy Selector -->
        <div class="controls-section">
            <h3 class="controls-label">Strategy</h3>
            <div class="strategy-picker" id="strategy-picker">
                ${Object.entries(STRATEGIES).map(([key, s]) => `
                    <button class="strategy-pill ${key === selectedStrategy ? 'active' : ''}"
                            data-strategy="${key}"
                            style="--pill-color: ${s.color}">
                        <span class="pill-icon">${s.icon}</span>
                        <span class="pill-name">${s.name}</span>
                        <span class="pill-desc">${s.description}</span>
                    </button>
                `).join('')}
            </div>
        </div>

        <!-- Date Range + Capital -->
        <div class="controls-row">
            <div class="controls-section">
                <h3 class="controls-label">Date Range</h3>
                <div class="date-presets">
                    ${PRESETS.map(p => `
                        <button class="preset-btn ${p.label === selectedPreset ? 'active' : ''}"
                                data-preset="${p.label}">${p.label}</button>
                    `).join('')}
                </div>
                <div class="custom-dates ${selectedPreset === 'Custom' ? '' : 'hidden'}" id="custom-dates">
                    <input type="date" id="custom-start" class="date-input" placeholder="Start date"
                           value="${customStart || ''}" max="${new Date().toISOString().split('T')[0]}">
                    <span class="date-sep">→</span>
                    <input type="date" id="custom-end" class="date-input" placeholder="End date"
                           value="${customEnd || ''}" max="${new Date().toISOString().split('T')[0]}">
                </div>
            </div>

            <div class="controls-section">
                <h3 class="controls-label">Starting Capital</h3>
                <div class="capital-input-wrap">
                    <span class="capital-prefix">$</span>
                    <input type="number" id="capital-input" class="capital-input"
                           value="10000" min="1000" max="10000000" step="1000">
                </div>
            </div>

            <div class="controls-section controls-run">
                <button class="btn btn-primary btn-lg btn-run" id="run-backtest-btn">
                    <i class="fas fa-play"></i>
                    Run Backtest
                </button>
            </div>
        </div>
    </div>

    <!-- Loading State -->
    <div class="backtest-loading hidden" id="backtest-loading">
        <div class="loading-inner">
            <div class="loading-spinner">
                <div class="spinner-ring"></div>
                <div class="spinner-icon"><i class="fas fa-chart-area"></i></div>
            </div>
            <p class="loading-title">Running backtest…</p>
            <p class="loading-subtitle" id="loading-message">Fetching historical data from Alpaca</p>
        </div>
    </div>

    <!-- Results (hidden until run) -->
    <div class="backtest-results hidden" id="backtest-results">

        <!-- Results Header -->
        <div class="results-header" id="results-header"></div>

        <!-- Hero Metrics -->
        <div class="metrics-hero" id="metrics-hero"></div>

        <!-- Charts Row -->
        <div class="charts-row">
            <div class="card chart-card chart-card-main">
                <div class="chart-card-header">
                    <h3><i class="fas fa-chart-area"></i> Equity Curve</h3>
                    <div class="chart-legend">
                        <span class="legend-item"><span class="legend-dot strategy-dot"></span>Strategy</span>
                        <span class="legend-item"><span class="legend-dot spy-dot"></span>SPY Benchmark</span>
                    </div>
                </div>
                <canvas id="equity-chart" height="90"></canvas>
            </div>

            <div class="card chart-card chart-card-side">
                <div class="chart-card-header">
                    <h3><i class="fas fa-arrow-down"></i> Drawdown</h3>
                    <span class="chart-hint">Underwater equity — lower = deeper drawdown</span>
                </div>
                <canvas id="drawdown-chart" height="90"></canvas>
            </div>
        </div>

        <!-- Secondary Metrics + Monthly Heatmap -->
        <div class="stats-heatmap-row">
            <div class="card secondary-stats" id="secondary-stats"></div>
            <div class="card monthly-heatmap-card">
                <div class="chart-card-header">
                    <h3><i class="fas fa-th"></i> Monthly Returns</h3>
                </div>
                <div class="heatmap-container" id="monthly-heatmap"></div>
            </div>
        </div>

        <!-- Trade Log -->
        <div class="card trade-log-card">
            <div class="chart-card-header">
                <h3><i class="fas fa-list-alt"></i> Trade Log</h3>
                <div class="trade-log-stats" id="trade-log-stats"></div>
            </div>
            <div class="trade-log-table-wrap">
                <table class="trade-log-table" id="trade-log-table">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Qty</th>
                            <th>Entry $</th>
                            <th>Exit $</th>
                            <th>P&L</th>
                            <th>Return</th>
                            <th>Duration</th>
                            <th>Exit Reason</th>
                        </tr>
                    </thead>
                    <tbody id="trade-log-body"></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Empty state (before first run) -->
    <div class="backtest-empty" id="backtest-empty">
        <div class="empty-icon"><i class="fas fa-flask"></i></div>
        <h3>Ready to simulate</h3>
        <p>Pick a strategy and date range above, then hit Run Backtest to see how it would have performed.</p>
        <div class="empty-features">
            <span><i class="fas fa-check"></i> Equity curve vs SPY</span>
            <span><i class="fas fa-check"></i> Drawdown analysis</span>
            <span><i class="fas fa-check"></i> Monthly returns heatmap</span>
            <span><i class="fas fa-check"></i> Full trade log</span>
        </div>
    </div>
</div>
        `;
    }

    // ── Event binding ─────────────────────────────────────────────────────────
    function bindEvents(container) {
        // Strategy pills
        container.querySelectorAll('.strategy-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedStrategy = btn.dataset.strategy;
                container.querySelectorAll('.strategy-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Date presets
        container.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedPreset = btn.dataset.preset;
                container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const customDates = document.getElementById('custom-dates');
                if (selectedPreset === 'Custom') {
                    customDates.classList.remove('hidden');
                } else {
                    customDates.classList.add('hidden');
                }
            });
        });

        // Custom date inputs
        const startInput = document.getElementById('custom-start');
        const endInput = document.getElementById('custom-end');
        if (startInput) startInput.addEventListener('change', e => { customStart = e.target.value; });
        if (endInput) endInput.addEventListener('change', e => { customEnd = e.target.value; });

        // Run button
        const runBtn = document.getElementById('run-backtest-btn');
        if (runBtn) {
            runBtn.addEventListener('click', () => runBacktest(container));
        }
    }

    // ── Run backtest ──────────────────────────────────────────────────────────
    async function runBacktest(container) {
        const { start, end } = getDateRange();
        const capital = parseFloat(document.getElementById('capital-input').value) || 10000;
        const stratMeta = STRATEGIES[selectedStrategy];

        if (selectedPreset === 'Custom' && (!customStart || !customEnd)) {
            toast.error('Please set a custom start and end date.');
            return;
        }

        // Show loading
        document.getElementById('backtest-empty').classList.add('hidden');
        document.getElementById('backtest-results').classList.add('hidden');
        document.getElementById('backtest-loading').classList.remove('hidden');
        document.getElementById('run-backtest-btn').disabled = true;

        // Animated loading messages
        const msgs = [
            `Fetching ${stratMeta.name} historical data…`,
            'Running simulation day by day…',
            'Calculating performance metrics…',
            'Building equity curve vs SPY…',
            'Almost there…',
        ];
        let msgIdx = 0;
        const msgEl = document.getElementById('loading-message');
        const msgInterval = setInterval(() => {
            msgIdx = (msgIdx + 1) % msgs.length;
            if (msgEl) msgEl.textContent = msgs[msgIdx];
        }, 2800);

        try {
            const res = await api.post('/backtest/run', {
                strategy: selectedStrategy,
                startDate: start,
                endDate: end,
                initialCapital: capital,
            });

            clearInterval(msgInterval);
            currentResults = res.data;
            renderResults(container, res.data, res.meta, capital);
        } catch (err) {
            clearInterval(msgInterval);
            toast.error(err.message || 'Backtest failed — check the console for details.');
            document.getElementById('backtest-empty').classList.remove('hidden');
        } finally {
            document.getElementById('backtest-loading').classList.add('hidden');
            document.getElementById('run-backtest-btn').disabled = false;
        }
    }

    // ── Render results ────────────────────────────────────────────────────────
    function renderResults(container, data, meta, capital) {
        const strat = STRATEGIES[selectedStrategy];
        const m = data.metrics;

        // Results header
        document.getElementById('results-header').innerHTML = `
            <div class="results-title-row">
                <div class="results-strategy-badge" style="--badge-color: ${strat.color}">
                    <span>${strat.icon}</span>
                    <strong>${data.strategy_name}</strong>
                </div>
                <div class="results-period">
                    ${formatDate(data.start_date)} → ${formatDate(data.end_date)}
                    · Starting capital: ${formatCurrency(capital)}
                    · ${data.symbols_used?.length || 0} symbols
                </div>
            </div>
        `;

        // Hero metrics
        const totalReturn = m.total_return ?? 0;
        const finalValue = m.final_value ?? (capital * (1 + totalReturn));
        const pnl = finalValue - capital;

        document.getElementById('metrics-hero').innerHTML = `
            <div class="metric-hero-card">
                <div class="mh-label">Total Return</div>
                <div class="mh-value ${totalReturn >= 0 ? 'pos' : 'neg'}">
                    ${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(2)}%
                </div>
                <div class="mh-sub ${pnl >= 0 ? 'pos' : 'neg'}">
                    ${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}
                </div>
            </div>
            <div class="metric-hero-card">
                <div class="mh-label">Sharpe Ratio</div>
                <div class="mh-value ${(m.sharpe_ratio ?? 0) >= 1 ? 'pos' : (m.sharpe_ratio ?? 0) >= 0 ? 'neutral' : 'neg'}">
                    ${fmtNum(m.sharpe_ratio, 2)}
                </div>
                <div class="mh-sub">${sharpeRating(m.sharpe_ratio)}</div>
            </div>
            <div class="metric-hero-card">
                <div class="mh-label">Max Drawdown</div>
                <div class="mh-value neg">
                    ${((m.max_drawdown ?? 0) * 100).toFixed(2)}%
                </div>
                <div class="mh-sub">${m.max_drawdown_duration_days ?? 0} days underwater</div>
            </div>
            <div class="metric-hero-card">
                <div class="mh-label">Win Rate</div>
                <div class="mh-value ${(m.win_rate ?? 0) >= 0.5 ? 'pos' : 'neg'}">
                    ${((m.win_rate ?? 0) * 100).toFixed(1)}%
                </div>
                <div class="mh-sub">${m.total_trades ?? 0} trades</div>
            </div>
            <div class="metric-hero-card">
                <div class="mh-label">Final Value</div>
                <div class="mh-value">
                    ${formatCurrency(finalValue)}
                </div>
                <div class="mh-sub">From ${formatCurrency(capital)}</div>
            </div>
        `;

        // Secondary stats
        document.getElementById('secondary-stats').innerHTML = `
            <h3 class="secondary-stats-title"><i class="fas fa-microscope"></i> Deep Metrics</h3>
            <div class="stats-grid">
                ${statRow('Annualised Return', fmtPct(m.annualized_return))}
                ${statRow('Volatility (Ann.)', fmtPct(m.volatility))}
                ${statRow('Sortino Ratio', fmtNum(m.sortino_ratio, 2))}
                ${statRow('Calmar Ratio', fmtNum(m.calmar_ratio, 2))}
                ${statRow('Profit Factor', fmtNum(m.profit_factor, 2))}
                ${statRow('Avg Win', formatCurrency(m.avg_win ?? 0))}
                ${statRow('Avg Loss', formatCurrency(m.avg_loss ?? 0))}
                ${statRow('Largest Win', formatCurrency(m.largest_win ?? 0))}
                ${statRow('Largest Loss', formatCurrency(m.largest_loss ?? 0))}
                ${statRow('Avg Duration', `${fmtNum(m.avg_trade_duration, 1)} days`)}
                ${statRow('VaR 95%', fmtPct(m.var_95))}
                ${statRow('Expected Shortfall', fmtPct(m.expected_shortfall))}
                ${statRow('Backtest Period', `${m.backtest_days ?? 0} days`)}
            </div>
        `;

        // Charts
        renderEquityChart(data);
        renderDrawdownChart(data);
        renderMonthlyHeatmap(data.monthly_returns || []);
        renderTradeLog(data.trades || [], m);

        // Show results
        document.getElementById('backtest-results').classList.remove('hidden');
        document.getElementById('backtest-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ── Equity curve chart ────────────────────────────────────────────────────
    function renderEquityChart(data) {
        if (equityChart) equityChart.destroy();

        const strat = STRATEGIES[selectedStrategy];
        const ctx = document.getElementById('equity-chart');
        if (!ctx) return;

        const equityData = (data.equity_curve || []).map(r => ({ x: r.date, y: r.value }));
        const benchData = (data.benchmark_curve || []).map(r => ({ x: r.date, y: r.value }));

        equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: data.strategy_name,
                        data: equityData,
                        borderColor: strat.color,
                        backgroundColor: hexToRgba(strat.color, 0.1),
                        fill: true,
                        tension: 0.2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        borderWidth: 2,
                    },
                    {
                        label: 'SPY Benchmark',
                        data: benchData,
                        borderColor: '#94a3b8',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.2,
                        pointRadius: 0,
                        borderWidth: 1.5,
                        borderDash: [4, 3],
                    },
                ],
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 26, 0.95)',
                        borderColor: '#374151',
                        borderWidth: 1,
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', maxTicksLimit: 8 },
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#64748b',
                            callback: v => '$' + v.toLocaleString('en-US', { notation: 'compact' }),
                        },
                    },
                },
            },
        });
    }

    // ── Drawdown chart ────────────────────────────────────────────────────────
    function renderDrawdownChart(data) {
        if (drawdownChart) drawdownChart.destroy();

        const ctx = document.getElementById('drawdown-chart');
        if (!ctx) return;

        const ddData = (data.drawdown_curve || []).map(r => ({ x: r.date, y: r.drawdown }));

        drawdownChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Drawdown %',
                    data: ddData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    fill: true,
                    tension: 0.15,
                    pointRadius: 0,
                    borderWidth: 1.5,
                }],
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 26, 0.95)',
                        borderColor: '#374151',
                        borderWidth: 1,
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        callbacks: {
                            label: ctx => `Drawdown: ${ctx.parsed.y.toFixed(2)}%`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', maxTicksLimit: 8 },
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', callback: v => v + '%' },
                    },
                },
            },
        });
    }

    // ── Monthly returns heatmap ───────────────────────────────────────────────
    function renderMonthlyHeatmap(monthlyReturns) {
        const container = document.getElementById('monthly-heatmap');
        if (!container) return;

        if (!monthlyReturns.length) {
            container.innerHTML = '<p class="heatmap-empty">Not enough data for monthly breakdown</p>';
            return;
        }

        // Group by year
        const byYear = {};
        monthlyReturns.forEach(r => {
            if (!byYear[r.year]) byYear[r.year] = {};
            byYear[r.year][r.month] = r.return;
        });

        const years = Object.keys(byYear).sort();
        const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Find max abs return for colour scaling
        const allReturns = monthlyReturns.map(r => Math.abs(r.return));
        const maxAbs = Math.max(...allReturns, 5);

        let html = `
            <div class="heatmap-grid">
                <div class="heatmap-header-row">
                    <div class="heatmap-year-label"></div>
                    ${monthLabels.map(m => `<div class="heatmap-month-label">${m}</div>`).join('')}
                    <div class="heatmap-year-total-label">Total</div>
                </div>
        `;

        years.forEach(year => {
            const yearData = byYear[year];
            let yearTotal = 1;
            monthLabels.forEach((_, i) => {
                const m = i + 1;
                if (yearData[m] !== undefined) {
                    yearTotal *= (1 + yearData[m] / 100);
                }
            });
            const yearReturn = (yearTotal - 1) * 100;

            html += `
                <div class="heatmap-row">
                    <div class="heatmap-year-label">${year}</div>
                    ${monthLabels.map((_, i) => {
                        const m = i + 1;
                        const val = yearData[m];
                        if (val === undefined) return `<div class="heatmap-cell empty"></div>`;
                        const intensity = Math.min(Math.abs(val) / maxAbs, 1);
                        const color = val >= 0
                            ? `rgba(52, 211, 153, ${0.15 + intensity * 0.7})`
                            : `rgba(248, 113, 113, ${0.15 + intensity * 0.7})`;
                        const textColor = intensity > 0.5 ? '#fff' : (val >= 0 ? '#34d399' : '#f87171');
                        return `
                            <div class="heatmap-cell" style="background:${color}; color:${textColor}"
                                 title="${monthLabels[i]} ${year}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%">
                                ${val >= 0 ? '+' : ''}${val.toFixed(1)}%
                            </div>
                        `;
                    }).join('')}
                    <div class="heatmap-cell year-total ${yearReturn >= 0 ? 'pos' : 'neg'}">
                        ${yearReturn >= 0 ? '+' : ''}${yearReturn.toFixed(1)}%
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // ── Trade log ─────────────────────────────────────────────────────────────
    function renderTradeLog(trades, metrics) {
        const totalTrades = trades.length;
        const wins = trades.filter(t => t.pnl > 0).length;

        document.getElementById('trade-log-stats').innerHTML = `
            <span class="tl-stat">${totalTrades} trades</span>
            <span class="tl-stat pos">${wins} wins</span>
            <span class="tl-stat neg">${totalTrades - wins} losses</span>
        `;

        const tbody = document.getElementById('trade-log-body');
        if (!tbody) return;

        if (!trades.length) {
            tbody.innerHTML = '<tr><td colspan="10" class="no-trades">No trades executed in this period</td></tr>';
            return;
        }

        tbody.innerHTML = trades.map(t => `
            <tr class="${t.pnl >= 0 ? 'trade-win' : 'trade-loss'}">
                <td><span class="symbol-tag">${escapeHtml(t.symbol)}</span></td>
                <td>${t.entry_date}</td>
                <td>${t.exit_date}</td>
                <td>${t.quantity.toLocaleString()}</td>
                <td>$${t.entry_price.toFixed(2)}</td>
                <td>$${t.exit_price.toFixed(2)}</td>
                <td class="${t.pnl >= 0 ? 'pos' : 'neg'} fw-600">
                    ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
                </td>
                <td class="${t.pnl_pct >= 0 ? 'pos' : 'neg'}">
                    ${t.pnl_pct >= 0 ? '+' : ''}${(t.pnl_pct).toFixed(2)}%
                </td>
                <td>${t.duration_days}d</td>
                <td class="exit-reason">${escapeHtml(t.exit_reason || '—')}</td>
            </tr>
        `).join('');
    }

    // ── Utility helpers ───────────────────────────────────────────────────────
    function fmtNum(v, decimals = 2) {
        if (v == null || isNaN(v)) return '—';
        return Number(v).toFixed(decimals);
    }

    function fmtPct(v) {
        if (v == null || isNaN(v)) return '—';
        return `${(v * 100).toFixed(2)}%`;
    }

    function statRow(label, value) {
        return `
            <div class="stat-row">
                <span class="stat-label">${label}</span>
                <span class="stat-value">${value}</span>
            </div>
        `;
    }

    function sharpeRating(s) {
        if (s == null) return '';
        if (s >= 2) return '🔥 Excellent';
        if (s >= 1) return '✅ Good';
        if (s >= 0.5) return '⚠️ Acceptable';
        if (s >= 0) return '😐 Poor';
        return '❌ Negative';
    }

    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function destroy() {
        if (equityChart) equityChart.destroy();
        if (drawdownChart) drawdownChart.destroy();
    }

    return { render, destroy };
}

export default BacktestPage;
