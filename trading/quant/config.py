"""Configuration management for the quant trading engine."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from config/.env
config_path = Path(__file__).parent.parent / "config" / ".env"
if config_path.exists():
    load_dotenv(config_path)

# Alpaca Configuration
ALPACA_API_KEY = os.getenv('ALPACA_API_KEY', '')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY', '')
ALPACA_BASE_URL = os.getenv('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets/v2')
ALPACA_DATA_URL = os.getenv('ALPACA_DATA_URL', 'https://data.alpaca.markets/v2')

# Trading Parameters
INITIAL_CAPITAL = float(os.getenv('INITIAL_CAPITAL', '10000'))
MAX_POSITION_PCT = float(os.getenv('MAX_POSITION_PCT', '0.20'))
MAX_PORTFOLIO_PCT = float(os.getenv('MAX_PORTFOLIO_PCT', '0.80'))
STOP_LOSS_PCT = float(os.getenv('STOP_LOSS_PCT', '0.05'))
DAILY_LOSS_LIMIT_PCT = float(os.getenv('DAILY_LOSS_LIMIT_PCT', '0.03'))
MAX_POSITIONS = int(os.getenv('MAX_POSITIONS', '10'))

# Universe of symbols to trade
DEFAULT_UNIVERSE = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 
    'JPM', 'V', 'JNJ', 'WMT', 'PG', 'MA', 'UNH', 'HD', 
    'DIS', 'BAC', 'XOM', 'PFE', 'KO'
]

# Database Configuration
DB_PATH = os.getenv('DB_PATH', '../server/data/trading.db')

# Logging Configuration
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_FILE = os.getenv('LOG_FILE', 'data/quant.log')

def validate_config():
    """Validate that required configuration is present."""
    required = ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY']
    missing = [key for key in required if not globals().get(key)]
    
    if missing:
        raise ValueError(f"Missing required configuration: {missing}")
    
    return True

def get_api_headers():
    """Get Alpaca API headers."""
    return {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        'Content-Type': 'application/json'
    }