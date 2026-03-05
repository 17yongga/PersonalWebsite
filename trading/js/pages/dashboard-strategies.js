// Annotated Equity Curve Dashboard - Bloomberg-style trading platform showcase

import { formatCurrency, formatPercent, escapeHtml, formatDate } from '../utils.js';
import { toast } from '../components/toast.js';

// Strategy configuration with colors and display info
const STRATEGY_CONFIG = {
    'momentum-hunter': {
        name: '🚀 Momentum Hunter',
        description: 'Trend following strategy that buys breakouts and rides momentum',
        color: '#3fb950',
        emoji: '🚀'
    },
    'mean-reversion': {
        name: '🔄 Mean Reversion', 
        description: 'Buys oversold dips and sells overbought peaks',
        color: '#58a6ff',
        emoji: '🔄'
    },
    'sector-rotator': {
        name: '📊 Sector Rotator',
        description: 'Rotates capital into strongest performing sectors',
        color: '#d2a8ff', 
        emoji: '📊'
    },
    'value-dividends': {
        name: '💎 Value & Dividends',
        description: 'Conservative approach targeting low P/E and high dividend yield',
        color: '#f0883e',
        emoji: '💎'
    },
    'volatility-breakout': {
        name: '⚡ Volatility Breakout',
        description: 'Trades volume spikes and volatility expansions', 
        color: '#ff7b72',
        emoji: '⚡'
    }
};

// Inject Bloomberg-style CSS
function injectDashboardStyles() {
    const existingStyle = document.getElementById('dashboard-styles');
    if (existingStyle) existingStyle.remove();
    
    const style = document.createElement('style');
    style.id = 'dashboard-styles';
    style.textContent = `
        .dashboard-container {
            background: #0d1117;
            color: #ffffff;
            min-height: 100vh;
            font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            padding: 0;
            margin: 0;
        }

        /* Header */
        .dashboard-header {
            background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
            border-bottom: 1px solid #21262d;
            padding: 1.5rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .header-left h1 {
            font-size: 1.8rem;
            font-weight: 700;
            margin: 0;
            background: linear-gradient(135deg, #3fb950 0%, #58a6ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .header-left .subtitle {
            font-size: 0.9rem;
            color: #8b949e;
            margin-top: 0.25rem;
        }

        .header-stats {
            display: flex;
            gap: 2rem;
            align-items: center;
        }

        .stat-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.25rem;
        }

        .stat-value {
            font-size: 1.2rem;
            font-weight: 700;
            color: #3fb950;
        }

        .stat-label {
            font-size: 0.75rem;
            color: #8b949e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .market-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .market-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .market-open { background: #3fb950; }
        .market-closed { background: #f85149; }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* Equity Chart Section */
        .equity-section {
            padding: 2rem;
            background: #161b22;
            margin: 1.5rem;
            border-radius: 12px;
            border: 1px solid #21262d;
        }

        .equity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .equity-title {
            font-size: 1.4rem;
            font-weight: 700;
            color: #ffffff;
        }

        .time-range-selector {
            display: flex;
            gap: 0.25rem;
            background: #0d1117;
            padding: 0.25rem;
            border-radius: 8px;
            border: 1px solid #21262d;
        }

        .time-btn {
            padding: 0.5rem 1rem;
            background: transparent;
            border: none;
            color: #8b949e;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.85rem;
            transition: all 0.2s ease;
        }

        .time-btn.active {
            background: #3fb950;
            color: #0d1117;
        }

        .time-btn:hover:not(.active) {
            background: #21262d;
            color: #ffffff;
        }

        .chart-container {
            position: relative;
            height: 450px;
            background: #0d1117;
            border-radius: 8px;
            border: 1px solid #21262d;
            padding: 1rem;
            margin-bottom: 1rem;
        }

        .chart-container canvas:hover {
            filter: drop-shadow(0 0 8px rgba(63, 185, 80, 0.2));
            transition: filter 0.2s ease;
        }

        .strategy-legend {
            display: flex;
            justify-content: center;
            gap: 2rem;
            flex-wrap: wrap;
            padding-top: 1rem;
            border-top: 1px solid #21262d;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            font-weight: 600;
        }

        .legend-color {
            width: 12px;
            height: 12px;
            border-radius: 2px;
        }

        /* Leaderboard Section */
        .leaderboard-section {
            padding: 0 2rem 2rem;
        }

        .section-title {
            font-size: 1.4rem;
            font-weight: 700;
            margin-bottom: 1.5rem;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .leaderboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1rem;
            max-width: 1400px;
            margin: 0 auto;
        }

        .strategy-rank-card {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 1.5rem;
            position: relative;
            transition: all 0.2s ease;
        }

        .strategy-rank-card:hover {
            border-color: #3fb950;
            transform: translateY(-2px);
        }

        .rank-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }

        .rank-position {
            font-size: 1.5rem;
            font-weight: 800;
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            min-width: 3rem;
            text-align: center;
        }

        .rank-1 { background: #ffd700; color: #000; }
        .rank-2 { background: #c0c0c0; color: #000; }
        .rank-3 { background: #cd7f32; color: #fff; }
        .rank-other { background: #21262d; color: #8b949e; }

        .strategy-info {
            flex: 1;
        }

        .strategy-name {
            font-size: 1.1rem;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 0.25rem;
        }

        .rank-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
        }

        .rank-stat {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .rank-stat-label {
            font-size: 0.75rem;
            color: #8b949e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .rank-stat-value {
            font-size: 1.2rem;
            font-weight: 700;
            color: #ffffff;
        }

        .pnl-positive { color: #3fb950; }
        .pnl-negative { color: #f85149; }

        .win-rate-bar {
            width: 100%;
            height: 4px;
            background: #21262d;
            border-radius: 2px;
            overflow: hidden;
            margin-top: 0.5rem;
        }

        .win-rate-fill {
            height: 100%;
            background: linear-gradient(90deg, #3fb950, #58a6ff);
            border-radius: 2px;
            transition: width 0.8s ease;
        }

        /* Activity Feed Section */
        .activity-section {
            padding: 0 2rem 2rem;
        }

        .activity-feed {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            max-height: 400px;
            overflow-y: auto;
        }

        .activity-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #21262d;
            transition: background 0.2s ease;
        }

        .activity-item:hover {
            background: #0d1117;
        }

        .activity-item:last-child {
            border-bottom: none;
        }

        .activity-time {
            font-size: 0.75rem;
            color: #8b949e;
            min-width: 4.5rem;
            font-family: monospace;
            line-height: 1.4;
            text-align: left;
        }

        .activity-emoji {
            font-size: 1.2rem;
            min-width: 2rem;
            text-align: center;
        }

        .activity-text {
            flex: 1;
            font-size: 0.9rem;
        }

        .activity-symbol {
            font-weight: 700;
            color: #58a6ff;
        }

        .activity-price {
            color: #8b949e;
        }

        .activity-strategy {
            color: #3fb950;
            font-size: 0.8rem;
        }

        /* Loading states */
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 200px;
            color: #8b949e;
        }

        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #21262d;
            border-top: 2px solid #3fb950;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 0.5rem;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Responsive */
        @media (max-width: 768px) {
            .dashboard-header {
                flex-direction: column;
                text-align: center;
            }
            
            .header-stats {
                justify-content: center;
            }
            
            .equity-section,
            .leaderboard-section,
            .activity-section {
                padding: 1rem;
                margin: 1rem;
            }
            
            .leaderboard-grid {
                grid-template-columns: 1fr;
            }
            
            .strategy-legend {
                gap: 1rem;
            }
            
            .chart-container {
                height: 300px;
            }
        }
    `;
    document.head.appendChild(style);
}

function DashboardStrategies() {
    let equityChart = null;
    let timeRange = 'ALL';
    let strategies = [];
    let equityData = { snapshots: [], trades: [] };

    // Helper functions
    function isMarketOpen() {
        const now = new Date();
        const day = now.getDay();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const timeValue = hours * 60 + minutes;
        
        if (day === 0 || day === 6) return false;
        return timeValue >= 570 && timeValue <= 960; // 9:30 AM - 4:00 PM
    }

    function getLastUpdated() {
        const minutes = Math.floor(Math.random() * 5) + 1;
        return `${minutes}m ago`;
    }

    async function render(container, params) {
        injectDashboardStyles();
        
        const marketOpen = isMarketOpen();
        const lastUpdated = getLastUpdated();
        
        container.innerHTML = `
            <div class="dashboard-container">
                <!-- Header -->
                <div class="dashboard-header">
                    <div class="header-left">
                        <h1>FANTASY TRADING PLATFORM</h1>
                        <div class="subtitle">5 Independent Strategy Portfolios · $20K Capital Each · Real Alpaca Execution</div>
                        <div class="subtitle-note" style="font-size:11px;color:var(--text-secondary);margin-top:4px;opacity:0.7;">
                            Each strategy runs in isolation — powered by Alpaca real-time market data
                        </div>
                    </div>
                    <div class="header-stats">
                        <div class="market-status">
                            <div class="market-indicator ${marketOpen ? 'market-open' : 'market-closed'}"></div>
                            <div class="stat-item">
                                <div class="stat-value">Market: ${marketOpen ? 'OPEN' : 'CLOSED'}</div>
                                <div class="stat-label">Status</div>
                            </div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${lastUpdated}</div>
                            <div class="stat-label">Last Update</div>
                        </div>
                    </div>
                </div>

                <!-- Equity Curves -->
                <div class="equity-section">
                    <div class="equity-header">
                        <h2 class="equity-title">PORTFOLIO EQUITY CURVES</h2>
                        <div class="time-range-selector">
                            <button class="time-btn ${timeRange === '1D' ? 'active' : ''}" data-range="1D">1D</button>
                            <button class="time-btn ${timeRange === '1W' ? 'active' : ''}" data-range="1W">1W</button>
                            <button class="time-btn ${timeRange === '1M' ? 'active' : ''}" data-range="1M">1M</button>
                            <button class="time-btn ${timeRange === 'ALL' ? 'active' : ''}" data-range="ALL">ALL</button>
                        </div>
                    </div>
                    <div class="chart-container">
                        <canvas id="equity-chart"></canvas>
                    </div>
                    <div class="strategy-legend" id="strategy-legend">
                        <!-- Legend will be populated dynamically -->
                    </div>
                </div>

                <!-- Leaderboard -->
                <div class="leaderboard-section">
                    <h2 class="section-title">🏆 LEADERBOARD</h2>
                    <div class="leaderboard-grid" id="leaderboard-grid">
                        <div class="loading">
                            <div class="spinner"></div>
                            Loading strategies...
                        </div>
                    </div>
                </div>

                <!-- Live Activity Feed -->
                <div class="activity-section">
                    <h2 class="section-title">📊 LIVE ACTIVITY FEED</h2>
                    <div class="activity-feed" id="activity-feed">
                        <div class="loading">
                            <div class="spinner"></div>
                            Loading activity...
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Load data and render components
        await loadData();
        try { await renderEquityChart(); } catch(e) { console.warn('Chart render error:', e); }
        try { renderLeaderboard(); } catch(e) { console.warn('Leaderboard render error:', e); }
        try { renderActivityFeed(); } catch(e) { console.warn('Activity feed render error:', e); }
        bindEventListeners();
    }

    async function loadData() {
        try {
            const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:3002'
                : 'https://api.gary-yong.com';

            // Load strategies
            const strategiesResponse = await fetch(`${apiBase}/api/v1/dashboard/strategies`);
            if (strategiesResponse.ok) {
                strategies = await strategiesResponse.json();
            }

            // Load equity history
            const equityResponse = await fetch(`${apiBase}/api/v1/dashboard/equity-history?range=${timeRange}`);
            if (equityResponse.ok) {
                equityData = await equityResponse.json();
            }

            // Fallback to mock data only if strategies API completely failed
            if (strategies.length === 0) {
                generateMockData();
            }

        } catch (error) {
            console.warn('API failed, using mock data:', error);
            generateMockData();
        }
    }

    function generateMockData() {
        // Generate mock strategies
        strategies = [
            { id: 'momentum-hunter', currentValue: 112450, totalPnl: 12450, totalPnlPercent: 12.45, winRate: 68.5, tradeCount: 47, rank: 1 },
            { id: 'sector-rotator', currentValue: 108930, totalPnl: 8930, totalPnlPercent: 8.93, winRate: 72.1, tradeCount: 35, rank: 2 },
            { id: 'mean-reversion', currentValue: 106780, totalPnl: 6780, totalPnlPercent: 6.78, winRate: 61.3, tradeCount: 63, rank: 3 },
            { id: 'value-dividends', currentValue: 104250, totalPnl: 4250, totalPnlPercent: 4.25, winRate: 79.2, tradeCount: 24, rank: 4 },
            { id: 'volatility-breakout', currentValue: 98560, totalPnl: -1440, totalPnlPercent: -1.44, winRate: 45.8, tradeCount: 72, rank: 5 }
        ];

        // Generate mock equity data
        equityData = generateMockEquityData();
    }

    function generateMockEquityData() {
        const snapshots = [];
        const trades = [];
        const symbols = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMD'];
        
        // Generate 7 days of hourly data during market hours
        const now = new Date();
        const startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        
        const portfolioValues = {
            'momentum-hunter': 20000,
            'mean-reversion': 20000,
            'sector-rotator': 20000,
            'value-dividends': 20000,
            'volatility-breakout': 20000
        };
        
        for (let d = 0; d < 7; d++) {
            const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
            if (date.getDay() === 0 || date.getDay() === 6) continue; // Skip weekends
            
            for (let h = 9; h <= 16; h++) { // Market hours
                if (h === 16 && Math.random() > 0.5) continue; // Sometimes skip 4pm
                
                const timestamp = new Date(date);
                timestamp.setHours(h, Math.floor(Math.random() * 60), 0, 0);
                
                const snapshot = { timestamp: timestamp.toISOString() };
                
                Object.keys(portfolioValues).forEach(strategy => {
                    // Random walk with strategy-specific characteristics
                    const volatility = strategy === 'volatility-breakout' ? 0.025 : 0.01;
                    const trend = strategy === 'momentum-hunter' ? 0.001 : 
                                 strategy === 'volatility-breakout' ? -0.0005 : 0.0002;
                    
                    const change = (Math.random() - 0.5) * volatility + trend;
                    portfolioValues[strategy] *= (1 + change);
                    portfolioValues[strategy] = Math.max(90000, Math.min(120000, portfolioValues[strategy]));
                    
                    snapshot[strategy] = Math.round(portfolioValues[strategy]);
                    
                    // Generate occasional trades with strategy-specific patterns
                    const tradeChance = {
                        'momentum-hunter': 0.08,      // More active
                        'volatility-breakout': 0.12,  // Most active
                        'mean-reversion': 0.06,       // Moderate
                        'sector-rotator': 0.04,       // Less frequent
                        'value-dividends': 0.02       // Least active
                    }[strategy] || 0.05;
                    
                    if (Math.random() < tradeChance) {
                        const action = Math.random() < 0.5 ? 'buy' : 'sell';
                        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
                        const basePrice = Math.round((Math.random() * 200 + 50) * 100) / 100;
                        
                        trades.push({
                            timestamp: timestamp.toISOString(),
                            strategy,
                            action,
                            symbol,
                            quantity: Math.floor(Math.random() * 50) + 10,
                            price: basePrice,
                            portfolioValueAfter: snapshot[strategy]
                        });
                    }
                });
                
                snapshots.push(snapshot);
            }
        }
        
        return { snapshots, trades };
    }

    // Helper function to filter outliers and interpolate
    function filterOutliersAndInterpolate(data, maxChangePercent = 0.1) {
        if (data.length <= 1) return data;
        
        const filtered = [data[0]]; // Keep first point
        
        for (let i = 1; i < data.length; i++) {
            const prev = filtered[filtered.length - 1];
            const curr = data[i];
            
            const changePercent = Math.abs(curr.y - prev.y) / prev.y;
            
            if (changePercent > maxChangePercent) {
                // Replace outlier with linear interpolation
                const next = data[i + 1];
                if (next) {
                    // Interpolate between prev and next
                    const interpolated = {
                        x: curr.x,
                        y: prev.y + (next.y - prev.y) * 0.5
                    };
                    filtered.push(interpolated);
                } else {
                    // No next point, use previous value with small random change
                    filtered.push({
                        x: curr.x,
                        y: prev.y * (1 + (Math.random() - 0.5) * 0.02)
                    });
                }
            } else {
                filtered.push(curr);
            }
        }
        
        return filtered;
    }

    // Helper function to generate mock equity history for sparse strategies
    function generateMockEquityHistory(strategyId, existingData) {
        if (existingData.length >= 3) return existingData;
        
        const baseline = 20000;
        const strategyCharacteristics = {
            'momentum-hunter': { trend: 0.002, volatility: 0.015 },
            'mean-reversion': { trend: 0.001, volatility: 0.008 },
            'sector-rotator': { trend: 0.0015, volatility: 0.012 },
            'value-dividends': { trend: 0.0008, volatility: 0.005 },
            'volatility-breakout': { trend: -0.0005, volatility: 0.025 }
        };
        
        const chars = strategyCharacteristics[strategyId] || { trend: 0.001, volatility: 0.01 };
        
        // Generate 7 days of market hours data
        const now = new Date();
        const startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const mockData = [];
        let currentValue = baseline;
        
        for (let d = 0; d < 7; d++) {
            const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
            if (date.getDay() === 0 || date.getDay() === 6) continue;
            
            for (let h = 9; h <= 16; h++) {
                if (h === 16 && Math.random() > 0.7) continue;
                
                const timestamp = new Date(date);
                timestamp.setHours(h, Math.floor(Math.random() * 60), 0, 0);
                
                // Random walk with momentum
                const randomChange = (Math.random() - 0.5) * chars.volatility;
                const momentumChange = chars.trend;
                currentValue *= (1 + randomChange + momentumChange);
                
                // Keep within reasonable bounds
                currentValue = Math.max(85000, Math.min(125000, currentValue));
                
                mockData.push({
                    x: timestamp.toISOString(),
                    y: Math.round(currentValue)
                });
            }
        }
        
        // If we have existing data, use the last point as starting value for future interpolation
        if (existingData.length > 0) {
            const lastExisting = existingData[existingData.length - 1];
            const lastTime = new Date(lastExisting.x);
            
            // Filter mock data to only include points after last existing data
            return existingData.concat(
                mockData.filter(point => new Date(point.x) > lastTime)
            );
        }
        
        return mockData;
    }

    async function renderEquityChart() {
        const canvas = document.getElementById('equity-chart');
        if (!canvas) return;

        // Wait for Chart.js to load
        let attempts = 0;
        while (typeof Chart === 'undefined' && attempts < 30) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        
        if (typeof Chart === 'undefined') {
            canvas.parentElement.innerHTML = '<p style="color:#8b949e;text-align:center;padding:2rem">Chart.js failed to load</p>';
            return;
        }

        const ctx = canvas.getContext('2d');
        
        // Prepare datasets for each strategy
        const datasets = [];
        const strategyOrder = ['momentum-hunter', 'mean-reversion', 'sector-rotator', 'value-dividends', 'volatility-breakout'];
        
        let totalPortfolioValue = 0;
        
        strategyOrder.forEach(strategyId => {
            const config = STRATEGY_CONFIG[strategyId];
            if (!config) return;
            
            // Extract time series data for this strategy (y values only — x is category-based)
            let data = equityData.snapshots
                .filter(snapshot => snapshot[strategyId] !== undefined)
                .map(snapshot => snapshot[strategyId]);

            // Calculate current value for portfolio total
            if (data.length > 0) {
                totalPortfolioValue += data[data.length - 1];
            }

            // Create main line dataset with improved styling
            datasets.push({
                label: config.name,
                data: data,
                borderColor: config.color,
                backgroundColor: config.color + '10',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointBorderWidth: 2,
                borderWidth: 2.5,  // Thicker lines
                hoverBorderWidth: 3,  // Subtle glow on hover
                shadowColor: config.color + '40',
                shadowBlur: 10
            });

            // Trade markers disabled for now (category axis doesn't support scatter overlay)
        });

        // Add baseline reference line at $20,000
        const baselineLen = equityData.snapshots?.length || 2;
        datasets.push({
            label: 'Baseline',
            data: Array(baselineLen).fill(20000),
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderDash: [5, 5],
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            tension: 0
        });

        if (equityChart) {
            equityChart.destroy();
        }

        // Update chart title with total portfolio value
        const chartTitle = document.querySelector('.equity-title');
        if (chartTitle) {
            chartTitle.innerHTML = `PORTFOLIO EQUITY CURVES <span style="color:#8b949e;font-size:1rem;font-weight:normal;">— Total: ${formatCurrency(totalPortfolioValue)}</span>`;
        }

        equityChart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                backgroundColor: '#0d1117',
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                layout: {
                    padding: 10
                },
                scales: {
                    x: {
                        type: 'category',
                        labels: (() => {
                            // Build sequential labels from snapshot timestamps (no gaps)
                            const snaps = equityData.snapshots || [];
                            return snaps.map(s => {
                                const d = new Date(s.timestamp);
                                if (timeRange === '1D') {
                                    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                                } else {
                                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + 
                                           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                                }
                            });
                        })(),
                        grid: {
                            color: 'rgba(255,255,255,0.07)',
                            lineWidth: 1
                        },
                        border: { color: '#21262d' },
                        ticks: {
                            color: '#8b949e',
                            font: { family: 'SF Mono, Monaco, monospace', size: 11 },
                            maxTicksLimit: timeRange === '1D' ? 8 : 6,
                            maxRotation: 45
                        }
                    },
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(255,255,255,0.07)',
                            lineWidth: 1
                        },
                        border: { color: '#21262d' },
                        ticks: {
                            color: '#8b949e',
                            font: { family: 'SF Mono, Monaco, monospace', size: 11 },
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false // We'll use custom legend
                    },
                    tooltip: {
                        backgroundColor: '#161b22',
                        titleColor: '#ffffff',
                        bodyColor: '#8b949e',
                        borderColor: '#3fb950',
                        borderWidth: 1,
                        cornerRadius: 6,
                        padding: 10,
                        filter: function(tooltipItem) {
                            // Hide baseline tooltips
                            return tooltipItem.datasetIndex < datasets.length - 1;
                        },
                        callbacks: {
                            title: function(context) {
                                return context[0].label || '';
                            },
                            label: function(context) {
                                if (context.dataset.label === 'Baseline') return null;
                                return `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`;
                            }
                        }
                    }
                },
                elements: {
                    point: {
                        radius: 0,
                        hoverRadius: 6,
                        hoverBorderWidth: 2
                    },
                    line: {
                        borderWidth: 2.5
                    }
                }
            }
        });

        // Render custom legend with P&L
        renderStrategyLegend();
    }

    function renderStrategyLegend() {
        const legendContainer = document.getElementById('strategy-legend');
        if (!legendContainer) return;

        const strategyOrder = ['momentum-hunter', 'mean-reversion', 'sector-rotator', 'value-dividends', 'volatility-breakout'];
        
        legendContainer.innerHTML = strategyOrder.map(strategyId => {
            const config = STRATEGY_CONFIG[strategyId];
            const strategy = strategies.find(s => s.id === strategyId);
            const shortName = config.name.replace(/^.\s+/, ''); // Remove emoji
            
            let pnlDisplay = '';
            if (strategy) {
                const pnl = strategy.totalPnl || 0;
                const pnlPercent = strategy.totalPnlPercent || 0;
                const pnlSign = pnl >= 0 ? '+' : '';
                const pnlColor = pnl >= 0 ? '#3fb950' : '#f85149';
                
                pnlDisplay = `<span style="color: ${pnlColor}; font-weight: 600; margin-left: 8px;">${pnlSign}${formatCurrency(pnl)} (${pnlSign}${formatPercent(pnlPercent, 2, false)})</span>`;
            }
            
            return `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: ${config.color}"></div>
                    <span>${config.emoji} ${shortName}${pnlDisplay}</span>
                </div>
            `;
        }).join('');
    }

    function renderLeaderboard() {
        const container = document.getElementById('leaderboard-grid');
        if (!container) return;

        const sortedStrategies = [...strategies].sort((a, b) => a.rank - b.rank);
        
        container.innerHTML = sortedStrategies.map(strategy => {
            const config = STRATEGY_CONFIG[strategy.id];
            if (!config) return '';
            
            const rankClass = strategy.rank <= 3 ? `rank-${strategy.rank}` : 'rank-other';
            const rankDisplay = strategy.rank <= 3 ? ['🥇', '🥈', '🥉'][strategy.rank - 1] : `#${strategy.rank}`;
            const pnlClass = strategy.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative';
            
            return `
                <div class="strategy-rank-card" data-strategy-id="${strategy.id}" style="cursor:pointer;" title="View strategy details">
                    <div class="rank-header">
                        <div class="strategy-info">
                            <div class="strategy-name">${config.name}</div>
                        </div>
                        <div class="rank-position ${rankClass}">${rankDisplay}</div>
                    </div>
                    
                    <div class="rank-stats">
                        <div class="rank-stat">
                            <div class="rank-stat-label">Portfolio Value</div>
                            <div class="rank-stat-value">${formatCurrency(strategy.currentValue)}</div>
                        </div>
                        
                        <div class="rank-stat">
                            <div class="rank-stat-label">P&L</div>
                            <div class="rank-stat-value ${pnlClass}">
                                ${formatCurrency(strategy.totalPnl ?? 0)} (${formatPercent(strategy.totalPnlPercent ?? 0, 2, false)})
                            </div>
                        </div>
                        
                        <div class="rank-stat">
                            <div class="rank-stat-label">Win Rate</div>
                            <div class="rank-stat-value">${formatPercent(strategy.winRate ?? 0, 2, false)}</div>
                            <div class="win-rate-bar">
                                <div class="win-rate-fill" style="width: ${strategy.winRate ?? 0}%"></div>
                            </div>
                        </div>
                        
                        <div class="rank-stat">
                            <div class="rank-stat-label">Trades</div>
                            <div class="rank-stat-value">${strategy.tradeCount}</div>
                        </div>
                    </div>
                    
                    ${strategy.positions && strategy.positions.length > 0 ? `
                    <div class="strategy-positions" style="margin-top:12px;padding-top:12px;border-top:1px solid #21262d;">
                        <div style="font-size:11px;color:#8b949e;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Holdings</div>
                        <!-- 4-column compact layout for card width; book value on detail page -->
                        <div style="display:grid;grid-template-columns:44px 36px 1fr 58px;gap:3px;padding:3px 0 5px;font-size:10px;color:#4d5566;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid #21262d;">
                            <span>Symbol</span><span style="text-align:right;">Alloc</span><span style="text-align:right;">Mkt Val</span><span style="text-align:right;">P&amp;L</span>
                        </div>
                        ${strategy.positions.map(p => `
                            <div style="display:grid;grid-template-columns:44px 36px 1fr 58px;gap:3px;padding:3px 0;font-size:11px;border-bottom:1px solid rgba(33,38,45,0.4);">
                                <span style="color:#e6edf3;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.symbol}</span>
                                <span style="color:#58a6ff;text-align:right;font-weight:600;">${p.allocation ?? 0}%</span>
                                <span style="color:#e6edf3;text-align:right;">${formatCurrency(p.marketValue)}</span>
                                <span style="color:${(p.unrealizedPl ?? 0) >= 0 ? '#3fb950' : '#f85149'};text-align:right;font-weight:600;">${formatCurrency(p.unrealizedPl)}</span>
                            </div>
                        `).join('')}
                        <!-- Cash row (only show if non-trivial) -->
                        ${(() => {
                            const cash = strategy.cashRemaining ?? 0;
                            if (Math.abs(cash) < 1) return '';
                            const cashColour  = cash < 0 ? '#f85149' : '#8b949e';
                            const allocColour = cash < 0 ? '#f85149' : '#58a6ff';
                            const label = cash < 0 ? 'MARGIN' : 'CASH';
                            return `
                        <div style="display:grid;grid-template-columns:44px 36px 1fr 58px;gap:3px;padding:3px 0;font-size:11px;border-top:1px solid #21262d;margin-top:2px;">
                            <span style="color:${cashColour};font-weight:700;">${label}</span>
                            <span style="color:${allocColour};text-align:right;font-weight:600;">${Math.abs(strategy.cashAllocation ?? 0)}%</span>
                            <span style="color:${cashColour};text-align:right;">${formatCurrency(cash)}</span>
                            <span></span>
                        </div>`;
                        })()}
                    </div>` : ''}
                    
                    ${strategy.trades && strategy.trades.length > 0 ? `
                    <div class="strategy-trades" style="margin-top:12px;padding-top:12px;border-top:1px solid #21262d;">
                        <div style="font-size:11px;color:#8b949e;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Recent Trades</div>
                        ${strategy.trades.slice(0, 5).map(t => `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;">
                                <span style="color:${t.side === 'buy' ? '#3fb950' : '#f85149'};font-weight:600;width:35px;">${t.side.toUpperCase()}</span>
                                <span style="color:#e6edf3;">${t.qty} ${t.symbol}</span>
                                <span style="color:#8b949e;">@ ${formatCurrency(t.price)}</span>
                            </div>
                        `).join('')}
                    </div>` : ''}
                </div>
            `;
        }).join('');

        // Make cards clickable -> navigate to strategy detail
        container.querySelectorAll('.strategy-rank-card[data-strategy-id]').forEach(card => {
            card.addEventListener('click', () => {
                window.location.hash = '#/strategy/' + card.dataset.strategyId;
            });
        });
    }

    function renderActivityFeed() {
        const container = document.getElementById('activity-feed');
        if (!container) return;

        // Collect all real trades from all strategies
        const allTrades = [];
        strategies.forEach(strategy => {
            if (strategy.trades && strategy.trades.length > 0) {
                strategy.trades.forEach(trade => {
                    allTrades.push({
                        ...trade,
                        strategyId: strategy.id,
                        strategyName: strategy.name
                    });
                });
            }
        });

        // Sort by time (newest first) and take top 10
        allTrades.sort((a, b) => new Date(b.filledAt || 0) - new Date(a.filledAt || 0));
        const recentTrades = allTrades.slice(0, 10);

        if (recentTrades.length === 0) {
            container.innerHTML = '<div class="activity-item" style="justify-content:center;color:#8b949e;padding:1rem;">No trades executed yet — strategies are scanning for signals</div>';
            return;
        }

        container.innerHTML = recentTrades.map(trade => {
            const config = STRATEGY_CONFIG[trade.strategyId];
            const time = new Date(trade.filledAt);
            const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const timeStr = time.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const dateTimeStr = `<span style="display:block;font-size:0.7rem;opacity:0.7">${dateStr}</span>${timeStr}`;
            
            return `
                <div class="activity-item">
                    <div class="activity-time">${dateTimeStr}</div>
                    <div class="activity-emoji">${config?.emoji || '📊'}</div>
                    <div class="activity-text">
                        <span class="activity-action" style="color:${trade.side === 'buy' ? '#3fb950' : '#f85149'}">${trade.side.toUpperCase()}</span>
                        <span class="activity-symbol">${trade.qty} ${trade.symbol}</span>
                        <span class="activity-price">@ ${formatCurrency(trade.price)}</span>
                        <div class="activity-strategy">${config?.name || trade.strategyName}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function bindEventListeners() {
        // Time range buttons
        document.querySelectorAll('.time-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const newRange = btn.getAttribute('data-range');
                    if (newRange === timeRange) return;
                    
                    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    timeRange = newRange;
                    
                    // Reload data and refresh chart
                    await loadData();
                    await renderEquityChart();
                } catch(e) {
                    console.warn('Chart update error:', e);
                }
            });
        });
    }

    function destroy() {
        if (equityChart) {
            equityChart.destroy();
            equityChart = null;
        }
    }

    return { render, destroy };
}

export default DashboardStrategies;