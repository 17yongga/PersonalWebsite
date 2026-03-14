// Risk Dashboard Page
// Drawdown curve, Sharpe cards, position concentration heatmap, daily loss limit, portfolio vs benchmark

import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { formatCurrency, formatPercent } from '../utils.js';

function RiskPage() {
    let drawdownChart = null;
    let benchmarkChart = null;
    let styleEl = null;

    async function render(container) {
        injectStyles();
        container.innerHTML = buildLoadingHTML();

        try {
            const [overview, drawdownHistory] = await Promise.all([
                api.get('/risk/overview'),
                api.get('/risk/drawdown-history'),
            ]);

            container.innerHTML = buildPageHTML(overview, drawdownHistory);
            renderDrawdownChart(drawdownHistory);
            renderBenchmarkChart(drawdownHistory);
        } catch (err) {
            container.innerHTML = buildErrorHTML(err.message);
        }
    }

    function buildLoadingHTML() {
        return `
<div class="risk-page">
    <div class="risk-header">
        <div class="risk-title-block">
            <h1 class="risk-title"><i class="fas fa-shield-alt"></i> Risk Dashboard</h1>
            <p class="risk-subtitle">Portfolio risk metrics, drawdown analysis, and position concentration</p>
        </div>
    </div>
    <div class="risk-loading">
        <div class="spinner spinner-lg"></div>
        <p>Loading risk data…</p>
    </div>
</div>`;
    }

    function buildErrorHTML(message) {
        return `
<div class="risk-page">
    <div class="risk-header">
        <div class="risk-title-block">
            <h1 class="risk-title"><i class="fas fa-shield-alt"></i> Risk Dashboard</h1>
        </div>
    </div>
    <div class="risk-empty">
        <div class="empty-icon"><i class="fas fa-exclamation-triangle"></i></div>
        <h3>Unable to load risk data</h3>
        <p>${message || 'Please try again later.'}</p>
    </div>
</div>`;
    }

    function buildPageHTML(overview, drawdownHistory) {
        const d = overview;
        const dd = d.drawdown;
        const pnl = d.daily_pnl;
        const positions = d.positions || [];
        const sharpeRatios = d.sharpe_ratios || [];

        const pnlBarColor = pnl.limit_used_pct > 80 ? 'var(--danger)' : pnl.limit_used_pct > 50 ? 'var(--warning)' : 'var(--success)';
        const pnlClass = pnl.today_pnl >= 0 ? 'pos' : 'neg';

        return `
<div class="risk-page">
    <div class="risk-header">
        <div class="risk-title-block">
            <h1 class="risk-title"><i class="fas fa-shield-alt"></i> Risk Dashboard</h1>
            <p class="risk-subtitle">Portfolio value: ${formatCurrency(d.portfolio_value)}</p>
        </div>
    </div>

    <!-- Daily Loss Limit -->
    <div class="card risk-loss-limit">
        <div class="loss-limit-header">
            <h3><i class="fas fa-exclamation-circle"></i> Daily Loss Limit</h3>
            <span class="loss-limit-value ${pnlClass}">
                Today: ${pnl.today_pnl >= 0 ? '+' : ''}${formatCurrency(pnl.today_pnl)}
            </span>
        </div>
        <div class="loss-limit-bar-track">
            <div class="loss-limit-bar-fill" style="width: ${Math.min(pnl.limit_used_pct, 100)}%; background: ${pnlBarColor}"></div>
        </div>
        <div class="loss-limit-labels">
            <span>${formatPercent(pnl.limit_used_pct, 1, false)} of 2% limit used</span>
            <span>Limit: ${formatCurrency(pnl.daily_limit)}</span>
        </div>
    </div>

    <!-- Stats Row: Sharpe Cards + Drawdown Summary -->
    <div class="risk-stats-row">
        <!-- Sharpe Ratio Cards -->
        <div class="risk-sharpe-section">
            <h3 class="risk-section-title"><i class="fas fa-chart-bar"></i> Sharpe Ratios (Annualized)</h3>
            <div class="sharpe-cards">
                ${sharpeRatios.map(s => `
                    <div class="sharpe-card" style="border-left: 3px solid ${s.color}">
                        <div class="sharpe-card-header">
                            <span class="sharpe-icon">${s.icon}</span>
                            <span class="sharpe-name">${s.name}</span>
                        </div>
                        <div class="sharpe-value" style="color: ${s.color}">
                            ${s.sharpe !== null ? s.sharpe.toFixed(2) : '--'}
                        </div>
                        <div class="sharpe-label">${s.label || ''}</div>
                    </div>
                `).join('')}
                ${sharpeRatios.length === 0 ? '<p class="no-data">No active strategies</p>' : ''}
            </div>
        </div>

        <!-- Position Concentration Heatmap -->
        <div class="risk-concentration-section">
            <h3 class="risk-section-title"><i class="fas fa-th-large"></i> Position Concentration</h3>
            <div class="concentration-grid">
                ${positions.length === 0 ? '<p class="no-data">No open positions</p>' : ''}
                ${positions.map(p => {
                    const bgColor = p.pct_of_portfolio > 15 ? 'var(--danger)' :
                                    p.pct_of_portfolio > 5 ? 'var(--warning)' : 'var(--success)';
                    const size = Math.max(60, Math.min(140, 60 + p.pct_of_portfolio * 4));
                    return `
                        <div class="concentration-cell" style="background: ${bgColor}; width: ${size}px; height: ${size}px;">
                            <span class="conc-symbol">${p.symbol}</span>
                            <span class="conc-pct">${p.pct_of_portfolio.toFixed(1)}%</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    </div>

    <!-- Charts -->
    <div class="risk-charts-row">
        <div class="card chart-card risk-chart-main">
            <div class="chart-card-header">
                <h3><i class="fas fa-arrow-down"></i> Drawdown Curve (90 Days)</h3>
                <div class="drawdown-stats">
                    <span>Current: ${dd.current_pct.toFixed(2)}%</span>
                    <span>Max (30d): ${dd.max_pct_30d.toFixed(2)}%</span>
                </div>
            </div>
            <canvas id="risk-drawdown-chart" height="80"></canvas>
        </div>

        <div class="card chart-card risk-chart-side">
            <div class="chart-card-header">
                <h3><i class="fas fa-chart-line"></i> Portfolio vs SPY (30 Days)</h3>
            </div>
            <canvas id="risk-benchmark-chart" height="80"></canvas>
        </div>
    </div>
</div>`;
    }

    function renderDrawdownChart(drawdownHistory) {
        if (drawdownChart) drawdownChart.destroy();

        const ctx = document.getElementById('risk-drawdown-chart');
        if (!ctx) return;

        const data = (drawdownHistory || []).map(r => ({ x: r.date, y: r.drawdown_pct }));

        drawdownChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Drawdown %',
                    data: data,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    fill: true,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    borderWidth: 2,
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
                        time: { unit: 'week', displayFormats: { week: 'MMM d' } },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', maxTicksLimit: 10 },
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', callback: v => v.toFixed(1) + '%' },
                    },
                },
            },
        });
    }

    function renderBenchmarkChart(drawdownHistory) {
        if (benchmarkChart) benchmarkChart.destroy();

        const ctx = document.getElementById('risk-benchmark-chart');
        if (!ctx) return;

        // Use last 30 entries from drawdown history for portfolio NAV
        const last30 = (drawdownHistory || []).slice(-30);
        if (last30.length === 0) return;

        const startValue = last30[0].portfolio_value;
        const portfolioData = last30.map(r => ({
            x: r.date,
            y: parseFloat(((r.portfolio_value / startValue) * 100).toFixed(2)),
        }));

        // Generate mock SPY baseline (slight upward trend with noise)
        let spyVal = 100;
        const spyData = last30.map(r => {
            spyVal = spyVal * (1 + (Math.random() - 0.47) * 0.008);
            return { x: r.date, y: parseFloat(spyVal.toFixed(2)) };
        });

        benchmarkChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Portfolio',
                        data: portfolioData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.2,
                        pointRadius: 0,
                        borderWidth: 2,
                    },
                    {
                        label: 'SPY',
                        data: spyData,
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
                    legend: {
                        display: true,
                        labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'line', padding: 12 },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 26, 0.95)',
                        borderColor: '#374151',
                        borderWidth: 1,
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                    },
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'week', displayFormats: { week: 'MMM d' } },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', maxTicksLimit: 6 },
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', callback: v => v.toFixed(0) },
                    },
                },
            },
        });
    }

    function injectStyles() {
        if (document.getElementById('risk-page-styles')) return;
        styleEl = document.createElement('style');
        styleEl.id = 'risk-page-styles';
        styleEl.textContent = `
.risk-page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 1.5rem;
}
.risk-header {
    margin-bottom: 1.5rem;
}
.risk-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.risk-title i {
    color: var(--accent);
}
.risk-subtitle {
    color: var(--text-secondary);
    margin-top: 0.25rem;
    font-size: 0.95rem;
}
.risk-loading, .risk-empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-secondary);
}
.risk-empty .empty-icon {
    font-size: 3rem;
    opacity: 0.5;
    margin-bottom: 1rem;
}

/* Daily Loss Limit */
.risk-loss-limit {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
}
.loss-limit-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
}
.loss-limit-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.loss-limit-value {
    font-weight: 600;
    font-size: 0.95rem;
}
.loss-limit-value.pos { color: var(--success); }
.loss-limit-value.neg { color: var(--danger); }
.loss-limit-bar-track {
    width: 100%;
    height: 10px;
    background: var(--bg-secondary);
    border-radius: 5px;
    overflow: hidden;
}
.loss-limit-bar-fill {
    height: 100%;
    border-radius: 5px;
    transition: width 0.5s ease;
}
.loss-limit-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-top: 0.4rem;
}

/* Stats Row */
.risk-stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
}
.risk-section-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

/* Sharpe Cards */
.sharpe-cards {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.sharpe-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
}
.sharpe-card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
}
.sharpe-icon {
    font-size: 1.1rem;
}
.sharpe-name {
    font-size: 0.85rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.sharpe-value {
    font-size: 1.25rem;
    font-weight: 700;
    min-width: 50px;
    text-align: right;
}
.sharpe-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    min-width: 80px;
    text-align: right;
}

/* Concentration Heatmap */
.concentration-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
.concentration-cell {
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 600;
    min-width: 60px;
    min-height: 60px;
    opacity: 0.85;
    transition: opacity 0.2s;
}
.concentration-cell:hover {
    opacity: 1;
}
.conc-symbol {
    font-size: 0.85rem;
    font-weight: 700;
}
.conc-pct {
    font-size: 0.75rem;
    font-weight: 500;
    opacity: 0.9;
}

/* Charts Row */
.risk-charts-row {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
}
.risk-chart-main, .risk-chart-side {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 1.25rem;
}
.chart-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
}
.chart-card-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.drawdown-stats {
    display: flex;
    gap: 1rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.no-data {
    color: var(--text-secondary);
    font-size: 0.85rem;
    padding: 1rem 0;
}

/* Responsive */
@media (max-width: 768px) {
    .risk-page {
        padding: 1rem;
    }
    .risk-stats-row {
        grid-template-columns: 1fr;
    }
    .risk-charts-row {
        grid-template-columns: 1fr;
    }
    .sharpe-card {
        flex-wrap: wrap;
    }
    .loss-limit-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
    }
}
        `;
        document.head.appendChild(styleEl);
    }

    function destroy() {
        if (drawdownChart) { drawdownChart.destroy(); drawdownChart = null; }
        if (benchmarkChart) { benchmarkChart.destroy(); benchmarkChart = null; }
    }

    return { render, destroy };
}

export default RiskPage;
