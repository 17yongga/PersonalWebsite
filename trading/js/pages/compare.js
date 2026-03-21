// Strategy Comparison Page

import { api } from '../api.js';

const COLORS = {
    momentum: '#3b82f6',
    mean_reversion: '#8b5cf6',
    sector_rotation: '#10b981',
    value_dividend: '#f59e0b',
    volatility_breakout: '#ef4444',
};

function ComparePage() {
    let equityChart = null;
    let radarChart = null;
    let styleEl = null;
    let hiddenLines = new Set();

    async function render(container) {
        injectStyles();
        container.innerHTML = buildLoadingHTML();

        try {
            const data = await api.get('/compare/overview');
            container.innerHTML = buildPageHTML(data);
            initEquityChart(data);
            initRadarChart(data);
            bindToggleButtons();
        } catch (err) {
            container.innerHTML = buildErrorHTML(err.message);
        }
    }

    function buildLoadingHTML() {
        return `
<div class="cmp-page">
    <div class="cmp-header">
        <h1 class="cmp-title"><i class="fas fa-balance-scale"></i> Strategy Comparison</h1>
        <p class="cmp-subtitle">Head-to-head performance across all five strategies</p>
    </div>
    <div class="cmp-loading"><div class="spinner spinner-lg"></div><p>Loading comparison data…</p></div>
</div>`;
    }

    function buildErrorHTML(message) {
        return `
<div class="cmp-page">
    <div class="cmp-header">
        <h1 class="cmp-title"><i class="fas fa-balance-scale"></i> Strategy Comparison</h1>
    </div>
    <div class="cmp-empty">
        <div class="empty-icon"><i class="fas fa-exclamation-triangle"></i></div>
        <h3>Unable to load comparison data</h3>
        <p>${message || 'Please try again later.'}</p>
    </div>
</div>`;
    }

    function fmt(val, type) {
        if (val == null) return '<span class="cmp-null">—</span>';
        switch (type) {
            case 'pct': {
                const cls = val >= 0 ? 'pos' : 'neg';
                return `<span class="cmp-${cls}">${(val * 100).toFixed(1)}%</span>`;
            }
            case 'ratio':
                return val.toFixed(2);
            case 'dd': {
                return `<span class="cmp-neg">${(val * 100).toFixed(1)}%</span>`;
            }
            case 'wr':
                return `${(val * 100).toFixed(0)}%`;
            case 'int':
                return val.toString();
            default:
                return String(val);
        }
    }

    function findWinner(strategies, metricKey, higherIsBetter = true) {
        let best = null;
        let bestVal = higherIsBetter ? -Infinity : Infinity;
        for (const s of strategies) {
            const v = s.metrics[metricKey];
            if (v == null) continue;
            if (higherIsBetter ? v > bestVal : v < bestVal) {
                bestVal = v;
                best = s;
            }
        }
        return best;
    }

    function buildPageHTML(data) {
        const { strategies, benchmark } = data;

        // Rankings
        const bestReturn = findWinner(strategies, 'totalReturn');
        const bestSharpe = findWinner(strategies, 'sharpeRatio');
        const bestWinRate = findWinner(strategies, 'winRate');
        // Best overall = highest Sharpe (risk-adjusted)
        const bestOverall = bestSharpe;

        const rankings = [
            { label: '🏆 Best Overall', strategy: bestOverall },
            { label: '📈 Best Returns', strategy: bestReturn },
            { label: '🛡️ Best Sharpe', strategy: bestSharpe },
            { label: '🎯 Highest Win Rate', strategy: bestWinRate },
        ];

        // Metric columns for table — [key, label, format, higherIsBetter]
        const cols = [
            ['totalReturn', 'Total Return', 'pct', true],
            ['sharpeRatio', 'Sharpe', 'ratio', true],
            ['maxDrawdown', 'Max Drawdown', 'dd', false],
            ['winRate', 'Win Rate', 'wr', true],
            ['totalTrades', 'Trades', 'int', true],
            ['profitFactor', 'Profit Factor', 'ratio', true],
        ];

        // Find winner per column
        const colWinners = {};
        for (const [key, , , hib] of cols) {
            const w = findWinner(strategies, key, hib);
            colWinners[key] = w ? w.id : null;
        }

        return `
<div class="cmp-page">
    <div class="cmp-header">
        <h1 class="cmp-title"><i class="fas fa-balance-scale"></i> Strategy Comparison</h1>
        <p class="cmp-subtitle">Head-to-head performance across all five strategies</p>
    </div>

    <!-- Rankings Strip -->
    <div class="cmp-rankings">
        ${rankings.map(r => `
            <div class="cmp-rank-badge">
                <span class="rank-label">${r.label}</span>
                <span class="rank-name" style="color: ${r.strategy ? r.strategy.color : 'var(--text-secondary)'}">
                    ${r.strategy ? `${r.strategy.icon} ${r.strategy.name}` : '—'}
                </span>
            </div>
        `).join('')}
    </div>

    <!-- Metrics Table -->
    <div class="cmp-table-wrap">
        <table class="cmp-table">
            <thead>
                <tr>
                    <th>Strategy</th>
                    ${cols.map(([, label]) => `<th>${label}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${strategies.map(s => `
                    <tr>
                        <td>
                            <span class="cmp-strat-dot" style="background:${s.color}"></span>
                            <span class="cmp-strat-icon">${s.icon}</span>
                            ${s.name}
                        </td>
                        ${cols.map(([key, , type]) => {
                            const isWinner = colWinners[key] === s.id;
                            return `<td class="${isWinner ? 'cmp-winner' : ''}">${fmt(s.metrics[key], type)}</td>`;
                        }).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <!-- Charts Row -->
    <div class="cmp-charts-row">
        <div class="card cmp-chart-card cmp-equity-card">
            <div class="cmp-chart-header">
                <h3><i class="fas fa-chart-line"></i> Equity Curves (90 Days)</h3>
                <div class="cmp-toggles" id="cmp-toggles">
                    ${strategies.map(s => `
                        <button class="cmp-toggle active" data-id="${s.id}" style="--tc:${s.color}">
                            ${s.icon} ${s.name}
                        </button>
                    `).join('')}
                    <button class="cmp-toggle active" data-id="benchmark" style="--tc:#94a3b8">
                        📊 SPY
                    </button>
                </div>
            </div>
            <canvas id="cmp-equity-chart" height="90"></canvas>
        </div>

        <div class="card cmp-chart-card cmp-radar-card">
            <div class="cmp-chart-header">
                <h3><i class="fas fa-spider"></i> Strategy Radar</h3>
            </div>
            <canvas id="cmp-radar-chart" height="90"></canvas>
        </div>
    </div>
</div>`;
    }

    function initEquityChart(data) {
        if (equityChart) equityChart.destroy();
        const ctx = document.getElementById('cmp-equity-chart');
        if (!ctx) return;

        const datasets = data.strategies.map(s => ({
            label: s.name,
            data: s.equityCurve.map(p => ({ x: p.date, y: p.value })),
            borderColor: s.color,
            backgroundColor: 'transparent',
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
            hidden: hiddenLines.has(s.id),
            _stratId: s.id,
        }));

        datasets.push({
            label: 'SPY',
            data: data.benchmark.map(p => ({ x: p.date, y: p.value })),
            borderColor: '#94a3b8',
            backgroundColor: 'transparent',
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 1.5,
            borderDash: [4, 3],
            hidden: hiddenLines.has('benchmark'),
            _stratId: 'benchmark',
        });

        equityChart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
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
                            label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`,
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
                        ticks: { color: '#64748b', callback: v => '$' + (v / 1000).toFixed(0) + 'k' },
                    },
                },
            },
        });
    }

    function initRadarChart(data) {
        if (radarChart) radarChart.destroy();
        const ctx = document.getElementById('cmp-radar-chart');
        if (!ctx) return;

        // Normalize metrics to 0-100 scale
        const metricKeys = ['totalReturn', 'sharpeRatio', 'maxDrawdown', 'winRate', 'profitFactor'];
        const metricLabels = ['Return', 'Sharpe', 'Drawdown', 'Win Rate', 'Profit Factor'];

        // Gather all values per metric for min/max
        const ranges = {};
        for (const key of metricKeys) {
            const vals = data.strategies.map(s => s.metrics[key]).filter(v => v != null);
            ranges[key] = { min: Math.min(...vals, 0), max: Math.max(...vals, 1) };
        }

        function normalize(val, key) {
            if (val == null) return 0;
            const r = ranges[key];
            const span = r.max - r.min || 1;
            let norm = ((val - r.min) / span) * 100;
            // For drawdown, lower (more negative) is worse — invert
            if (key === 'maxDrawdown') norm = 100 - norm;
            return Math.max(0, Math.min(100, parseFloat(norm.toFixed(1))));
        }

        const datasets = data.strategies.map(s => ({
            label: s.name,
            data: metricKeys.map(k => normalize(s.metrics[k], k)),
            borderColor: s.color,
            backgroundColor: s.color + '20',
            borderWidth: 2,
            pointBackgroundColor: s.color,
            pointRadius: 3,
        }));

        radarChart = new Chart(ctx, {
            type: 'radar',
            data: { labels: metricLabels, datasets },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11 } },
                        position: 'bottom',
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
                    r: {
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        angleLines: { color: 'rgba(255,255,255,0.08)' },
                        pointLabels: { color: '#94a3b8', font: { size: 11 } },
                        ticks: { display: false },
                        suggestedMin: 0,
                        suggestedMax: 100,
                    },
                },
            },
        });
    }

    function bindToggleButtons() {
        const container = document.getElementById('cmp-toggles');
        if (!container) return;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.cmp-toggle');
            if (!btn) return;
            const id = btn.dataset.id;
            btn.classList.toggle('active');
            if (hiddenLines.has(id)) {
                hiddenLines.delete(id);
            } else {
                hiddenLines.add(id);
            }
            // Toggle dataset visibility
            if (equityChart) {
                for (const ds of equityChart.data.datasets) {
                    if (ds._stratId === id) {
                        ds.hidden = hiddenLines.has(id);
                    }
                }
                equityChart.update();
            }
        });
    }

    function injectStyles() {
        if (document.getElementById('cmp-page-styles')) return;
        styleEl = document.createElement('style');
        styleEl.id = 'cmp-page-styles';
        styleEl.textContent = `
.cmp-page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 1.5rem;
}
.cmp-header { margin-bottom: 1.5rem; }
.cmp-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.cmp-title i { color: var(--accent); }
.cmp-subtitle {
    color: var(--text-secondary);
    margin-top: 0.25rem;
    font-size: 0.95rem;
}
.cmp-loading, .cmp-empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-secondary);
}
.cmp-empty .empty-icon { font-size: 3rem; opacity: 0.5; margin-bottom: 1rem; }

/* Rankings Strip */
.cmp-rankings {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
}
.cmp-rank-badge {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 1rem;
    text-align: center;
}
.rank-label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 0.4rem;
}
.rank-name {
    font-weight: 700;
    font-size: 0.95rem;
}

/* Metrics Table */
.cmp-table-wrap {
    overflow-x: auto;
    margin-bottom: 1.5rem;
    border-radius: 12px;
    border: 1px solid var(--border-color);
    background: var(--bg-card);
}
.cmp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.cmp-table th, .cmp-table td {
    padding: 0.75rem 1rem;
    text-align: right;
    white-space: nowrap;
    color: var(--text-primary);
}
.cmp-table th {
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-color);
}
.cmp-table td:first-child, .cmp-table th:first-child {
    text-align: left;
    font-weight: 600;
}
.cmp-table tbody tr { border-bottom: 1px solid var(--border-color); }
.cmp-table tbody tr:last-child { border-bottom: none; }
.cmp-table tbody tr:hover { background: rgba(255,255,255,0.03); }
.cmp-strat-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.4rem;
    vertical-align: middle;
}
.cmp-strat-icon { margin-right: 0.25rem; }
.cmp-winner { font-weight: 700; }
.cmp-pos { color: var(--success); }
.cmp-neg { color: var(--danger); }
.cmp-null { color: var(--text-secondary); }

/* Charts Row */
.cmp-charts-row {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
}
.cmp-chart-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 1.25rem;
}
.cmp-chart-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
}
.cmp-chart-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

/* Toggle Buttons */
.cmp-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}
.cmp-toggle {
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
}
.cmp-toggle.active {
    background: color-mix(in srgb, var(--tc) 15%, transparent);
    border-color: var(--tc);
    color: var(--tc);
}
.cmp-toggle:hover { opacity: 0.8; }

/* Responsive */
@media (max-width: 768px) {
    .cmp-page { padding: 1rem; }
    .cmp-rankings { grid-template-columns: repeat(2, 1fr); }
    .cmp-charts-row { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
    .cmp-rankings { grid-template-columns: 1fr; }
}
        `;
        document.head.appendChild(styleEl);
    }

    function destroy() {
        if (equityChart) { equityChart.destroy(); equityChart = null; }
        if (radarChart) { radarChart.destroy(); radarChart = null; }
    }

    return { render, destroy };
}

export default ComparePage;
