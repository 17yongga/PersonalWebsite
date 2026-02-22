# Build Plan: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2025-07-10  
**Timeline:** 10 weeks (5 milestones × 2 weeks each)  
**Team Size:** 1 full-stack developer  
**Hours/Week:** ~30–40 (side project pace)  

---

## Overview

This build plan breaks the Fantasy Trading Platform into 5 milestones. Each milestone is self-contained and produces a deployable artifact. The platform incrementally becomes usable — M1 gives you auth + portfolios, M2 adds trading, M3 adds strategies, M4 adds social, M5 polishes everything.

**Critical Path:** M1 → M2 → M3 → M4 → M5 (strictly sequential — each builds on the last).

---

## Milestone 1: Foundation (Week 1–2)

**Goal:** Users can register, log in, create portfolios, and see real market data. The platform skeleton is deployed and accessible at `gary-yong.com/trading`.

### Tasks

| # | Task | Effort | Depends On | Acceptance Criteria |
|---|------|--------|------------|-------------------|
| 1.1 | **Project scaffolding** — Initialize Node.js server (`trading-server/`), Express setup, PM2 config, folder structure per ARCHITECTURE.md | 0.5d | — | `npm start` boots server on port 3002, health endpoint returns 200 |
| 1.2 | **SQLite setup** — `better-sqlite3`, WAL mode, migration runner, `001_initial.sql` schema (users, refresh_tokens, portfolios, positions, orders, transactions tables) | 1d | 1.1 | `node src/db/migrate.js` creates all tables, foreign keys enforced |
| 1.3 | **Auth system** — Registration (bcrypt cost 12), login, JWT access (15min) + refresh (7d) tokens, token rotation, logout, `GET /auth/me` | 2d | 1.2 | Register → login → access protected route → refresh token → logout. Rate limited (5 login/15min per IP) |
| 1.4 | **Auth middleware** — JWT verification middleware, zod validation middleware, global error handler, CORS config, rate limiter setup | 1d | 1.3 | Unauthorized requests get 401, invalid bodies get 400, CORS headers present |
| 1.5 | **Portfolio CRUD** — Create, list, get detail, update name, soft delete, reset. Max 5 per user enforced | 1.5d | 1.4 | All portfolio endpoints functional per API_SPEC.md §2. Reset restores cash, clears positions |
| 1.6 | **Market data service** — Yahoo Finance client (quotes, historical, search), Alpha Vantage fallback, in-memory cache (60s TTL for quotes), SQLite cache (24h for historical) | 2d | 1.2 | `GET /market/quote/AAPL` returns real price, `GET /market/search?q=apple` returns results, fallback fires on Yahoo failure |
| 1.7 | **Watchlist** — CRUD for watchlist items, max 50 per user, price alerts (stored, not yet triggered) | 0.5d | 1.4, 1.6 | Add/remove symbols, list watchlist with current prices |
| 1.8 | **Frontend shell** — `index.html`, SPA hash router, CSS variables (dark/light theme), navbar, login/register page, dashboard skeleton | 2d | — | Navigate between routes, theme toggle works, login form submits to API |
| 1.9 | **Frontend: Dashboard page** — Portfolio summary cards (name, value, day change), watchlist table with live prices, empty states | 1.5d | 1.5, 1.6, 1.8 | Dashboard loads portfolios, displays watchlist, create portfolio modal works |
| 1.10 | **Nginx config + deployment** — Add `/api/v1/` proxy to localhost:3002 in nginx, deploy frontend to S3 (`/trading/`), PM2 startup config | 1d | 1.1–1.9 | `gary-yong.com/trading` loads SPA, API calls route to EC2, SSL works |

**Total Effort:** ~13 days  
**Buffer:** 1 day (fits in 2-week sprint at ~7 productive days/week)

### M1 Deliverables
- [x] User registration & login working end-to-end
- [x] JWT auth with refresh rotation
- [x] Portfolio CRUD (create, view, rename, delete, reset)
- [x] Market data: quotes, search, historical (cached)
- [x] Watchlist management
- [x] Frontend: login page, dashboard with portfolio cards + watchlist
- [x] Deployed to gary-yong.com/trading
- [x] Health check endpoint operational

### M1 Definition of Done
A new user can visit gary-yong.com/trading, register an account, create a portfolio named "My First Portfolio" with $100K, add AAPL/GOOGL/SPY to their watchlist, see live prices, and return the next day still logged in via refresh token.

---

## Milestone 2: Trading Engine (Week 3–4)

**Goal:** Users can place market, limit, and stop orders. Orders execute against real delayed prices. Positions are tracked with P&L calculations. WebSocket pushes real-time updates.

### Tasks

| # | Task | Effort | Depends On | Acceptance Criteria |
|---|------|--------|------------|-------------------|
| 2.1 | **Trading engine core** — Order validation (sufficient funds, valid symbol, quantity checks), market order execution (immediate fill at quote + slippage), position creation/update (average cost calculation), cash balance update | 2.5d | M1 | Market buy 10 AAPL → cash decreases, position appears with correct avg cost. Market sell → cash increases, realized P&L calculated |
| 2.2 | **Limit & stop orders** — Open order storage, `orderChecker` cron job (every 60s during market hours), price matching logic: limit buy fills when ask ≤ limit price, stop triggers when price crosses stop level, stop-limit two-phase trigger | 2d | 2.1 | Place limit buy AAPL @ $190 → status "open" → when quote drops to $190 → fills automatically, WebSocket notification sent |
| 2.3 | **Order lifecycle management** — Day order expiry (4 PM ET), GTC expiry (30 days), order cancellation, order history with all status transitions | 1d | 2.2 | Day orders expire at close, GTC persists, cancel returns funds/shares, history shows full lifecycle |
| 2.4 | **Position management** — Position list per portfolio, unrealized P&L (current price − avg cost × qty), realized P&L tracking, position close detection (qty → 0), cost basis recalculation on partial sells (FIFO) | 1.5d | 2.1 | Portfolio detail shows all positions with real-time unrealized P&L, selling half a position correctly recalculates remaining cost basis |
| 2.5 | **Transaction log** — Record every fill as a transaction, link to originating order, CSV export endpoint | 0.5d | 2.1 | `GET /trading/transactions?portfolioId=X&format=csv` downloads valid CSV with all trades |
| 2.6 | **WebSocket server** — ws setup, auth on connect (JWT), subscribe to price channels and portfolio channels, heartbeat ping/pong (30s), reconnection support, max 50 symbol subscriptions per client | 2d | M1 | Client subscribes to AAPL → receives price updates every 60s. Order fills trigger `order_filled` event. Portfolio value updates stream to client |
| 2.7 | **Price updater job** — Cron job: collect all symbols with active positions/watchlist → batch fetch quotes → update in-memory cache → broadcast via WebSocket → check pending orders | 1d | 2.2, 2.6 | During market hours, prices refresh every 60s. Clients get push updates without polling |
| 2.8 | **Frontend: Trading page** — Symbol search with autocomplete (debounced 300ms), real-time quote display (price, change, volume, day range), order form (type selector: market/limit/stop/stop-limit, quantity input, price inputs, buy/sell buttons), open orders list with cancel button | 2.5d | 2.1–2.7 | User searches "AAPL" → sees quote → places market buy → order fills → position appears in portfolio. Can place limit order → sees it in open orders → cancels it |
| 2.9 | **Frontend: Order history** — Order history table with status badges (filled=green, cancelled=grey, open=blue), filters by status/symbol/side, transaction log tab | 1d | 2.8 | Filter to "filled" orders only, click order to see transaction detail, export CSV button works |

**Total Effort:** ~14 days

### M2 Deliverables
- [x] Market order execution (buy/sell) with slippage simulation
- [x] Limit orders with automatic price matching
- [x] Stop orders with trigger logic
- [x] Stop-limit orders (two-phase)
- [x] Day and GTC order duration
- [x] Position tracking with unrealized + realized P&L
- [x] Transaction log with CSV export
- [x] WebSocket: real-time price updates, order fill notifications, portfolio value stream
- [x] Frontend: full trading page with search, quotes, order form, order history

### M2 Definition of Done
User places a limit buy for 10 AAPL @ $190 (GTC). Price is currently $195. User goes away. The next day, AAPL drops to $189.50. The order checker detects the price cross, fills the order at $190, creates a transaction, updates the portfolio cash balance and position, and the user sees an `order_filled` notification via WebSocket when they next open the app. The position shows correct unrealized P&L based on the latest price.

---

## Milestone 3: Strategy Builder + Backtesting (Week 5–6)

**Goal:** Users can create rule-based and code-based trading strategies, validate them, backtest against up to 5 years of historical data, and see results with equity curves and performance metrics.

### Tasks

| # | Task | Effort | Depends On | Acceptance Criteria |
|---|------|--------|------------|-------------------|
| 3.1 | **Strategy CRUD** — Create, list, get, update (version increment), delete strategies. Max 10 per user. Store rules config (JSON) or code (text) | 1d | M2 | All CRUD operations per API_SPEC.md §5. Version increments on update |
| 3.2 | **Rules engine** — Parse rules config JSON, evaluate conditions against market data (SMA, EMA, RSI, MACD, price, volume crossovers), emit buy/sell signals. Support AND/OR condition groups, `crosses_above`/`crosses_below` detection (requires 2-day lookback) | 2.5d | 3.1 | Rules config with "IF SMA(50) crosses_above SMA(200) THEN buy 10 AAPL" correctly detects golden cross in historical data and emits signal |
| 3.3 | **Technical indicators library** — Pure JS implementations: SMA, EMA, RSI, MACD (fast/slow/signal), ATR, Bollinger Bands (upper/lower), volume SMA. All take an array of OHLCV candles + period params | 1.5d | — | Unit tests: SMA([1,2,3,4,5], 3) = [2,3,4]. RSI matches known values for AAPL 2024 data within 0.1% tolerance |
| 3.4 | **Strategy sandbox (isolated-vm)** — Set up isolated-vm for code-based strategies, inject API: `getData()`, `getPosition()`, `getPortfolio()`, `buy()`, `sell()`. CPU limit 1s, memory 64MB, no network/FS access. Input sanitization (reject `require`, `import`, `process`, `eval` patterns) | 2d | 3.1 | User code `buy('AAPL', 10)` inside isolate → signal captured. Code with `require('fs')` → rejected. Infinite loop → killed at 1s timeout |
| 3.5 | **Strategy validation** — Syntax check (rules: JSON schema validation with zod; code: parse in isolate without executing), dry run against 5 days of data, report warnings (single-symbol strategy, excessive trades), mark strategy valid/invalid | 1d | 3.2, 3.4 | Invalid JSON config → validation error with specific field. Invalid JS syntax → line number + error message. Valid strategy → "valid" status + estimated signals |
| 3.6 | **Backtest engine (worker thread)** — Worker thread pool (2 threads), accept strategy + date range + starting capital. For each trading day: feed OHLCV to strategy → collect signals → simulate execution (with slippage) → update virtual portfolio → record daily value. Strict point-in-time: strategy only sees data up to current day. Max 30s timeout, max 5yr range, max 50 symbols | 3d | 3.2, 3.3, 3.4 | Backtest "buy AAPL on golden cross" from 2020–2024 → completes in <15s → equity curve has 1260 data points → total return reasonable (not >1000% for simple strategy) |
| 3.7 | **Backtest metrics calculation** — Calculate: total return, annualized return, max drawdown (peak-to-trough), Sharpe ratio (using 4% risk-free rate), Sortino ratio, win rate, profit factor, avg hold days, best/worst trade. Benchmark comparison (SPY buy-and-hold over same period) | 1d | 3.6 | Metrics match manual calculation within 0.1%. Sharpe = (annualized_return - 0.04) / annualized_std_dev. Drawdown correctly identifies worst peak-to-trough |
| 3.8 | **Historical data pipeline** — Bulk fetch + cache historical OHLCV for backtesting. Pre-fetch common symbols (SPY, QQQ, top 50 by market cap) on first deploy. Cache 5yr daily data per symbol in SQLite (market_data_cache), refresh daily after close | 1d | 1.6 | 5 years of AAPL daily data loads in <2s (from cache). Cache miss → fetch from Yahoo → store → serve |
| 3.9 | **Strategy attach/detach** — Attach a validated strategy to a portfolio for live paper-trading. Detach/pause without deleting. When attached, strategy runs on each price update cycle (every 60s) and can emit orders | 1d | 3.2, 3.4, M2 | Attach "Golden Cross" strategy to portfolio → next price update runs strategy → if conditions met, order auto-placed. Detach → strategy stops generating orders |
| 3.10 | **Frontend: Strategy Builder** — Two-mode editor: (a) Visual rules builder with dropdown selectors for indicator, comparison, target, action type. Add/remove rules, AND/OR toggle. (b) CodeMirror 6 code editor with JS syntax highlighting, line numbers, auto-indent. Validate button, save button, version history display | 2.5d | 3.1–3.5 | User creates rules strategy via dropdowns → saves → validates → sees "valid" badge. User writes JS code → syntax highlighted → validates → sees estimated signals |
| 3.11 | **Frontend: Backtest page** — Start backtest form (select strategy, date range, starting capital). Results view: equity curve (Chart.js line chart, blue = strategy, grey = SPY benchmark), metrics cards grid (Sharpe, max drawdown, CAGR, win rate, profit factor, total trades), trade log table (sortable, filterable by symbol/side, paginated) | 2d | 3.6, 3.7 | Run backtest → progress indicator → results load → equity curve renders smoothly with 1260+ points → metrics cards display correctly → trade log filterable |

**Total Effort:** ~18.5 days (ambitious — expect some overflow into M4 week 1)

### M3 Deliverables
- [x] Strategy CRUD (rules + code types)
- [x] Rules engine with 10 technical indicators
- [x] Sandbox execution for user-written JavaScript
- [x] Strategy validation (syntax + dry run)
- [x] Backtesting engine (worker threads, point-in-time enforcement)
- [x] Performance metrics (Sharpe, drawdown, win rate, etc.)
- [x] SPY benchmark comparison
- [x] Strategy attach to portfolio (live paper-trading automation)
- [x] Frontend: visual rules builder + code editor + backtest results page

### M3 Definition of Done
User creates a rules-based strategy: "IF RSI(14) < 30 for AAPL, THEN buy 20 shares. IF RSI(14) > 70 for AAPL, THEN sell all." User validates it (passes). User backtests it against 2022–2024 data with $100K starting capital. Results show: equity curve vs SPY, total return of ~15%, Sharpe of 0.8, max drawdown of -12%, win rate 55%, 47 total trades. User views the trade log, filters to sell trades only, sees realized P&L on each. User then attaches the strategy to their live portfolio.

---

## Milestone 4: Social & Contests (Week 7–8)

**Goal:** Users can create and join trading contests, compete on leaderboards, earn badges, and view public profiles.

### Tasks

| # | Task | Effort | Depends On | Acceptance Criteria |
|---|------|--------|------------|-------------------|
| 4.1 | **Contest CRUD** — Create contest (name, type, dates, rules, ranking metric, public/private), list contests (active/upcoming/completed), get detail, cancel | 1.5d | M2 | Create weekly contest starting next Monday → appears in "upcoming" list. Contest with invite_code only joinable with code |
| 4.2 | **Contest lifecycle manager** — Cron job: transition contests from `upcoming` → `active` on start_date, `active` → `completed` on end_date. On completion: calculate final rankings, assign badges (🥇🥈🥉), freeze contest portfolios | 1.5d | 4.1 | Contest auto-starts at configured time. On end: rankings calculated, top 3 get badges, portfolios frozen (no more trades) |
| 4.3 | **Contest join flow** — Join public/private contest, auto-create contest portfolio (fresh $100K), enforce max_participants, prevent duplicate joins, withdraw from contest | 1d | 4.1 | User joins "Weekly Sprint" → contest portfolio created → user can trade within contest portfolio → appears in standings |
| 4.4 | **Contest standings** — Live standings during active contests (hourly update), ranked by contest's `ranking_metric` (total_return or sharpe_ratio), show each participant's portfolio value, return %, rank | 1d | 4.2, 4.3 | During active contest, standings page shows all participants sorted by return. Updates hourly. Final standings frozen at contest end |
| 4.5 | **System-created contests** — Auto-create recurring contests: "Weekly Sprint" (Mon 9:30AM – Fri 4PM, total return), "Monthly Marathon" (1st–last trading day, Sharpe ratio). Cron job creates next week/month's contest on previous one's completion | 1d | 4.2 | System creates "Weekly Sprint — Jul 14–18" automatically. After it completes, "Weekly Sprint — Jul 21–25" is auto-created |
| 4.6 | **Leaderboard service** — Compute global leaderboards: all-time, monthly, weekly. Rank by total return across best-performing portfolio. Only include `is_public = 1` users. Hourly refresh via cron. Contest-specific leaderboards computed at contest end | 1.5d | M2 | `GET /leaderboard?period=weekly` returns ranked list with return %, Sharpe, total trades. Users with `isPublic: false` excluded |
| 4.7 | **Leaderboard snapshots** — Store hourly leaderboard state in `leaderboard_snapshots` table, serve latest snapshot from cache, clean up snapshots older than 30 days | 0.5d | 4.6 | Leaderboard loads from snapshot (fast), not computed on request. Old snapshots purged daily |
| 4.8 | **Public profiles** — `GET /users/:id/profile` returns display name, join date, achievement badges, contest history (placements), best portfolio return. Respects `is_public` flag | 1d | 4.6 | Click user on leaderboard → see profile with badges and contest placements. Private users return 404 |
| 4.9 | **Achievements system** — Award badges on triggers: first_trade, ten_trades, hundred_trades, first_strategy, first_backtest, first_contest, contest_gold/silver/bronze, ten_percent, hundred_percent, diversified (10+ positions), streak_5 (5 consecutive winners), early_adopter (registered in first month) | 1.5d | M2, M3, 4.2 | After 10th trade → `ten_trades` badge awarded → visible on profile and dashboard |
| 4.10 | **Frontend: Contests page** — Browse contests (tabs: Active, Upcoming, Past, My Contests). Contest card: name, type badge, dates, participant count, ranking metric, join button. Contest detail: rules display, live standings table, my position highlighted. Create contest modal (name, type, dates, rules, public/private toggle, invite link generator) | 2d | 4.1–4.5 | User browses active contests → clicks "Weekly Sprint" → sees standings → clicks "Join" → contest portfolio created → starts trading |
| 4.11 | **Frontend: Leaderboard page** — Global rankings table: rank, username (linked to profile), total return, Sharpe, total trades, best portfolio. Filter tabs: Weekly / Monthly / All-Time. Filter dropdown: by metric (return, Sharpe). User's own rank highlighted. Pagination (top 100) | 1.5d | 4.6 | Leaderboard loads with 100 entries, user sees own rank highlighted in blue, can toggle between weekly/monthly/all-time |
| 4.12 | **Frontend: Profile page** — Own profile: edit display name, toggle public/private, view achievements grid (earned badges glow, unearned greyed out), contest history table. Others' profiles: view-only with badges and contests | 1d | 4.8, 4.9 | User views own profile → edits display name → sees 5 earned badges. Clicks another user from leaderboard → sees their public profile |

**Total Effort:** ~15 days

### M4 Deliverables
- [x] Contest CRUD with public/private support
- [x] Automated contest lifecycle (upcoming → active → completed)
- [x] System-created weekly + monthly contests
- [x] Contest join + auto-portfolio creation
- [x] Live standings (hourly refresh)
- [x] Global leaderboards (weekly, monthly, all-time)
- [x] Public user profiles with achievements
- [x] 14 achievement badges with auto-awarding
- [x] Frontend: contests browser, contest detail + standings, create contest
- [x] Frontend: leaderboard with filters, public profiles

### M4 Definition of Done
System auto-creates "Weekly Sprint — Jul 21–25". 3 users join. Each trades throughout the week — placing orders, using strategies. Live standings update hourly showing rank by total return. On Friday at 4 PM ET, contest auto-completes: final rankings calculated, 1st place gets 🥇 badge (visible on their profile and the leaderboard). The next week's contest auto-creates. Global leaderboard reflects updated stats for all 3 users.

---

## Milestone 5: Polish & Production (Week 9–10)

**Goal:** Analytics dashboard with charts, mobile responsiveness, performance optimization, error handling hardening, deployment automation, and final QA.

### Tasks

| # | Task | Effort | Depends On | Acceptance Criteria |
|---|------|--------|------------|-------------------|
| 5.1 | **Analytics service** — Portfolio performance chart data (daily snapshots → equity curve), P&L breakdown by holding (realized + unrealized), sector allocation pie data, aggregate stats (total trades, win rate, avg hold time, best/worst trade) | 1.5d | M2 | `GET /analytics/portfolio/:id` returns chart data, P&L breakdown, sector allocation, and aggregate stats |
| 5.2 | **Portfolio daily snapshots** — Cron job: at 4:30 PM ET, snapshot every active portfolio (total value, cash, holdings, day return, total return, position count). Powers equity curves and historical performance charts | 1d | 5.1 | After market close, each portfolio has a new snapshot row. Equity curve endpoint returns array of {date, value} for any portfolio |
| 5.3 | **Frontend: Analytics dashboard** — Portfolio performance line chart (Chart.js, daily values, tooltips with date + value), P&L breakdown table (per symbol: qty, avg cost, current price, unrealized, realized), sector allocation donut chart, stats cards (total trades, win rate, avg hold time, best/worst trade) | 2.5d | 5.1, 5.2 | Dashboard renders equity curve with 90+ days of data smoothly. Pie chart shows sector allocation. Stats cards show correct aggregates |
| 5.4 | **Mobile responsive pass** — All pages: dashboard, trading, strategy builder, backtest, contests, leaderboard, profile. Breakpoints: 480px (phone), 768px (tablet), 1024px (desktop). Collapsible sidebar/navbar, stacked cards, horizontal scroll for tables, touch-friendly order form | 2d | M1–M4 | All pages usable on iPhone 14 (390px) and iPad (768px). Order form submits correctly on mobile. Tables horizontally scrollable. No overflow/cut-off |
| 5.5 | **Dark/light theme refinement** — Ensure all components respect CSS custom properties. Test: charts, code editor (CodeMirror theme), tables, forms, modals, badges, toasts. Smooth toggle transition (0.2s). Persist preference in localStorage | 1d | M1–M4 | Toggle theme → all elements transition smoothly, no white flashes. Charts re-render with new color scheme. Preference persists across sessions |
| 5.6 | **Error handling hardening** — Client: global fetch error handler, retry logic (1 retry on 5xx), user-friendly error toasts, offline detection banner. Server: structured error logging (Pino), unhandled rejection catching, graceful shutdown (close DB, drain WebSockets) | 1d | M1–M4 | Server crash → PM2 restarts → clients auto-reconnect WebSocket. API 500 → user sees "Something went wrong" toast, not raw error. Offline → "You're offline" banner |
| 5.7 | **Performance optimization** — Lazy-load pages via dynamic import, debounce expensive operations, virtual scrolling for trade log (>1000 rows), compress API responses (gzip), optimize SQLite queries (EXPLAIN ANALYZE on hot paths), add composite indexes where needed | 1.5d | M1–M4 | Dashboard page loads <200KB (excluding CDN libs). Trade log with 5000 entries scrolls at 60fps. API response time p95 < 200ms for portfolio endpoints |
| 5.8 | **Educational disclaimer system** — Persistent banner on every page: "⚠️ This is a simulation for educational purposes only. Not financial advice. Past performance does not indicate future results." Dismissable per session but returns on page change. Accept terms modal on first login | 1d | M1 | Disclaimer visible on every page load. First-time user must accept terms before trading. Cannot be permanently hidden |
| 5.9 | **Deployment automation** — Shell scripts: `deploy-frontend.sh` (S3 sync + CloudFront invalidation), `deploy-backend.sh` (SSH, git pull, npm ci, migrate, PM2 restart). Backup script: `backup-db.sh` (copy trading.db with timestamp). Add to existing crontab for daily DB backup | 1d | M1 | `./deploy-frontend.sh` deploys in <30s. `./deploy-backend.sh` deploys with zero downtime. DB backup runs daily at 2 AM ET |
| 5.10 | **Monitoring & alerts** — Health check endpoint enrichment (DB size, cache hit rate, WebSocket count, backtest queue depth). Simple uptime check: cron on local machine hits `/api/v1/health` every 5 min, alerts on failure | 0.5d | M1 | Health endpoint returns all metrics. Uptime check logs status. If server unreachable → log alert (email/Telegram notification is stretch goal) |
| 5.11 | **End-to-end QA & bug bash** — Test all user flows end-to-end: register → create portfolio → trade → create strategy → backtest → join contest → view leaderboard. Test edge cases: insufficient funds, cancel filled order, expired tokens, concurrent orders, backtest timeout | 2d | All | All happy paths work. Edge cases return appropriate errors. No console errors in browser. No unhandled server crashes |
| 5.12 | **Documentation** — README.md (setup instructions, environment variables, deployment), inline code comments on complex logic (trading engine, backtest engine, sandbox), update spec docs with any deviations from plan | 1d | All | New developer can clone repo, follow README, and run locally in <15 minutes |

**Total Effort:** ~16 days

### M5 Deliverables
- [x] Analytics dashboard with equity curves, P&L breakdown, sector allocation, stats
- [x] Daily portfolio snapshots (automated)
- [x] Fully responsive on mobile (480px, 768px, 1024px breakpoints)
- [x] Dark/light theme polished across all components
- [x] Error handling: retry, toasts, offline detection, graceful shutdown
- [x] Performance: lazy loading, virtual scrolling, gzip, query optimization
- [x] Educational disclaimer on every page
- [x] Deployment scripts (frontend + backend + DB backup)
- [x] Health monitoring
- [x] Full QA pass
- [x] Developer documentation

### M5 Definition of Done
A new user on an iPhone opens gary-yong.com/trading. They see the educational disclaimer, register, create a portfolio, search for and buy 10 shares of AAPL (the order form is touch-friendly). They visit the analytics dashboard, see their portfolio's equity curve (flat for now — just started), and check the leaderboard. They toggle to dark mode. The page loads in under 2 seconds on 4G. The deployment ran via `./deploy-frontend.sh` in under 30 seconds.

---

## v1 "Shipped" Definition

**All of the following must be true:**

| Category | Criterion |
|----------|-----------|
| **Auth** | Users can register, login, refresh tokens, update profile, delete account |
| **Portfolios** | Create up to 5 portfolios, $100K default, reset to initial state |
| **Trading** | Market/limit/stop/stop-limit orders execute correctly with slippage |
| **Positions** | Unrealized + realized P&L accurate, cost basis correct on partial sells |
| **Market Data** | US equities + ETFs searchable, quotes within 15min delay, 5yr historical available |
| **Strategies** | Rules-based (10 indicators) + code-based (sandboxed JS) creation and validation |
| **Backtesting** | Run against 1–5yr data, equity curve, Sharpe/drawdown/win rate/profit factor, SPY benchmark |
| **Contests** | System-created weekly + monthly, user-created custom, join, live standings, badges |
| **Leaderboards** | Global (weekly/monthly/all-time), contest-specific, filterable |
| **Analytics** | Equity curve chart, P&L breakdown, sector allocation, trade stats |
| **UX** | Mobile responsive (480px+), dark/light theme, <2s page load, educational disclaimer |
| **Deployment** | Running on EC2, frontend on S3/CloudFront, automated deploy scripts, daily DB backup |
| **Quality** | No critical bugs, all happy paths tested, error handling in place |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **Yahoo Finance API breaks** (unofficial, no SLA) | High — no market data | Medium | Alpha Vantage + Polygon.io fallbacks already built in M1. Can add FinnHub as 4th source |
| **SQLite write contention** under load | Medium — slow trades | Low (v1 scale is small) | WAL mode + busy timeout. PostgreSQL migration path documented in ARCHITECTURE.md |
| **isolated-vm security escape** | Critical — server compromise | Very Low | Keep isolated-vm updated, test with adversarial payloads in M3, add process-level sandboxing as defense-in-depth |
| **M3 scope overflow** (strategy + backtest is largest milestone) | Medium — delays M4/M5 | Medium | Start technical indicators (3.3) in M2 as a parallel task. Cut Sortino ratio and advanced metrics if behind |
| **Market data API rate limits** (Alpha Vantage: 25/day free tier) | Low — fallback degradation | Medium | Primary source is Yahoo (no published limits). Cache aggressively. Upgrade AV to $50/mo if needed |
| **WebSocket scalability** at contest peaks | Low — dropped connections | Low | Max 200 concurrent WS in v1. Add connection pooling if needed |

---

## Week-by-Week Timeline

```
Week  1: M1 Tasks 1.1–1.6 (backend foundation)
Week  2: M1 Tasks 1.7–1.10 (frontend shell + deployment)
Week  3: M2 Tasks 2.1–2.5 (trading engine backend)
Week  4: M2 Tasks 2.6–2.9 (WebSocket + trading frontend)
Week  5: M3 Tasks 3.1–3.5 (strategies + sandbox + indicators)
Week  6: M3 Tasks 3.6–3.11 (backtest engine + frontend)
Week  7: M4 Tasks 4.1–4.5 (contests backend)
Week  8: M4 Tasks 4.6–4.12 (leaderboards + social frontend)
Week  9: M5 Tasks 5.1–5.6 (analytics + mobile + hardening)
Week 10: M5 Tasks 5.7–5.12 (optimization + deploy + QA)
```

---

## Post-v1 Prioritized Backlog

If v1 ships early or there's momentum, these are ordered by impact/effort:

1. **Portfolio clone** (0.5d) — Low effort, useful for experimentation
2. **Side-by-side backtest comparison** (1d) — High value for strategy tinkerers
3. **Strategy sharing** (2d) — Share strategy configs via URL (read-only)
4. **Price alerts** (1d) — Trigger watchlist alerts via WebSocket notification
5. **Advanced order types** (2d) — Trailing stop, bracket orders
6. **Options simulation** (5d+) — Begins v2 scope
