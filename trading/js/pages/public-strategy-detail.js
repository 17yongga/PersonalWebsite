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
 * Render a Chart.js equity curve for this strategy, with BUY/SELL event markers
 * overlaid as scatter points at the times each trade was executed.
 */
async function renderEquityCurve(container, strategyId, stratColor, tradesData) {
    // Wait for Chart.js
    let tries = 0;
    while (typeof Chart === 'undefined' && tries++ < 30) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (typeof Chart === 'undefined') {
        container.innerHTML = '<p style="color:#8b949e;text-align:center;padding:2rem">Chart.js failed to load</p>';
        return;
    }

    // Fetch equity history
    let snapshots = [], equityTrades = [];
    try {
        const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3002'
            : 'https://api.gary-yong.com';
        const res = await fetch(`${apiBase}/api/v1/dashboard/equity-history?range=ALL`);
        if (res.ok) {
            const d = await res.json();
            snapshots    = d.snapshots  || [];
            equityTrades = (d.trades || []).filter(t => t.strategy === strategyId);
        }
    } catch (e) {
        console.warn('Failed to load equity history:', e);
    }

    // Build equity line data points
    const lineData = snapshots
        .filter(s => s[strategyId] !== undefined)
        .map(s => ({ x: new Date(s.timestamp).getTime(), y: s[strategyId] }));

    if (lineData.length === 0) {
        container.innerHTML = '<p style="color:#8b949e;text-align:center;padding:2rem">No equity data yet</p>';
        return;
    }

    // Build trade marker datasets from equity-history trades array
    // Find the closest equity snapshot value at each trade time
    const findNearestValue = (ts) => {
        const t = new Date(ts).getTime();
        let best = lineData[0];
        let bestDiff = Math.abs(t - best.x);
        for (const pt of lineData) {
            const d = Math.abs(t - pt.x);
            if (d < bestDiff) { bestDiff = d; best = pt; }
        }
        return best?.y ?? 20000;
    };

    const buyPoints  = equityTrades.filter(t => t.action === 'buy').map(t => ({
        x: new Date(t.timestamp).getTime(),
        y: findNearestValue(t.timestamp),
        label: `BUY ${t.quantity} ${t.symbol} @ $${t.price}`
    }));
    const sellPoints = equityTrades.filter(t => t.action === 'sell').map(t => ({
        x: new Date(t.timestamp).getTime(),
        y: findNearestValue(t.timestamp),
        label: `SELL ${t.quantity} ${t.symbol} @ $${t.price}`
    }));

    // Also add trade markers from the decision log trades (from Alpaca)
    if (tradesData?.length) {
        tradesData.forEach(t => {
            const ts = t.executed_at;
            const val = findNearestValue(ts);
            if (t.side === 'buy') {
                if (!buyPoints.find(p => Math.abs(p.x - new Date(ts).getTime()) < 60000)) {
                    buyPoints.push({ x: new Date(ts).getTime(), y: val, label: `BUY ${t.quantity} ${t.symbol} @ $${t.price?.toFixed(2)}` });
                }
            } else {
                if (!sellPoints.find(p => Math.abs(p.x - new Date(ts).getTime()) < 60000)) {
                    sellPoints.push({ x: new Date(ts).getTime(), y: val, label: `SELL ${t.quantity} ${t.symbol} @ $${t.price?.toFixed(2)}` });
                }
            }
        });
    }

    container.innerHTML = '<canvas id="psd-equity-canvas" style="width:100%;height:320px"></canvas>';
    const canvas = container.querySelector('#psd-equity-canvas');
    const ctx = canvas.getContext('2d');

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
                            return ts ? new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
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
                    time: { tooltipFormat: 'MMM d, h:mm a', displayFormats: { day: 'MMM d', hour: 'MMM d ha' } },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b949e', font: { size: 10 } },
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

            // Fetch strategy summary and trades in parallel
            let strategy = null;
            let tradesData = [];
            try {
                const [strategies, tradesRes] = await Promise.all([
                    api.get('/dashboard/strategies'),
                    api.get(`/strategies/${strategyId}/trades?limit=200`)
                ]);
                strategy    = (strategies || []).find(s => s.id === strategyId);
                tradesData  = tradesRes?.trades || [];
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
                        .psd-section-title { font-size: 1rem; font-weight: 600; margin: 0 0 1rem 0; color: #e6edf3; }
                        .psd-positions { margin-top: 0.5rem; }
                        .psd-pos-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #21262d; }
                        .psd-pos-row:last-child { border-bottom: none; }
                        .psd-chart-wrap { height: 320px; position: relative; }
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
                        <h3 class="psd-section-title">Open Positions</h3>
                        <div class="psd-positions">
                            ${strategy.positions.map(p => `
                                <div class="psd-pos-row">
                                    <span style="font-weight:600;min-width:60px">${escapeHtml(p.symbol)}</span>
                                    <span style="color:#8b949e;">${p.qty} shares @ ${formatCurrency(p.avgEntry)}</span>
                                    <span style="color:${p.unrealizedPl >= 0 ? '#3fb950' : '#f85149'};">${p.unrealizedPl >= 0 ? '+' : ''}${formatCurrency(p.unrealizedPl)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>` : ''}

                    <div class="psd-section">
                        <h3 class="psd-section-title">Portfolio Equity Curve</h3>
                        <div class="psd-chart-wrap" id="psd-chart-container"></div>
                    </div>

                    <div class="psd-section">
                        <h3 class="psd-section-title">Decision Log</h3>
                        <div id="psd-decision-log"></div>
                    </div>
                </div>
            `;

            // Render equity curve chart with trade markers
            const chartContainer = container.querySelector('#psd-chart-container');
            await renderEquityCurve(chartContainer, strategyId, config.color, tradesData);

            // Mount DecisionLog (now backed by Alpaca data via fixed server endpoint)
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
