# Trading Platform (PaperTrade) — STATUS.md
> Updated: 2026-03-11 17:30 EDT

## What's Live
- **Frontend:** https://gary-yong.com/trading/index.html#/leaderboard (S3/CloudFront)
- **Backend API:** api.gary-yong.com (EC2 port 3005, PM2: `trading-server`)
- **Quant engine:** PM2 `strategy-runner` (Python, EC2)
- **EC2 path:** `/home/ubuntu/PersonalWebsite/trading/`

## Phase 1 — Shipped Features
### Manual Trading
- Search stocks by symbol or company name
- Place market and limit orders via Alpaca Paper Trading API
- Track positions with real-time P&L
- Portfolio management with configurable starting balance
- Watchlist for tracking symbols

### Automated Quant Strategies (5 strategies)
- **Momentum/Trend Following** — RSI, MACD, EMA crossover signals
- **Mean Reversion** — Bollinger Bands, Z-score deviation
- **Sentiment Analysis** — news-driven signal generation (partial)
- Risk management: position sizing, stop losses, daily loss limits
- Strategy runner on cron (PM2: `strategy-runner`)

### Dashboard & Analytics
- Portfolio overview — total value, P&L
- Strategy performance metrics — Sharpe ratio, max drawdown, win rate
- Order history with filtering
- Real-time quote data via WebSocket
- Leaderboard page

### Reporting
- Daily P&L summaries to Telegram group
- Trade notifications
- Strategy performance alerts

## Tech Stack
- **Frontend:** Vanilla JS SPA, hash router, CSS3
- **Backend:** Node.js, Express, SQLite (better-sqlite3)
- **Quant engine:** Python 3.10+, pandas, numpy, ta
- **Market data:** Alpaca Markets API (paper trading)
- **DB:** SQLite (users, portfolios, orders, strategies)

## Phase 2 Roadmap (decided 2026-03-10, in order)
1. ✅ **Backtesting Panel** — SHIPPED 2026-03-11 (route: #/backtest)
   - Python BacktestEngine + `backtest_runner.py` CLI
   - Node.js `/api/v1/backtest/run` + `/api/v1/backtest/strategies`
   - Equity curve vs SPY, underwater drawdown chart, monthly returns heatmap
   - Key metrics (Sharpe, Sortino, Calmar, win rate, profit factor, VaR)
   - Full trade log with entry/exit reasons
2. **Risk Dashboard** — drawdown, Sharpe ratio, position concentration at a glance
3. **Strategy Comparison** — side-by-side performance of all strategies

## Circuit Breaker / Auto-trader
- ✅ **Auto-trader is LIVE** — all 5 strategies running cleanly as of 2026-03-10
- 3 bugs fixed in `strategy_executor.py` (see Decision Log below)
- No circuit breaker required — root cause was data/logic bugs, not runaway execution
- Volatility Breakout exit logic now correctly fires ATR-based stop-loss + 5-day max-hold

## Deploy
```bash
# Frontend (S3)
aws s3 sync ~/clawd/PersonalWebsite/trading/ s3://gary-yong.com/trading/ \
  --exclude "*.py" --exclude "*.sh" --exclude "node_modules/*" \
  --profile clawdbot-deploy

# Backend (EC2)
rsync -avz ~/clawd/PersonalWebsite/trading/server/ ubuntu@52.86.178.139:/home/ubuntu/PersonalWebsite/trading/server/ -i ~/.ssh/id_ed25519
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 restart trading-server"

# Cache bust
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/trading/*" --profile clawdbot-deploy
```

## Decision Log
| Date | Decision |
|------|----------|
| 2026-03-06 | Phase 1 complete — auto-trader paused pending circuit breaker |
| 2026-03-10 | Phase 2 scoped: Backtesting → Risk Dashboard → Strategy Comparison |
| 2026-03-10 | Auto-trader re-enable queued for overnight (circuit breaker first) |
| 2026-03-10 | **Bug fix deployed** — 3 bugs fixed in `strategy_executor.py`, auto-trader confirmed live |

## Bug Fix Log (2026-03-10)
| # | File | Bug | Impact | Fix |
|---|------|-----|--------|-----|
| 1 | `strategy_executor.py` | `check_volatility_breakout_exits` fetched 10 calendar days (~7 trading rows) — ATR(14) needs 14+ rows | Exit checks crashed silently on every run for MARA, MSTR, AMD, PLTR | Bumped to `days=30`, added `len(df) < 15` guard |
| 2 | `strategy_executor.py` | `days_held` used `updated_at` (reset to `now()` on every read) instead of `last_buy_time` | 5-day max-hold exit never triggered — positions held indefinitely | Switched to `last_buy_time` with UTC-aware comparison |
| 3 | `strategy_executor.py` | Value & Dividends confidence = `(40 - rsi) / 40` — negative for RSI 40–50 | Negative confidence scores on valid buy signals | Fixed to `(50 - rsi) / 50`, clamped 0.0–1.0 |

**Post-fix result:** On first clean run, Volatility Breakout correctly exited 3 stale positions (MARA 544 shares held 10d, MSTR 33 shares held 5d, AMD 24 shares held 5d).
