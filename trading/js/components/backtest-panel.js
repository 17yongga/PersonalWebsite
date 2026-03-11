/**
 * BacktestPanel — self-contained, embeddable backtest component.
 * Drop it into any strategy detail page.
 *
 * Usage:
 *   const panel = new BacktestPanel({ strategyKey: 'momentum', strategyName: 'Momentum Rider', color: '#3b82f6' });
 *   panel.mount(containerElement);
 *   // later:
 *   panel.destroy();
 */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3005'
    : 'https://api.gary-yong.com';

// ── Slug → Python key map (for public detail page slugs) ─────────────────────
export const SLUG_TO_KEY = {
    'momentum-hunter':     'momentum',
    'mean-reversion':      'mean_reversion',
    'sector-rotator':      'sector_rotation',
    'value-dividends':     'value_dividend',
    'volatility-breakout': 'volatility_breakout',
};

// ── Name/type → Python key map (for authenticated strategies page) ────────────
export const NAME_TO_KEY = {
    'Momentum Rider':      'momentum',
    'Contrarian':          'mean_reversion',
    'Sector Rotator':      'sector_rotation',
    'Dividend Hunter':     'value_dividend',
    'Volatility Trader':   'volatility_breakout',
    // type-field fallbacks
    'momentum':            'momentum',
    'mean_reversion':      'mean_reversion',
    'sector_rotation':     'sector_rotation',
    'value_dividend':      'value_dividend',
    'volatility_breakout': 'volatility_breakout',
    'sentiment':           'momentum', // closest fallback
};

const PRESETS = [
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: '1Y', days: 365 },
    { label: '2Y', days: 730 },
];

export class BacktestPanel {
    constructor({ strategyKey, strategyName, color = '#3b82f6' }) {
        this.strategyKey = strategyKey;
        this.strategyName = strategyName;
        this.color = color;
        this.selectedPreset = '1Y';
        this.equityChart = null;
        this.drawdownChart = null;
        this._container = null;
        this._id = `bt-${Math.random().toString(36).slice(2, 8)}`;
    }

    mount(container) {
        this._container = container;
        container.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    destroy() {
        if (this.equityChart) { this.equityChart.destroy(); this.equityChart = null; }
        if (this.drawdownChart) { this.drawdownChart.destroy(); this.drawdownChart = null; }
    }

    // ── HTML ────────────────────────────────────────────────────────────────────

    _buildHTML() {
        const id = this._id;
        return `
<div class="btp-wrap" id="${id}-wrap">
    <style>
        /* scoped to .btp-wrap to avoid conflicts with other page styles */
        .btp-wrap { font-family: var(--font-family, 'Inter', sans-serif); color: var(--text-primary, #e2e8f0); }
        .btp-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1.25rem; }
        .btp-field { display: flex; flex-direction: column; gap: 0.3rem; }
        .btp-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-secondary, #94a3b8); }
        .btp-presets { display: flex; gap: 0.375rem; }
        .btp-preset { padding: 0.35rem 0.75rem; background: var(--bg-tertiary, #2d2d44); border: 1px solid var(--border, #374151); border-radius: 6px; color: var(--text-secondary, #94a3b8); font-size: 0.82rem; font-weight: 500; cursor: pointer; transition: all 0.15s; }
        .btp-preset:hover { border-color: ${this.color}; color: ${this.color}; }
        .btp-preset.active { background: ${this.color}; border-color: ${this.color}; color: #fff; }
        .btp-capital-wrap { display: flex; align-items: center; background: var(--input-bg, #2d2d44); border: 1px solid var(--border, #374151); border-radius: 6px; overflow: hidden; }
        .btp-capital-prefix { padding: 0.35rem 0.6rem; background: var(--bg-tertiary, #1e1e32); color: var(--text-secondary, #94a3b8); font-size: 0.82rem; border-right: 1px solid var(--border, #374151); }
        .btp-capital { padding: 0.35rem 0.6rem; background: transparent; border: none; color: var(--text-primary, #e2e8f0); font-size: 0.82rem; outline: none; width: 100px; }
        .btp-run { display: flex; align-items: center; gap: 0.4rem; padding: 0.45rem 1.25rem; background: ${this.color}; border: none; border-radius: 6px; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; white-space: nowrap; }
        .btp-run:hover { opacity: 0.85; }
        .btp-run:disabled { opacity: 0.5; cursor: not-allowed; }
        .btp-loading { display: flex; align-items: center; gap: 0.75rem; color: var(--text-secondary, #94a3b8); font-size: 0.85rem; padding: 2.5rem 0; }
        .btp-loading.hidden, .btp-results.hidden, .btp-empty.hidden { display: none; }
        .btp-spin { width: 18px; height: 18px; border: 2px solid var(--border, #374151); border-top-color: ${this.color}; border-radius: 50%; animation: btp-spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes btp-spin { to { transform: rotate(360deg); } }

        /* Hero metrics */
        .btp-hero { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.75rem; margin-bottom: 1.25rem; }
        .btp-metric { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #374151); border-radius: 10px; padding: 0.9rem 1rem; text-align: center; }
        .btp-metric-label { font-size: 0.67rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-secondary, #94a3b8); margin-bottom: 0.35rem; }
        .btp-metric-val { font-size: 1.35rem; font-weight: 700; line-height: 1; margin-bottom: 0.2rem; }
        .btp-metric-sub { font-size: 0.7rem; color: var(--text-secondary, #94a3b8); }
        .btp-pos { color: #34d399; }
        .btp-neg { color: #f87171; }
        .btp-neutral { color: #fbbf24; }

        /* Charts */
        .btp-charts { display: grid; grid-template-columns: 1fr 380px; gap: 1rem; margin-bottom: 1.25rem; }
        .btp-chart-card { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #374151); border-radius: 10px; padding: 1rem; }
        .btp-chart-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem; }
        .btp-chart-title { font-size: 0.82rem; font-weight: 600; color: var(--text-primary, #e2e8f0); display: flex; align-items: center; gap: 0.35rem; }
        .btp-legend { display: flex; gap: 1rem; }
        .btp-leg { display: flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; color: var(--text-secondary, #94a3b8); }
        .btp-dot { width: 10px; height: 3px; border-radius: 2px; }
        .btp-chart-hint { font-size: 0.7rem; color: var(--text-secondary, #94a3b8); }

        /* Bottom row: stats + heatmap */
        .btp-bottom { display: grid; grid-template-columns: 260px 1fr; gap: 1rem; margin-bottom: 1.25rem; }
        .btp-stats-card, .btp-heatmap-card { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #374151); border-radius: 10px; padding: 1rem; }
        .btp-stats-title { font-size: 0.78rem; font-weight: 600; color: var(--text-primary, #e2e8f0); margin: 0 0 0.75rem; display: flex; align-items: center; gap: 0.3rem; }
        .btp-stat-row { display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .btp-stat-label { font-size: 0.73rem; color: var(--text-secondary, #94a3b8); }
        .btp-stat-val { font-size: 0.76rem; font-weight: 500; color: var(--text-primary, #e2e8f0); font-variant-numeric: tabular-nums; }

        /* Heatmap */
        .btp-heatmap-title { font-size: 0.78rem; font-weight: 600; color: var(--text-primary, #e2e8f0); margin: 0 0 0.75rem; display: flex; align-items: center; gap: 0.3rem; }
        .btp-hm-grid { display: flex; flex-direction: column; gap: 2px; overflow-x: auto; }
        .btp-hm-row { display: grid; grid-template-columns: 40px repeat(12, 1fr) 52px; gap: 2px; align-items: center; min-width: 560px; }
        .btp-hm-year { font-size: 0.67rem; color: var(--text-secondary, #94a3b8); font-weight: 600; text-align: right; padding-right: 4px; }
        .btp-hm-month { font-size: 0.65rem; color: var(--text-secondary, #94a3b8); text-align: center; font-weight: 600; }
        .btp-hm-cell { height: 30px; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 0.62rem; font-weight: 600; cursor: default; background: var(--bg-tertiary, #2d2d44); color: var(--text-secondary, #94a3b8); }
        .btp-hm-cell.empty { background: transparent; }
        .btp-hm-total { font-size: 0.65rem; font-weight: 700; text-align: center; }

        /* Trade log */
        .btp-trades-card { background: var(--bg-secondary, #1a1a2e); border: 1px solid var(--border, #374151); border-radius: 10px; padding: 1rem; }
        .btp-trades-hdr { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
        .btp-trades-title { font-size: 0.82rem; font-weight: 600; color: var(--text-primary, #e2e8f0); display: flex; align-items: center; gap: 0.35rem; }
        .btp-trades-stats { display: flex; gap: 1rem; font-size: 0.73rem; color: var(--text-secondary, #94a3b8); }
        .btp-trades-scroll { overflow-x: auto; max-height: 320px; overflow-y: auto; }
        table.btp-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
        table.btp-table th { text-align: left; padding: 0.35rem 0.6rem; font-size: 0.67rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary, #94a3b8); background: var(--bg-primary, #0f0f1a); position: sticky; top: 0; white-space: nowrap; border-bottom: 1px solid var(--border, #374151); }
        table.btp-table td { padding: 0.3rem 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.04); color: var(--text-primary, #e2e8f0); white-space: nowrap; font-variant-numeric: tabular-nums; }
        table.btp-table tbody tr:hover { background: rgba(255,255,255,0.03); }
        .btp-sym { background: var(--bg-tertiary, #2d2d44); border: 1px solid var(--border, #374151); border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 0.7rem; font-weight: 700; }
        .btp-no-trades { text-align: center; padding: 1.5rem; color: var(--text-secondary, #94a3b8); font-size: 0.82rem; }
        .btp-auth-note { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25); border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.82rem; color: var(--text-secondary, #94a3b8); text-align: center; }
        .btp-auth-note a { color: ${this.color}; }

        @media (max-width: 1100px) { .btp-charts { grid-template-columns: 1fr; } }
        @media (max-width: 900px) { .btp-hero { grid-template-columns: repeat(3, 1fr); } .btp-bottom { grid-template-columns: 1fr; } }
        @media (max-width: 600px) { .btp-hero { grid-template-columns: repeat(2, 1fr); } }
    </style>

    <!-- Controls -->
    <div class="btp-controls">
        <div class="btp-field">
            <span class="btp-label">Date Range</span>
            <div class="btp-presets" id="${id}-presets">
                ${PRESETS.map(p => `
                    <button class="btp-preset ${p.label === this.selectedPreset ? 'active' : ''}"
                            data-days="${p.days}">${p.label}</button>
                `).join('')}
            </div>
        </div>
        <div class="btp-field">
            <span class="btp-label">Starting Capital</span>
            <div class="btp-capital-wrap">
                <span class="btp-capital-prefix">$</span>
                <input type="number" class="btp-capital" id="${id}-capital"
                       value="10000" min="1000" max="10000000" step="1000">
            </div>
        </div>
        <button class="btp-run" id="${id}-run">
            <i class="fas fa-play"></i> Run Backtest
        </button>
    </div>

    <!-- Loading -->
    <div class="btp-loading hidden" id="${id}-loading">
        <div class="btp-spin"></div>
        <span id="${id}-loading-msg">Fetching historical data from Alpaca…</span>
    </div>

    <!-- Results -->
    <div class="btp-results hidden" id="${id}-results">
        <div class="btp-hero" id="${id}-hero"></div>
        <div class="btp-charts">
            <div class="btp-chart-card">
                <div class="btp-chart-hdr">
                    <span class="btp-chart-title">📈 Equity Curve</span>
                    <div class="btp-legend">
                        <span class="btp-leg"><span class="btp-dot" style="background:${this.color}"></span>Strategy</span>
                        <span class="btp-leg"><span class="btp-dot" style="background:#94a3b8"></span>SPY</span>
                    </div>
                </div>
                <canvas id="${id}-equity" height="100"></canvas>
            </div>
            <div class="btp-chart-card">
                <div class="btp-chart-hdr">
                    <span class="btp-chart-title">📉 Drawdown</span>
                    <span class="btp-chart-hint">Depth below peak</span>
                </div>
                <canvas id="${id}-drawdown" height="100"></canvas>
            </div>
        </div>
        <div class="btp-bottom">
            <div class="btp-stats-card" id="${id}-stats"></div>
            <div class="btp-heatmap-card">
                <div class="btp-heatmap-title">📅 Monthly Returns</div>
                <div class="btp-hm-grid" id="${id}-heatmap"></div>
            </div>
        </div>
        <div class="btp-trades-card">
            <div class="btp-trades-hdr">
                <span class="btp-trades-title">📋 Trade Log</span>
                <div class="btp-trades-stats" id="${id}-trade-stats"></div>
            </div>
            <div class="btp-trades-scroll">
                <table class="btp-table">
                    <thead>
                        <tr>
                            <th>Symbol</th><th>Entry</th><th>Exit</th><th>Qty</th>
                            <th>Entry $</th><th>Exit $</th><th>P&L</th><th>Ret%</th>
                            <th>Days</th><th>Exit Reason</th>
                        </tr>
                    </thead>
                    <tbody id="${id}-trades"></tbody>
                </table>
            </div>
        </div>
    </div>
</div>`;
    }

    // ── Events ──────────────────────────────────────────────────────────────────

    _bindEvents() {
        const id = this._id;

        // Preset buttons
        this._container.querySelectorAll(`#${id}-presets .btp-preset`).forEach(btn => {
            btn.addEventListener('click', () => {
                this._container.querySelectorAll(`#${id}-presets .btp-preset`).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedPreset = btn.textContent;
            });
        });

        // Run button
        const runBtn = this._container.querySelector(`#${id}-run`);
        if (runBtn) runBtn.addEventListener('click', () => this._run());
    }

    // ── Run ─────────────────────────────────────────────────────────────────────

    async _run() {
        const id = this._id;
        const { start, end } = this._getDateRange();
        const capital = parseFloat(this._container.querySelector(`#${id}-capital`).value) || 10000;

        // Get auth token from cookie or localStorage
        const token = this._getAuthToken();

        // Show loading
        this._container.querySelector(`#${id}-results`).classList.add('hidden');
        const loadingEl = this._container.querySelector(`#${id}-loading`);
        loadingEl.classList.remove('hidden');

        const runBtn = this._container.querySelector(`#${id}-run`);
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';

        // Animated loading messages
        const msgs = [
            `Fetching ${this.strategyName} historical data…`,
            'Running simulation day by day…',
            'Calculating performance metrics…',
            'Building equity curve vs SPY…',
        ];
        let mi = 0;
        const msgEl = this._container.querySelector(`#${id}-loading-msg`);
        const msgTimer = setInterval(() => {
            mi = (mi + 1) % msgs.length;
            if (msgEl) msgEl.textContent = msgs[mi];
        }, 2500);

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(`${API_BASE}/api/v1/backtest/run`, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify({
                    strategy: this.strategyKey,
                    startDate: start,
                    endDate: end,
                    initialCapital: capital,
                }),
            });

            const json = await res.json();

            if (!res.ok || !json.success) {
                throw new Error(json.error || json.message || 'Backtest failed');
            }

            this._renderResults(json.data, capital);

        } catch (err) {
            console.error('[BacktestPanel] error:', err);

            if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
                this._container.querySelector(`#${id}-results`).innerHTML = `
                    <div class="btp-auth-note">
                        🔒 Backtesting requires an account.
                        <a href="#/login">Log in</a> to run simulations.
                    </div>`;
                this._container.querySelector(`#${id}-results`).classList.remove('hidden');
            } else {
                // Show error in a small inline message
                const errDiv = document.createElement('div');
                errDiv.className = 'btp-auth-note';
                errDiv.style.borderColor = 'rgba(248,113,113,0.3)';
                errDiv.style.background = 'rgba(248,113,113,0.08)';
                errDiv.textContent = `⚠️ ${err.message}`;
                this._container.querySelector(`#${id}-loading`).after(errDiv);
                setTimeout(() => errDiv.remove(), 6000);
            }
        } finally {
            clearInterval(msgTimer);
            loadingEl.classList.add('hidden');
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="fas fa-play"></i> Run Backtest';
        }
    }

    // ── Render results ──────────────────────────────────────────────────────────

    _renderResults(data, capital) {
        const id = this._id;
        const m = data.metrics;
        const totalReturn = m.total_return ?? 0;
        const finalValue = m.final_value ?? capital;
        const pnl = finalValue - capital;

        // Hero cards
        this._container.querySelector(`#${id}-hero`).innerHTML = `
            ${this._heroCard('Total Return', `${totalReturn >= 0 ? '+' : ''}${(totalReturn * 100).toFixed(2)}%`, totalReturn >= 0 ? 'pos' : 'neg', `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', {maximumFractionDigits: 0})}`)}
            ${this._heroCard('Sharpe Ratio', this._fmtN(m.sharpe_ratio, 2), (m.sharpe_ratio ?? 0) >= 1 ? 'pos' : (m.sharpe_ratio ?? 0) >= 0 ? 'neutral' : 'neg', this._sharpeLabel(m.sharpe_ratio))}
            ${this._heroCard('Max Drawdown', `${((m.max_drawdown ?? 0) * 100).toFixed(2)}%`, 'neg', `${m.max_drawdown_duration_days ?? 0} days`)}
            ${this._heroCard('Win Rate', `${((m.win_rate ?? 0) * 100).toFixed(1)}%`, (m.win_rate ?? 0) >= 0.5 ? 'pos' : 'neg', `${m.total_trades ?? 0} trades`)}
            ${this._heroCard('Final Value', `$${finalValue.toLocaleString('en-US', {maximumFractionDigits: 0})}`, '', `from $${capital.toLocaleString('en-US', {maximumFractionDigits: 0})}`)}
        `;

        // Charts
        this._renderEquityChart(data);
        this._renderDrawdownChart(data);
        this._renderHeatmap(data.monthly_returns || []);
        this._renderTradeLog(data.trades || []);

        // Secondary stats
        this._container.querySelector(`#${id}-stats`).innerHTML = `
            <div class="btp-stats-title">🔬 Deep Metrics</div>
            ${this._statRow('Ann. Return', this._fmtPct(m.annualized_return))}
            ${this._statRow('Volatility', this._fmtPct(m.volatility))}
            ${this._statRow('Sortino', this._fmtN(m.sortino_ratio, 2))}
            ${this._statRow('Calmar', this._fmtN(m.calmar_ratio, 2))}
            ${this._statRow('Profit Factor', this._fmtN(m.profit_factor, 2))}
            ${this._statRow('Avg Win', `$${(m.avg_win ?? 0).toFixed(2)}`)}
            ${this._statRow('Avg Loss', `$${(m.avg_loss ?? 0).toFixed(2)}`)}
            ${this._statRow('Largest Win', `$${(m.largest_win ?? 0).toFixed(2)}`)}
            ${this._statRow('Largest Loss', `$${(m.largest_loss ?? 0).toFixed(2)}`)}
            ${this._statRow('Avg Duration', `${this._fmtN(m.avg_trade_duration, 1)}d`)}
            ${this._statRow('VaR 95%', this._fmtPct(m.var_95))}
        `;

        this._container.querySelector(`#${id}-results`).classList.remove('hidden');
        this._container.querySelector(`#${id}-results`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── Charts ──────────────────────────────────────────────────────────────────

    _renderEquityChart(data) {
        if (this.equityChart) { this.equityChart.destroy(); this.equityChart = null; }
        const ctx = this._container.querySelector(`#${this._id}-equity`);
        if (!ctx || typeof Chart === 'undefined') return;

        const eq = (data.equity_curve || []).map(r => ({ x: r.date, y: r.value }));
        const bm = (data.benchmark_curve || []).map(r => ({ x: r.date, y: r.value }));

        this.equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: this.strategyName,
                        data: eq,
                        borderColor: this.color,
                        backgroundColor: this._hex2rgba(this.color, 0.1),
                        fill: true,
                        tension: 0.2,
                        pointRadius: 0,
                        borderWidth: 2,
                    },
                    {
                        label: 'SPY',
                        data: bm,
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
                        backgroundColor: 'rgba(15,15,26,0.95)',
                        borderColor: '#374151',
                        borderWidth: 1,
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        callbacks: {
                            label: c => `${c.dataset.label}: $${c.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
                        },
                    },
                },
                scales: {
                    x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', maxTicksLimit: 7 } },
                    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => '$' + v.toLocaleString('en-US', { notation: 'compact' }) } },
                },
            },
        });
    }

    _renderDrawdownChart(data) {
        if (this.drawdownChart) { this.drawdownChart.destroy(); this.drawdownChart = null; }
        const ctx = this._container.querySelector(`#${this._id}-drawdown`);
        if (!ctx || typeof Chart === 'undefined') return;

        this.drawdownChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Drawdown',
                    data: (data.drawdown_curve || []).map(r => ({ x: r.date, y: r.drawdown })),
                    borderColor: '#f87171',
                    backgroundColor: 'rgba(248,113,113,0.15)',
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
                        backgroundColor: 'rgba(15,15,26,0.95)',
                        borderColor: '#374151',
                        borderWidth: 1,
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        callbacks: { label: c => `Drawdown: ${c.parsed.y.toFixed(2)}%` },
                    },
                },
                scales: {
                    x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', maxTicksLimit: 7 } },
                    y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', callback: v => v + '%' } },
                },
            },
        });
    }

    _renderHeatmap(monthlyReturns) {
        const container = this._container.querySelector(`#${this._id}-heatmap`);
        if (!container) return;

        if (!monthlyReturns.length) {
            container.innerHTML = '<p style="color:#64748b;font-size:0.78rem;text-align:center;padding:1rem">Not enough data</p>';
            return;
        }

        const byYear = {};
        monthlyReturns.forEach(r => {
            if (!byYear[r.year]) byYear[r.year] = {};
            byYear[r.year][r.month] = r.return;
        });

        const years = Object.keys(byYear).sort();
        const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
        const maxAbs = Math.max(...monthlyReturns.map(r => Math.abs(r.return)), 5);

        let html = `
            <div class="btp-hm-row">
                <div class="btp-hm-year"></div>
                ${months.map(m => `<div class="btp-hm-month">${m}</div>`).join('')}
                <div class="btp-hm-month" style="font-size:0.6rem">YTD</div>
            </div>`;

        years.forEach(year => {
            const yd = byYear[year];
            let ytd = 1;
            months.forEach((_, i) => { if (yd[i+1] !== undefined) ytd *= (1 + yd[i+1] / 100); });
            const ytdR = (ytd - 1) * 100;

            html += `<div class="btp-hm-row"><div class="btp-hm-year">${year}</div>`;
            months.forEach((_, i) => {
                const v = yd[i+1];
                if (v === undefined) { html += `<div class="btp-hm-cell empty"></div>`; return; }
                const intensity = Math.min(Math.abs(v) / maxAbs, 1);
                const bg = v >= 0 ? `rgba(52,211,153,${0.15 + intensity * 0.7})` : `rgba(248,113,113,${0.15 + intensity * 0.7})`;
                const tc = intensity > 0.5 ? '#fff' : (v >= 0 ? '#34d399' : '#f87171');
                html += `<div class="btp-hm-cell" style="background:${bg};color:${tc}" title="${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]} ${year}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}%">${v >= 0 ? '+' : ''}${v.toFixed(1)}</div>`;
            });
            const ytdColor = ytdR >= 0 ? '#34d399' : '#f87171';
            html += `<div class="btp-hm-total" style="color:${ytdColor}">${ytdR >= 0 ? '+' : ''}${ytdR.toFixed(1)}%</div></div>`;
        });

        container.innerHTML = html;
    }

    _renderTradeLog(trades) {
        const id = this._id;
        const wins = trades.filter(t => t.pnl > 0).length;
        const statsEl = this._container.querySelector(`#${id}-trade-stats`);
        if (statsEl) statsEl.innerHTML = `
            <span>${trades.length} trades</span>
            <span style="color:#34d399">${wins} wins</span>
            <span style="color:#f87171">${trades.length - wins} losses</span>
        `;

        const tbody = this._container.querySelector(`#${id}-trades`);
        if (!tbody) return;

        if (!trades.length) {
            tbody.innerHTML = `<tr><td colspan="10" class="btp-no-trades">No trades in this period</td></tr>`;
            return;
        }

        tbody.innerHTML = trades.map(t => `
            <tr>
                <td><span class="btp-sym">${t.symbol}</span></td>
                <td>${t.entry_date}</td>
                <td>${t.exit_date}</td>
                <td>${t.quantity.toLocaleString()}</td>
                <td>$${t.entry_price.toFixed(2)}</td>
                <td>$${t.exit_price.toFixed(2)}</td>
                <td style="color:${t.pnl >= 0 ? '#34d399' : '#f87171'};font-weight:600">
                    ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
                </td>
                <td style="color:${t.pnl_pct >= 0 ? '#34d399' : '#f87171'}">
                    ${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%
                </td>
                <td>${t.duration_days}d</td>
                <td style="color:#64748b;font-size:0.7rem;max-width:180px;overflow:hidden;text-overflow:ellipsis">${t.exit_reason || '—'}</td>
            </tr>
        `).join('');
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    _getDateRange() {
        const activeBtn = this._container.querySelector(`#${this._id}-presets .btp-preset.active`);
        const days = activeBtn ? parseInt(activeBtn.dataset.days) : 365;
        const end = new Date(); end.setDate(end.getDate() - 1);
        const start = new Date(end); start.setDate(start.getDate() - days);
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
        };
    }

    _getAuthToken() {
        // Try localStorage (common pattern for JWT)
        try {
            const stored = localStorage.getItem('trading_token') || localStorage.getItem('auth_token') || localStorage.getItem('token');
            if (stored) return stored;
        } catch (_) {}
        return null;
    }

    _heroCard(label, value, cls, sub) {
        return `<div class="btp-metric">
            <div class="btp-metric-label">${label}</div>
            <div class="btp-metric-val ${cls ? 'btp-' + cls : ''}">${value}</div>
            <div class="btp-metric-sub">${sub || ''}</div>
        </div>`;
    }

    _statRow(label, value) {
        return `<div class="btp-stat-row"><span class="btp-stat-label">${label}</span><span class="btp-stat-val">${value}</span></div>`;
    }

    _fmtN(v, d = 2) {
        if (v == null || isNaN(v)) return '—';
        return Number(v).toFixed(d);
    }

    _fmtPct(v) {
        if (v == null || isNaN(v)) return '—';
        return `${(v * 100).toFixed(2)}%`;
    }

    _sharpeLabel(s) {
        if (s == null) return '';
        if (s >= 2) return '🔥 Excellent';
        if (s >= 1) return '✅ Good';
        if (s >= 0.5) return '⚠️ Borderline';
        if (s >= 0) return '😐 Poor';
        return '❌ Negative';
    }

    _hex2rgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
}
