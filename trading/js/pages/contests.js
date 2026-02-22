// Contests Page (Coming Soon)

function contestsPage() {
    async function render(container, params) {
        container.innerHTML = `
            <div class="coming-soon-page">
                <div class="coming-soon-header">
                    <h1>Trading Contests</h1>
                    <p class="coming-soon-subtitle">Compete with other traders and win prizes</p>
                </div>

                <div class="coming-soon-content">
                    <div class="coming-soon-icon">
                        <i class="fas fa-trophy"></i>
                    </div>
                    
                    <div class="coming-soon-main">
                        <h2>Coming Soon</h2>
                        <p class="coming-soon-description">
                            Get ready for exciting trading competitions where you can showcase your skills and win awesome prizes:
                        </p>
                        
                        <div class="coming-soon-features">
                            <div class="feature-item">
                                <i class="fas fa-calendar-alt"></i>
                                <div>
                                    <strong>Weekly Challenges</strong>
                                    <p>Short-term contests with quick turnarounds and instant gratification</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-medal"></i>
                                <div>
                                    <strong>Monthly Championships</strong>
                                    <p>Longer contests to test your consistency and strategy over time</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-users"></i>
                                <div>
                                    <strong>Team Competitions</strong>
                                    <p>Join forces with friends and compete as a trading team</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-gift"></i>
                                <div>
                                    <strong>Real Prizes</strong>
                                    <p>Win cash prizes, trading tools, and exclusive platform features</p>
                                </div>
                            </div>
                        </div>

                        <div class="coming-soon-preview">
                            <h3>Contest Categories</h3>
                            <div class="contest-categories">
                                <div class="category-badge">📈 Best Returns</div>
                                <div class="category-badge">📊 Risk Management</div>
                                <div class="category-badge">⚡ Day Trading</div>
                                <div class="category-badge">📅 Long Term</div>
                                <div class="category-badge">🎯 Sector Focus</div>
                            </div>
                        </div>

                        <div class="coming-soon-cta">
                            <p class="cta-text">Start practicing now to be ready for our first contest!</p>
                            <div class="cta-buttons">
                                <button class="btn btn-primary" onclick="window.location.hash='#/'">
                                    <i class="fas fa-arrow-left"></i>
                                    Back to Dashboard
                                </button>
                                <button class="btn btn-secondary" onclick="window.location.hash='#/trade'">
                                    <i class="fas fa-chart-line"></i>
                                    Practice Trading
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

export default contestsPage;
