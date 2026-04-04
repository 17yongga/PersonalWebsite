/**
 * BacktestPanel — self-contained, embeddable backtest component.
 * Tabbed layout: Performance | Charts | Trades
 */

import { auth } from '../auth.js';

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3005'
    : 'https://api.gary-yong.com';

export const SLUG_TO_KEY = {
    'momentum-hunter':     'momentum',
    'mean-reversion':      'mean_reversion',
    'sector-rotator':      'sector_rotation',
    'value-dividends':     'value_dividend',
    'volatility-breakout': 'volatility_breakout',
};

export const NAME_TO_KEY = {
    'Momentum Rider':      'momentum',
    'Contrarian':          'mean_reversion',
    'Sector Rotator':      'sector_rotation',
    'Dividend Hunter':     'value_dividend',
    'Volatility Trader':   'volatility_breakout',
    'momentum':            'momentum',
    'mean_reversion':      'mean_reversion',
    'sector_rotation':     'sector_rotation',
    'value_dividend':      'value_dividend',
    'volatility_breakout': 'volatility_breakout',
    'sentiment':           'momentum',
};

const PRESETS = [
    { label: '1M',  days: 30,  warn: true },
    { label: '3M',  days: 90 },
    { label: '6M',  days: 180 },
    { label: '1Y',  days: 365 },
    { label: '2Y',  days: 730 },
];

export class BacktestPanel {
    constructor({ strategyKey, strategyName, color = '#3b82f6' }) {
        this.strategyKey  = strategyKey;
        this.strategyName = strategyName;
        this.color        = color;
        this.selectedPreset = '1Y';
        this.equityChart   = null;
        this.drawdownChart = null;
        this._container    = null;
        this._id           = `bt-${Math.random().toString(36).slice(2, 8)}`;
        this._activeTab    = 'performance';
    }

    mount(container) {
        this._container = container;
        container.innerHTML = this._buildHTML();
        this._bindEvents();
    }

    destroy() {
        if (this.equityChart)   { this.equityChart.destroy();   this.equityChart   = null; }
        if (this.drawdownChart) { this.drawdownChart.destroy(); this.drawdownChart = null; }
    }

    // ── HTML ──────────────────────────────────────────────────────────────────

    _buildHTML() {
        const id = this._id;
        const c  = this.color;
        return `
<div class="btp-wrap" id="${id}-wrap">
<style>
  .btp-wrap{font-family:var(--font-family,'Inter',sans-serif);color:var(--text-primary,#e2e8f0)}
  /* Controls */
  .btp-controls{display:flex;align-items:flex-end;flex-wrap:wrap;gap:1rem;margin-bottom:1.25rem}
  .btp-field{display:flex;flex-direction:column;gap:.3rem}
  .btp-lbl{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-secondary,#94a3b8)}
  .btp-presets{display:flex;gap:.35rem}
  .btp-preset{padding:.33rem .7rem;background:var(--bg-tertiary,#2d2d44);border:1px solid var(--border,#374151);border-radius:6px;color:var(--text-secondary,#94a3b8);font-size:.8rem;font-weight:500;cursor:pointer;transition:all .15s}
  .btp-preset:hover{border-color:${c};color:${c}}
  .btp-preset.active{background:${c};border-color:${c};color:#fff}
  .btp-preset.warn-range{position:relative}
  .btp-capital-wrap{display:flex;align-items:center;background:var(--input-bg,#2d2d44);border:1px solid var(--border,#374151);border-radius:6px;overflow:hidden}
  .btp-cap-pfx{padding:.33rem .55rem;background:var(--bg-tertiary,#1e1e32);color:var(--text-secondary,#94a3b8);font-size:.8rem;border-right:1px solid var(--border,#374151)}
  .btp-capital{padding:.33rem .55rem;background:transparent;border:none;color:var(--text-primary,#e2e8f0);font-size:.8rem;outline:none;width:95px}
  .btp-run{display:flex;align-items:center;gap:.4rem;padding:.42rem 1.2rem;background:${c};border:none;border-radius:6px;color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;transition:opacity .15s;white-space:nowrap}
  .btp-run:hover{opacity:.85}
  .btp-run:disabled{opacity:.45;cursor:not-allowed}
  /* Loading */
  .btp-loading{display:flex;align-items:center;gap:.75rem;color:var(--text-secondary,#94a3b8);font-size:.82rem;padding:2rem 0}
  .btp-loading.hidden,.btp-results.hidden{display:none}
  .btp-spin{width:16px;height:16px;border:2px solid var(--border,#374151);border-top-color:${c};border-radius:50%;animation:btp-spin .8s linear infinite;flex-shrink:0}
  @keyframes btp-spin{to{transform:rotate(360deg)}}
  /* Zero-trades warning */
  .btp-warn{display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.25);border-radius:8px;font-size:.78rem;color:#fbbf24;margin-bottom:1rem}
  .btp-warn.hidden{display:none}
  /* Hero */
  .btp-hero{display:grid;grid-template-columns:repeat(5,1fr);gap:.65rem;margin-bottom:1.1rem}
  .btp-metric{background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border,#374151);border-radius:9px;padding:.8rem .9rem;text-align:center}
  .btp-metric-lbl{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-secondary,#94a3b8);margin-bottom:.3rem}
  .btp-metric-val{font-size:1.25rem;font-weight:700;line-height:1;margin-bottom:.2rem}
  .btp-metric-sub{font-size:.67rem;color:var(--text-secondary,#94a3b8)}
  .btp-pos{color:#34d399} .btp-neg{color:#f87171} .btp-neutral{color:#fbbf24}
  /* Tabs */
  .btp-tabs{display:flex;gap:0;border-bottom:1px solid var(--border,#374151);margin-bottom:1rem}
  .btp-tab{padding:.55rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;color:var(--text-secondary,#94a3b8);font-size:.8rem;font-weight:600;cursor:pointer;transition:all .15s;margin-bottom:-1px}
  .btp-tab:hover{color:var(--text-primary,#e2e8f0)}
  .btp-tab.active{color:${c};border-bottom-color:${c}}
  /* Tab panes */
  .btp-pane{display:none}
  .btp-pane.active{display:block}
  /* Performance tab */
  .btp-perf-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  .btp-stats-card,.btp-heatmap-card{background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border,#374151);border-radius:9px;padding:1rem}
  .btp-card-title{font-size:.78rem;font-weight:600;color:var(--text-primary,#e2e8f0);margin:0 0 .75rem;display:flex;align-items:center;gap:.3rem}
  .btp-stat-row{display:flex;justify-content:space-between;align-items:center;padding:.22rem 0;border-bottom:1px solid rgba(255,255,255,.04)}
  .btp-stat-row:last-child{border-bottom:none}
  .btp-stat-label{font-size:.72rem;color:var(--text-secondary,#94a3b8)}
  .btp-stat-val{font-size:.75rem;font-weight:500;color:var(--text-primary,#e2e8f0);font-variant-numeric:tabular-nums}
  /* Heatmap */
  .btp-hm-grid{display:flex;flex-direction:column;gap:2px;overflow-x:auto}
  .btp-hm-row{display:grid;grid-template-columns:36px repeat(12,1fr) 48px;gap:2px;align-items:center;min-width:520px}
  .btp-hm-year{font-size:.63rem;color:var(--text-secondary,#94a3b8);font-weight:600;text-align:right;padding-right:4px}
  .btp-hm-mo{font-size:.6rem;color:var(--text-secondary,#94a3b8);text-align:center;font-weight:600}
  .btp-hm-cell{height:28px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:600;cursor:default;background:var(--bg-tertiary,#2d2d44);color:var(--text-secondary,#94a3b8)}
  .btp-hm-cell.empty{background:transparent}
  .btp-hm-total{font-size:.63rem;font-weight:700;text-align:center}
  /* Charts tab */
  .btp-chart-card{background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border,#374151);border-radius:9px;padding:1rem;margin-bottom:1rem}
  .btp-chart-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.4rem}
  .btp-chart-title{font-size:.8rem;font-weight:600;color:var(--text-primary,#e2e8f0);display:flex;align-items:center;gap:.3rem}
  .btp-legend{display:flex;gap:1rem}
  .btp-leg{display:flex;align-items:center;gap:.3rem;font-size:.7rem;color:var(--text-secondary,#94a3b8)}
  .btp-dot{width:10px;height:3px;border-radius:2px}
  .btp-chart-hint{font-size:.68rem;color:var(--text-secondary,#94a3b8)}
  /* Trades tab */
  .btp-trades-meta{display:flex;gap:1rem;font-size:.72rem;color:var(--text-secondary,#94a3b8);margin-bottom:.75rem}
  .btp-trades-scroll{overflow-x:auto;max-height:360px;overflow-y:auto}
  table.btp-tbl{width:100%;border-collapse:collapse;font-size:.74rem}
  table.btp-tbl th{text-align:left;padding:.32rem .55rem;font-size:.64rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary,#94a3b8);background:var(--bg-primary,#0f0f1a);position:sticky;top:0;white-space:nowrap;border-bottom:1px solid var(--border,#374151)}
  table.btp-tbl td{padding:.28rem .55rem;border-bottom:1px solid rgba(255,255,255,.04);color:var(--text-primary,#e2e8f0);white-space:nowrap;font-variant-numeric:tabular-nums}
  table.btp-tbl tbody tr:hover{background:rgba(255,255,255,.03)}
  .btp-sym{background:var(--bg-tertiary,#2d2d44);border:1px solid var(--border,#374151);border-radius:3px;padding:1px 5px;font-family:monospace;font-size:.68rem;font-weight:700}
  .btp-no-trades{text-align:center;padding:1.5rem;color:var(--text-secondary,#94a3b8);font-size:.8rem}
  .btp-err{background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25);border-radius:8px;padding:.7rem 1rem;font-size:.8rem;color:#fca5a5;margin-top:.5rem}
  @media(max-width:900px){.btp-hero{grid-template-columns:repeat(3,1fr)}.btp-perf-grid{grid-template-columns:1fr}}
  @media(max-width:600px){.btp-hero{grid-template-columns:repeat(2,1fr)}}
</style>

<!-- Controls -->
<div class="btp-controls">
  <div class="btp-field">
    <span class="btp-lbl">Date Range</span>
    <div class="btp-presets" id="${id}-presets">
      ${PRESETS.map(p => `<button class="btp-preset${p.label===this.selectedPreset?' active':''}" data-days="${p.days}" data-warn="${p.warn||''}">${p.label}</button>`).join('')}
    </div>
  </div>
  <div class="btp-field">
    <span class="btp-lbl">Starting Capital</span>
    <div class="btp-capital-wrap">
      <span class="btp-cap-pfx">$</span>
      <input type="number" class="btp-capital" id="${id}-capital" value="10000" min="1000" max="10000000" step="1000">
    </div>
  </div>
  <button class="btp-run" id="${id}-run"><i class="fas fa-play"></i> Run Backtest</button>
</div>

<!-- Loading -->
<div class="btp-loading hidden" id="${id}-loading">
  <div class="btp-spin"></div>
  <span id="${id}-loading-msg">Fetching historical data…</span>
</div>

<!-- Results -->
<div class="btp-results hidden" id="${id}-results">

  <!-- Zero-trades warning -->
  <div class="btp-warn hidden" id="${id}-warn">
    ⚠️ <span id="${id}-warn-msg">No trades fired in this period — try a longer date range (3M+). Short windows don't give indicators enough time to warm up.</span>
  </div>

  <!-- Hero metrics (always visible) -->
  <div class="btp-hero" id="${id}-hero"></div>

  <!-- Tabs -->
  <div class="btp-tabs">
    <button class="btp-tab active" data-tab="performance">📊 Performance</button>
    <button class="btp-tab" data-tab="charts">📈 Charts</button>
    <button class="btp-tab" data-tab="trades">📋 Trades</button>
  </div>

  <!-- Performance tab -->
  <div class="btp-pane active" id="${id}-pane-performance">
    <div class="btp-perf-grid">
      <div class="btp-stats-card" id="${id}-stats"></div>
      <div class="btp-heatmap-card">
        <div class="btp-card-title">📅 Monthly Returns</div>
        <div class="btp-hm-grid" id="${id}-heatmap"></div>
      </div>
    </div>
  </div>

  <!-- Charts tab -->
  <div class="btp-pane" id="${id}-pane-charts">
    <div class="btp-chart-card">
      <div class="btp-chart-hdr">
        <span class="btp-chart-title">📈 Equity Curve</span>
        <div class="btp-legend">
          <span class="btp-leg"><span class="btp-dot" style="background:${c};height:3px"></span>${this.strategyName}</span>
          <span class="btp-leg"><span class="btp-dot" style="background:#64748b;height:2px"></span>SPY Benchmark</span>
        </div>
      </div>
      <canvas id="${id}-equity" height="110"></canvas>
    </div>
    <div class="btp-chart-card">
      <div class="btp-chart-hdr">
        <span class="btp-chart-title">📉 Drawdown</span>
        <span class="btp-chart-hint">Portfolio depth below all-time high</span>
      </div>
      <canvas id="${id}-drawdown" height="80"></canvas>
    </div>
  </div>

  <!-- Trades tab -->
  <div class="btp-pane" id="${id}-pane-trades">
    <div class="btp-trades-meta" id="${id}-trade-meta"></div>
    <div class="btp-trades-scroll">
      <table class="btp-tbl">
        <thead><tr>
          <th>Symbol</th><th>Entry</th><th>Exit</th><th>Qty</th>
          <th>Entry $</th><th>Exit $</th><th>P&amp;L</th><th>Ret%</th>
          <th>Days</th><th>Exit Reason</th>
        </tr></thead>
        <tbody id="${id}-trades"></tbody>
      </table>
    </div>
  </div>

</div>
</div>`;
    }

    // ── Events ────────────────────────────────────────────────────────────────

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

    _bindTabEvents() {
        const id = this._id;
        this._container.querySelectorAll('.btp-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this._container.querySelectorAll('.btp-tab').forEach(b => b.classList.remove('active'));
                this._container.querySelectorAll('.btp-pane').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const pane = this._container.querySelector(`#${id}-pane-${tab}`);
                if (pane) pane.classList.add('active');

                // Trigger chart resize when switching to Charts tab
                if (tab === 'charts') {
                    setTimeout(() => {
                        if (this.equityChart)   this.equityChart.resize();
                        if (this.drawdownChart) this.drawdownChart.resize();
                    }, 50);
                }
            });
        });
    }

    // ── Run ───────────────────────────────────────────────────────────────────

    async _run() {
        const id = this._id;
        const { start, end } = this._getDateRange();
        const capital = parseFloat(this._container.querySelector(`#${id}-capital`).value) || 10000;

        const resultsEl  = this._container.querySelector(`#${id}-results`);
        const loadingEl  = this._container.querySelector(`#${id}-loading`);
        const runBtn     = this._container.querySelector(`#${id}-run`);

        resultsEl.classList.add('hidden');
        loadingEl.classList.remove('hidden');
        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';

        const msgs = [
            `Fetching ${this.strategyName} historical data…`,
            'Running simulation day by day…',
            'Calculating performance metrics…',
            'Building equity curve vs SPY…',
        ];
        let mi = 0;
        const msgEl    = this._container.querySelector(`#${id}-loading-msg`);
        const msgTimer = setInterval(() => {
            mi = (mi + 1) % msgs.length;
            if (msgEl) msgEl.textContent = msgs[mi];
        }, 2500);

        try {
            const token   = auth.getToken();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res  = await fetch(`${API_BASE}/api/v1/backtest/run`, {
                method: 'POST', headers, credentials: 'include',
                body: JSON.stringify({ strategy: this.strategyKey, startDate: start, endDate: end, initialCapital: capital }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || json.message || 'Backtest failed');

            this._renderResults(json.data, capital);

        } catch (err) {
            console.error('[BacktestPanel]', err);
            const errDiv = document.createElement('div');
            errDiv.className = 'btp-err';
            errDiv.textContent = `⚠️ ${err.message}`;
            loadingEl.after(errDiv);
            setTimeout(() => errDiv.remove(), 8000);
        } finally {
            clearInterval(msgTimer);
            loadingEl.classList.add('hidden');
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="fas fa-play"></i> Run Backtest';
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _renderResults(data, capital) {
        const id = this._id;
        const m  = data.metrics;
        const totalReturn = m.total_return ?? 0;
        const finalValue  = m.final_value ?? capital;
        const pnl         = finalValue - capital;
        const trades      = data.trades || [];
        const noTrades    = trades.length === 0;

        // Zero-trades warning
        const warnEl = this._container.querySelector(`#${id}-warn`);
        if (warnEl) {
            if (noTrades) {
                warnEl.classList.remove('hidden');
                const msgEl = this._container.querySelector(`#${id}-warn-msg`);
                if (msgEl) msgEl.textContent = `No trades fired in this period. The indicators (EMA50, RSI, MACD) need at least 3 months of data to warm up properly. Try 3M or longer for meaningful results.`;
            } else {
                warnEl.classList.add('hidden');
            }
        }

        // Hero
        this._container.querySelector(`#${id}-hero`).innerHTML = `
            ${this._hCard('Total Return', `${totalReturn >= 0 ? '+' : ''}${(totalReturn*100).toFixed(2)}%`, totalReturn >= 0 ? 'pos' : 'neg', `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', {maximumFractionDigits:0})}`)}
            ${this._hCard('Sharpe Ratio', this._fN(m.sharpe_ratio, 2), (m.sharpe_ratio??0) >= 1 ? 'pos' : (m.sharpe_ratio??0) >= 0 ? 'neutral' : 'neg', this._sharpeLabel(m.sharpe_ratio))}
            ${this._hCard('Max Drawdown', `${((m.max_drawdown??0)*100).toFixed(2)}%`, 'neg', `${m.max_drawdown_duration_days??0} days`)}
            ${this._hCard('Win Rate', `${((m.win_rate??0)*100).toFixed(1)}%`, (m.win_rate??0) >= 0.5 ? 'pos' : 'neg', `${m.total_trades??0} trades`)}
            ${this._hCard('Final Value', `$${finalValue.toLocaleString('en-US',{maximumFractionDigits:0})}`, '', `from $${capital.toLocaleString('en-US',{maximumFractionDigits:0})}`)}
        `;

        // Performance tab — deep stats
        this._container.querySelector(`#${id}-stats`).innerHTML = `
            <div class="btp-card-title">🔬 Deep Metrics</div>
            ${this._sRow('Annualised Return',  this._fPct(m.annualized_return))}
            ${this._sRow('Volatility (Ann.)',   this._fPct(m.volatility))}
            ${this._sRow('Sortino Ratio',       this._fN(m.sortino_ratio, 2))}
            ${this._sRow('Calmar Ratio',        this._fN(m.calmar_ratio, 2))}
            ${this._sRow('Profit Factor',       this._fN(m.profit_factor, 2))}
            ${this._sRow('Avg Win',             `$${(m.avg_win??0).toFixed(2)}`)}
            ${this._sRow('Avg Loss',            `$${(m.avg_loss??0).toFixed(2)}`)}
            ${this._sRow('Largest Win',         `$${(m.largest_win??0).toFixed(2)}`)}
            ${this._sRow('Largest Loss',        `$${(m.largest_loss??0).toFixed(2)}`)}
            ${this._sRow('Avg Trade Duration',  `${this._fN(m.avg_trade_duration, 1)} days`)}
            ${this._sRow('VaR 95%',             this._fPct(m.var_95))}
            ${this._sRow('Expected Shortfall',  this._fPct(m.expected_shortfall))}
            ${this._sRow('Period',              `${m.backtest_days??0} days`)}
        `;

        // Heatmap
        this._renderHeatmap(data.monthly_returns || []);

        // Charts (rendered even when hidden — resize on tab switch)
        this._renderEquityChart(data);
        this._renderDrawdownChart(data);

        // Trades tab
        this._renderTradeLog(trades);

        // Wire up tab events
        this._bindTabEvents();

        // Show results
        this._container.querySelector(`#${id}-results`).classList.remove('hidden');
    }

    // ── Charts ────────────────────────────────────────────────────────────────

    _renderEquityChart(data) {
        if (this.equityChart) { this.equityChart.destroy(); this.equityChart = null; }
        const ctx = this._container.querySelector(`#${this._id}-equity`);
        if (!ctx || typeof Chart === 'undefined') return;

        const c = this.color;
        this.equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    // SPY first (renders behind strategy)
                    { label: 'SPY', data: (data.benchmark_curve||[]).map(r=>({x:r.date,y:r.value})), borderColor: '#64748b', backgroundColor: 'transparent', fill: false, tension: 0.2, pointRadius: 0, borderWidth: 1.5, borderDash: [5,4], order: 2 },
                    // Strategy on top
                    { label: this.strategyName, data: (data.equity_curve||[]).map(r=>({x:r.date,y:r.value})), borderColor: c, backgroundColor: this._rgba(c, 0.12), fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2.5, order: 1 },
                ],
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { backgroundColor: 'rgba(15,15,26,.95)', borderColor: '#374151', borderWidth: 1, titleColor: '#e2e8f0', bodyColor: '#94a3b8', callbacks: { label: c => `${c.dataset.label}: $${c.parsed.y.toLocaleString('en-US',{maximumFractionDigits:0})}` } },
                },
                scales: {
                    x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#64748b', maxTicksLimit: 8 } },
                    y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#64748b', callback: v => '$'+v.toLocaleString('en-US',{notation:'compact'}) } },
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
            data: { datasets: [{ label: 'Drawdown', data: (data.drawdown_curve||[]).map(r=>({x:r.date,y:r.drawdown})), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,.15)', fill: true, tension: 0.15, pointRadius: 0, borderWidth: 1.5 }] },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,15,26,.95)', borderColor: '#374151', borderWidth: 1, titleColor: '#e2e8f0', bodyColor: '#94a3b8', callbacks: { label: c => `Drawdown: ${c.parsed.y.toFixed(2)}%` } } },
                scales: {
                    x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#64748b', maxTicksLimit: 8 } },
                    y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#64748b', callback: v => v+'%' } },
                },
            },
        });
    }

    _renderHeatmap(monthlyReturns) {
        const el = this._container.querySelector(`#${this._id}-heatmap`);
        if (!el) return;
        if (!monthlyReturns.length) {
            el.innerHTML = '<p style="color:#64748b;font-size:.75rem;text-align:center;padding:.75rem">Run a longer backtest (3M+) to see monthly breakdown</p>';
            return;
        }
        const byYear = {};
        monthlyReturns.forEach(r => { if (!byYear[r.year]) byYear[r.year]={}; byYear[r.year][r.month]=r.return; });
        const years  = Object.keys(byYear).sort();
        const mos    = ['J','F','M','A','M','J','J','A','S','O','N','D'];
        const full   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const maxAbs = Math.max(...monthlyReturns.map(r=>Math.abs(r.return)), 5);

        let html = `<div class="btp-hm-row"><div class="btp-hm-year"></div>${mos.map(m=>`<div class="btp-hm-mo">${m}</div>`).join('')}<div class="btp-hm-mo" style="font-size:.58rem">YTD</div></div>`;
        years.forEach(yr => {
            const yd = byYear[yr];
            let ytd = 1;
            mos.forEach((_,i) => { if (yd[i+1]!==undefined) ytd *= (1+yd[i+1]/100); });
            const ytdR = (ytd-1)*100;
            html += `<div class="btp-hm-row"><div class="btp-hm-year">${yr}</div>`;
            mos.forEach((_,i) => {
                const v = yd[i+1];
                if (v===undefined) { html+=`<div class="btp-hm-cell empty"></div>`; return; }
                const intensity = Math.min(Math.abs(v)/maxAbs, 1);
                const bg = v>=0 ? `rgba(52,211,153,${.15+intensity*.7})` : `rgba(248,113,113,${.15+intensity*.7})`;
                const tc = intensity>.5 ? '#fff' : (v>=0 ? '#34d399' : '#f87171');
                html += `<div class="btp-hm-cell" style="background:${bg};color:${tc}" title="${full[i]} ${yr}: ${v>=0?'+':''}${v.toFixed(2)}%">${v>=0?'+':''}${v.toFixed(1)}</div>`;
            });
            const yc = ytdR>=0 ? '#34d399' : '#f87171';
            html += `<div class="btp-hm-total" style="color:${yc}">${ytdR>=0?'+':''}${ytdR.toFixed(1)}%</div></div>`;
        });
        el.innerHTML = html;
    }

    _renderTradeLog(trades) {
        const id   = this._id;
        const wins = trades.filter(t => t.pnl > 0).length;

        const metaEl = this._container.querySelector(`#${id}-trade-meta`);
        if (metaEl) metaEl.innerHTML = `
            <span>${trades.length} trades total</span>
            <span style="color:#34d399">${wins} wins</span>
            <span style="color:#f87171">${trades.length-wins} losses</span>
            ${trades.length ? `<span>Win rate: ${((wins/trades.length)*100).toFixed(1)}%</span>` : ''}
        `;

        const tbody = this._container.querySelector(`#${id}-trades`);
        if (!tbody) return;

        if (!trades.length) {
            tbody.innerHTML = `<tr><td colspan="10" class="btp-no-trades">No trades executed — try a longer date range (3M+)</td></tr>`;
            return;
        }

        tbody.innerHTML = trades.map(t => `
            <tr>
                <td><span class="btp-sym">${t.symbol}</span></td>
                <td>${t.entry_date}</td><td>${t.exit_date}</td>
                <td>${t.quantity.toLocaleString()}</td>
                <td>$${t.entry_price.toFixed(2)}</td>
                <td>$${t.exit_price.toFixed(2)}</td>
                <td style="color:${t.pnl>=0?'#34d399':'#f87171'};font-weight:600">${t.pnl>=0?'+':''}$${t.pnl.toFixed(2)}</td>
                <td style="color:${t.pnl_pct>=0?'#34d399':'#f87171'}">${t.pnl_pct>=0?'+':''}${t.pnl_pct.toFixed(2)}%</td>
                <td>${t.duration_days}d</td>
                <td style="color:#64748b;font-size:.68rem;max-width:180px;overflow:hidden;text-overflow:ellipsis">${t.exit_reason||'—'}</td>
            </tr>`).join('');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _getDateRange() {
        const btn  = this._container.querySelector(`#${this._id}-presets .btp-preset.active`);
        const days = btn ? parseInt(btn.dataset.days) : 365;
        const end  = new Date(); end.setDate(end.getDate()-1);
        const start = new Date(end); start.setDate(start.getDate()-days);
        return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
    }

    _hCard(label, value, cls, sub) {
        return `<div class="btp-metric"><div class="btp-metric-lbl">${label}</div><div class="btp-metric-val${cls?' btp-'+cls:''}">${value}</div><div class="btp-metric-sub">${sub||''}</div></div>`;
    }
    _sRow(label, value) {
        return `<div class="btp-stat-row"><span class="btp-stat-label">${label}</span><span class="btp-stat-val">${value}</span></div>`;
    }
    _fN(v, d=2) { return (v==null||isNaN(v)) ? '—' : Number(v).toFixed(d); }
    _fPct(v)    { return (v==null||isNaN(v)) ? '—' : `${(v*100).toFixed(2)}%`; }
    _sharpeLabel(s) {
        if (s==null) return '';
        if (s>=2)    return '🔥 Excellent';
        if (s>=1)    return '✅ Good';
        if (s>=0.5)  return '⚠️ Borderline';
        if (s>=0)    return '😐 Poor';
        return '❌ Negative';
    }
    _rgba(hex, a) {
        const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
        return `rgba(${r},${g},${b},${a})`;
    }
}
