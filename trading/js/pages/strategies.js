// Strategies Page (Coming Soon)

function strategiesPage() {
    async function render(container, params) {
        container.innerHTML = `
            <div class="coming-soon-page">
                <div class="coming-soon-header">
                    <h1>Trading Strategies</h1>
                    <p class="coming-soon-subtitle">Build and backtest your trading strategies</p>
                </div>

                <div class="coming-soon-content">
                    <div class="coming-soon-icon">
                        <i class="fas fa-brain"></i>
                    </div>
                    
                    <div class="coming-soon-main">
                        <h2>Coming Soon</h2>
                        <p class="coming-soon-description">
                            We're working hard to bring you powerful strategy building tools that will let you:
                        </p>
                        
                        <div class="coming-soon-features">
                            <div class="feature-item">
                                <i class="fas fa-chart-line"></i>
                                <div>
                                    <strong>Technical Analysis</strong>
                                    <p>Build strategies using moving averages, RSI, MACD, and more</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-history"></i>
                                <div>
                                    <strong>Backtesting</strong>
                                    <p>Test your strategies against historical market data</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-robot"></i>
                                <div>
                                    <strong>Automation</strong>
                                    <p>Set up automated trading based on your custom strategies</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-share-alt"></i>
                                <div>
                                    <strong>Strategy Sharing</strong>
                                    <p>Share and discover strategies with the community</p>
                                </div>
                            </div>
                        </div>

                        <div class="coming-soon-cta">
                            <p class="cta-text">Want to be notified when strategies launch?</p>
                            <div class="cta-buttons">
                                <button class="btn btn-primary" onclick="window.location.hash='#/'">
                                    <i class="fas fa-arrow-left"></i>
                                    Back to Dashboard
                                </button>
                                <button class="btn btn-secondary" onclick="window.location.hash='#/trade'">
                                    <i class="fas fa-chart-line"></i>
                                    Start Trading
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function destroy() {}

    return { render, destroy };
}

export default strategiesPage;
