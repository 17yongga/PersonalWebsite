# Technical Architecture: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2025-07-10  

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Trading UI   │  │  Strategy    │  │  Analytics Dashboard     │  │
│  │  (Vanilla JS) │  │  Builder     │  │  (Charts.js / D3)        │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘  │
│         │                  │                      │                  │
│  ┌──────┴──────────────────┴──────────────────────┴───────────────┐ │
│  │                    App Shell (SPA Router)                       │ │
│  │              Vanilla JS Module Pattern + ES Modules             │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                    HTTPS + WSS (api.gary-yong.com)
                              │
┌─────────────────────────────┼───────────────────────────────────────┐
│                     NGINX REVERSE PROXY                             │
│              api.gary-yong.com → localhost:3002                     │
│              (existing: casino → localhost:3001)                    │
│              SSL: Let's Encrypt (auto-renew)                       │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────┐
│                    EC2 INSTANCE (52.86.178.139)                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Trading Server (Node.js + Express)              │   │
│  │                     PM2: trading-server                       │   │
│  │                     Port: 3002                                │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │   │
│  │  │  REST API    │  │  WebSocket   │  │  Background Jobs   │  │   │
│  │  │  /api/v1/*   │  │  Server      │  │  (node-cron)       │  │   │
│  │  │              │  │  (ws)        │  │                    │  │   │
│  │  │  - Auth      │  │  - Prices    │  │  - Order checker   │  │   │
│  │  │  - Portfolio  │  │  - Portfolio │  │  - Contest mgmt    │  │   │
│  │  │  - Trading   │  │    updates   │  │  - Data cache      │  │   │
│  │  │  - Strategy  │  │  - Alerts    │  │  - Leaderboard     │  │   │
│  │  │  - Backtest  │  │              │  │    refresh         │  │   │
│  │  │  - Contest   │  │              │  │                    │  │   │
│  │  │  - Analytics │  │              │  │                    │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────────────┘  │   │
│  │                                                               │   │
│  │  ┌─────────────────────┐  ┌────────────────────────────────┐ │   │
│  │  │  Strategy Sandbox   │  │  Backtest Engine               │ │   │
│  │  │  (isolated-vm)      │  │  (Worker Threads)              │ │   │
│  │  │  - CPU: 1s limit    │  │  - Historical data replay      │ │   │
│  │  │  - Mem: 64MB limit  │  │  - Point-in-time enforcement   │ │   │
│  │  │  - No network/FS    │  │  - Parallel execution          │ │   │
│  │  └─────────────────────┘  └────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SQLite Database                            │   │
│  │                    /data/trading/trading.db                   │   │
│  │                    WAL mode, 10s busy timeout                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Existing Services (unchanged)                    │   │
│  │              PM2: casino-server (port 3001)                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                                 │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │  Yahoo Finance    │  │  Alpha Vantage    │  │  Polygon.io     │  │
│  │  (unofficial API) │  │  (free tier)      │  │  (free tier)    │  │
│  │  Primary source   │  │  Fallback source  │  │  Historical     │  │
│  │  Quotes, search   │  │  Quotes, intraday │  │  data backup    │  │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘  │
│                                                                     │
│  ┌──────────────────┐                                              │
│  │  S3 + CloudFront │                                              │
│  │  Static frontend │                                              │
│  │  gary-yong.com/  │                                              │
│  │    trading/      │                                              │
│  └──────────────────┘                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Architecture

### 2.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | Vanilla JavaScript (ES2022+) | Consistent with existing site, no build step |
| Modules | ES Modules (`import`/`export`) | Native browser support, no bundler needed |
| Routing | Hash-based SPA router (`#/dashboard`, `#/trade`) | Simple, no server config needed for S3 |
| Charting | Chart.js 4.x (CDN) | Lightweight, canvas-based, good for equity curves |
| Code Editor | CodeMirror 6 (CDN) | Syntax highlighting for strategy code editor |
| Styling | CSS Custom Properties + BEM | Themeable (dark/light), maintainable |
| HTTP | `fetch` API with wrapper module | Native, no dependencies |
| WebSocket | Native `WebSocket` API | Real-time price and portfolio updates |
| State | Simple pub/sub store (custom) | Lightweight state management without framework |

### 2.2 File Structure

```
trading/
├── index.html                    # App shell, loads modules
├── css/
│   ├── variables.css             # CSS custom properties (colors, spacing)
│   ├── base.css                  # Reset, typography, layout
│   ├── components.css            # Buttons, cards, forms, tables
│   ├── dashboard.css             # Dashboard-specific styles
│   ├── trading.css               # Trading page styles
│   ├── strategy.css              # Strategy builder styles
│   ├── backtest.css              # Backtest results styles
│   └── contest.css               # Contest & leaderboard styles
├── js/
│   ├── app.js                    # Entry point, router init
│   ├── router.js                 # Hash-based SPA router
│   ├── store.js                  # Pub/sub state management
│   ├── api.js                    # API client (fetch wrapper + auth)
│   ├── ws.js                     # WebSocket client
│   ├── auth.js                   # Auth module (login, register, token mgmt)
│   ├── utils.js                  # Formatting, validation helpers
│   ├── pages/
│   │   ├── dashboard.js          # Dashboard page component
│   │   ├── trading.js            # Trading page component
│   │   ├── strategy-builder.js   # Strategy builder component
│   │   ├── backtest.js           # Backtest results component
│   │   ├── contests.js           # Contests & leagues component
│   │   ├── leaderboard.js        # Leaderboard component
│   │   ├── profile.js            # User profile / settings
│   │   └── login.js              # Login / register page
│   ├── components/
│   │   ├── navbar.js             # Navigation bar
│   │   ├── portfolio-card.js     # Portfolio summary card
│   │   ├── order-form.js         # Order entry form
│   │   ├── symbol-search.js      # Ticker search autocomplete
│   │   ├── equity-chart.js       # Equity curve chart wrapper
│   │   ├── metrics-table.js      # Performance metrics display
│   │   ├── trade-log.js          # Trade history table
│   │   ├── rules-editor.js       # Visual strategy rules editor
│   │   ├── code-editor.js        # CodeMirror wrapper
│   │   ├── toast.js              # Notification toasts
│   │   └── modal.js              # Modal dialog
│   └── workers/
│       └── backtest-worker.js    # Web Worker for client-side backtest display processing
├── assets/
│   ├── icons/                    # SVG icons
│   └── sounds/                   # Trade execution sounds (optional)
└── manifest.json                 # PWA manifest (optional)
```

### 2.3 Module Pattern

Each page/component follows the same pattern:

```javascript
// js/pages/dashboard.js
export function DashboardPage() {
  const state = {
    portfolios: [],
    watchlist: [],
    recentTrades: [],
  };

  function render(container) {
    container.innerHTML = template(state);
    bindEvents(container);
    loadData();
  }

  function template(data) {
    return `
      <div class="dashboard">
        <section class="dashboard__portfolios">
          ${data.portfolios.map(p => PortfolioCard(p)).join('')}
        </section>
        <!-- ... -->
      </div>
    `;
  }

  async function loadData() {
    state.portfolios = await api.get('/portfolios');
    state.watchlist = await api.get('/watchlist');
    rerender();
  }

  function bindEvents(container) {
    container.querySelector('.btn-new-portfolio')
      ?.addEventListener('click', handleNewPortfolio);
  }

  function destroy() {
    // Cleanup subscriptions, intervals
  }

  return { render, destroy };
}
```

### 2.4 SPA Router

```javascript
// js/router.js
const routes = {
  '/':           () => import('./pages/dashboard.js').then(m => m.DashboardPage()),
  '/trade':      () => import('./pages/trading.js').then(m => m.TradingPage()),
  '/trade/:id':  () => import('./pages/trading.js').then(m => m.TradingPage()),
  '/strategies': () => import('./pages/strategy-builder.js').then(m => m.StrategyPage()),
  '/backtest':   () => import('./pages/backtest.js').then(m => m.BacktestPage()),
  '/contests':   () => import('./pages/contests.js').then(m => m.ContestsPage()),
  '/leaderboard':() => import('./pages/leaderboard.js').then(m => m.LeaderboardPage()),
  '/profile':    () => import('./pages/profile.js').then(m => m.ProfilePage()),
  '/login':      () => import('./pages/login.js').then(m => m.LoginPage()),
};
```

---

## 3. Backend Architecture

### 3.1 Technology Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Runtime | Node.js | 20 LTS | Already on EC2, stable |
| Framework | Express.js | 4.x | Lightweight, well-known |
| Database | better-sqlite3 | 11.x | Synchronous SQLite driver, fast, no async overhead |
| Auth | jsonwebtoken + bcryptjs | Latest | JWT tokens, password hashing |
| WebSocket | ws | 8.x | Lightweight WebSocket server |
| Sandbox | isolated-vm | 4.x | Secure JS execution for user strategies |
| Scheduler | node-cron | 3.x | Background jobs (order checker, data refresh) |
| Validation | zod | 3.x | Schema validation for API inputs |
| Rate Limiting | express-rate-limit | 7.x | Per-IP and per-user rate limits |
| Logging | pino | 8.x | Fast structured logging |
| Process Mgr | PM2 | 5.x | Already deployed, auto-restart |

### 3.2 Server File Structure

```
trading-server/
├── package.json
├── ecosystem.config.js           # PM2 config
├── src/
│   ├── index.js                  # Entry point, Express app setup
│   ├── config.js                 # Environment config (port, DB path, API keys)
│   ├── db/
│   │   ├── connection.js         # SQLite connection (WAL mode)
│   │   ├── migrations/           # Schema migration files (versioned)
│   │   │   ├── 001_initial.sql
│   │   │   ├── 002_contests.sql
│   │   │   └── ...
│   │   └── migrate.js            # Migration runner
│   ├── middleware/
│   │   ├── auth.js               # JWT verification middleware
│   │   ├── validate.js           # Zod schema validation middleware
│   │   ├── rateLimit.js          # Rate limiting config
│   │   ├── errorHandler.js       # Global error handler
│   │   └── cors.js               # CORS config
│   ├── routes/
│   │   ├── auth.js               # POST /register, /login, /refresh, /logout
│   │   ├── portfolios.js         # CRUD /portfolios
│   │   ├── trading.js            # POST /orders, DELETE /orders/:id
│   │   ├── market.js             # GET /quotes, /historical, /search
│   │   ├── strategies.js         # CRUD /strategies, POST /validate
│   │   ├── backtests.js          # POST /backtests, GET /backtests/:id
│   │   ├── contests.js           # CRUD /contests, POST /join
│   │   └── analytics.js          # GET /analytics/portfolio/:id
│   ├── services/
│   │   ├── tradingEngine.js      # Order matching & execution logic
│   │   ├── marketData.js         # Yahoo Finance / Alpha Vantage client
│   │   ├── backtestEngine.js     # Historical replay engine
│   │   ├── strategySandbox.js    # isolated-vm execution environment
│   │   ├── contestManager.js     # Contest lifecycle management
│   │   ├── leaderboardService.js # Leaderboard computation
│   │   └── analyticsService.js   # Portfolio analytics computation
│   ├── jobs/
│   │   ├── orderChecker.js       # Check pending limit/stop orders (every 60s)
│   │   ├── priceUpdater.js       # Refresh cached quotes (every 60s)
│   │   ├── contestLifecycle.js   # Start/end contests on schedule
│   │   └── leaderboardRefresh.js # Recompute leaderboards (every hour)
│   ├── ws/
│   │   ├── server.js             # WebSocket server setup
│   │   ├── priceStream.js        # Broadcast price updates to subscribers
│   │   └── portfolioStream.js    # Broadcast portfolio value updates
│   └── utils/
│       ├── logger.js             # Pino logger instance
│       ├── errors.js             # Custom error classes
│       └── formatters.js         # Number/date formatting
├── data/
│   └── trading.db                # SQLite database file
├── logs/
│   └── trading.log               # Log file (rotated by PM2)
└── tests/
    ├── unit/
    └── integration/
```

### 3.3 Express App Setup

```javascript
// src/index.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { runMigrations } from './db/migrate.js';
import { startJobs } from './jobs/index.js';
import { setupWebSocket } from './ws/server.js';

// Routes
import authRoutes from './routes/auth.js';
import portfolioRoutes from './routes/portfolios.js';
import tradingRoutes from './routes/trading.js';
import marketRoutes from './routes/market.js';
import strategyRoutes from './routes/strategies.js';
import backtestRoutes from './routes/backtests.js';
import contestRoutes from './routes/contests.js';
import analyticsRoutes from './routes/analytics.js';

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors);
app.use(express.json({ limit: '1mb' }));

// API routes (versioned)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/portfolios', portfolioRoutes);
app.use('/api/v1/trading', tradingRoutes);
app.use('/api/v1/market', marketRoutes);
app.use('/api/v1/strategies', strategyRoutes);
app.use('/api/v1/backtests', backtestRoutes);
app.use('/api/v1/contests', contestRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// Error handler
app.use(errorHandler);

// Database migrations
runMigrations();

// WebSocket
setupWebSocket(server);

// Background jobs
startJobs();

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Trading server running on port ${PORT}`);
});
```

---

## 4. Database (SQLite → PostgreSQL Path)

### 4.1 Why SQLite for v1

- **Zero infrastructure:** No database server to install/manage/monitor.
- **Single file:** Easy backup (`cp trading.db trading.db.bak`).
- **Fast reads:** Excellent read performance for our workload.
- **WAL mode:** Concurrent reads during writes, perfect for our scale.
- **Sufficient for v1:** SQLite handles thousands of users comfortably.

### 4.2 Limitations & PostgreSQL Migration Triggers

Migrate to PostgreSQL when ANY of these occur:
- **Write contention:** >50 concurrent write requests/second
- **Database size:** >5GB (SQLite performance degrades)
- **User count:** >5,000 registered users
- **Need for:** Full-text search, JSONB queries, connection pooling, replication

### 4.3 Migration Strategy

1. Use an abstraction layer (`db/connection.js`) that wraps `better-sqlite3` with a consistent interface.
2. Write all queries using standard SQL compatible with both SQLite and PostgreSQL.
3. Avoid SQLite-specific features (e.g., `AUTOINCREMENT` — use `INTEGER PRIMARY KEY` which auto-increments in SQLite and maps to `SERIAL` in PG).
4. When migrating: swap `better-sqlite3` for `pg` (node-postgres), update connection module, run schema migration with type adjustments (`TEXT` → `VARCHAR`, `INTEGER` → `BIGINT` where needed).

---

## 5. Market Data Architecture

### 5.1 Data Source Hierarchy (Failover Chain)

```
Primary:    Yahoo Finance (unofficial yfinance API)
            ├── Quotes (delayed 15min)
            ├── Historical daily OHLCV
            └── Symbol search / company info

Fallback 1: Alpha Vantage (free tier: 25 calls/day)
            ├── Quotes
            └── Intraday data

Fallback 2: Polygon.io (free tier: 5 calls/min)
            ├── Historical data
            └── Symbol details
```

### 5.2 Caching Strategy

```
┌──────────────────────────────────────────────┐
│               Market Data Cache               │
│                                                │
│  ┌─────────────────────────────────────────┐  │
│  │  In-Memory Cache (Map)                   │  │
│  │  - Current quotes: TTL 60 seconds        │  │
│  │  - Symbol search results: TTL 1 hour     │  │
│  └─────────────────────────────────────────┘  │
│                                                │
│  ┌─────────────────────────────────────────┐  │
│  │  SQLite Cache (market_data_cache table)   │  │
│  │  - Historical OHLCV: TTL 24 hours        │  │
│  │  - Company info: TTL 7 days              │  │
│  │  - End-of-day prices: TTL until next day │  │
│  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 5.3 Quote Refresh Pipeline

```
Every 60 seconds (market hours only: 9:30 AM - 4:00 PM ET, Mon-Fri):

1. Collect all symbols with active positions or watchlist entries
2. Batch into groups of 10 (Yahoo Finance supports batch quotes)
3. Fetch quotes from primary source
4. On failure: try fallback sources
5. Update in-memory cache
6. Broadcast updated prices via WebSocket to subscribed clients
7. Check pending limit/stop orders against new prices
8. Execute any triggered orders
```

---

## 6. Real-Time Architecture (WebSocket)

### 6.1 WebSocket Protocol

```javascript
// Client → Server messages
{ type: 'subscribe', channel: 'prices', symbols: ['AAPL', 'GOOGL', 'SPY'] }
{ type: 'subscribe', channel: 'portfolio', portfolioId: 'uuid-here' }
{ type: 'unsubscribe', channel: 'prices', symbols: ['AAPL'] }
{ type: 'ping' }

// Server → Client messages
{ type: 'price_update', data: { symbol: 'AAPL', price: 195.42, change: 1.23, changePercent: 0.63, volume: 54321000, timestamp: 1720627200 } }
{ type: 'portfolio_update', data: { portfolioId: 'uuid', totalValue: 102345.67, dayChange: 456.78, dayChangePercent: 0.45 } }
{ type: 'order_filled', data: { orderId: 'uuid', symbol: 'AAPL', qty: 10, price: 195.42, side: 'buy' } }
{ type: 'alert', data: { message: 'Your limit order for AAPL filled at $195.42' } }
{ type: 'pong' }
```

### 6.2 Connection Management

- **Heartbeat:** Client sends `ping` every 30 seconds; server responds with `pong`.
- **Reconnection:** Client auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, max 30s).
- **Authentication:** First message after connect must be `{ type: 'auth', token: 'jwt-token' }`.
- **Max subscriptions:** 50 symbols per client, 3 portfolio streams per client.

---

## 7. Authentication Architecture

### 7.1 Token Flow

```
┌─────────┐          ┌─────────────┐          ┌──────────┐
│ Browser  │          │  API Server │          │ Database │
└────┬─────┘          └──────┬──────┘          └─────┬────┘
     │                       │                       │
     │  POST /auth/register  │                       │
     │  {email, password,    │                       │
     │   displayName}        │                       │
     │──────────────────────>│                       │
     │                       │  INSERT user           │
     │                       │  (bcrypt hash)         │
     │                       │──────────────────────>│
     │                       │                       │
     │  { accessToken,       │                       │
     │    refreshToken }     │                       │
     │<──────────────────────│                       │
     │                       │                       │
     │  GET /portfolios      │                       │
     │  Authorization:       │                       │
     │  Bearer <accessToken> │                       │
     │──────────────────────>│                       │
     │                       │  Verify JWT            │
     │                       │  Query portfolios      │
     │                       │──────────────────────>│
     │                       │                       │
     │  { portfolios: [...] }│                       │
     │<──────────────────────│                       │
     │                       │                       │
     │  POST /auth/refresh   │                       │
     │  { refreshToken }     │                       │
     │──────────────────────>│                       │
     │                       │  Verify refresh token  │
     │                       │  Issue new pair         │
     │                       │──────────────────────>│
     │  { accessToken,       │                       │
     │    refreshToken }     │                       │
     │<──────────────────────│                       │
```

### 7.2 Token Configuration

| Parameter | Value |
|-----------|-------|
| Access token TTL | 15 minutes |
| Refresh token TTL | 7 days |
| Algorithm | HS256 |
| Password hash | bcrypt, cost factor 12 |
| Refresh token storage | Database (hashed, one per user) |
| Token rotation | New refresh token on each refresh |
| Login rate limit | 5 attempts per IP per 15 minutes |
| Registration rate limit | 3 accounts per IP per hour |

---

## 8. Backtest Engine Architecture

### 8.1 Execution Model

```
┌─────────────────────────────────────────────────────┐
│                  Backtest Request                     │
│  { strategyId, startDate, endDate, startingCapital } │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│              Backtest Engine (Worker Thread)           │
│                                                        │
│  1. Load strategy config/code                          │
│  2. Fetch historical data for all relevant symbols     │
│  3. Initialize virtual portfolio                       │
│  4. For each trading day in [startDate, endDate]:      │
│     a. Feed day's OHLCV data to strategy               │
│     b. Strategy emits signals (buy/sell)                │
│     c. Execute signals against day's prices             │
│     d. Record portfolio value, trades, positions        │
│     e. ⚠️ Strategy sees ONLY data up to current day    │
│  5. Calculate metrics                                   │
│  6. Return results                                      │
│                                                        │
│  Constraints:                                          │
│  - Max execution time: 30 seconds                      │
│  - Max symbols: 50 per strategy                        │
│  - Max period: 5 years                                 │
│  - No future data leakage (enforced by data windowing) │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│                 Backtest Results                       │
│                                                        │
│  { equityCurve: [{date, value}, ...],                 │
│    totalReturn: 0.234,                                │
│    annualizedReturn: 0.112,                           │
│    maxDrawdown: -0.156,                               │
│    sharpeRatio: 1.42,                                 │
│    winRate: 0.58,                                     │
│    profitFactor: 1.87,                                │
│    totalTrades: 142,                                  │
│    trades: [{date, symbol, side, qty, price}, ...],   │
│    benchmark: {spyReturn: 0.198, ...}  }              │
└──────────────────────────────────────────────────────┘
```

### 8.2 Worker Thread Pool

- **Pool size:** 2 worker threads (EC2 t3.micro has 2 vCPUs).
- **Queue:** Pending backtests queue with FIFO processing.
- **Timeout:** 30 seconds per backtest. Killed if exceeded.
- **Concurrency limit:** 1 active backtest per user. Queue up to 3.

---

## 9. Strategy Sandbox Architecture

### 9.1 isolated-vm Configuration

```javascript
const ivm = require('isolated-vm');

const isolate = new ivm.Isolate({ memoryLimit: 64 }); // 64MB
const context = isolate.createContextSync();

// Inject read-only market data API
context.global.setSync('getData', new ivm.Reference((symbol, period) => {
  // Returns historical data up to current simulation date
  // NO future data access
}));

context.global.setSync('getPosition', new ivm.Reference((symbol) => {
  // Returns current position for symbol
}));

context.global.setSync('buy', new ivm.Reference((symbol, qty) => {
  // Queues a buy signal
}));

context.global.setSync('sell', new ivm.Reference((symbol, qty) => {
  // Queues a sell signal
}));

// Execute user code with timeout
const script = isolate.compileScriptSync(userCode);
script.runSync(context, { timeout: 1000 }); // 1 second CPU time limit
```

### 9.2 Security Layers

1. **isolated-vm:** V8 isolate — separate heap, no access to Node.js APIs.
2. **CPU limit:** 1 second per execution tick.
3. **Memory limit:** 64MB per isolate.
4. **No globals:** `require`, `import`, `process`, `fs`, `fetch`, etc. are unavailable.
5. **Input sanitization:** Strategy code is parsed and checked for prohibited patterns before execution.
6. **Output validation:** Signals emitted by strategy are validated (valid symbols, reasonable quantities).

---

## 10. Deployment Architecture

### 10.1 Frontend Deployment

```bash
# Build (no build step needed — vanilla JS)
# Just sync to S3

cd PersonalWebsite
aws s3 sync trading/ s3://gary-yong.com/trading/ \
  --profile clawdbot-deploy \
  --cache-control "public, max-age=3600" \
  --exclude "*.map"

# Cache bust
aws cloudfront create-invalidation \
  --distribution-id EUVZ94LCG1QV2 \
  --paths "/trading/*" \
  --profile clawdbot-deploy
```

### 10.2 Backend Deployment

```bash
# SSH into EC2
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519

# Pull latest code (or scp)
cd /home/ubuntu/trading-server
git pull origin main  # or: scp from local

# Install dependencies
npm ci --production

# Run migrations
node src/db/migrate.js

# Restart via PM2
pm2 restart trading-server
# or first time:
pm2 start ecosystem.config.js
pm2 save
```

### 10.3 PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'trading-server',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    node_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
      PORT: 3002,
      DB_PATH: '/home/ubuntu/trading-server/data/trading.db',
      JWT_SECRET: 'CHANGE_ME_IN_PRODUCTION',
      ALPHA_VANTAGE_KEY: 'YOUR_KEY_HERE',
      POLYGON_KEY: 'YOUR_KEY_HERE',
    },
    max_memory_restart: '512M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
  }]
};
```

### 10.4 Nginx Configuration Addition

```nginx
# Add to existing nginx config for api.gary-yong.com

# Trading server
location /api/v1/ {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;  # WebSocket long-lived connections
}

# Trading WebSocket
location /ws/trading {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;
}
```

### 10.5 Nginx Routing Consideration

Since the casino server already uses `api.gary-yong.com` routing to port 3001, we have two options:

**Option A (Recommended): Path-based routing**
```nginx
# Existing casino routes stay as-is (they use specific paths)
# Trading gets /api/v1/ prefix — no conflict if casino uses different paths

location /api/v1/ {
    proxy_pass http://localhost:3002;
    # ... headers
}
```

**Option B: Subdomain**
```nginx
# trading-api.gary-yong.com → localhost:3002
# Requires new DNS record + SSL cert
```

Option A is simpler — the casino API likely uses `/api/casino/` or similar prefixed paths, so `/api/v1/` for trading won't conflict.

---

## 11. Monitoring & Observability

### 11.1 Logging

- **Structured JSON logging** via Pino.
- **Log levels:** `error`, `warn`, `info`, `debug`.
- **Production level:** `info` (no debug in prod).
- **Log rotation:** PM2 handles rotation (10MB max file, 5 files retained).

### 11.2 Health Check

```
GET /api/v1/health

Response:
{
  "status": "ok",
  "uptime": 86400,
  "dbStatus": "connected",
  "marketDataStatus": "connected",
  "activeWebSockets": 12,
  "pendingOrders": 5,
  "version": "1.0.0"
}
```

### 11.3 Key Metrics to Track

| Metric | Method |
|--------|--------|
| API response times | Pino request logging (middleware) |
| Error rates | PM2 error logs + structured error logging |
| Active WebSocket connections | In-memory counter, exposed via health endpoint |
| Database size | Periodic check in background job |
| Market data API usage | Counter per provider, logged hourly |
| Backtest queue depth | In-memory counter, exposed via health endpoint |

---

## 12. Performance Considerations

### 12.1 Frontend
- **Lazy loading:** Pages loaded via dynamic `import()` — only dashboard JS loads initially.
- **Chart.js:** Canvas-based rendering, efficient for 1000+ data points.
- **Debounced search:** Symbol search input debounced at 300ms.
- **Virtual scrolling:** Trade log table uses virtual scrolling for 1000+ rows.

### 12.2 Backend
- **SQLite WAL mode:** Concurrent reads don't block writes.
- **Prepared statements:** All SQL queries use prepared statements (performance + security).
- **In-memory quote cache:** Hot quotes served from memory, not DB.
- **Worker threads:** Backtests run in worker threads, don't block main event loop.
- **Connection pooling:** Not needed for SQLite (single connection is fine in WAL mode).

### 12.3 Scalability Limits (v1)

| Resource | Limit | Action When Exceeded |
|----------|-------|---------------------|
| Concurrent users | ~200 | Migrate to PostgreSQL + add caching layer |
| Database size | ~2GB | Archive old backtest results, migrate to PG |
| WebSocket connections | ~500 | Add Redis pub/sub for horizontal scaling |
| Backtest concurrency | 2 | Add more worker threads or queue service |
| Market data API calls | 500/day (AV free) | Upgrade to paid tier or add more providers |
