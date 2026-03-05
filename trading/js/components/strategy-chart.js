import { api } from '../api.js';

const TIMEFRAMES = {
    today: { label: 'Today', days: 1, tf: '5Min' },
    '1w': { label: '1W', days: 7, tf: '1Hour' },
    '1m': { label: '1M', days: 30, tf: '1Day' },
    all: { label: 'All', days: 365, tf: '1Day' }
};

export class StrategyChart {
    constructor(container) {
        this.container = container;
        this.chart = null;
        this.candleSeries = null;
        this.strategyId = null;
        this.symbol = null;
        this.currentTimeframe = '1m';
    }

    async init(strategyId, symbol) {
        this.strategyId = strategyId;
        this.symbol = symbol;
        await this._render();
    }

    destroy() {
        if (this.chart) {
            this.chart.remove();
            this.chart = null;
        }
        this.container.innerHTML = '';
    }

    async setTimeframe(tf) {
        this.currentTimeframe = tf;
        await this._render();
    }

    async _render() {
        const tf = TIMEFRAMES[this.currentTimeframe];
        const to = new Date().toISOString().split('T')[0];
        const from = new Date(Date.now() - tf.days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        this.container.innerHTML = `
            <div class="chart-timeframe-switcher">
                ${Object.entries(TIMEFRAMES).map(([key, val]) => `
                    <button class="chart-tf-btn ${key === this.currentTimeframe ? 'active' : ''}"
                            data-tf="${key}">${val.label}</button>
                `).join('')}
            </div>
            <div class="chart-simulated-banner" style="display:none" id="simulated-banner">
                Using simulated data — Alpaca connection unavailable
            </div>
            <div class="strategy-chart-container" id="chart-render-target"></div>
        `;

        // Bind timeframe buttons
        this.container.querySelectorAll('.chart-tf-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setTimeframe(btn.dataset.tf));
        });

        let candles, trades, simulated;
        try {
            const [candleData, tradeData] = await Promise.all([
                api.get(`/strategies/${this.strategyId}/candles?timeframe=${tf.tf}&from=${from}&to=${to}&symbol=${this.symbol}`),
                api.get(`/strategies/${this.strategyId}/trades?limit=200`)
            ]);
            candles = candleData.candles || [];
            simulated = candleData.simulated;
            trades = tradeData.trades || [];
        } catch (error) {
            console.error('Failed to load chart data:', error);
            const target = this.container.querySelector('#chart-render-target');
            target.innerHTML = `<div class="dl-error">Failed to load chart data — ${error.message || 'Unknown error'}</div>`;
            return;
        }

        if (simulated) {
            this.container.querySelector('#simulated-banner').style.display = 'block';
        }

        if (!candles.length) {
            const target = this.container.querySelector('#chart-render-target');
            target.innerHTML = '<div class="dl-empty">No candle data available</div>';
            return;
        }

        this._createChart(candles, trades);
    }

    _createChart(candles, trades) {
        const target = this.container.querySelector('#chart-render-target');
        const styles = getComputedStyle(document.documentElement);
        const bgColor = styles.getPropertyValue('--bg-secondary').trim() || '#1a1a2e';
        const textColor = styles.getPropertyValue('--text-secondary').trim() || '#94a3b8';
        const borderColor = styles.getPropertyValue('--border').trim() || '#374151';

        if (this.chart) this.chart.remove();

        this.chart = LightweightCharts.createChart(target, {
            width: target.clientWidth,
            height: 400,
            layout: {
                background: { type: 'solid', color: bgColor },
                textColor,
            },
            grid: {
                vertLines: { color: borderColor },
                horzLines: { color: borderColor },
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            timeScale: { borderColor },
            rightPriceScale: { borderColor },
        });

        this.candleSeries = this.chart.addCandlestickSeries({
            upColor: '#3fb950',
            downColor: '#f85149',
            borderUpColor: '#3fb950',
            borderDownColor: '#f85149',
            wickUpColor: '#3fb950',
            wickDownColor: '#f85149',
        });

        this.candleSeries.setData(candles);

        // Build trade markers
        const markers = this._buildMarkers(candles, trades);
        if (markers.length) {
            this.candleSeries.setMarkers(markers);
        }

        // Tooltip on crosshair
        this._setupTooltip(candles, trades);

        // Resize observer
        const resizeObserver = new ResizeObserver(() => {
            if (this.chart) {
                this.chart.applyOptions({ width: target.clientWidth });
            }
        });
        resizeObserver.observe(target);

        this.chart.timeScale().fitContent();
    }

    _buildMarkers(candles, trades) {
        const candleTimes = new Set(candles.map(c => c.time));
        const markers = [];

        for (const trade of trades) {
            const tradeDate = (trade.executed_at || '').split('T')[0];
            if (!candleTimes.has(tradeDate)) continue;

            const isBuy = trade.side === 'buy';
            markers.push({
                time: tradeDate,
                position: isBuy ? 'belowBar' : 'aboveBar',
                color: isBuy ? '#3fb950' : '#f85149',
                shape: isBuy ? 'arrowUp' : 'arrowDown',
                text: isBuy ? 'BUY' : 'SELL'
            });
        }

        return markers.sort((a, b) => a.time.localeCompare(b.time));
    }

    _setupTooltip(candles, trades) {
        const tooltip = document.createElement('div');
        tooltip.style.cssText = 'position:absolute;top:12px;left:12px;padding:8px 12px;background:rgba(0,0,0,0.85);color:#e2e8f0;border-radius:6px;font-size:12px;pointer-events:none;z-index:10;display:none;max-width:300px;font-family:var(--font-mono,monospace)';
        this.container.querySelector('#chart-render-target').appendChild(tooltip);

        const tradeByDate = {};
        for (const t of trades) {
            const d = (t.executed_at || '').split('T')[0];
            tradeByDate[d] = t;
        }

        this.chart.subscribeCrosshairMove(param => {
            if (!param.time || !param.seriesData?.size) {
                tooltip.style.display = 'none';
                return;
            }

            const data = param.seriesData.get(this.candleSeries);
            if (!data) { tooltip.style.display = 'none'; return; }

            let html = `<div>${param.time}</div>`;
            html += `O: ${data.open} H: ${data.high} L: ${data.low} C: ${data.close}`;

            const trade = tradeByDate[param.time];
            if (trade) {
                html += `<br><b>${trade.side.toUpperCase()}</b>`;
                if (trade.pnl != null) html += ` P&L: $${trade.pnl.toFixed(2)}`;
                if (trade.reasoning?.condition) {
                    const cond = trade.reasoning.condition.length > 80
                        ? trade.reasoning.condition.slice(0, 77) + '...'
                        : trade.reasoning.condition;
                    html += `<br>${cond}`;
                }
            }

            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
        });
    }
}
