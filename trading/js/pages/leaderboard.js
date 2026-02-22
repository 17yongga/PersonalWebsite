// Leaderboard Page (Coming Soon)

function leaderboardPage() {
    async function render(container, params) {
        container.innerHTML = `
            <div class="coming-soon-page">
                <div class="coming-soon-header">
                    <h1>Leaderboard</h1>
                    <p class="coming-soon-subtitle">See how you stack up against other traders</p>
                </div>

                <div class="coming-soon-content">
                    <div class="coming-soon-icon">
                        <i class="fas fa-crown"></i>
                    </div>
                    
                    <div class="coming-soon-main">
                        <h2>Coming Soon</h2>
                        <p class="coming-soon-description">
                            The leaderboard will showcase the best traders on our platform across different metrics:
                        </p>
                        
                        <div class="coming-soon-features">
                            <div class="feature-item">
                                <i class="fas fa-percentage"></i>
                                <div>
                                    <strong>Total Returns</strong>
                                    <p>See who's achieved the highest overall portfolio returns</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-shield-alt"></i>
                                <div>
                                    <strong>Risk-Adjusted Returns</strong>
                                    <p>Rankings based on Sharpe ratio and other risk metrics</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-chart-line"></i>
                                <div>
                                    <strong>Consistency Score</strong>
                                    <p>Reward steady, reliable performance over time</p>
                                </div>
                            </div>
                            <div class="feature-item">
                                <i class="fas fa-fire"></i>
                                <div>
                                    <strong>Streaks</strong>
                                    <p>Track winning streaks and hot trading periods</p>
                                </div>
                            </div>
                        </div>

                        <div class="coming-soon-preview">
                            <h3>Leaderboard Categories</h3>
                            <div class="leaderboard-preview">
                                <div class="preview-row">
                                    <div class="rank-badge">🥇</div>
                                    <div class="preview-info">
                                        <span class="preview-name">Daily Leaders</span>
                                        <span class="preview-desc">Best performance today</span>
                                    </div>
                                </div>
                                <div class="preview-row">
                                    <div class="rank-badge">📅</div>
                                    <div class="preview-info">
                                        <span class="preview-name">Weekly Rankings</span>
                                        <span class="preview-desc">Top traders this week</span>
                                    </div>
                                </div>
                                <div class="preview-row">
                                    <div class="rank-badge">📊</div>
                                    <div class="preview-info">
                                        <span class="preview-name">All-Time Hall of Fame</span>
                                        <span class="preview-desc">Legend status traders</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="coming-soon-cta">
                            <p class="cta-text">Build your trading record now to claim your spot on the leaderboard!</p>
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

export default leaderboardPage;
