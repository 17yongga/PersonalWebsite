# Database Schema: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2025-07-10  
**Database:** SQLite 3 (WAL mode) — PostgreSQL migration path documented  

---

## Entity Relationship Overview

```
users ─────────┬──────── portfolios ──────── positions
               │              │                  │
               │              ├──────── orders ───┘
               │              │
               │              └──────── transactions
               │
               ├──────── strategies ──────── backtests
               │
               ├──────── contest_entries ──── contests
               │
               └──────── watchlist_items

market_data_cache (standalone)
refresh_tokens (linked to users)
leaderboard_snapshots (computed, linked to users)
```

---

## 1. Users

```sql
CREATE TABLE users (
    id              TEXT PRIMARY KEY,          -- UUID v4
    email           TEXT NOT NULL UNIQUE,      -- Lowercase, validated
    display_name    TEXT NOT NULL,             -- 3-30 chars, alphanumeric + underscores
    password_hash   TEXT NOT NULL,             -- bcrypt hash (cost factor 12)
    is_public       INTEGER NOT NULL DEFAULT 1, -- 1 = visible on leaderboard, 0 = private
    created_at      TEXT NOT NULL DEFAULT (datetime('now')), -- ISO 8601
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT,                      -- ISO 8601, updated on each login
    is_banned       INTEGER NOT NULL DEFAULT 0,
    ban_reason      TEXT                       -- Admin notes if banned
);

CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_display_name ON users(display_name);
CREATE INDEX idx_users_created_at ON users(created_at);
```

**Notes:**
- `id` uses UUID v4 (generated server-side via `crypto.randomUUID()`).
- `email` stored lowercase, validated via regex on insert.
- `display_name` is the public-facing username. Unique enforcement optional (v1: not unique, rely on UUID).
- `password_hash` never exposed via API.
- PostgreSQL migration: `TEXT` → `UUID` for `id`, `TIMESTAMPTZ` for dates.

---

## 2. Refresh Tokens

```sql
CREATE TABLE refresh_tokens (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,             -- SHA-256 hash of the refresh token
    expires_at      TEXT NOT NULL,             -- ISO 8601
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at      TEXT,                      -- Set when token is revoked
    replaced_by     TEXT,                      -- ID of the replacement token (rotation)
    ip_address      TEXT,                      -- IP that created this token
    user_agent      TEXT                       -- Browser user-agent
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

**Notes:**
- Tokens stored as SHA-256 hashes (not plaintext).
- Token rotation: on refresh, old token is revoked and `replaced_by` points to new token.
- Expired/revoked tokens cleaned up by background job (daily).

---

## 3. Portfolios

```sql
CREATE TABLE portfolios (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,             -- User-defined name, max 50 chars
    starting_capital REAL NOT NULL DEFAULT 100000.00,  -- Initial virtual balance
    cash_balance    REAL NOT NULL DEFAULT 100000.00,   -- Current available cash
    is_active       INTEGER NOT NULL DEFAULT 1,        -- 0 = soft deleted
    is_contest      INTEGER NOT NULL DEFAULT 0,        -- 1 = created for a contest
    contest_id      TEXT REFERENCES contests(id),      -- Link to contest if applicable
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    reset_count     INTEGER NOT NULL DEFAULT 0         -- Number of times portfolio was reset
);

CREATE INDEX idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX idx_portfolios_contest_id ON portfolios(contest_id);
CREATE INDEX idx_portfolios_user_active ON portfolios(user_id, is_active);
```

**Constraints:**
- Max 5 non-contest portfolios per user (enforced in application layer).
- `cash_balance` is updated on every trade. Must be >= 0 (enforced in application layer).
- `starting_capital` is immutable after creation (used for performance calculations).

---

## 4. Positions

```sql
CREATE TABLE positions (
    id              TEXT PRIMARY KEY,          -- UUID v4
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,             -- Ticker symbol (e.g., 'AAPL')
    quantity        REAL NOT NULL DEFAULT 0,   -- Number of shares (supports fractional in future)
    average_cost    REAL NOT NULL DEFAULT 0,   -- Volume-weighted average purchase price
    current_price   REAL,                      -- Last known price (updated periodically)
    realized_pnl    REAL NOT NULL DEFAULT 0,   -- Cumulative realized P&L for this symbol
    opened_at       TEXT NOT NULL DEFAULT (datetime('now')),  -- When first purchased
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at       TEXT                       -- When position was fully closed (qty = 0)
);

CREATE INDEX idx_positions_portfolio_id ON positions(portfolio_id);
CREATE UNIQUE INDEX idx_positions_portfolio_symbol ON positions(portfolio_id, symbol)
    WHERE quantity > 0;  -- Only one open position per symbol per portfolio
CREATE INDEX idx_positions_symbol ON positions(symbol);
```

**Notes:**
- `quantity` > 0 for open positions. Set to 0 when fully sold (and `closed_at` set).
- `average_cost` recalculated on each buy: `(old_avg * old_qty + new_price * new_qty) / (old_qty + new_qty)`.
- `current_price` updated by background job (price updater) every 60 seconds.
- `realized_pnl` accumulated as shares are sold: `(sell_price - average_cost) * qty_sold`.
- Partial index ensures one open position per symbol per portfolio.

---

## 5. Orders

```sql
CREATE TABLE orders (
    id              TEXT PRIMARY KEY,          -- UUID v4
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    symbol          TEXT NOT NULL,             -- Ticker symbol
    side            TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    order_type      TEXT NOT NULL CHECK(order_type IN ('market', 'limit', 'stop', 'stop_limit')),
    quantity        REAL NOT NULL,             -- Number of shares
    limit_price     REAL,                      -- For limit and stop_limit orders
    stop_price      REAL,                      -- For stop and stop_limit orders
    time_in_force   TEXT NOT NULL DEFAULT 'day' CHECK(time_in_force IN ('day', 'gtc')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'open', 'filled', 'partially_filled',
                                     'cancelled', 'expired', 'rejected')),
    filled_quantity REAL NOT NULL DEFAULT 0,   -- How many shares have been filled
    filled_price    REAL,                      -- Average fill price
    filled_at       TEXT,                      -- When the order was (fully) filled
    reject_reason   TEXT,                      -- Why the order was rejected
    expires_at      TEXT,                      -- For day orders: market close time
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at    TEXT                       -- When the order was cancelled
);

CREATE INDEX idx_orders_portfolio_id ON orders(portfolio_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_symbol_status ON orders(symbol, status);
CREATE INDEX idx_orders_pending ON orders(status, expires_at)
    WHERE status IN ('pending', 'open');
```

**Order Lifecycle:**
1. `pending` → Validation passed, awaiting execution.
2. `open` → Limit/stop order waiting for price trigger.
3. `filled` → Fully executed.
4. `partially_filled` → Part of the order executed (v2 feature, not in v1).
5. `cancelled` → User cancelled the order.
6. `expired` → Day order reached market close without filling.
7. `rejected` → Failed validation (insufficient funds, invalid symbol, etc.).

---

## 6. Transactions

```sql
CREATE TABLE transactions (
    id              TEXT PRIMARY KEY,          -- UUID v4
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    order_id        TEXT REFERENCES orders(id),-- Link to the order that triggered this
    symbol          TEXT NOT NULL,             -- Ticker symbol
    side            TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    quantity        REAL NOT NULL,             -- Shares transacted
    price           REAL NOT NULL,             -- Execution price per share
    total_amount    REAL NOT NULL,             -- quantity * price
    commission      REAL NOT NULL DEFAULT 0,   -- Commission charged (0 for v1)
    slippage        REAL NOT NULL DEFAULT 0,   -- Simulated slippage amount
    realized_pnl    REAL,                      -- P&L realized on this transaction (sells only)
    executed_at     TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT                       -- System notes (e.g., "Market order filled")
);

CREATE INDEX idx_transactions_portfolio_id ON transactions(portfolio_id);
CREATE INDEX idx_transactions_order_id ON transactions(order_id);
CREATE INDEX idx_transactions_symbol ON transactions(symbol);
CREATE INDEX idx_transactions_executed_at ON transactions(executed_at);
CREATE INDEX idx_transactions_portfolio_date ON transactions(portfolio_id, executed_at);
```

**Notes:**
- Every filled order creates one transaction record.
- `realized_pnl` is calculated for sell transactions: `(price - position.average_cost) * quantity`.
- `total_amount` is always positive (buy or sell).
- `slippage` records the simulated spread applied (0.01–0.05% of price).

---

## 7. Strategies

```sql
CREATE TABLE strategies (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,             -- User-defined name, max 100 chars
    description     TEXT,                      -- User-provided description
    type            TEXT NOT NULL CHECK(type IN ('rules', 'code')),
    config          TEXT,                      -- JSON for rules-based strategies
    code            TEXT,                      -- JavaScript code for code-based strategies
    symbols         TEXT,                      -- JSON array of symbols this strategy trades
    is_active       INTEGER NOT NULL DEFAULT 1,
    version         INTEGER NOT NULL DEFAULT 1,-- Incremented on each update
    attached_portfolio_id TEXT REFERENCES portfolios(id),  -- Currently deployed to
    last_validated_at TEXT,                    -- When last syntax check passed
    validation_status TEXT CHECK(validation_status IN ('valid', 'invalid', 'pending')),
    validation_errors TEXT,                    -- JSON array of error messages
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_strategies_user_id ON strategies(user_id);
CREATE INDEX idx_strategies_attached ON strategies(attached_portfolio_id)
    WHERE attached_portfolio_id IS NOT NULL;
```

### 7.1 Rules Config Schema (JSON)

```json
{
  "rules": [
    {
      "id": "rule_1",
      "name": "Golden Cross Buy",
      "conditions": {
        "operator": "AND",
        "items": [
          {
            "indicator": "SMA",
            "params": { "period": 50, "symbol": "AAPL" },
            "comparison": "crosses_above",
            "target": {
              "indicator": "SMA",
              "params": { "period": 200, "symbol": "AAPL" }
            }
          },
          {
            "indicator": "RSI",
            "params": { "period": 14, "symbol": "AAPL" },
            "comparison": "less_than",
            "target": { "value": 70 }
          }
        ]
      },
      "action": {
        "type": "buy",
        "symbol": "AAPL",
        "quantity_type": "fixed",
        "quantity": 10
      }
    },
    {
      "id": "rule_2",
      "name": "Death Cross Sell",
      "conditions": {
        "operator": "AND",
        "items": [
          {
            "indicator": "SMA",
            "params": { "period": 50, "symbol": "AAPL" },
            "comparison": "crosses_below",
            "target": {
              "indicator": "SMA",
              "params": { "period": 200, "symbol": "AAPL" }
            }
          }
        ]
      },
      "action": {
        "type": "sell",
        "symbol": "AAPL",
        "quantity_type": "all"
      }
    }
  ],
  "universe": ["AAPL"],
  "rebalance_frequency": "daily"
}
```

### 7.2 Available Indicators (v1)

| Indicator | Parameters | Description |
|-----------|-----------|-------------|
| `SMA` | `period` (int) | Simple Moving Average |
| `EMA` | `period` (int) | Exponential Moving Average |
| `RSI` | `period` (int, default 14) | Relative Strength Index |
| `MACD` | `fast` (12), `slow` (26), `signal` (9) | Moving Average Convergence Divergence |
| `PRICE` | none | Current price |
| `VOLUME` | none | Current volume |
| `VOLUME_SMA` | `period` (int) | Simple Moving Average of volume |
| `ATR` | `period` (int, default 14) | Average True Range |
| `BB_UPPER` | `period` (20), `std` (2) | Bollinger Band Upper |
| `BB_LOWER` | `period` (20), `std` (2) | Bollinger Band Lower |

### 7.3 Available Comparisons

| Comparison | Description |
|-----------|-------------|
| `greater_than` | Left > Right |
| `less_than` | Left < Right |
| `equal_to` | Left == Right (within 0.01% tolerance) |
| `crosses_above` | Left was below right, now above |
| `crosses_below` | Left was above right, now below |
| `between` | Left between target.low and target.high |

---

## 8. Backtests

```sql
CREATE TABLE backtests (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id     TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    strategy_version INTEGER NOT NULL,         -- Strategy version at time of backtest
    start_date      TEXT NOT NULL,             -- YYYY-MM-DD
    end_date        TEXT NOT NULL,             -- YYYY-MM-DD
    starting_capital REAL NOT NULL DEFAULT 100000.00,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

    -- Results (populated when status = 'completed')
    total_return    REAL,                      -- e.g., 0.234 = 23.4%
    annualized_return REAL,
    max_drawdown    REAL,                      -- e.g., -0.156 = -15.6%
    sharpe_ratio    REAL,
    sortino_ratio   REAL,
    win_rate        REAL,                      -- e.g., 0.58 = 58%
    profit_factor   REAL,
    total_trades    INTEGER,
    winning_trades  INTEGER,
    losing_trades   INTEGER,
    avg_trade_return REAL,
    best_trade      REAL,                      -- Best single trade return
    worst_trade     REAL,                      -- Worst single trade return
    avg_hold_days   REAL,                      -- Average holding period in days
    final_value     REAL,                      -- Final portfolio value

    -- Benchmark
    benchmark_return REAL,                     -- S&P 500 (SPY) return over same period

    -- Detailed results (JSON)
    equity_curve    TEXT,                      -- JSON array: [{date, value}, ...]
    trade_log       TEXT,                      -- JSON array: [{date, symbol, side, qty, price, pnl}, ...]
    daily_returns   TEXT,                      -- JSON array: [0.01, -0.005, ...]

    -- Metadata
    execution_time_ms INTEGER,                -- How long the backtest took to run
    error_message   TEXT,                      -- Error details if status = 'failed'
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
);

CREATE INDEX idx_backtests_user_id ON backtests(user_id);
CREATE INDEX idx_backtests_strategy_id ON backtests(strategy_id);
CREATE INDEX idx_backtests_status ON backtests(status);
CREATE INDEX idx_backtests_created_at ON backtests(created_at);
```

**Notes:**
- `equity_curve` and `trade_log` stored as JSON text. For v2 (PostgreSQL), these become JSONB columns for queryability.
- `strategy_version` captures which version of the strategy was backtested.
- Max 50 backtests per user (oldest auto-deleted when exceeded).

---

## 9. Contests

```sql
CREATE TABLE contests (
    id              TEXT PRIMARY KEY,          -- UUID v4
    creator_id      TEXT REFERENCES users(id), -- NULL for system-created contests
    name            TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL CHECK(type IN ('weekly', 'monthly', 'custom')),
    status          TEXT NOT NULL DEFAULT 'upcoming'
                    CHECK(status IN ('upcoming', 'active', 'completed', 'cancelled')),
    starting_capital REAL NOT NULL DEFAULT 100000.00,
    start_date      TEXT NOT NULL,             -- ISO 8601
    end_date        TEXT NOT NULL,             -- ISO 8601
    max_participants INTEGER DEFAULT 100,
    is_public       INTEGER NOT NULL DEFAULT 1,-- 0 = invite-only
    invite_code     TEXT UNIQUE,               -- For private contests
    rules           TEXT,                      -- JSON: allowed symbols, position limits, etc.
    ranking_metric  TEXT NOT NULL DEFAULT 'total_return'
                    CHECK(ranking_metric IN ('total_return', 'sharpe_ratio', 'risk_adjusted')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contests_status ON contests(status);
CREATE INDEX idx_contests_start_date ON contests(start_date);
CREATE INDEX idx_contests_creator_id ON contests(creator_id);
CREATE INDEX idx_contests_invite_code ON contests(invite_code) WHERE invite_code IS NOT NULL;
```

### 9.1 Contest Rules Schema (JSON)

```json
{
  "allowed_symbols": null,
  "blocked_symbols": [],
  "max_position_pct": 25,
  "max_positions": 20,
  "order_types": ["market", "limit", "stop", "stop_limit"],
  "allow_strategies": true,
  "min_trades": 1,
  "max_daily_trades": 50
}
```

---

## 10. Contest Entries

```sql
CREATE TABLE contest_entries (
    id              TEXT PRIMARY KEY,          -- UUID v4
    contest_id      TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active', 'disqualified', 'withdrawn')),
    final_rank      INTEGER,                   -- Set when contest completes
    final_return    REAL,                       -- Set when contest completes
    final_value     REAL,                       -- Set when contest completes
    badge           TEXT CHECK(badge IN ('gold', 'silver', 'bronze')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    disqualified_at TEXT,
    disqualify_reason TEXT
);

CREATE UNIQUE INDEX idx_contest_entries_unique ON contest_entries(contest_id, user_id);
CREATE INDEX idx_contest_entries_contest_id ON contest_entries(contest_id);
CREATE INDEX idx_contest_entries_user_id ON contest_entries(user_id);
CREATE INDEX idx_contest_entries_portfolio_id ON contest_entries(portfolio_id);
```

---

## 11. Leaderboard Snapshots

```sql
CREATE TABLE leaderboard_snapshots (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope           TEXT NOT NULL CHECK(scope IN ('global', 'contest')),
    contest_id      TEXT REFERENCES contests(id),  -- NULL for global
    period          TEXT NOT NULL CHECK(period IN ('weekly', 'monthly', 'all_time')),
    rank            INTEGER NOT NULL,
    total_return    REAL NOT NULL,
    sharpe_ratio    REAL,
    total_trades    INTEGER,
    best_portfolio_id TEXT REFERENCES portfolios(id),
    snapshot_date   TEXT NOT NULL,              -- Date this snapshot was computed
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_leaderboard_scope_period ON leaderboard_snapshots(scope, period, snapshot_date);
CREATE INDEX idx_leaderboard_user_id ON leaderboard_snapshots(user_id);
CREATE INDEX idx_leaderboard_contest_id ON leaderboard_snapshots(contest_id)
    WHERE contest_id IS NOT NULL;
CREATE INDEX idx_leaderboard_rank ON leaderboard_snapshots(scope, period, snapshot_date, rank);
```

**Notes:**
- Snapshots are computed hourly by a background job.
- Only the latest snapshot per scope/period is displayed; older ones retained for 30 days.
- Global leaderboard only includes users with `is_public = 1`.

---

## 12. Watchlist Items

```sql
CREATE TABLE watchlist_items (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT,                      -- User's personal notes on this symbol
    alert_above     REAL,                      -- Price alert: notify if price goes above
    alert_below     REAL                       -- Price alert: notify if price goes below
);

CREATE UNIQUE INDEX idx_watchlist_user_symbol ON watchlist_items(user_id, symbol);
CREATE INDEX idx_watchlist_user_id ON watchlist_items(user_id);
```

**Constraints:**
- Max 50 watchlist items per user (enforced in application layer).

---

## 13. Market Data Cache

```sql
CREATE TABLE market_data_cache (
    id              TEXT PRIMARY KEY,          -- UUID v4
    symbol          TEXT NOT NULL,
    data_type       TEXT NOT NULL CHECK(data_type IN ('quote', 'historical', 'company_info', 'search')),
    data            TEXT NOT NULL,             -- JSON payload
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL,             -- When this cache entry expires
    source          TEXT NOT NULL              -- 'yahoo', 'alpha_vantage', 'polygon'
);

CREATE INDEX idx_market_cache_symbol_type ON market_data_cache(symbol, data_type);
CREATE INDEX idx_market_cache_expires ON market_data_cache(expires_at);
CREATE INDEX idx_market_cache_lookup ON market_data_cache(symbol, data_type, expires_at);
```

### 13.1 Cache TTL Rules

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| `quote` | 60 seconds | Market data refreshes frequently |
| `historical` | 24 hours | Daily OHLCV doesn't change after market close |
| `company_info` | 7 days | Company details change rarely |
| `search` | 1 hour | Symbol search results are stable |

### 13.2 Historical Data Schema (JSON stored in `data` field)

```json
{
  "symbol": "AAPL",
  "period": "5y",
  "interval": "1d",
  "data": [
    {
      "date": "2020-01-02",
      "open": 296.24,
      "high": 300.60,
      "low": 295.19,
      "close": 300.35,
      "volume": 33911380,
      "adjusted_close": 296.83
    }
  ]
}
```

---

## 14. Portfolio Daily Snapshots (Analytics)

```sql
CREATE TABLE portfolio_snapshots (
    id              TEXT PRIMARY KEY,          -- UUID v4
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    snapshot_date   TEXT NOT NULL,             -- YYYY-MM-DD
    total_value     REAL NOT NULL,             -- Cash + holdings value
    cash_balance    REAL NOT NULL,
    holdings_value  REAL NOT NULL,
    day_return      REAL,                      -- Percentage return for the day
    total_return    REAL,                      -- Percentage return since inception
    positions_count INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_portfolio_snapshots_unique ON portfolio_snapshots(portfolio_id, snapshot_date);
CREATE INDEX idx_portfolio_snapshots_portfolio ON portfolio_snapshots(portfolio_id, snapshot_date);
```

**Notes:**
- Created daily at market close (4:00 PM ET) by background job.
- Used to generate equity curves and performance charts.
- Retained for the lifetime of the portfolio.

---

## 15. User Achievements / Badges

```sql
CREATE TABLE user_achievements (
    id              TEXT PRIMARY KEY,          -- UUID v4
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement     TEXT NOT NULL,             -- Achievement code
    metadata        TEXT,                      -- JSON with additional context
    earned_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_achievements_unique ON user_achievements(user_id, achievement);
CREATE INDEX idx_achievements_user_id ON user_achievements(user_id);
```

### 15.1 Achievement Codes

| Code | Name | Criteria |
|------|------|----------|
| `first_trade` | First Trade | Execute your first trade |
| `ten_trades` | Active Trader | Execute 10 trades |
| `hundred_trades` | Trading Pro | Execute 100 trades |
| `first_strategy` | Strategist | Create your first strategy |
| `first_backtest` | Time Traveler | Run your first backtest |
| `first_contest` | Competitor | Join your first contest |
| `contest_gold` | Champion | Win 1st place in a contest |
| `contest_silver` | Runner Up | Win 2nd place in a contest |
| `contest_bronze` | Podium Finish | Win 3rd place in a contest |
| `ten_percent` | Double Digits | Achieve 10%+ return on a portfolio |
| `hundred_percent` | Double Up | Achieve 100%+ return on a portfolio |
| `diversified` | Diversified | Hold 10+ different positions simultaneously |
| `streak_5` | Hot Streak | 5 consecutive profitable trades |
| `early_adopter` | Early Adopter | Register within first month of launch |

---

## 16. Complete Migration Script (001_initial.sql)

```sql
-- Fantasy Trading Platform - Initial Schema
-- SQLite 3, WAL mode

PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 10000;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -64000;  -- 64MB cache

-- ===========================
-- USERS & AUTH
-- ===========================

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    is_public       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT,
    is_banned       INTEGER NOT NULL DEFAULT 0,
    ban_reason      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at      TEXT,
    replaced_by     TEXT,
    ip_address      TEXT,
    user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

-- ===========================
-- PORTFOLIOS & TRADING
-- ===========================

CREATE TABLE IF NOT EXISTS portfolios (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    starting_capital REAL NOT NULL DEFAULT 100000.00,
    cash_balance    REAL NOT NULL DEFAULT 100000.00,
    is_active       INTEGER NOT NULL DEFAULT 1,
    is_contest      INTEGER NOT NULL DEFAULT 0,
    contest_id      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    reset_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_contest_id ON portfolios(contest_id);

CREATE TABLE IF NOT EXISTS positions (
    id              TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    quantity        REAL NOT NULL DEFAULT 0,
    average_cost    REAL NOT NULL DEFAULT 0,
    current_price   REAL,
    realized_pnl    REAL NOT NULL DEFAULT 0,
    opened_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_positions_portfolio_id ON positions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);

CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    order_type      TEXT NOT NULL CHECK(order_type IN ('market', 'limit', 'stop', 'stop_limit')),
    quantity        REAL NOT NULL,
    limit_price     REAL,
    stop_price      REAL,
    time_in_force   TEXT NOT NULL DEFAULT 'day' CHECK(time_in_force IN ('day', 'gtc')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'open', 'filled', 'partially_filled',
                                     'cancelled', 'expired', 'rejected')),
    filled_quantity REAL NOT NULL DEFAULT 0,
    filled_price    REAL,
    filled_at       TEXT,
    reject_reason   TEXT,
    expires_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_portfolio_id ON orders(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS transactions (
    id              TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    order_id        TEXT REFERENCES orders(id),
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    quantity        REAL NOT NULL,
    price           REAL NOT NULL,
    total_amount    REAL NOT NULL,
    commission      REAL NOT NULL DEFAULT 0,
    slippage        REAL NOT NULL DEFAULT 0,
    realized_pnl    REAL,
    executed_at     TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_id ON transactions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol);
CREATE INDEX IF NOT EXISTS idx_transactions_executed_at ON transactions(executed_at);

-- ===========================
-- STRATEGIES & BACKTESTING
-- ===========================

CREATE TABLE IF NOT EXISTS strategies (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL CHECK(type IN ('rules', 'code')),
    config          TEXT,
    code            TEXT,
    symbols         TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    version         INTEGER NOT NULL DEFAULT 1,
    attached_portfolio_id TEXT REFERENCES portfolios(id),
    last_validated_at TEXT,
    validation_status TEXT CHECK(validation_status IN ('valid', 'invalid', 'pending')),
    validation_errors TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);

CREATE TABLE IF NOT EXISTS backtests (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id     TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    strategy_version INTEGER NOT NULL,
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    starting_capital REAL NOT NULL DEFAULT 100000.00,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    total_return    REAL,
    annualized_return REAL,
    max_drawdown    REAL,
    sharpe_ratio    REAL,
    sortino_ratio   REAL,
    win_rate        REAL,
    profit_factor   REAL,
    total_trades    INTEGER,
    winning_trades  INTEGER,
    losing_trades   INTEGER,
    avg_trade_return REAL,
    best_trade      REAL,
    worst_trade     REAL,
    avg_hold_days   REAL,
    final_value     REAL,
    benchmark_return REAL,
    equity_curve    TEXT,
    trade_log       TEXT,
    daily_returns   TEXT,
    execution_time_ms INTEGER,
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_backtests_user_id ON backtests(user_id);
CREATE INDEX IF NOT EXISTS idx_backtests_strategy_id ON backtests(strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtests_status ON backtests(status);

-- ===========================
-- CONTESTS & LEADERBOARDS
-- ===========================

CREATE TABLE IF NOT EXISTS contests (
    id              TEXT PRIMARY KEY,
    creator_id      TEXT REFERENCES users(id),
    name            TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL CHECK(type IN ('weekly', 'monthly', 'custom')),
    status          TEXT NOT NULL DEFAULT 'upcoming'
                    CHECK(status IN ('upcoming', 'active', 'completed', 'cancelled')),
    starting_capital REAL NOT NULL DEFAULT 100000.00,
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    max_participants INTEGER DEFAULT 100,
    is_public       INTEGER NOT NULL DEFAULT 1,
    invite_code     TEXT UNIQUE,
    rules           TEXT,
    ranking_metric  TEXT NOT NULL DEFAULT 'total_return'
                    CHECK(ranking_metric IN ('total_return', 'sharpe_ratio', 'risk_adjusted')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);
CREATE INDEX IF NOT EXISTS idx_contests_start_date ON contests(start_date);

CREATE TABLE IF NOT EXISTS contest_entries (
    id              TEXT PRIMARY KEY,
    contest_id      TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active', 'disqualified', 'withdrawn')),
    final_rank      INTEGER,
    final_return    REAL,
    final_value     REAL,
    badge           TEXT CHECK(badge IN ('gold', 'silver', 'bronze')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    disqualified_at TEXT,
    disqualify_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_entries_unique ON contest_entries(contest_id, user_id);
CREATE INDEX IF NOT EXISTS idx_contest_entries_contest_id ON contest_entries(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_entries_user_id ON contest_entries(user_id);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope           TEXT NOT NULL CHECK(scope IN ('global', 'contest')),
    contest_id      TEXT REFERENCES contests(id),
    period          TEXT NOT NULL CHECK(period IN ('weekly', 'monthly', 'all_time')),
    rank            INTEGER NOT NULL,
    total_return    REAL NOT NULL,
    sharpe_ratio    REAL,
    total_trades    INTEGER,
    best_portfolio_id TEXT REFERENCES portfolios(id),
    snapshot_date   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_scope ON leaderboard_snapshots(scope, period, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_leaderboard_user_id ON leaderboard_snapshots(user_id);

-- ===========================
-- WATCHLIST & MARKET DATA
-- ===========================

CREATE TABLE IF NOT EXISTS watchlist_items (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    notes           TEXT,
    alert_above     REAL,
    alert_below     REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_user_symbol ON watchlist_items(user_id, symbol);

CREATE TABLE IF NOT EXISTS market_data_cache (
    id              TEXT PRIMARY KEY,
    symbol          TEXT NOT NULL,
    data_type       TEXT NOT NULL CHECK(data_type IN ('quote', 'historical', 'company_info', 'search')),
    data            TEXT NOT NULL,
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL,
    source          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_cache_lookup ON market_data_cache(symbol, data_type, expires_at);
CREATE INDEX IF NOT EXISTS idx_market_cache_expires ON market_data_cache(expires_at);

-- ===========================
-- ANALYTICS & ACHIEVEMENTS
-- ===========================

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id              TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    snapshot_date   TEXT NOT NULL,
    total_value     REAL NOT NULL,
    cash_balance    REAL NOT NULL,
    holdings_value  REAL NOT NULL,
    day_return      REAL,
    total_return    REAL,
    positions_count INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_snapshots_unique
    ON portfolio_snapshots(portfolio_id, snapshot_date);

CREATE TABLE IF NOT EXISTS user_achievements (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement     TEXT NOT NULL,
    metadata        TEXT,
    earned_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_unique ON user_achievements(user_id, achievement);
CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON user_achievements(user_id);
```

---

## 17. PostgreSQL Migration Notes

When migrating from SQLite to PostgreSQL:

| SQLite | PostgreSQL | Notes |
|--------|-----------|-------|
| `TEXT PRIMARY KEY` (UUID) | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Use native UUID type |
| `TEXT` (dates) | `TIMESTAMPTZ` | Proper timestamp with timezone |
| `INTEGER` (boolean) | `BOOLEAN` | Native boolean type |
| `REAL` | `DECIMAL(18,8)` | For financial precision |
| `TEXT` (JSON) | `JSONB` | Queryable JSON with indexing |
| `datetime('now')` | `NOW()` | Current timestamp function |
| Partial indexes with WHERE | Same syntax | PostgreSQL supports this |
| `AUTOINCREMENT` (if used) | `SERIAL` or `BIGSERIAL` | Sequence-backed integers |

Additional PostgreSQL advantages to leverage:
- **JSONB queries:** Index and query strategy configs, backtest results directly.
- **Full-text search:** `tsvector` for symbol search without external service.
- **Connection pooling:** Use `pg-pool` or PgBouncer for concurrent connections.
- **Partitioning:** Partition `transactions` and `portfolio_snapshots` by date for performance.
- **Row-level security:** Enforce user data isolation at the database level.
