"""Alpaca API client using requests for direct control."""

import requests
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import config

logger = logging.getLogger(__name__)

class AlpacaClient:
    """Wrapper around Alpaca API using requests library."""
    
    def __init__(self):
        self.base_url = config.ALPACA_BASE_URL
        self.data_url = config.ALPACA_DATA_URL
        self.headers = config.get_api_headers()
        self.session = requests.Session()
        self.session.headers.update(self.headers)
    
    def _request(self, method: str, url: str, **kwargs) -> Dict[str, Any]:
        """Make an API request with error handling."""
        try:
            response = self.session.request(method, url, **kwargs)
            response.raise_for_status()
            
            if response.content:
                return response.json()
            return {}
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error {e.response.status_code}: {e.response.text}")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error: {e}")
            raise
    
    def get_account(self) -> Dict[str, Any]:
        """Get account information."""
        url = f"{self.base_url}/account"
        return self._request('GET', url)
    
    def get_positions(self) -> List[Dict[str, Any]]:
        """Get all current positions."""
        url = f"{self.base_url}/positions"
        return self._request('GET', url)
    
    def get_position(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get position for a specific symbol."""
        url = f"{self.base_url}/positions/{symbol}"
        try:
            return self._request('GET', url)
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise
    
    def get_orders(self, status: str = 'all', limit: int = 100) -> List[Dict[str, Any]]:
        """Get orders with optional filtering."""
        url = f"{self.base_url}/orders"
        params = {'status': status, 'limit': limit}
        return self._request('GET', url, params=params)
    
    def get_orders_by_client_prefix(self, prefix: str, status: str = 'all', limit: int = 500) -> List[Dict[str, Any]]:
        """Get orders where client_order_id starts with prefix."""
        all_orders = self.get_orders(status=status, limit=limit)
        return [o for o in all_orders if o.get('client_order_id', '').startswith(prefix)]
    
    def get_order(self, order_id: str) -> Dict[str, Any]:
        """Get a specific order by ID."""
        url = f"{self.base_url}/orders/{order_id}"
        return self._request('GET', url)
    
    def place_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        order_type: str = 'market',
        time_in_force: str = 'day',
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
        client_order_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Place a new order."""
        url = f"{self.base_url}/orders"
        
        data = {
            'symbol': symbol,
            'qty': qty,
            'side': side,
            'type': order_type,
            'time_in_force': time_in_force
        }
        
        if limit_price is not None:
            data['limit_price'] = limit_price
        if stop_price is not None:
            data['stop_price'] = stop_price
        if client_order_id is not None:
            data['client_order_id'] = client_order_id
        
        logger.info(f"Placing {side} order: {qty} shares of {symbol} @ {order_type}")
        return self._request('POST', url, json=data)
    
    def cancel_order(self, order_id: str) -> Dict[str, Any]:
        """Cancel an order."""
        url = f"{self.base_url}/orders/{order_id}"
        logger.info(f"Cancelling order {order_id}")
        return self._request('DELETE', url)
    
    def cancel_all_orders(self) -> List[Dict[str, Any]]:
        """Cancel all open orders."""
        url = f"{self.base_url}/orders"
        logger.info("Cancelling all open orders")
        return self._request('DELETE', url)
    
    def get_latest_quotes(self, symbols: List[str]) -> Dict[str, Any]:
        """Get latest quotes for symbols."""
        url = f"{self.data_url}/stocks/quotes/latest"
        params = {'symbols': ','.join(symbols), 'feed': 'iex'}
        return self._request('GET', url, params=params)
    
    def get_latest_quote(self, symbol: str) -> Dict[str, Any]:
        """Get latest quote for a single symbol."""
        quotes = self.get_latest_quotes([symbol])
        return quotes.get('quotes', {}).get(symbol, {})
    
    def get_historical_bars(
        self,
        symbols: List[str],
        timeframe: str = '1Day',
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: int = 1000
    ) -> Dict[str, Any]:
        """Get historical bars for symbols."""
        url = f"{self.data_url}/stocks/bars"
        
        params = {
            'symbols': ','.join(symbols),
            'timeframe': timeframe,
            'limit': limit,
            'feed': 'iex'
        }
        
        if start:
            params['start'] = start
        if end:
            params['end'] = end
        
        return self._request('GET', url, params=params)
    
    def get_bars_for_symbol(
        self,
        symbol: str,
        timeframe: str = '1Day',
        start: Optional[str] = None,
        end: Optional[str] = None,
        limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """Get historical bars for a single symbol."""
        data = self.get_historical_bars([symbol], timeframe, start, end, limit)
        return data.get('bars', {}).get(symbol, [])
    
    def get_portfolio_value(self) -> float:
        """Get total portfolio value (cash + positions)."""
        account = self.get_account()
        return float(account.get('portfolio_value', 0))
    
    def get_buying_power(self) -> float:
        """Get available buying power."""
        account = self.get_account()
        return float(account.get('buying_power', 0))
    
    def is_market_open(self) -> bool:
        """Check if the market is currently open."""
        url = f"{self.base_url}/clock"
        clock = self._request('GET', url)
        return clock.get('is_open', False)

# Global client instance
client = AlpacaClient()