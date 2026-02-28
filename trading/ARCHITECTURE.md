# PaperTrade + Alpaca Quant Trading Platform — Architecture

## Overview
An integrated paper trading platform combining:
1. **Manual trading** — users search stocks, place orders via web UI
2. **Automated quant strategies** — Python engine executes algorithmic trades via Alpaca
3. **Real-time dashboard** — web frontend shows positions, P&L, strategy performance
4. **Telegram reporting** — daily summaries and trade notifications to group chat

## System Architecture

```
┌─────────────────────────────────────────┐
│           Web Frontend (SPA)            │
│  • Dashboard (portfolios + strategies)  │
│  • Trading (manual + strategy orders)   │
│  • Strategies (manage, backtest, toggle)│
│  • Portfolio detail (positions, P&L)    │
└──────────────┬──────────────────────────┘
               │ REST API + WebSocket
┌──────────────▼──────────────────────────┐
│         Backend API (Node.js)           │
│  /api/v1/auth/*      — JWT auth         │
│  /api/v1/portfolios/* — CRUD            │
│  /api/v1/trading/*   — order routing    │
│  /api/v1/market/*    — quotes/search    │
│  /api/v1/strategies/*— strategy mgmt    │
│  /api/v1/watchlist/* — watchlist         │
│  WebSocket: live price + order updates  │
└────┬──────────────┬─────────────────────┘
     │              │
┌────▼────┐  ┌──────▼──────────────────────┐
│ SQLite  │  │     Alpaca Paper API         │
│   DB    │  │  • Market data (quotes)      │
│(users,  │  │  • Order execution           │
│portf,   │  │  • Account/positions         │
│orders,  │  │  • Historical bars           │
│strats)  │  └──────────────────────────────┘
└─────────┘          │
                     │
┌────────────────────▼─────────────────────┐
│        Quant Engine (Python)             │
│  • Strategy runner (cron-based)          │
│  • Backtesting framework                 │
│  • Signal generation                     │
│  • Risk management                       │
│  • Talks to Alpaca API directly          │
│  • Writes results to SQLite              │
└────────────────────┬─────────────────────┘
                     │
┌────────────────────▼─────────────────────┐
│       Telegram Reporting                 │
│  • Daily P&L summary (via Clawdbot)     │
│  • Trade notifications                   │
│  • Strategy alerts                       │
└──────────────────────────────────────────┘
```

## Directory Structure

```
trading/
├── index.html              # SPA entry point
├── css/                    # Stylesheets
├── js/                     # Frontend SPA
│   ├── api.js             # API client
│   ├── auth.js            # Auth module
│   ├── router.js          # Hash router
│   ├── store.js           # State management
│   ├── app.js             # App bootstrap
│   ├── ws.js              # WebSocket client
│   ├── utils.js           # Helpers
│   ├── components/        # Reusable UI
│   └── pages/             # Route pages
│       ├── dashboard.js   # Main dashboard
│       ├── trading.js     # Trade execution
│       ├── portfolio.js   # Portfolio detail
│       ├── strategies.js  # Strategy management ← NEW
│       ├── profile.js     # User profile
│       ├── login.js       # Auth
│       └── 404.js         # Not found
│
├── server/                # Backend API
│   ├── package.json
│   ├── src/
│   │   ├── index.js       # Express app entry
│   │   ├── config/
│   │   │   ├── index.js   # Config loader
│   │   │   └── database.js# SQLite setup
│   │   ├── middleware/
│   │   │   ├── auth.js    # JWT middleware
│   │   │   └── error.js   # Error handler
│   │   ├── routes/
│   │   │   ├── auth.js    # Auth routes
│   │   │   ├── portfolios.js
│   │   │   ├── trading.js
│   │   │   ├── market.js
│   │   │   ├── strategies.js
│   │   │   └── watchlist.js
│   │   ├── services/
│   │   │   ├── alpaca.js  # Alpaca API client
│   │   │   ├── portfolio.js
│   │   │   ├── trading.js
│   │   │   └── market.js
│   │   └── models/
│   │       └── schema.sql # DB schema
│   └── tests/
│
├── quant/                 # Python quant engine
│   ├── requirements.txt
│   ├── config.py          # Config + env vars
│   ├── main.py            # Entry point / scheduler
│   ├── alpaca_client.py   # Alpaca API wrapper
│   ├── strategies/
│   │   ├── base.py        # Abstract strategy class
│   │   ├── momentum.py    # Momentum strategy
│   │   ├── mean_reversion.py
│   │   └── sentiment.py   # News sentiment
│   ├── backtesting/
│   │   ├── engine.py      # Backtest runner
│   │   └── metrics.py     # Performance metrics
│   ├── signals/
│   │   └── generator.py   # Signal aggregation
│   ├── utils/
│   │   ├── indicators.py  # Technical indicators
│   │   └── risk.py        # Position sizing, risk mgmt
│   ├── data/              # Cached market data
│   └── tests/
│
├── config/
│   └── .env.example       # Environment variables template
│
└── scripts/
    ├── setup.sh           # Full setup script
    ├── start.sh           # Start all services
    └── report.py          # Telegram reporting script
```

## Database Schema (SQLite)

### Users
- id, email, password_hash, display_name, created_at

### Portfolios
- id, user_id, name, starting_balance, cash_balance, type (manual|strategy), strategy_id?, created_at

### Positions
- id, portfolio_id, symbol, quantity, avg_cost_basis, created_at, updated_at

### Orders
- id, portfolio_id, symbol, side, type, quantity, limit_price?, stop_price?, fill_price?, status, alpaca_order_id?, source (manual|strategy), created_at

### Strategies
- id, user_id, name, type, config (JSON), status (active|paused|backtest), portfolio_id?, created_at

### Strategy_Runs
- id, strategy_id, run_type (live|backtest), start_date, end_date, total_return, sharpe_ratio, max_drawdown, trades_count, results (JSON), created_at

### Watchlist
- id, user_id, symbol, added_at

### Transactions (filled order log)
- id, portfolio_id, order_id, symbol, side, quantity, price, total, created_at

## API Endpoints

### Auth
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/logout
- POST /api/v1/auth/refresh
- PATCH /api/v1/auth/profile
- PATCH /api/v1/auth/password

### Portfolios
- GET /api/v1/portfolios
- POST /api/v1/portfolios
- GET /api/v1/portfolios/:id
- PATCH /api/v1/portfolios/:id
- DELETE /api/v1/portfolios/:id
- POST /api/v1/portfolios/:id/reset

### Trading
- POST /api/v1/trading/orders — place order (routes to Alpaca)
- GET /api/v1/trading/orders?portfolio_id=X
- DELETE /api/v1/trading/orders/:id — cancel order
- GET /api/v1/trading/positions/:portfolio_id
- GET /api/v1/trading/transactions?portfolio_id=X

### Market Data
- GET /api/v1/market/quote/:symbol
- GET /api/v1/market/search?q=X
- GET /api/v1/market/bars/:symbol?timeframe=1D&start=X&end=Y

### Strategies
- GET /api/v1/strategies
- POST /api/v1/strategies — create strategy config
- GET /api/v1/strategies/:id
- PATCH /api/v1/strategies/:id — update config / toggle active
- DELETE /api/v1/strategies/:id
- POST /api/v1/strategies/:id/backtest — run backtest
- GET /api/v1/strategies/:id/runs — get run history
- GET /api/v1/strategies/:id/signals — get latest signals

### Watchlist
- GET /api/v1/watchlist
- POST /api/v1/watchlist
- DELETE /api/v1/watchlist/:symbol

## Environment Variables
```
# Alpaca
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# Server
PORT=3002
JWT_SECRET=<random>
DB_PATH=./data/trading.db

# Quant
QUANT_SCHEDULE=0 9,12,15 * * 1-5  # Run at 9am, 12pm, 3pm weekdays
INITIAL_CAPITAL=10000

# Telegram
TELEGRAM_CHAT_ID=-5154861739
```

## Strategy Types (MVP)

### 1. Momentum (Trend Following)
- Indicators: RSI, MACD, EMA crossover
- Entry: Strong uptrend signals across multiple timeframes
- Exit: Trend reversal or trailing stop

### 2. Mean Reversion
- Indicators: Bollinger Bands, Z-score
- Entry: Price deviates >2 std from mean
- Exit: Price returns to mean

### 3. Sentiment-Driven
- Data: News headlines, social sentiment scores
- Entry: Strong positive/negative sentiment divergence from price
- Exit: Sentiment normalizes

## Risk Management
- Max position size: 20% of portfolio per symbol
- Max portfolio allocation: 80% invested, 20% cash reserve
- Stop loss: -5% per position
- Daily loss limit: -3% of portfolio
- Max concurrent positions: 10
