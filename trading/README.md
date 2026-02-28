# 📈 PaperTrade — Fantasy Quantitative Trading Platform

A full-stack paper trading platform combining manual trading with automated quantitative strategies, powered by the Alpaca Paper Trading API.

**Live:** [gary-yong.com/trading](https://gary-yong.com/trading)

## Features

### 🎯 Manual Trading
- Search stocks by symbol or company name
- Place market and limit orders
- Track positions with real-time P&L
- Portfolio management with starting balance configuration
- Watchlist for tracking symbols of interest

### 🤖 Automated Quant Strategies
- **Momentum/Trend Following** — RSI, MACD, EMA crossover signals
- **Mean Reversion** — Bollinger Bands, Z-score deviation trading
- **Sentiment Analysis** — News-driven signal generation (coming soon)
- Full backtesting framework with performance metrics
- Risk management: position sizing, stop losses, daily loss limits

### 📊 Dashboard & Analytics
- Portfolio overview with total value and P&L
- Strategy performance metrics (Sharpe ratio, max drawdown, win rate)
- Order history with filtering
- Real-time quote data

### 📱 Telegram Reports
- Daily P&L summaries to group chat
- Trade notifications
- Strategy performance alerts

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla JS SPA, CSS3, Font Awesome |
| Backend | Node.js, Express, SQLite (better-sqlite3) |
| Quant Engine | Python 3.10+, pandas, numpy, ta |
| Market Data | Alpaca Markets API |
| Trading | Alpaca Paper Trading API |
| Reporting | Python + Clawdbot Telegram integration |

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- Alpaca Paper Trading account ([sign up free](https://app.alpaca.markets/signup))

### Setup
```bash
# Clone and navigate
cd PersonalWebsite/trading

# Run full setup
bash scripts/setup.sh

# Add your Alpaca API keys
nano config/.env
```

### Run
```bash
# Start all services
bash scripts/start.sh

# Or start individually:

# Backend
cd server && node src/index.js

# Quant engine (in new terminal)
cd quant && source venv/bin/activate
python main.py run          # Execute one strategy cycle
python main.py backtest --strategy momentum --symbol AAPL --days 365
python main.py status       # Account + positions
python main.py signals      # Generate signals without executing
```

### Environment Variables
See `config/.env.example` for all configuration options.

Key variables:
```
ALPACA_API_KEY=        # Alpaca API key
ALPACA_SECRET_KEY=     # Alpaca secret key
PORT=3002              # Backend server port
INITIAL_CAPITAL=10000  # Starting capital for strategies
```

## Architecture

```
Frontend (SPA) → Backend API (Node.js) → Alpaca Paper Trading API
                      ↕                         ↕
                   SQLite DB            Quant Engine (Python)
                      ↕
              Telegram Reports
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design.

## Risk Management

All automated trades follow configurable risk rules:
- **Max position size:** 20% of portfolio per symbol
- **Cash reserve:** 20% always kept as cash
- **Stop loss:** 5% per position
- **Daily loss limit:** 3% of portfolio value
- **Max concurrent positions:** 10

## Reporting

Generate reports via the CLI:
```bash
python scripts/report.py daily     # Full daily summary
python scripts/report.py positions # Current positions
python scripts/report.py trades    # Today's trades
python scripts/report.py status    # Quick status
```

Reports are automatically sent to the configured Telegram group via Clawdbot.

## Project Status

| Component | Status |
|-----------|--------|
| Frontend SPA | ✅ Built |
| Auth system | ✅ Working |
| Dashboard | ✅ Working |
| Trading page | ✅ Working |
| Portfolio detail | ✅ Built |
| Strategies page | ✅ Built |
| Backend API | ✅ Built |
| Alpaca integration | ✅ Built |
| Quant engine | ✅ Built |
| Momentum strategy | ✅ Built |
| Mean reversion | ✅ Built |
| Sentiment strategy | 🔧 Placeholder |
| Backtesting | ✅ Built |
| Telegram reports | ✅ Built |
| EC2 deployment | ⏳ Pending |

## License

Private project — Gary Yong © 2026
