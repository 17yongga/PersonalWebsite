# v1/v2/v3 Summary: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2026-02-18  

---

## v1 — "Shipped" Checklist

Everything below must be complete and tested for v1 to be considered shipped.

### ✅ Authentication & User Management
- [x] Email + password registration with bcrypt hashing
- [x] JWT access tokens (15min) + refresh tokens (7d) with rotation
- [x] Login, logout, token refresh endpoints
- [x] User profile (display name, public/private toggle)
- [x] Account deletion with full data cascade
- [x] Rate-limited login (5 attempts / 15min per IP)

### ✅ Virtual Portfolios
- [x] Create up to 5 portfolios per user
- [x] Default $100,000 virtual starting capital
- [x] Configurable starting balance ($1K–$10M)
- [x] Portfolio rename, soft delete, hard reset
- [x] Portfolio overview: total value, cash, positions, day/total return
- [x] Daily portfolio snapshots (automated at market close)

### ✅ Market Data
- [x] US equities + ETFs searchable (~8,000+ symbols)
- [x] Real-time-ish quotes (15-min delayed, 60s refresh via WebSocket)
- [x] Symbol search with autocomplete
- [x] Historical OHLCV data (up to 5 years, daily candles)
- [x] Multi-source failover (Yahoo Finance → Alpha Vantage → Polygon.io)
- [x] Server-side caching (60s quotes, 24h historical)

### ✅ Trading Engine
- [x] Market orders (immediate fill at quote + slippage)
- [x] Limit orders (fill when price target reached)
- [x] Stop orders (trigger market order on price cross)
- [x] Stop-limit orders (two-phase trigger)
- [x] Day + GTC order duration
- [x] Order cancellation
- [x] Order history with full status lifecycle
- [x] $0 commission (simulating modern brokerages)
- [x] Simulated slippage (0.01–0.05%)

### ✅ Position Management
- [x] Position tracking per portfolio
- [x] Unrealized P&L (current price vs avg cost)
- [x] Realized P&L (FIFO cost basis on sales)
- [x] Cost basis recalculation on partial sells
- [x] Transaction log with CSV export

### ✅ Strategy Builder
- [x] Rules-based strategies (visual IF/THEN editor)
  - Conditions: price, volume, SMA, EMA, RSI, MACD, ATR, Bollinger Bands
  - Operators: crosses_above, crosses_below, greater_than, less_than
  - Actions: buy, sell (configurable quantity)
  - AND/OR condition groups
- [x] Code-based strategies (JavaScript in sandboxed editor)
  - CodeMirror 6 editor with syntax highlighting
  - API: getData(), getPosition(), getPortfolio(), buy(), sell()
  - isolated-vm sandbox (1s CPU, 64MB memory, no network/FS)
- [x] Strategy CRUD (max 10 per user) with versioning
- [x] Strategy validation (syntax + dry run)
- [x] Attach/detach strategy to portfolio for live paper-trading

### ✅ Backtesting Engine
- [x] Backtest any strategy against 1–5 years of historical data
- [x] Configurable date range and starting capital
- [x] Worker thread execution (parallel, 30s timeout)
- [x] Equity curve (daily portfolio value over time)
- [x] Performance metrics:
  - Total return, annualized return (CAGR)
  - Sharpe ratio, Sortino ratio
  - Max drawdown (peak-to-trough)
  - Win rate, profit factor
  - Average holding period, best/worst trade
- [x] SPY buy-and-hold benchmark comparison
- [x] Trade log (every simulated trade with entry/exit prices)
- [x] Anti-cheat: strict point-in-time enforcement (no lookahead bias)

### ✅ Contests & Leagues
- [x] System-created recurring contests:
  - Weekly Sprint (Mon–Fri, ranked by total return)
  - Monthly Marathon (full month, ranked by Sharpe ratio)
- [x] User-created custom contests (name, dates, rules, public/private)
- [x] Private contest invite links
- [x] Automated contest lifecycle (upcoming → active → completed)
- [x] Contest join flow (auto-creates isolated contest portfolio)
- [x] Live standings (hourly refresh during active contests)
- [x] Final rankings with 🥇🥈🥉 badges

### ✅ Leaderboards
- [x] Global leaderboard (all-time, monthly, weekly)
- [x] Ranked by total return (filterable by Sharpe ratio)
- [x] Contest-specific leaderboards
- [x] Public/private user visibility toggle
- [x] Leaderboard snapshots (hourly, 30-day retention)

### ✅ Analytics Dashboard
- [x] Portfolio equity curve (Chart.js line chart)
- [x] P&L breakdown by holding (realized + unrealized)
- [x] Sector allocation donut chart
- [x] Aggregate stats: total trades, win rate, avg hold time, best/worst trade
- [x] Trade history with filters and CSV export

### ✅ User Experience
- [x] Mobile responsive (480px, 768px, 1024px breakpoints)
- [x] Dark/light theme toggle (persisted in localStorage)
- [x] < 2 second page load (LCP)
- [x] Educational disclaimer on every page
- [x] Terms acceptance modal on first login
- [x] Error toasts, offline detection, auto-reconnect
- [x] Touch-friendly order form on mobile

### ✅ Infrastructure
- [x] Deployed at gary-yong.com/trading
- [x] Backend: Node.js + Express on EC2 (PM2: trading-server, port 3002)
- [x] Database: SQLite with WAL mode
- [x] WebSocket: real-time price updates + portfolio streaming
- [x] nginx reverse proxy with SSL (api.gary-yong.com)
- [x] Frontend: S3 + CloudFront (static files)
- [x] Deploy scripts (frontend + backend)
- [x] Daily DB backup (cron, 2 AM ET)
- [x] Health check endpoint with system metrics

---

## v2 — Next Phase Features

Prioritized by impact and feasibility. Estimated total: 8–12 weeks.

### 🔥 High Priority

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| **Options Trading Simulation** | Call/put buying, Greeks display, options chain viewer, strategy payoff diagrams (covered calls, spreads, straddles) | 4–5 weeks | Opens platform to a huge audience of options learners |
| **Social Trading (Copy Strategies)** | Follow other users, auto-copy their trades into your portfolio. "Top Trader" badges. Strategy marketplace (share/discover) | 2–3 weeks | Viral growth loop — users invite friends to follow them |
| **Advanced Charting (TradingView Widget)** | Embed TradingView lightweight charts for candlestick charts, drawing tools, indicators overlay. Replace Chart.js for price charts | 1 week | Dramatically improves UX for serious traders |
| **Real-Time Market Data** | Upgrade to real-time quotes (Polygon.io paid tier or Alpaca market data). Sub-second price updates via WebSocket | 1 week + ongoing cost | Professional feel, critical for active trading simulation |

### 📈 Medium Priority

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| **AI-Powered Strategy Suggestions** | Analyze user's trading history → suggest strategy improvements. "Your win rate drops on Mondays" or "Consider adding a stop-loss" | 2 weeks | Unique differentiator, educational value |
| **News Sentiment Integration** | Display relevant financial news per symbol, sentiment score (positive/negative/neutral), news-based alerts | 2 weeks | Adds context to trading decisions |
| **Short Selling & Margin** | Enable short selling with margin requirements, margin calls, leverage (2x max). Adds risk management layer | 2 weeks | Teaches important concepts, enables more strategies |
| **Multiplayer Real-Time Contests** | Synchronized contest start, real-time standings (every minute), countdown timer, live spectating | 2 weeks | Excitement factor, competitive engagement |
| **Push Notifications** | Browser push notifications for order fills, contest updates, price alerts, strategy signals | 1 week | Re-engagement, keeps users coming back |

### 🛠️ Infrastructure

| Feature | Description | Effort | Impact |
|---------|-------------|--------|--------|
| **PostgreSQL Migration** | Migrate from SQLite to PostgreSQL for better concurrency, full-text search, and scalability | 1 week | Required before scaling past ~500 concurrent users |
| **Public API** | Documented REST API for third-party strategy bots, portfolio management scripts, data export | 2 weeks | Developer community, integrations |
| **Redis Cache Layer** | Replace in-memory caches with Redis for multi-process support, rate limiting consistency, session storage | 1 week | Required if adding more backend processes |

---

## v3 — Long-Term Vision

These represent the platform's aspirational direction. Timeline: 6–12 months post-v2.

### 🌍 Market Expansion
- **Cryptocurrency Simulation** — BTC, ETH, top 50 by market cap. 24/7 trading (unlike equities). Unique backtesting opportunities with crypto volatility.
- **Global Markets** — TSX (Canada), LSE (UK), ASX (Australia), JPX (Japan). Multi-currency support with FX simulation.
- **Futures & Commodities** — Oil, gold, wheat, S&P 500 futures. Contract-based trading with expiration mechanics.
- **Forex Pairs** — Major and minor currency pairs. 24/5 trading. Leverage simulation.

### 🎓 Education Platform
- **Interactive Courses** — Step-by-step lessons: "Trading 101", "Technical Analysis", "Portfolio Theory", "Options Basics". Quizzes at the end of each module.
- **Certification Program** — Complete all courses + demonstrate proficiency (Sharpe > 1.0 in 3 consecutive months) → earn "Certified Paper Trader" badge. Shareable certificate.
- **Guided Challenges** — "Build a portfolio that beats the S&P 500 this month" or "Create a mean-reversion strategy with Sharpe > 1.5 in backtesting." Gamified learning.
- **Glossary & Wiki** — In-platform financial terms glossary. Click any metric → see explanation.

### 🏢 Team & Institutional Mode
- **Trading Teams** — Create a "firm" with team members. Shared portfolio, role-based permissions (trader, analyst, risk manager). Team leaderboard.
- **Classroom Mode** — Professors create a classroom, invite students, assign trading challenges, grade based on performance metrics. Export student results.
- **Paper Trading API Integration** — Connect to Alpaca Paper Trading or IBKR Paper Account for more realistic execution. Bridge between simulation and real paper accounts.

### 🤖 AI & Automation
- **AI Strategy Generator** — Describe what you want in plain English ("I want a momentum strategy that buys breakouts in tech stocks") → AI generates strategy code/rules.
- **Portfolio Optimizer** — Given your holdings, suggest optimal allocation using Modern Portfolio Theory (efficient frontier visualization).
- **Natural Language Querying** — "How did my AAPL position perform last month?" → instant answer with chart.
- **Anomaly Detection** — "Your portfolio lost 5% today — here's why" auto-analysis after significant moves.

### 📱 Native Apps
- **iOS App** — SwiftUI, push notifications, Apple Sign In, Watch complication for portfolio value.
- **Android App** — Kotlin, Material Design 3, widget for home screen portfolio tracker.
- **Desktop App** — Electron wrapper with system tray, multi-window support (chart + order form + watchlist).

---

## Summary Matrix

| Category | v1 (Shipped) | v2 (Next) | v3 (Vision) |
|----------|-------------|-----------|-------------|
| **Markets** | US equities + ETFs | + Options | + Crypto, Global, Forex, Futures |
| **Trading** | Market/Limit/Stop, long-only | + Short selling, margin, trailing stops | + Complex order types, multi-leg |
| **Data** | 15-min delayed | Real-time | Real-time + news + sentiment |
| **Strategies** | Rules + JS code | + AI suggestions, social sharing | + NL generation, portfolio optimization |
| **Social** | Contests, leaderboards | + Copy trading, followers | + Teams, classrooms, firms |
| **Education** | Disclaimer + learning by doing | + News context, AI tips | + Courses, certification, guided challenges |
| **Platform** | Web (responsive) | + Push notifications, public API | + Native iOS/Android/Desktop |
| **Infra** | SQLite, single EC2 | PostgreSQL, Redis | Multi-region, CDN-first, API gateway |
| **Scale** | ~100 users | ~5,000 users | ~100,000 users |

---

## What Makes This Platform Unique

1. **Strategy Builder + Backtesting** — Most paper trading apps let you trade manually. This one lets you build automated strategies and prove they work against years of data. That's the killer feature.

2. **Zero Friction** — No KYC, no credit card, no app download. Email + password → trading in 60 seconds.

3. **Competition Layer** — Weekly/monthly contests with leaderboards turn passive learning into active engagement. People come back to defend their rank.

4. **Code-Based Strategies** — For the technically inclined, writing actual JavaScript strategies (safely sandboxed) is a bridge between "learning to trade" and "learning to build trading systems." That's a rare educational offering.

5. **Showcase for Gary** — This lives on gary-yong.com alongside the casino, CS2 betting, and budget tools. It demonstrates full-stack engineering, financial domain knowledge, and product thinking — exactly what YongAI clients need to see.

---

*This document is the north star. v1 is the foundation. v2 adds the hooks that make people stay. v3 is the vision that makes it a real product.*
