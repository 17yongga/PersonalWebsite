# Product Specification: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2025-07-10  
**Deploy Target:** gary-yong.com/trading  

---

## 1. Vision

Build a **free, educational fantasy/paper trading platform** where users simulate US equity and ETF trading with virtual money. Users build portfolios, create automated strategies, backtest against historical data, and compete in leagues — all without risking real capital.

The platform lives at `gary-yong.com/trading` as a new module alongside Gary Yong's existing apps (casino, CS2 betting, budget tracker, Ask Gary chatbot), reinforcing the site as a hub for interactive financial and gaming tools.

---

## 2. Target Users

| Persona | Description | Primary Need |
|---------|-------------|--------------|
| **Curious Beginner** | College student or new grad who wants to learn trading without risk | Safe environment to experiment |
| **Strategy Tinkerer** | Hobby coder who wants to build and backtest trading rules | Strategy builder + backtesting |
| **Competitive Trader** | Wants to prove skill against others | Contests, leagues, leaderboards |
| **Portfolio Student** | Finance student learning portfolio theory | Portfolio analytics, diversification tools |
| **Gary's Network** | Friends, colleagues, visitors to gary-yong.com | Fun, polished demo of Gary's engineering |

---

## 3. Value Proposition

- **Zero risk, real learning.** Trade with $100K virtual dollars using real (delayed) market data.
- **Strategy automation.** Build rule-based or code-based strategies and backtest them against years of historical data.
- **Social competition.** Compete in time-boxed contests and climb global leaderboards.
- **No sign-up friction.** Register with just email + password. No KYC, no credit card, no PII.
- **Clean, modern UI.** Consistent with gary-yong.com's existing design language.

---

## 4. Core Features

### 4.1 Virtual Portfolios

Users create and manage multiple virtual portfolios, each seeded with configurable starting capital (default $100,000).

**User Stories:**
- As a user, I can create a new portfolio with a custom name and starting balance so I can experiment with different strategies.
- As a user, I can view my portfolio's current holdings, cash balance, and total value at a glance.
- As a user, I can reset a portfolio to its starting state to try a fresh approach.
- As a user, I can clone an existing portfolio to branch off a new strategy without losing the original.
- As a user, I can have up to 5 active portfolios simultaneously.
- As a user, I can see my portfolio's allocation breakdown (pie chart by sector, by holding).

### 4.2 Paper Trading (Order Execution)

Simulated trading engine that executes orders against real delayed market prices.

**Supported Order Types (v1):**
- **Market Order** — Execute immediately at current ask/bid price
- **Limit Order** — Execute when price reaches target (GTC or day-only)
- **Stop Order** — Trigger market order when stop price is hit
- **Stop-Limit Order** — Trigger limit order when stop price is hit

**User Stories:**
- As a user, I can search for any US equity or ETF by ticker or company name.
- As a user, I can place a market buy/sell order and see it execute within seconds.
- As a user, I can place a limit order and see it fill when the market price reaches my target.
- As a user, I can cancel any open (unfilled) order.
- As a user, I can view my complete order history with status (filled, cancelled, pending).
- As a user, I can see the simulated fill price, timestamp, and any slippage applied.
- As a user, I cannot buy more shares than my cash balance allows (no margin in v1).
- As a user, I cannot short sell (long-only in v1).

**Execution Rules:**
- Market orders fill at the current delayed quote price + simulated spread (0.01–0.05%).
- Limit/stop orders are checked every 60 seconds against latest quotes.
- Orders expire at market close if set to "Day" duration.
- GTC orders persist until filled or cancelled (max 30 calendar days).
- Commission: $0 (simulating modern brokerages).

### 4.3 Strategy Builder

Users create automated trading strategies using either a visual rules editor or a JavaScript code editor.

**Rules-Based Strategies:**
- IF/THEN/ELSE logic with conditions on price, volume, moving averages, RSI, MACD.
- Example: "IF AAPL 50-day MA crosses above 200-day MA, THEN BUY 10 shares."
- Conditions can be AND/OR combined.
- Actions: BUY, SELL, set alert.

**Code-Based Strategies:**
- Users write JavaScript snippets that receive market data and return trade signals.
- Sandboxed execution (no network access, no file system, CPU/memory limits).
- API provided: `getData(symbol, period)`, `getPosition(symbol)`, `buy(symbol, qty)`, `sell(symbol, qty)`, `getPortfolio()`.

**User Stories:**
- As a user, I can create a rules-based strategy using dropdown menus and condition builders without writing code.
- As a user, I can create a code-based strategy by writing JavaScript in an in-browser editor with syntax highlighting.
- As a user, I can save, name, and version my strategies.
- As a user, I can validate a strategy (syntax check + dry run) before deploying it.
- As a user, I can attach a strategy to a portfolio for live paper-trading execution.
- As a user, I can detach/pause a strategy without deleting it.
- As a user, I can have up to 10 saved strategies.

### 4.4 Backtesting Engine

Run strategies against historical market data to evaluate performance.

**User Stories:**
- As a user, I can backtest any saved strategy against 1–5 years of historical data.
- As a user, I can choose the backtest period (start date, end date) and starting capital.
- As a user, I can see an equity curve (portfolio value over time) after a backtest completes.
- As a user, I can see key performance metrics: total return, annualized return, max drawdown, Sharpe ratio, win rate, profit factor.
- As a user, I can see a trade log showing every simulated trade the strategy made.
- As a user, I can compare two backtest results side-by-side.
- As a user, I can see benchmark comparison (strategy vs. S&P 500 buy-and-hold).

**Anti-Cheat:**
- Strategies cannot access future data (strict point-in-time enforcement).
- Historical data is fed chronologically; no lookahead bias.
- Backtest results include a "realistic" flag indicating whether slippage and spread were applied.

### 4.5 Contests & Leagues

Time-boxed trading competitions where users compete for the highest portfolio return.

**User Stories:**
- As a user, I can browse a list of active, upcoming, and past contests.
- As a user, I can join an open contest with one click (a fresh contest portfolio is created automatically).
- As a user, I can see the contest rules (duration, starting capital, allowed instruments, max position size).
- As a user, I can view live standings during a contest (updated hourly).
- As a user, I can see final results and winners after a contest ends.
- As a user, I can create a private contest and invite others via a shareable link.
- As a user, I earn badges/achievements for contest placements (🥇🥈🥉).

**Contest Types (v1):**
- **Weekly Sprint** — 1-week contest, $100K starting capital, best total return wins.
- **Monthly Marathon** — 1-month contest, $100K starting capital, best risk-adjusted return (Sharpe) wins.
- **Custom** — User-created with configurable rules.

### 4.6 Leaderboards

Global and contest-specific rankings.

**User Stories:**
- As a user, I can see a global leaderboard ranked by all-time total return across all portfolios.
- As a user, I can see leaderboards filtered by time period (weekly, monthly, all-time).
- As a user, I can see my own rank and percentile.
- As a user, I can click on any leaderboard entry to see that user's public profile (display name, join date, contest history, top portfolio return).
- As a user, I can opt out of the global leaderboard (go private).

### 4.7 Analytics Dashboard

Portfolio performance analysis and trade history visualization.

**User Stories:**
- As a user, I can see my portfolio's performance chart (daily value over time).
- As a user, I can see P&L breakdown by individual holding (realized + unrealized).
- As a user, I can see sector allocation and diversification metrics.
- As a user, I can export my trade history as CSV.
- As a user, I can see aggregate stats: total trades, win rate, average hold time, best/worst trade.

---

## 5. Assumptions & Constraints

| Assumption | Detail |
|------------|--------|
| **No real money** | All trading uses virtual currency. No integration with brokerages. |
| **Educational purpose** | Platform includes prominent disclaimers that this is not financial advice. |
| **US equities + ETFs only (v1)** | Roughly 8,000+ symbols. No options, futures, forex, or crypto in v1. |
| **Delayed market data** | 15-minute delayed quotes are acceptable. Real-time is a v2 upgrade. |
| **Free market data APIs** | Use Yahoo Finance (unofficial), Alpha Vantage free tier (5 calls/min, 500/day), or Polygon.io free tier. |
| **No margin trading (v1)** | Long-only, cash account. No short selling, no leverage. |
| **Single currency** | All trading in USD. |
| **No mobile app (v1)** | Responsive web only. Native app is v2+. |
| **Minimal PII** | Only email + display name collected. No SSN, no address, no financial info. |
| **SQLite for v1** | Simple deployment on existing EC2. PostgreSQL migration path for v2 when user count grows. |

---

## 6. Security & Compliance Summary

*(Full detail in SECURITY.md)*

- **Authentication:** bcrypt password hashing, JWT access + refresh tokens, rate-limited login attempts.
- **Strategy Sandboxing:** User-submitted JavaScript runs in `isolated-vm` with CPU time limits (1s), memory limits (64MB), no network/FS access.
- **Anti-Cheat:** Point-in-time data enforcement in backtests, position size limits, order rate limits.
- **Data Privacy:** No PII beyond email. No real financial data stored. GDPR-ready delete endpoint.
- **Rate Limiting:** Per-IP and per-user rate limits on all API endpoints.
- **Disclaimer:** Every page displays "This is a simulation. Not financial advice. Past performance does not indicate future results."

---

## 7. v1 Scope (MVP)

**In Scope:**
- [x] User registration & login (email + password)
- [x] Portfolio CRUD (create, view, reset, delete) — max 5 per user
- [x] Market order execution against delayed quotes
- [x] Limit and stop orders
- [x] Symbol search (US equities + ETFs)
- [x] Real-time-ish portfolio value updates (WebSocket, 60s refresh)
- [x] Rules-based strategy builder (visual editor)
- [x] Code-based strategy builder (JS sandbox)
- [x] Backtesting against up to 5 years of historical data
- [x] Backtest results: equity curve, key metrics, trade log
- [x] Weekly and monthly contests (system-created)
- [x] Custom contests (user-created)
- [x] Global leaderboard (total return, Sharpe ratio)
- [x] Portfolio analytics dashboard
- [x] Trade history with CSV export
- [x] Mobile-responsive design
- [x] Dark/light theme toggle

**Out of Scope (v2+):**
- Options trading
- Short selling / margin
- Social trading (copy strategies)
- AI-powered strategy suggestions
- Native mobile app
- Real-time (non-delayed) market data
- News sentiment integration
- TradingView charting widget
- Multiplayer real-time contests
- Third-party strategy bot API
- Crypto / international markets

---

## 8. Success Metrics

| Metric | Target (3 months post-launch) |
|--------|-------------------------------|
| Registered users | 100+ |
| Weekly active users | 30+ |
| Portfolios created | 200+ |
| Strategies created | 50+ |
| Backtests run | 200+ |
| Contest participation rate | 40% of active users |
| Average session duration | 8+ minutes |
| Page load time (LCP) | < 2 seconds |
| API error rate | < 1% |

---

## 9. Glossary

| Term | Definition |
|------|-----------|
| **Paper Trading** | Simulated trading with virtual money using real market data |
| **Backtest** | Running a strategy against historical data to evaluate performance |
| **Sharpe Ratio** | Risk-adjusted return metric: (return - risk-free rate) / standard deviation |
| **Max Drawdown** | Largest peak-to-trough decline in portfolio value |
| **GTC** | Good 'Til Cancelled — order remains active until filled or manually cancelled |
| **Equity Curve** | Chart showing portfolio value over time |
| **Slippage** | Difference between expected and actual execution price |
| **Win Rate** | Percentage of trades that were profitable |
| **Profit Factor** | Gross profit / gross loss |
