// Professional Order Form Component - Production Ready

import { api } from '../api.js';
import { toast } from './toast.js';
import { 
    formatCurrency, 
    formatNumber, 
    escapeHtml, 
    parseNumber, 
    debounce 
} from '../utils.js';

export function createOrderForm(container, { 
    portfolios = [], 
    onOrderPlaced, 
    currentSymbol, 
    currentPrice 
}) {
    let isDestroyed = false;
    let state = {
        portfolios: portfolios,
        selectedPortfolio: portfolios[0] || null,
        currentSymbol: currentSymbol || null,
        currentPrice: currentPrice || null,
        orderType: 'market',
        orderSide: 'buy',
        quantity: 1,
        limitPrice: currentPrice || null,
        stopPrice: currentPrice ? currentPrice * 0.95 : null,
        duration: 'day',
        isSubmitting: false,
        maxQuantity: null
    };

    // Debounced calculation update
    const updateCalculations = debounce(() => {
        if (!isDestroyed) {
            updateEstimatedTotal();
            updateValidation();
        }
    }, 100);

    function render() {
        container.innerHTML = `
            <div class="order-form">
                ${renderPortfolioSection()}
                ${renderSymbolSection()}
                ${renderOrderTypeSection()}
                ${renderSideSection()}
                ${renderQuantitySection()}
                ${renderPriceInputs()}
                ${renderDurationSection()}
                ${renderEstimatedSection()}
                ${renderSubmitSection()}
                <div class="order-errors" id="order-errors" style="display: none;"></div>
            </div>
        `;
        
        bindEvents();
        updateCalculations();
    }

    function renderPortfolioSection() {
        return `
            <div class="form-group">
                <label class="form-label">
                    <i class="fas fa-wallet"></i>
                    Portfolio
                </label>
                <select class="form-select" id="portfolio-select" ${state.portfolios.length === 0 ? 'disabled' : ''}>
                    ${state.portfolios.length === 0 
                        ? '<option>No portfolios available</option>'
                        : state.portfolios.map(portfolio => `
                            <option value="${portfolio.id}" ${portfolio.id === state.selectedPortfolio?.id ? 'selected' : ''}>
                                ${escapeHtml(portfolio.name)}
                            </option>
                        `).join('')
                    }
                </select>
                <div class="portfolio-balance" id="portfolio-balance">
                    ${renderPortfolioBalance()}
                </div>
            </div>
        `;
    }

    function renderPortfolioBalance() {
        if (!state.selectedPortfolio) {
            return '<span class="balance-placeholder">Select a portfolio</span>';
        }

        const balance = state.selectedPortfolio.cash_balance || 0;
        const availableShares = state.currentPrice > 0 ? Math.floor(balance / state.currentPrice) : 0;

        return `
            <div class="balance-info">
                <div class="balance-item">
                    <span class="balance-label">Cash Available:</span>
                    <span class="balance-amount">${formatCurrency(balance)}</span>
                </div>
                ${state.currentPrice && state.orderSide === 'buy' ? `
                    <div class="balance-item">
                        <span class="balance-label">Max Shares:</span>
                        <span class="balance-amount">${formatNumber(availableShares, 0)}</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderSymbolSection() {
        if (!state.currentSymbol) {
            return `
                <div class="form-group">
                    <div class="no-symbol-warning">
                        <i class="fas fa-info-circle"></i>
                        <span>Select a symbol from the search above to place an order</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="form-group">
                <label class="form-label">
                    <i class="fas fa-chart-line"></i>
                    Symbol
                </label>
                <div class="symbol-display">
                    <div class="symbol-main">
                        <span class="symbol-ticker">${escapeHtml(state.currentSymbol)}</span>
                        ${state.currentPrice ? `<span class="symbol-price">$${formatNumber(state.currentPrice, 2)}</span>` : ''}
                    </div>
                    <div class="symbol-actions">
                        <button type="button" class="btn btn-sm btn-outline" id="refresh-price-btn">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderOrderTypeSection() {
        return `
            <div class="form-group">
                <label class="form-label">
                    <i class="fas fa-list-alt"></i>
                    Order Type
                </label>
                <div class="order-type-tabs">
                    <button type="button" class="order-type-tab ${state.orderType === 'market' ? 'active' : ''}" data-type="market">
                        <i class="fas fa-bolt"></i>
                        <span>Market</span>
                    </button>
                    <button type="button" class="order-type-tab ${state.orderType === 'limit' ? 'active' : ''}" data-type="limit">
                        <i class="fas fa-crosshairs"></i>
                        <span>Limit</span>
                    </button>
                    <button type="button" class="order-type-tab ${state.orderType === 'stop' ? 'active' : ''}" data-type="stop">
                        <i class="fas fa-hand-paper"></i>
                        <span>Stop</span>
                    </button>
                </div>
                <div class="order-type-help">
                    ${getOrderTypeDescription(state.orderType)}
                </div>
            </div>
        `;
    }

    function getOrderTypeDescription(type) {
        const descriptions = {
            market: 'Execute immediately at the best available price',
            limit: 'Execute only at your specified price or better',
            stop: 'Trigger a market order when price reaches your stop level'
        };
        return `<small class="text-secondary">${descriptions[type] || ''}</small>`;
    }

    function renderSideSection() {
        return `
            <div class="form-group">
                <label class="form-label">
                    <i class="fas fa-exchange-alt"></i>
                    Order Side
                </label>
                <div class="side-toggle">
                    <button type="button" class="side-btn buy-btn ${state.orderSide === 'buy' ? 'active' : ''}" data-side="buy">
                        <i class="fas fa-arrow-up"></i>
                        <span>BUY</span>
                    </button>
                    <button type="button" class="side-btn sell-btn ${state.orderSide === 'sell' ? 'active' : ''}" data-side="sell">
                        <i class="fas fa-arrow-down"></i>
                        <span>SELL</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderQuantitySection() {
        const maxShares = getMaxAvailableShares();
        
        return `
            <div class="form-group">
                <label class="form-label">
                    <i class="fas fa-calculator"></i>
                    Quantity
                    ${maxShares > 0 ? `<span class="max-available">(max: ${formatNumber(maxShares, 0)})</span>` : ''}
                </label>
                <div class="quantity-input-wrapper">
                    <div class="quantity-input">
                        <button type="button" class="quantity-btn quantity-decrease" id="quantity-decrease" ${state.quantity <= 1 ? 'disabled' : ''}>
                            <i class="fas fa-minus"></i>
                        </button>
                        <input type="number" class="form-input quantity-field" id="quantity-input" 
                               value="${state.quantity}" min="1" step="1" max="${maxShares || 999999}">
                        <button type="button" class="quantity-btn quantity-increase" id="quantity-increase">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    ${maxShares > 0 ? `
                        <button type="button" class="btn btn-sm btn-outline max-btn" id="max-quantity-btn">
                            MAX
                        </button>
                    ` : ''}
                </div>
                <div class="quantity-shortcuts">
                    <button type="button" class="quantity-shortcut" data-amount="10">10</button>
                    <button type="button" class="quantity-shortcut" data-amount="50">50</button>
                    <button type="button" class="quantity-shortcut" data-amount="100">100</button>
                    <button type="button" class="quantity-shortcut" data-amount="500">500</button>
                </div>
            </div>
        `;
    }

    function renderPriceInputs() {
        let html = '';

        if (state.orderType === 'limit') {
            html += `
                <div class="form-group">
                    <label class="form-label">
                        <i class="fas fa-crosshairs"></i>
                        Limit Price
                    </label>
                    <div class="price-input-wrapper">
                        <div class="price-input">
                            <span class="price-prefix">$</span>
                            <input type="number" class="form-input price-field" id="limit-price-input" 
                                   value="${state.limitPrice || ''}" min="0.01" step="0.01" placeholder="0.00">
                        </div>
                        ${state.currentPrice ? `
                            <div class="price-helpers">
                                <button type="button" class="price-helper" data-offset="-0.05">-5¢</button>
                                <button type="button" class="price-helper" data-offset="-0.01">-1¢</button>
                                <button type="button" class="price-helper" data-current="true">Current</button>
                                <button type="button" class="price-helper" data-offset="0.01">+1¢</button>
                                <button type="button" class="price-helper" data-offset="0.05">+5¢</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if (state.orderType === 'stop') {
            html += `
                <div class="form-group">
                    <label class="form-label">
                        <i class="fas fa-hand-paper"></i>
                        Stop Price
                    </label>
                    <div class="price-input-wrapper">
                        <div class="price-input">
                            <span class="price-prefix">$</span>
                            <input type="number" class="form-input price-field" id="stop-price-input" 
                                   value="${state.stopPrice || ''}" min="0.01" step="0.01" placeholder="0.00">
                        </div>
                        ${state.currentPrice ? `
                            <div class="price-helpers">
                                <button type="button" class="stop-helper" data-percent="-10">-10%</button>
                                <button type="button" class="stop-helper" data-percent="-5">-5%</button>
                                <button type="button" class="stop-helper" data-current="true">Current</button>
                                <button type="button" class="stop-helper" data-percent="5">+5%</button>
                                <button type="button" class="stop-helper" data-percent="10">+10%</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        return html;
    }

    function renderDurationSection() {
        return `
            <div class="form-group">
                <label class="form-label">
                    <i class="fas fa-clock"></i>
                    Duration
                </label>
                <div class="duration-options">
                    <label class="radio-option ${state.duration === 'day' ? 'checked' : ''}">
                        <input type="radio" name="duration" value="day" ${state.duration === 'day' ? 'checked' : ''}>
                        <span class="radio-custom"></span>
                        <span class="radio-label">Day</span>
                        <small class="radio-help">Valid until market close</small>
                    </label>
                    <label class="radio-option ${state.duration === 'gtc' ? 'checked' : ''}">
                        <input type="radio" name="duration" value="gtc" ${state.duration === 'gtc' ? 'checked' : ''}>
                        <span class="radio-custom"></span>
                        <span class="radio-label">Good Till Cancelled</span>
                        <small class="radio-help">Valid until you cancel</small>
                    </label>
                </div>
            </div>
        `;
    }

    function renderEstimatedSection() {
        return `
            <div class="form-group">
                <div class="estimated-section">
                    <div class="estimated-total" id="estimated-total">
                        ${renderEstimatedTotal()}
                    </div>
                    <div class="estimated-breakdown" id="estimated-breakdown">
                        ${renderEstimatedBreakdown()}
                    </div>
                </div>
            </div>
        `;
    }

    function renderEstimatedTotal() {
        const total = calculateEstimatedTotal();
        const label = state.orderSide === 'buy' ? 'Estimated Cost' : 'Estimated Credit';
        
        if (total === 0) {
            return `
                <div class="estimated-total-content">
                    <div class="total-label">${label}</div>
                    <div class="total-placeholder">Enter quantity and price</div>
                </div>
            `;
        }

        return `
            <div class="estimated-total-content">
                <div class="total-label">${label}</div>
                <div class="total-amount">${formatCurrency(total)}</div>
            </div>
        `;
    }

    function renderEstimatedBreakdown() {
        const price = getExecutionPrice();
        const total = calculateEstimatedTotal();
        
        if (total === 0 || !price) return '';

        // For now, we're not charging fees, but this is where they'd be shown
        return `
            <div class="breakdown-items">
                <div class="breakdown-item">
                    <span class="breakdown-label">${formatNumber(state.quantity)} shares × $${formatNumber(price, 2)}</span>
                    <span class="breakdown-value">${formatCurrency(total)}</span>
                </div>
            </div>
        `;
    }

    function renderSubmitSection() {
        const isDisabled = !canPlaceOrder();
        const buttonClass = state.orderSide === 'buy' ? 'btn-success' : 'btn-danger';
        const buttonText = `${state.isSubmitting ? 'Placing' : 'Place'} ${state.orderSide.toUpperCase()} Order`;
        
        return `
            <div class="form-group">
                <button type="button" class="btn btn-block place-order-btn ${buttonClass}" 
                        id="place-order-btn" ${isDisabled ? 'disabled' : ''}>
                    ${state.isSubmitting ? `
                        <span class="spinner spinner-sm"></span>
                        ${buttonText}...
                    ` : `
                        <i class="fas ${state.orderSide === 'buy' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                        ${buttonText}
                    `}
                </button>
            </div>
        `;
    }

    function bindEvents() {
        if (isDestroyed) return;

        // Portfolio selection
        const portfolioSelect = container.querySelector('#portfolio-select');
        if (portfolioSelect) {
            portfolioSelect.addEventListener('change', (e) => {
                const portfolioId = e.target.value;
                state.selectedPortfolio = state.portfolios.find(p => p.id === portfolioId);
                updatePortfolioBalance();
                updateCalculations();
            });
        }

        // Order type tabs
        container.querySelectorAll('.order-type-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const type = tab.dataset.type;
                if (type !== state.orderType) {
                    state.orderType = type;
                    updateOrderTypeUI();
                    updateCalculations();
                }
            });
        });

        // Side buttons
        container.querySelectorAll('.side-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const side = btn.dataset.side;
                if (side !== state.orderSide) {
                    state.orderSide = side;
                    updateSideUI();
                    updateCalculations();
                }
            });
        });

        // Quantity controls
        const quantityInput = container.querySelector('#quantity-input');
        const quantityDecrease = container.querySelector('#quantity-decrease');
        const quantityIncrease = container.querySelector('#quantity-increase');
        const maxQuantityBtn = container.querySelector('#max-quantity-btn');

        if (quantityInput) {
            quantityInput.addEventListener('input', (e) => {
                const value = Math.max(1, parseInt(e.target.value) || 1);
                state.quantity = value;
                e.target.value = value;
                updateQuantityButtons();
                updateCalculations();
            });
        }

        if (quantityDecrease) {
            quantityDecrease.addEventListener('click', () => {
                if (state.quantity > 1) {
                    state.quantity--;
                    quantityInput.value = state.quantity;
                    updateQuantityButtons();
                    updateCalculations();
                }
            });
        }

        if (quantityIncrease) {
            quantityIncrease.addEventListener('click', () => {
                const maxShares = getMaxAvailableShares();
                if (maxShares === 0 || state.quantity < maxShares) {
                    state.quantity++;
                    quantityInput.value = state.quantity;
                    updateQuantityButtons();
                    updateCalculations();
                }
            });
        }

        if (maxQuantityBtn) {
            maxQuantityBtn.addEventListener('click', () => {
                const maxShares = getMaxAvailableShares();
                if (maxShares > 0) {
                    state.quantity = maxShares;
                    quantityInput.value = state.quantity;
                    updateQuantityButtons();
                    updateCalculations();
                }
            });
        }

        // Quantity shortcuts
        container.querySelectorAll('.quantity-shortcut').forEach(btn => {
            btn.addEventListener('click', () => {
                const amount = parseInt(btn.dataset.amount);
                const maxShares = getMaxAvailableShares();
                
                if (maxShares === 0 || amount <= maxShares) {
                    state.quantity = amount;
                    quantityInput.value = state.quantity;
                    updateQuantityButtons();
                    updateCalculations();
                }
            });
        });

        // Duration options
        container.querySelectorAll('input[name="duration"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                state.duration = e.target.value;
                updateDurationUI();
            });
        });

        // Price inputs
        bindPriceInputs();

        // Price helpers
        container.querySelectorAll('.price-helper').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.current) {
                    state.limitPrice = state.currentPrice;
                } else if (btn.dataset.offset) {
                    const offset = parseFloat(btn.dataset.offset);
                    state.limitPrice = Math.max(0.01, (state.currentPrice || 0) + offset);
                }
                
                const limitInput = container.querySelector('#limit-price-input');
                if (limitInput) {
                    limitInput.value = state.limitPrice.toFixed(2);
                }
                updateCalculations();
            });
        });

        // Stop helpers
        container.querySelectorAll('.stop-helper').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.current) {
                    state.stopPrice = state.currentPrice;
                } else if (btn.dataset.percent) {
                    const percent = parseFloat(btn.dataset.percent);
                    state.stopPrice = Math.max(0.01, (state.currentPrice || 0) * (1 + percent / 100));
                }
                
                const stopInput = container.querySelector('#stop-price-input');
                if (stopInput) {
                    stopInput.value = state.stopPrice.toFixed(2);
                }
                updateCalculations();
            });
        });

        // Refresh price button
        const refreshPriceBtn = container.querySelector('#refresh-price-btn');
        if (refreshPriceBtn) {
            refreshPriceBtn.addEventListener('click', async () => {
                if (state.currentSymbol) {
                    refreshPriceBtn.disabled = true;
                    refreshPriceBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    
                    try {
                        const response = await api.get(`/market/quote/${state.currentSymbol}`);
                        const quote = response.quote || response;
                        state.currentPrice = quote.price;
                        updateSymbolDisplay();
                        updateCalculations();
                        
                        toast.success(`Price updated: $${formatNumber(quote.price, 2)}`);
                    } catch (error) {
                        toast.error('Failed to refresh price');
                    } finally {
                        refreshPriceBtn.disabled = false;
                        refreshPriceBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
                    }
                }
            });
        }

        // Place order button
        const placeOrderBtn = container.querySelector('#place-order-btn');
        if (placeOrderBtn) {
            placeOrderBtn.addEventListener('click', handlePlaceOrder);
        }
    }

    function bindPriceInputs() {
        const limitPriceInput = container.querySelector('#limit-price-input');
        const stopPriceInput = container.querySelector('#stop-price-input');

        if (limitPriceInput) {
            limitPriceInput.addEventListener('input', (e) => {
                state.limitPrice = parseFloat(e.target.value) || null;
                updateCalculations();
            });
        }

        if (stopPriceInput) {
            stopPriceInput.addEventListener('input', (e) => {
                state.stopPrice = parseFloat(e.target.value) || null;
                updateCalculations();
            });
        }
    }

    function updateOrderTypeUI() {
        // Update tab states
        container.querySelectorAll('.order-type-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === state.orderType);
        });

        // Re-render price inputs and help text
        const priceInputsContainer = container.querySelector('.form-group:has(#limit-price-input), .form-group:has(#stop-price-input)');
        if (priceInputsContainer) {
            priceInputsContainer.remove();
        }

        const helpContainer = container.querySelector('.order-type-help');
        if (helpContainer) {
            helpContainer.innerHTML = getOrderTypeDescription(state.orderType);
        }

        // Insert new price inputs after duration section
        const durationSection = container.querySelector('.duration-options').closest('.form-group');
        const priceInputsHtml = renderPriceInputs();
        
        if (priceInputsHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = priceInputsHtml;
            
            while (tempDiv.firstChild) {
                durationSection.insertAdjacentElement('beforebegin', tempDiv.firstChild);
            }
            
            bindPriceInputs();
        }
    }

    function updateSideUI() {
        container.querySelectorAll('.side-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.side === state.orderSide);
        });

        updateSubmitButton();
        updateEstimatedTotal();
    }

    function updatePortfolioBalance() {
        const balanceElement = container.querySelector('#portfolio-balance');
        if (balanceElement) {
            balanceElement.innerHTML = renderPortfolioBalance();
        }
    }

    function updateQuantityButtons() {
        const decreaseBtn = container.querySelector('#quantity-decrease');
        const increaseBtn = container.querySelector('#quantity-increase');
        const maxShares = getMaxAvailableShares();

        if (decreaseBtn) {
            decreaseBtn.disabled = state.quantity <= 1;
        }

        if (increaseBtn) {
            increaseBtn.disabled = maxShares > 0 && state.quantity >= maxShares;
        }
    }

    function updateDurationUI() {
        container.querySelectorAll('.radio-option').forEach(option => {
            const radio = option.querySelector('input[type="radio"]');
            option.classList.toggle('checked', radio.checked);
        });
    }

    function updateSymbolDisplay() {
        const symbolDisplay = container.querySelector('.symbol-display');
        if (symbolDisplay && state.currentSymbol) {
            symbolDisplay.innerHTML = `
                <div class="symbol-main">
                    <span class="symbol-ticker">${escapeHtml(state.currentSymbol)}</span>
                    ${state.currentPrice ? `<span class="symbol-price">$${formatNumber(state.currentPrice, 2)}</span>` : ''}
                </div>
                <div class="symbol-actions">
                    <button type="button" class="btn btn-sm btn-outline" id="refresh-price-btn">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            `;
        }
    }

    function updateEstimatedTotal() {
        const totalElement = container.querySelector('#estimated-total');
        if (totalElement) {
            totalElement.innerHTML = renderEstimatedTotal();
        }

        const breakdownElement = container.querySelector('#estimated-breakdown');
        if (breakdownElement) {
            breakdownElement.innerHTML = renderEstimatedBreakdown();
        }
    }

    function updateValidation() {
        const errors = validateOrder();
        displayErrors(errors);
        updateSubmitButton();
    }

    function updateSubmitButton() {
        const btn = container.querySelector('#place-order-btn');
        if (!btn) return;

        const isDisabled = !canPlaceOrder();
        const buttonClass = state.orderSide === 'buy' ? 'btn-success' : 'btn-danger';
        const buttonText = `${state.isSubmitting ? 'Placing' : 'Place'} ${state.orderSide.toUpperCase()} Order`;
        
        btn.disabled = isDisabled;
        btn.className = `btn btn-block place-order-btn ${buttonClass}`;
        
        if (state.isSubmitting) {
            btn.innerHTML = `
                <span class="spinner spinner-sm"></span>
                ${buttonText}...
            `;
        } else {
            btn.innerHTML = `
                <i class="fas ${state.orderSide === 'buy' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                ${buttonText}
            `;
        }
    }

    function calculateEstimatedTotal() {
        if (!state.quantity || state.quantity <= 0) return 0;
        
        const price = getExecutionPrice();
        return price ? price * state.quantity : 0;
    }

    function getExecutionPrice() {
        switch (state.orderType) {
            case 'market':
                return state.currentPrice || 0;
            case 'limit':
                return parseNumber(state.limitPrice) || 0;
            case 'stop':
                return parseNumber(state.stopPrice) || 0;
            default:
                return 0;
        }
    }

    function getMaxAvailableShares() {
        if (state.orderSide === 'sell') {
            return state.maxQuantity || 0;
        }
        
        if (!state.selectedPortfolio || !state.currentPrice) return 0;
        
        const balance = state.selectedPortfolio.cash_balance || 0;
        const price = getExecutionPrice();
        
        return price > 0 ? Math.floor(balance / price) : 0;
    }

    function canPlaceOrder() {
        return !state.isSubmitting && validateOrder().length === 0;
    }

    function validateOrder() {
        const errors = [];

        if (!state.currentSymbol) {
            errors.push('Please select a symbol');
        }

        if (!state.selectedPortfolio) {
            errors.push('Please select a portfolio');
        }

        if (state.quantity < 1) {
            errors.push('Quantity must be at least 1');
        }

        // Price validations
        if (state.orderType === 'limit' && (!state.limitPrice || state.limitPrice <= 0)) {
            errors.push('Please enter a valid limit price');
        }

        if (state.orderType === 'stop' && (!state.stopPrice || state.stopPrice <= 0)) {
            errors.push('Please enter a valid stop price');
        }

        // Balance validation for buy orders
        if (state.orderSide === 'buy' && state.selectedPortfolio) {
            const estimatedCost = calculateEstimatedTotal();
            const availableBalance = state.selectedPortfolio.cash_balance || 0;
            
            if (estimatedCost > availableBalance) {
                errors.push('Insufficient funds for this order');
            }
        }

        // Share validation for sell orders
        if (state.orderSide === 'sell' && state.maxQuantity !== null) {
            if (state.quantity > state.maxQuantity) {
                errors.push(`Cannot sell more than ${formatNumber(state.maxQuantity, 0)} shares`);
            }
        }

        return errors;
    }

    function displayErrors(errors) {
        const errorsContainer = container.querySelector('#order-errors');
        if (!errorsContainer) return;

        if (errors.length === 0) {
            errorsContainer.style.display = 'none';
            return;
        }

        errorsContainer.innerHTML = `
            <div class="error-list">
                ${errors.map(error => `
                    <div class="error-item">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>${escapeHtml(error)}</span>
                    </div>
                `).join('')}
            </div>
        `;
        errorsContainer.style.display = 'block';
    }

    async function handlePlaceOrder() {
        if (!canPlaceOrder()) return;

        const errors = validateOrder();
        if (errors.length > 0) {
            displayErrors(errors);
            return;
        }

        displayErrors([]);
        state.isSubmitting = true;
        updateSubmitButton();

        try {
            const orderData = {
                portfolio_id: state.selectedPortfolio.id,
                symbol: state.currentSymbol,
                side: state.orderSide,
                type: state.orderType,
                quantity: state.quantity,
                duration: state.duration
            };

            if (state.orderType === 'limit') {
                orderData.limit_price = state.limitPrice;
            }

            if (state.orderType === 'stop') {
                orderData.stop_price = state.stopPrice;
            }

            const response = await api.post('/trading/orders', orderData);
            
            if (onOrderPlaced) {
                onOrderPlaced(response.order || response);
            }

            // Reset form to defaults but keep symbol and portfolio
            resetFormPartial();

        } catch (error) {
            console.error('Error placing order:', error);
            
            if (error.details && error.details.errors) {
                const apiErrors = Object.values(error.details.errors).flat();
                displayErrors(apiErrors);
            } else {
                displayErrors([error.message || 'Failed to place order. Please try again.']);
            }
        } finally {
            state.isSubmitting = false;
            updateSubmitButton();
        }
    }

    function resetFormPartial() {
        // Reset form state but keep symbol, portfolio, and side
        state.orderType = 'market';
        state.quantity = 1;
        state.duration = 'day';
        state.limitPrice = state.currentPrice;
        state.stopPrice = state.currentPrice ? state.currentPrice * 0.95 : null;
        
        // Re-render the form
        render();
    }

    // Public API
    function updateSymbol(symbol, price) {
        state.currentSymbol = symbol;
        state.currentPrice = price;
        
        if (price) {
            state.limitPrice = price;
            state.stopPrice = price * 0.95;
        }

        render();
    }

    function updatePortfolios(newPortfolios) {
        state.portfolios = newPortfolios;
        state.selectedPortfolio = newPortfolios[0] || null;
        render();
    }

    function setSide(side) {
        if (side === 'buy' || side === 'sell') {
            state.orderSide = side;
            updateSideUI();
        }
    }

    function setMaxQuantity(maxQty) {
        state.maxQuantity = maxQty;
        updatePortfolioBalance();
    }

    function destroy() {
        isDestroyed = true;
    }

    // Initial render
    render();

    return {
        updateSymbol,
        updatePortfolios,
        setSide,
        setMaxQuantity,
        destroy
    };
}