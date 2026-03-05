import { api } from '../api.js';
import { formatCurrency, formatDate } from '../utils.js';

const PAGE_SIZE = 50;

export class DecisionLog {
    constructor(container, strategyId) {
        this.container = container;
        this.strategyId = strategyId;
        this.trades = [];
        this.total = 0;
        this.offset = 0;
        this.filter = 'all'; // 'all' | 'buy' | 'sell'
        this.dateFrom = '';
        this.dateTo = '';
    }

    async init() {
        this.container.innerHTML = '';
        await this._fetchPage(0);
        this._render();
    }

    async loadMore() {
        await this._fetchPage(this.offset + PAGE_SIZE);
        this._render();
    }

    async _fetchPage(offset) {
        try {
            const data = await api.get(`/strategies/${this.strategyId}/trades?limit=${PAGE_SIZE}&offset=${offset}`);
            if (offset === 0) {
                this.trades = data.trades || [];
            } else {
                this.trades = this.trades.concat(data.trades || []);
            }
            this.total = data.total || 0;
            this.offset = offset;
        } catch (error) {
            console.error('Failed to load trades:', error);
            this.container.innerHTML = `<div class="dl-error">Failed to load trades — ${error.message || 'Unknown error'}</div>`;
            throw error;
        }
    }

    _getFilteredTrades() {
        return this.trades.filter(t => {
            if (this.filter !== 'all' && t.side !== this.filter) return false;
            if (this.dateFrom) {
                const tradeDate = (t.executed_at || '').split('T')[0];
                if (tradeDate < this.dateFrom) return false;
            }
            if (this.dateTo) {
                const tradeDate = (t.executed_at || '').split('T')[0];
                if (tradeDate > this.dateTo) return false;
            }
            return true;
        });
    }

    _render() {
        const filtered = this._getFilteredTrades();
        const allLoaded = this.trades.length >= this.total;

        this.container.innerHTML = `
            <div class="dl-filter-bar">
                <button class="chart-tf-btn ${this.filter === 'all' ? 'active' : ''}" data-filter="all">All</button>
                <button class="chart-tf-btn ${this.filter === 'buy' ? 'active' : ''}" data-filter="buy">BUY</button>
                <button class="chart-tf-btn ${this.filter === 'sell' ? 'active' : ''}" data-filter="sell">SELL</button>
                <input type="date" class="form-input dl-date-input" id="dl-date-from" value="${this.dateFrom}" placeholder="From">
                <input type="date" class="form-input dl-date-input" id="dl-date-to" value="${this.dateTo}" placeholder="To">
            </div>
            ${filtered.length === 0
                ? '<div class="dl-empty">No trades recorded yet</div>'
                : `<div class="dl-table-wrap"><table class="dl-table">
                    <thead>
                        <tr>
                            <th style="min-width:80px">Time</th>
                            <th style="min-width:70px">Action</th>
                            <th style="min-width:72px">Price</th>
                            <th>Signal</th>
                            <th style="min-width:64px">P&L</th>
                            <th style="min-width:28px"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map((t, i) => this._renderRow(t, i)).join('')}
                    </tbody>
                </table></div>`
            }
            ${!allLoaded ? '<button class="btn btn-secondary dl-load-more">Load More</button>' : ''}
        `;

        this._bindEvents();
    }

    _renderRow(trade, index) {
        const date = formatDate(trade.executed_at);
        const isBuy = trade.side === 'buy';
        const signal = trade.reasoning?.condition || trade.reason || '-';
        const signalShort = signal.length > 65 ? signal.slice(0, 62) + '…' : signal;
        const pnl = trade.pnl != null ? formatCurrency(trade.pnl) : '-';
        const pnlClass = trade.pnl > 0 ? 'positive' : trade.pnl < 0 ? 'negative' : '';

        return `
            <tr class="dl-row ${isBuy ? 'buy' : 'sell'}" data-idx="${index}">
                <td>${date}</td>
                <td><span class="badge badge-${isBuy ? 'success' : 'danger'}">${trade.side.toUpperCase()}</span></td>
                <td>${formatCurrency(trade.price)}</td>
                <td title="${signal}">${signalShort}</td>
                <td class="${pnlClass}">${pnl}</td>
                <td><i class="fas fa-chevron-down dl-expand-icon"></i></td>
            </tr>
            <tr class="dl-expanded-row" data-expanded-idx="${index}" style="display:none">
                <td colspan="6">
                    <div class="dl-expanded-content">
                        ${this._renderExpanded(trade)}
                    </div>
                </td>
            </tr>
        `;
    }

    _renderExpanded(trade) {
        // Rich reasoning object (user strategies with indicator data)
        if (trade.reasoning) {
            const r = trade.reasoning;
            const indicators = r.indicators || {};
            return `
                <div><strong>Signal:</strong> ${r.condition || trade.reason || '-'}</div>
                ${r.decision ? `<div><strong>Decision:</strong> ${r.decision}</div>` : ''}
                ${Object.keys(indicators).length ? `
                <div style="margin-top:4px"><strong>Indicators:</strong>
                    <span style="color:#8b949e;margin-left:8px">
                        ${indicators.rsi != null    ? `RSI ${indicators.rsi}` : ''}
                        ${indicators.macd != null   ? ` · MACD ${indicators.macd}` : ''}
                        ${indicators.ema_cross != null ? ` · EMA cross ${indicators.ema_cross}` : ''}
                        ${indicators.composite_score != null ? ` · Score ${indicators.composite_score}` : ''}
                    </span>
                </div>` : ''}
            `;
        }

        // Showcase strategy — reason IS the explanation
        const reason = trade.reason || 'No reasoning data available';
        const isBuy  = trade.side === 'buy';
        return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:2px 0;">
                <span style="color:${isBuy ? '#3fb950' : '#f85149'};font-size:11px;font-weight:700;min-width:36px;margin-top:1px;">${isBuy ? 'WHY BUY' : 'WHY SELL'}</span>
                <span style="color:#c9d1d9;font-size:13px;line-height:1.5;">${reason}</span>
            </div>
        `;
    }

    _bindEvents() {
        // Filter buttons
        this.container.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.filter = btn.dataset.filter;
                this._render();
            });
        });

        // Date filters
        const fromInput = this.container.querySelector('#dl-date-from');
        const toInput = this.container.querySelector('#dl-date-to');
        if (fromInput) fromInput.addEventListener('change', () => { this.dateFrom = fromInput.value; this._render(); });
        if (toInput) toInput.addEventListener('change', () => { this.dateTo = toInput.value; this._render(); });

        // Expand/collapse rows
        this.container.querySelectorAll('.dl-row').forEach(row => {
            row.addEventListener('click', () => {
                const idx = row.dataset.idx;
                const expanded = this.container.querySelector(`[data-expanded-idx="${idx}"]`);
                if (expanded) {
                    const isVisible = expanded.style.display !== 'none';
                    expanded.style.display = isVisible ? 'none' : '';
                    row.classList.toggle('expanded', !isVisible);
                }
            });
        });

        // Load more
        const loadMoreBtn = this.container.querySelector('.dl-load-more');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => this.loadMore());
        }
    }
}
