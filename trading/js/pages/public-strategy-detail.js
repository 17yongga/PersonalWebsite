import { api } from '../api.js';
import { formatCurrency, formatPercent, escapeHtml } from '../utils.js';
import { DecisionLog } from '../components/decision-log.js';

const STRATEGY_CONFIG = {
    'momentum-hunter':    { name: 'Momentum Hunter',    emoji: '🚀', color: '#3fb950' },
    'mean-reversion':     { name: 'Mean Reversion',     emoji: '🔄', color: '#58a6ff' },
    'sector-rotator':     { name: 'Sector Rotator',     emoji: '📊', color: '#d2a8ff' },
    'value-dividends':    { name: 'Value & Dividends',  emoji: '💎', color: '#f0883e' },
    'volatility-breakout':{ name: 'Volatility Breakout',emoji: '⚡', color: '#ff7b72' }
};

let equityChartInstance = null;

/**
 * When multiple trades are filled within the same hourly bar they land on the
 * identical (x, y) pixel and only one triangle is visible.  This function
 * spreads them vertically so every marker is distinct.
 *
 * Algorithm: group by 1-hour bucket → centre the group around the bar's
 * portfolio value → offset each marker by ±stepDollars.
 */
function staggerOverlappingMarkers(points, stepDollars = 55) {
    if (points.length <= 1) return points;

    // Group points whose timestamps fall in the same 1-hour window
    const MS_PER_HOUR = 3_600_000;
    const buckets = {};
    points.forEach((p, i) => {
        const key = Math.floor(p.x / MS_PER_HOUR);
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push({ ...p, _i: i });
    });

    const result = new Array(points.length);
    Object.values(buckets).forEach(group => {
        const mid = (group.length - 1) / 2; // centre index (may be fractional)
        group.forEach((p, idx) => {
            result[p._i] = { ...p, y: p.y + Math.round((idx - mid) * stepDollars) };
        });
    });
    return result;
}

/**
 * Render (or re-render) a Chart.js equity curve for this strategy.
 *
 * @param {HTMLElement} container  — wraps the <canvas>
 * @param {string}      strategyId — e.g. 'value-dividends'
 * @param {string}      stratColor — hex colour for the equity line
 * @param {string}      range      — '1D' | '1W' | '1M' | 'ALL'
 */
async function renderEquityCurve(container, strategyId, stratColor, range = 'ALL') {
    // Wait for Chart.js
    let tries = 0;
    while (typeof Chart === 'undefined' && tries++ < 30) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (typeof Chart === 'undefined') {
        container.innerHTML = '<p style="color:#8b949e;text-align:center;padding:2rem">Chart.js failed to load</p>';
        return;
    }

    const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:3002'
        : 'https://api.gary-yong.com';

    // Fetch equity history for the selected range
    let snapshots = [], equityTrades = [];
    try {
        const res = await fetch(`${apiBase}/api/v1/dashboard/equity-history?range=${range}`);
        if (res.ok) {
            const d = await res.json();
            snapshots    = d.snapshots || [];
            // Use equity-history trades as the single source of truth for markers.
            // These already contain every filled order for this strategy; no need
            // to merge the /strategies/:id/trades endpoint (avoids double-counting).
            equityTrades = (d.trades || []).filter(t => t.strategy === strategyId);
        }
    } catch (e) {
        console.warn('Failed to load equity history:', e);
    }

    // --- Equity line ---
    const lineData = snapshots
        .filter(s => s[strategyId] !== undefined)
        .map(s => ({ x: new Date(s.timestamp).getTime(), y: s[strategyId] }));

    if (lineData.length === 0) {
        container.innerHTML = '<p style="color:#8b949e;text-align:center;padding:2rem">No equity data for this range yet</p>';
        return;
    }

    // --- Trade markers ---
    // Snap each trade to the nearest equity line point so the marker sits ON the curve.
    const findNearestValue = (ts) => {
        const t = new Date(ts).getTime();
        let best = lineData[0], bestDiff = Math.abs(t - lineData[0].x);
        for (const pt of lineData) {
            const diff = Math.abs(t - pt.x);
            if (diff < bestDiff) { bestDiff = diff; best = pt; }
        }
        return best?.y ?? 20000;
    };

    // Build raw marker arrays (exact trade timestamps → exact fill prices as labels)
    const rawBuy  = equityTrades.filter(t => t.action === 'buy').map(t => ({
        x:     new Date(t.timestamp).getTime(),
        y:     findNearestValue(t.timestamp),
        label: `BUY ${t.quantity} ${t.symbol} @ $${Number(t.price).toFixed(2)}`
    }));
    const rawSell = equityTrades.filter(t => t.action === 'sell').map(t => ({
        x:     new Date(t.timestamp).getTime(),
        y:     findNearestValue(t.timestamp),
        label: `SELL ${t.quantity} ${t.symbol} @ $${Number(t.price).toFixed(2)}`
    }));

    // Stagger markers that cluster in the same hourly bar so all are visible
    const buyPoints  = staggerOverlappingMarkers(rawBuy);
    const sellPoints = staggerOverlappingMarkers(rawSell);

    // --- Build / rebuild chart ---
    container.innerHTML = '<canvas id="psd-equity-canvas" style="width:100%;height:320px"></canvas>';
    const ctx = container.querySelector('#psd-equity-canvas').getContext('2d');

    if (equityChartInstance) { equityChartInstance.destroy(); equityChartInstance = null; }

    equityChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Portfolio Value',
                    data: lineData,
                    borderColor: stratColor,
                    backgroundColor: stratColor + '18',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    borderWidth: 2.5,
                    order: 3
                },
                {
                    label: 'Baseline $20K',
                    data: lineData.map(p => ({ x: p.x, y: 20000 })),
                    borderColor: 'rgba(255,255,255,0.2)',
                    borderDash: [4, 4],
                    borderWidth: 1,
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                    order: 4
                },
                {
                    label: 'BUY',
                    data: buyPoints,
                    type: 'scatter',
                    backgroundColor: '#3fb950',
                    borderColor: '#fff',
                    borderWidth: 1.5,
                    pointRadius: 7,
                    pointStyle: 'triangle',
                    order: 1
                },
                {
                    label: 'SELL',
                    data: sellPoints,
                    type: 'scatter',
                    backgroundColor: '#f85149',
                    borderColor: '#fff',
                    borderWidth: 1.5,
                    pointRadius: 7,
                    pointStyle: 'rectRot',
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: '#8b949e', usePointStyle: true, boxWidth: 8, font: { size: 11 } }
                },
                tooltip: {
                    backgroundColor: '#161b22',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    titleColor: '#e6edf3',
                    bodyColor: '#8b949e',
                    callbacks: {
                        title: (items) => {
                            const ts = items[0]?.parsed?.x;
                            return ts ? new Date(ts).toLocaleString('en-US', {
                                month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                            }) : '';
                        },
                        label: (item) => {
                            if (item.dataset.label === 'Portfolio Value') {
                                return ` $${item.parsed.y.toLocaleString()}`;
                            }
                            if (item.dataset.label === 'BUY' || item.dataset.label === 'SELL') {
                                return ` ${item.raw.label || item.dataset.label}`;
                            }
                            return null;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        tooltipFormat: 'MMM d, h:mm a',
                        displayFormats: { day: 'MMM d', hour: 'MMM d ha' }
                    },
                    grid:   { color: 'rgba(255,255,255,0.05)' },
                    ticks:  { color: '#8b949e', font: { size: 10 } },
                    border: { color: '#21262d' }
                },
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(255,255,255,0.07)' },
                    ticks: {
                        color: '#8b949e',
                        font: { family: 'SF Mono, Monaco, monospace', size: 11 },
                        callback: v => '$' + v.toLocaleString()
                    },
                    border: { color: '#21262d' }
                }
            }
        }
    });
}

function createPage() {
    return {
        async render(container, params) {
            const strategyId = params.id;
            const config = STRATEGY_CONFIG[strategyId];

            if (!config) {
                container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-secondary);">Strategy not found. <a href="#/leaderboard" style="color:var(--accent);">Back to Leaderboard</a></div>`;
                return;
            }

            // Fetch strategy summary only (no tradesData needed — equity-history is the marker source)
            let strategy = null;
            try {
                const strategies = await api.get('/dashboard/strategies');
                strategy = (strategies || []).find(s => s.id === strategyId);
            } catch (e) {
                console.error('Failed to load strategy data:', e);
            }

            const totalReturn  = strategy?.totalReturnPct ?? 0;
            const totalPnl     = strategy?.totalPnl ?? 0;
            const winRate      = strategy?.winRate ?? 0;
            const tradeCount   = strategy?.tradeCount ?? 0;
            const currentValue = strategy?.currentValue ?? 0;
            const pnlClass     = totalPnl >= 0 ? 'positive' : 'negative';

            container.innerHTML = `
                <div class="psd-page">
                    <style>
                        .psd-page { background: #0d1117; min-height: 100vh; padding: 1.5rem 2rem; color: #e6edf3; font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif; }
                        .psd-back { display: inline-flex; align-items: center; gap: 6px; color: #8b949e; text-decoration: none; font-size: 14px; margin-bottom: 1.5rem; transition: color 0.15s; cursor:pointer; }
                        .psd-back:hover { color: #58a6ff; }
                        .psd-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem; }
                        .psd-title { display: flex; align-items: center; gap: 12px; }
                        .psd-title h1 { font-size: 1.8rem; font-weight: 700; margin: 0; color: ${config.color}; }
                        .psd-title .emoji { font-size: 2rem; }
                        .psd-desc { color: #8b949e; margin-top: 4px; font-size: 14px; }
                        .psd-stats { display: flex; gap: 2rem; flex-wrap: wrap; }
                        .psd-stat { text-align: center; }
                        .psd-stat-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
                        .psd-stat-value { font-size: 1.3rem; font-weight: 700; }
                        .psd-stat-value.positive { color: #3fb950; }
                        .psd-stat-value.negative { color: #f85149; }
                        .psd-section { background: #161b22; border: 1px solid #21262d; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
                        .psd-section-title { font-size: 1rem; font-weight: 600; margin: 0; color: #e6edf3; }
                        .psd-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
                        .psd-positions { margin-top: 0.5rem; }
                        .psd-pos-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #21262d; }
                        .psd-pos-row:last-child { border-bottom: none; }
                        .psd-chart-wrap { height: 320px; position: relative; }
                        /* Range selector — matches main dashboard */
                        .psd-range-selector { display: flex; gap: 3px; background: #0d1117; padding: 3px; border-radius: 8px; border: 1px solid #21262d; }
                        .psd-range-btn { padding: 5px 12px; background: transparent; border: none; color: #8b949e; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.15s; }
                        .psd-range-btn.active { background: ${config.color}; color: #0d1117; }
                        .psd-range-btn:hover:not(.active) { background: #21262d; color: #e6edf3; }
                        .psd-chart-loading { display:flex;align-items:center;justify-content:center;height:320px;color:#8b949e;font-size:14px;gap:8px; }
                        .psd-spinner { width:16px;height:16px;border:2px solid #21262d;border-top-color:${config.color};border-radius:50%;animation:psd-spin 0.8s linear infinite; }
                        @keyframes psd-spin { to { transform: rotate(360deg); } }
                    </style>

                    <a class="psd-back" onclick="window.location.hash='#/leaderboard'">
                        <i class="fas fa-arrow-left"></i> Back to Leaderboard
                    </a>

                    <div class="psd-header">
                        <div>
                            <div class="psd-title">
                                <span class="emoji">${config.emoji}</span>
                                <h1>${escapeHtml(config.name)}</h1>
                            </div>
                            <div class="psd-desc">${tradeCount} trades executed</div>
                        </div>
                        <div class="psd-stats">
                            <div class="psd-stat">
                                <div class="psd-stat-label">Portfolio Value</div>
                                <div class="psd-stat-value">${formatCurrency(currentValue)}</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Total P&amp;L</div>
                                <div class="psd-stat-value ${pnlClass}">${formatCurrency(totalPnl)}</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Return</div>
                                <div class="psd-stat-value ${pnlClass}">${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Win Rate</div>
                                <div class="psd-stat-value">${winRate.toFixed(1)}%</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Trades</div>
                                <div class="psd-stat-value">${tradeCount}</div>
                            </div>
                        </div>
                    </div>

                    ${strategy?.positions?.length ? `
                    <div class="psd-section">
                        <div class="psd-section-header">
                            <h3 class="psd-section-title">Holdings</h3>
                        </div>
                        <div class="psd-positions">
                            <!-- Column headers -->
                            <div style="display:grid;grid-template-columns:64px 1fr 52px 100px 100px 52px 80px;gap:4px;padding:4px 0 8px;font-size:11px;color:#4d5566;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #21262d;">
                                <span>Symbol</span>
                                <span style="text-align:right;">Qty @ Avg Price</span>
                                <span style="text-align:right;">Alloc</span>
                                <span style="text-align:right;">Book Value</span>
                                <span style="text-align:right;">Market Value</span>
                                <span style="text-align:right;">Return</span>
                                <span style="text-align:right;">P&amp;L</span>
                            </div>
                            ${strategy.positions.map(p => {
                                const retPct = p.bookValue > 0 ? ((p.marketValue - p.bookValue) / p.bookValue * 100).toFixed(1) : '0.0';
                                const plColour = (p.unrealizedPl ?? 0) >= 0 ? '#3fb950' : '#f85149';
                                return `
                                <div class="psd-pos-row" style="display:grid;grid-template-columns:64px 1fr 52px 100px 100px 52px 80px;gap:4px;">
                                    <span style="font-weight:700;color:#e6edf3;">${escapeHtml(p.symbol)}</span>
                                    <span style="color:#8b949e;text-align:right;">${p.qty} @ ${formatCurrency(p.avgEntry)}</span>
                                    <span style="color:#58a6ff;font-weight:600;text-align:right;">${p.allocation ?? 0}%</span>
                                    <span style="color:#8b949e;text-align:right;">${formatCurrency(p.bookValue)}</span>
                                    <span style="color:#e6edf3;text-align:right;">${formatCurrency(p.marketValue)}</span>
                                    <span style="color:${plColour};text-align:right;font-weight:600;">${retPct >= 0 ? '+' : ''}${retPct}%</span>
                                    <span style="color:${plColour};text-align:right;font-weight:600;">${(p.unrealizedPl ?? 0) >= 0 ? '+' : ''}${formatCurrency(p.unrealizedPl)}</span>
                                </div>`;
                            }).join('')}
                            <!-- Cash / Margin row -->
                            ${(() => {
                                const cash = strategy.cashRemaining ?? 0;
                                const isMargin = cash < 0;
                                const cashLabel  = isMargin ? 'MARGIN' : 'CASH';
                                const cashColour = isMargin ? '#f85149' : '#8b949e';
                                const allocColour = isMargin ? '#f85149' : '#58a6ff';
                                return `
                            <div class="psd-pos-row" style="display:grid;grid-template-columns:64px 1fr 52px 100px 100px 52px 80px;gap:4px;border-top:1px solid #21262d;margin-top:4px;padding-top:8px;">
                                <span style="font-weight:700;color:${cashColour};">${cashLabel}</span>
                                <span></span>
                                <span style="color:${allocColour};font-weight:600;text-align:right;">${Math.abs(strategy.cashAllocation ?? 0)}%</span>
                                <span></span>
                                <span style="color:${cashColour};text-align:right;font-weight:600;">${formatCurrency(cash)}</span>
                                <span></span>
                                <span></span>
                            </div>`;
                            })()}
                        </div>
                    </div>` : ''}

                    <div class="psd-section">
                        <div class="psd-section-header">
                            <h3 class="psd-section-title">Portfolio Equity Curve</h3>
                            <div class="psd-range-selector" id="psd-range-selector">
                                <button class="psd-range-btn" data-range="1D">1D</button>
                                <button class="psd-range-btn" data-range="1W">1W</button>
                                <button class="psd-range-btn" data-range="1M">1M</button>
                                <button class="psd-range-btn active" data-range="ALL">ALL</button>
                            </div>
                        </div>
                        <div class="psd-chart-wrap" id="psd-chart-container">
                            <div class="psd-chart-loading">
                                <div class="psd-spinner"></div> Loading chart…
                            </div>
                        </div>
                    </div>

                    <div class="psd-section">
                        <div class="psd-section-header">
                            <h3 class="psd-section-title">Decision Log</h3>
                        </div>
                        <div id="psd-decision-log"></div>
                    </div>
                </div>
            `;

            // ── Chart rendering + range-button wiring ──────────────────────────
            let activeRange = 'ALL';
            const chartContainer = container.querySelector('#psd-chart-container');

            async function loadChart(range) {
                // Show loading state while fetching
                if (equityChartInstance) { equityChartInstance.destroy(); equityChartInstance = null; }
                chartContainer.innerHTML = `
                    <div class="psd-chart-loading">
                        <div class="psd-spinner"></div> Loading chart…
                    </div>`;
                await renderEquityCurve(chartContainer, strategyId, config.color, range);
            }

            container.querySelector('#psd-range-selector').addEventListener('click', async (e) => {
                const btn = e.target.closest('.psd-range-btn');
                if (!btn || btn.dataset.range === activeRange) return;

                // Update active button state
                container.querySelectorAll('.psd-range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeRange = btn.dataset.range;

                await loadChart(activeRange);
            });

            // Initial load
            await loadChart(activeRange);

            // Mount DecisionLog (backed by Alpaca data via fixed server endpoint)
            const logContainer = container.querySelector('#psd-decision-log');
            const decisionLog = new DecisionLog(logContainer, strategyId);
            await decisionLog.init();
        },

        destroy() {
            if (equityChartInstance) {
                equityChartInstance.destroy();
                equityChartInstance = null;
            }
        }
    };
}

export default createPage;
