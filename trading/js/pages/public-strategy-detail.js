import { api } from '../api.js';
import { formatCurrency, formatPercent, escapeHtml } from '../utils.js';
import { StrategyChart } from '../components/strategy-chart.js';
import { DecisionLog } from '../components/decision-log.js';

const STRATEGY_CONFIG = {
    'momentum-hunter': { name: 'Momentum Hunter', emoji: '🚀', color: '#3fb950', symbol: 'SOXL' },
    'mean-reversion': { name: 'Mean Reversion', emoji: '🔄', color: '#58a6ff', symbol: 'SOXL' },
    'sector-rotator': { name: 'Sector Rotator', emoji: '📊', color: '#d2a8ff', symbol: 'XLK' },
    'value-dividends': { name: 'Value & Dividends', emoji: '💎', color: '#f0883e', symbol: 'SCHD' },
    'volatility-breakout': { name: 'Volatility Breakout', emoji: '⚡', color: '#ff7b72', symbol: 'SOXL' }
};

let chart = null;

function createPage() {
    return {
        async render(container, params) {
            const strategyId = params.id;
            const config = STRATEGY_CONFIG[strategyId];

            if (!config) {
                container.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text-secondary);">Strategy not found. <a href="#/leaderboard" style="color:var(--accent);">Back to Leaderboard</a></div>`;
                return;
            }

            // Fetch strategy data from the dashboard endpoint
            let strategy = null;
            try {
                const strategies = await api.get('/dashboard/strategies');
                strategy = (strategies || []).find(s => s.id === strategyId);
            } catch (e) {
                console.error('Failed to load strategy data:', e);
            }

            // Determine symbol from positions or config
            const symbol = strategy?.positions?.[0]?.symbol || config.symbol;

            const totalReturn = strategy?.totalReturnPct ?? 0;
            const totalPnl = strategy?.totalPnl ?? 0;
            const winRate = strategy?.winRate ?? 0;
            const tradeCount = strategy?.tradeCount ?? 0;
            const currentValue = strategy?.currentValue ?? 0;
            const pnlClass = totalPnl >= 0 ? 'positive' : 'negative';

            container.innerHTML = `
                <div class="psd-page">
                    <style>
                        .psd-page { background: #0d1117; min-height: 100vh; padding: 1.5rem 2rem; color: #e6edf3; font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif; }
                        .psd-back { display: inline-flex; align-items: center; gap: 6px; color: #8b949e; text-decoration: none; font-size: 14px; margin-bottom: 1.5rem; transition: color 0.15s; }
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
                        .psd-positions { margin-top: 1rem; }
                        .psd-pos-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #21262d; }
                        .psd-pos-row:last-child { border-bottom: none; }
                    </style>

                    <a href="#/leaderboard" class="psd-back"><i class="fas fa-arrow-left"></i> Back to Leaderboard</a>

                    <div class="psd-header">
                        <div>
                            <div class="psd-title">
                                <span class="emoji">${config.emoji}</span>
                                <h1>${escapeHtml(config.name)}</h1>
                            </div>
                            <div class="psd-desc">Trading ${escapeHtml(symbol)} &middot; ${tradeCount} trades executed</div>
                        </div>
                        <div class="psd-stats">
                            <div class="psd-stat">
                                <div class="psd-stat-label">Portfolio Value</div>
                                <div class="psd-stat-value">${formatCurrency(currentValue)}</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Total P&L</div>
                                <div class="psd-stat-value ${pnlClass}">${formatCurrency(totalPnl)}</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Return</div>
                                <div class="psd-stat-value ${pnlClass}">${formatPercent(totalReturn, 2, false)}</div>
                            </div>
                            <div class="psd-stat">
                                <div class="psd-stat-label">Win Rate</div>
                                <div class="psd-stat-value">${formatPercent(winRate, 1, false)}</div>
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
                                    <span style="font-weight:600;">${escapeHtml(p.symbol)}</span>
                                    <span style="color:#8b949e;">${p.qty} shares @ ${formatCurrency(p.avgEntry)}</span>
                                    <span style="color:${p.unrealizedPl >= 0 ? '#3fb950' : '#f85149'};">${formatCurrency(p.unrealizedPl)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>` : ''}

                    <div class="psd-section">
                        <h3 class="psd-section-title">Price Chart &mdash; ${escapeHtml(symbol)}</h3>
                        <div id="psd-chart-container"></div>
                    </div>

                    <div class="psd-section">
                        <h3 class="psd-section-title">Decision Log</h3>
                        <div id="psd-decision-log"></div>
                    </div>
                </div>
            `;

            // Mount StrategyChart
            const chartContainer = container.querySelector('#psd-chart-container');
            chart = new StrategyChart(chartContainer);
            await chart.init(strategyId, symbol);

            // Mount DecisionLog
            const logContainer = container.querySelector('#psd-decision-log');
            const decisionLog = new DecisionLog(logContainer, strategyId);
            await decisionLog.init();
        },

        destroy() {
            if (chart) {
                chart.destroy();
                chart = null;
            }
        }
    };
}

export default createPage;
