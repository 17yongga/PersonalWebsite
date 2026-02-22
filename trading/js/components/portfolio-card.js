// Portfolio Card Component

import { formatCurrency, formatPercent, escapeHtml } from '../utils.js';

export function PortfolioCard(portfolio) {
    // Calculate derived values (all snake_case from API)
    const totalValue = portfolio.total_value || 0;
    const cashBalance = portfolio.cash_balance || 0;
    const dailyChange = portfolio.daily_change || 0;
    const dailyChangePercent = portfolio.daily_change_percent || 0;
    const positionCount = portfolio.position_count || 0;
    const startingBalance = portfolio.starting_balance || 0;
    
    // Calculate invested amount
    const investedAmount = Math.max(0, totalValue - cashBalance);
    
    // Calculate allocation percentages
    const cashPercent = totalValue > 0 ? (cashBalance / totalValue) * 100 : 100;
    const investedPercent = totalValue > 0 ? (investedAmount / totalValue) * 100 : 0;
    
    // Format values
    const formattedTotal = formatCurrency(totalValue);
    const formattedCash = formatCurrency(cashBalance);
    const formattedDailyChange = formatCurrency(dailyChange);
    const changePercent = formatPercent(dailyChangePercent);
    
    // Determine change color class
    let changeClass = 'neutral';
    if (dailyChange > 0) changeClass = 'positive';
    else if (dailyChange < 0) changeClass = 'negative';
    
    return `
        <div class="portfolio-card" data-portfolio-id="${portfolio.id}" onclick="navigateToPortfolio('${portfolio.id}')">
            <div class="portfolio-card__header">
                <h3 class="portfolio-card__name">${escapeHtml(portfolio.name)}</h3>
                <div class="portfolio-card__menu">
                    <button class="portfolio-menu-button" onclick="event.stopPropagation(); showPortfolioMenu(event, '${portfolio.id}')" aria-label="Portfolio menu">
                        <i class="fas fa-ellipsis-h"></i>
                    </button>
                </div>
            </div>
            
            <div class="portfolio-card__value">
                <div class="portfolio-card__total">${formattedTotal}</div>
                <div class="portfolio-card__change ${changeClass}">
                    <span class="change-amount">${formattedDailyChange}</span>
                    <span class="change-percent">(${changePercent.text})</span>
                    <i class="fas fa-${dailyChange >= 0 ? 'arrow-up' : 'arrow-down'} change-icon"></i>
                </div>
            </div>
            
            <div class="portfolio-card__stats">
                <div class="portfolio-stat">
                    <div class="portfolio-stat__label">Cash</div>
                    <div class="portfolio-stat__value">${formattedCash}</div>
                </div>
                <div class="portfolio-stat">
                    <div class="portfolio-stat__label">Positions</div>
                    <div class="portfolio-stat__value">${positionCount}</div>
                </div>
            </div>
            
            <div class="portfolio-card__allocation">
                <div class="allocation-label">
                    <span>Cash vs Invested</span>
                    <span>${Math.round(cashPercent)}% / ${Math.round(investedPercent)}%</span>
                </div>
                <div class="allocation-bar">
                    <div class="allocation-fill" style="width: ${investedPercent}%"></div>
                </div>
            </div>
        </div>
    `;
}

// Global helper functions for event handling
window.navigateToPortfolio = function(portfolioId) {
    window.location.hash = `#/portfolio/${portfolioId}`;
};

window.showPortfolioMenu = function(event, portfolioId) {
    // This would be implemented to show a dropdown menu
    // For now, we'll just prevent the card click and show a simple alert
    console.log('Portfolio menu clicked for:', portfolioId);
    
    // Example menu actions could include:
    // - Edit portfolio name
    // - View detailed performance
    // - Export data
    // - Delete portfolio (with confirmation)
};

// Add portfolio card specific styles
if (!document.getElementById('portfolio-card-styles')) {
    const portfolioCardStyles = `
        .portfolio-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-6);
            cursor: pointer;
            transition: all var(--transition-medium);
            position: relative;
            overflow: hidden;
        }

        .portfolio-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--accent), var(--success));
            transform: scaleX(0);
            transform-origin: left;
            transition: transform var(--transition-medium);
        }

        .portfolio-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-xl);
            border-color: var(--accent);
        }

        .portfolio-card:hover::before {
            transform: scaleX(1);
        }

        .portfolio-card__header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: var(--space-4);
            gap: var(--space-3);
        }

        .portfolio-card__name {
            font-size: 1.125rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0;
            flex: 1;
            word-break: break-word;
        }

        .portfolio-card__menu {
            position: relative;
        }

        .portfolio-menu-button {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: var(--space-1);
            border-radius: var(--radius-sm);
            transition: all var(--transition-fast);
            opacity: 0;
        }

        .portfolio-card:hover .portfolio-menu-button {
            opacity: 1;
        }

        .portfolio-menu-button:hover {
            background: var(--bg-secondary);
            color: var(--text-primary);
        }

        .portfolio-card__value {
            margin-bottom: var(--space-4);
        }

        .portfolio-card__total {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: var(--space-1);
            line-height: 1.2;
        }

        .portfolio-card__change {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            font-size: 0.875rem;
            font-weight: 500;
        }

        .portfolio-card__change.positive {
            color: var(--success);
        }

        .portfolio-card__change.negative {
            color: var(--danger);
        }

        .portfolio-card__change.neutral {
            color: var(--text-secondary);
        }

        .change-icon {
            font-size: 0.75rem;
        }

        .portfolio-card__stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-4);
            margin-bottom: var(--space-4);
        }

        .portfolio-stat {
            text-align: center;
        }

        .portfolio-stat__label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-1);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 500;
        }

        .portfolio-stat__value {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-primary);
        }

        .portfolio-card__allocation {
            margin-top: var(--space-4);
        }

        .allocation-label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: var(--space-2);
            font-size: 0.75rem;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .allocation-bar {
            height: 6px;
            background: var(--bg-secondary);
            border-radius: var(--radius-full);
            overflow: hidden;
            position: relative;
        }

        .allocation-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--accent), var(--success));
            border-radius: var(--radius-full);
            transition: width var(--transition-medium);
            min-width: 2px;
        }

        /* Loading state */
        .portfolio-card.loading {
            pointer-events: none;
        }

        .portfolio-card.loading .portfolio-card__total,
        .portfolio-card.loading .portfolio-card__change,
        .portfolio-card.loading .portfolio-stat__value {
            background: var(--skeleton-base);
            color: transparent;
            border-radius: var(--radius-sm);
            animation: loading 1.5s infinite;
        }

        .portfolio-card.loading .allocation-fill {
            background: var(--skeleton-base);
            animation: loading 1.5s infinite;
        }

        /* Empty state for zero values */
        .portfolio-card__total[data-value="0"] {
            opacity: 0.7;
        }

        /* Responsive adjustments */
        @media (max-width: 767px) {
            .portfolio-card {
                padding: var(--space-4);
            }
            
            .portfolio-card__total {
                font-size: 1.5rem;
            }
            
            .portfolio-card__stats {
                grid-template-columns: 1fr 1fr;
                gap: var(--space-3);
            }
        }

        @media (max-width: 480px) {
            .portfolio-card__header {
                flex-direction: column;
                align-items: flex-start;
                gap: var(--space-2);
            }
            
            .portfolio-card__name {
                font-size: 1rem;
            }
            
            .portfolio-card__total {
                font-size: 1.25rem;
            }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'portfolio-card-styles';
    styleEl.textContent = portfolioCardStyles;
    document.head.appendChild(styleEl);
}