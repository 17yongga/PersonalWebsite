# Quantitative Trading Engine

A comprehensive Python-based quantitative trading system designed for paper trading with Alpaca Markets.

## Features

- **Multiple Trading Strategies**
  - Momentum/Trend Following (RSI, MACD, EMA crossover)
  - Mean Reversion (Bollinger Bands, Z-score)
  - Sentiment Analysis (placeholder for news/social sentiment)

- **Comprehensive Backtesting**
  - Realistic order execution simulation
  - Slippage and commission modeling
  - Performance metrics (Sharpe, Sortino, Max Drawdown, etc.)
  - Trade-by-trade analysis

- **Risk Management**
  - Position sizing (Fixed Fractional, Kelly Criterion, Volatility Targeting)
  - Portfolio allocation limits
  - Daily loss limits
  - Stop loss management

- **Real-time Trading**
  - Alpaca API integration for live/paper trading
  - Signal aggregation from multiple strategies
  - Command-line interface for execution

## Installation

```bash
cd /Users/moltbot/clawd/PersonalWebsite/trading/quant
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Configuration

Create environment file at `../config/.env`:
```
ALPACA_API_KEY=your_api_key
ALPACA_SECRET_KEY=your_secret_key
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
INITIAL_CAPITAL=10000
MAX_POSITION_PCT=0.20
MAX_PORTFOLIO_PCT=0.80
STOP_LOSS_PCT=0.05
DAILY_LOSS_LIMIT_PCT=0.03
MAX_POSITIONS=10
```

## Usage

### Command Line Interface

```bash
# Show help
python main.py --help

# Execute trading strategies
python main.py run

# Dry run (show signals without executing)
python main.py run --dry-run

# Show account status
python main.py status

# Generate current signals
python main.py signals

# Run backtests
python main.py backtest --strategy momentum --symbol AAPL --days 365
python main.py backtest --strategy mean_reversion --days 252
```

### Python API

```python
from strategies.momentum import MomentumStrategy
from backtesting.engine import BacktestEngine

# Create strategy
strategy = MomentumStrategy({
    'rsi_period': 14,
    'buy_threshold': 2,
    'sell_threshold': -2
})

# Run backtest
engine = BacktestEngine(initial_capital=10000)
results = engine.run_backtest(strategy, data)
```

## Architecture

```
quant/
├── strategies/          # Trading strategy implementations
│   ├── base.py         # Abstract strategy class
│   ├── momentum.py     # Momentum/trend following
│   ├── mean_reversion.py # Mean reversion strategy
│   └── sentiment.py    # Sentiment analysis (placeholder)
├── backtesting/        # Backtesting framework
│   ├── engine.py       # Backtest execution engine
│   └── metrics.py      # Performance metrics calculation
├── signals/            # Signal generation and aggregation
│   └── generator.py    # Multi-strategy signal aggregation
├── utils/              # Utility modules
│   ├── indicators.py   # Technical indicators
│   └── risk.py         # Risk management
├── tests/              # Test suite
├── data/               # Cached market data
├── config.py           # Configuration management
├── alpaca_client.py    # Alpaca API client
└── main.py             # CLI entry point
```

## Trading Universe

Default symbols: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, JPM, V, JNJ, WMT, PG, MA, UNH, HD, DIS, BAC, XOM, PFE, KO

## Risk Parameters

- Max position size: 20% of portfolio per symbol
- Max portfolio allocation: 80% invested, 20% cash reserve  
- Stop loss: 5% per position
- Daily loss limit: 3% of portfolio
- Max concurrent positions: 10

## Strategy Details

### Momentum Strategy
- Uses RSI (14), MACD (12,26,9), EMA crossover (20/50)
- Composite scoring system
- BUY when score > threshold, SELL when score < -threshold

### Mean Reversion Strategy  
- Bollinger Bands (20, 2std) and Z-score analysis
- BUY when price < lower band AND z-score < -2
- SELL when price > upper band AND z-score > 2

### Sentiment Strategy
- Currently a placeholder with random sentiment
- Designed for future news/social media integration
- Same interface as other strategies

## Testing

```bash
# Run all tests
python -m pytest tests/ -v

# Run specific test file
python -m pytest tests/test_strategies.py -v

# Run with coverage
pip install pytest-cov
python -m pytest tests/ --cov=. --cov-report=html
```

## Development

The system is designed to be modular and extensible:

1. **Adding New Strategies**: Inherit from `Strategy` base class
2. **Custom Indicators**: Add to `utils/indicators.py`  
3. **Risk Models**: Extend `RiskManager` class
4. **Data Sources**: Modify `alpaca_client.py` or add new clients

## Performance Metrics

The backtesting engine calculates comprehensive metrics:

- **Return Metrics**: Total return, annualized return, CAGR
- **Risk Metrics**: Volatility, max drawdown, VaR, expected shortfall  
- **Risk-Adjusted**: Sharpe ratio, Sortino ratio, Calmar ratio
- **Trade Metrics**: Win rate, profit factor, avg trade duration

## Logging

All components use Python's logging module. Configure via:

```python
import logging
logging.basicConfig(level=logging.INFO)
```

## Disclaimer

This system is for educational and paper trading purposes only. Past performance does not guarantee future results. Always test thoroughly before any live trading.