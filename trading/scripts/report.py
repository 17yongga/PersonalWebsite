#!/usr/bin/env python3
"""
Telegram Trading Report Generator

Generates formatted trading reports for the PaperTrade platform.
Called by Clawdbot cron or manually to send daily P&L summaries.

Usage:
    python report.py daily     # Full daily summary
    python report.py positions # Current positions snapshot
    python report.py trades    # Today's trades
    python report.py status    # Quick account status
"""

import sys
import os
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

# Add parent dir for imports
sys.path.insert(0, str(Path(__file__).parent.parent / 'quant'))

DB_PATH = os.environ.get('DB_PATH', str(Path(__file__).parent.parent / 'server' / 'data' / 'trading.db'))
ALPACA_API_KEY = os.environ.get('ALPACA_API_KEY', '')
ALPACA_SECRET_KEY = os.environ.get('ALPACA_SECRET_KEY', '')
ALPACA_BASE_URL = os.environ.get('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets')

def get_db():
    """Connect to SQLite database."""
    if not os.path.exists(DB_PATH):
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_alpaca_account():
    """Fetch Alpaca paper account info."""
    if not ALPACA_API_KEY:
        return None
    try:
        import requests
        resp = requests.get(
            f"{ALPACA_BASE_URL}/v2/account",
            headers={
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Error fetching Alpaca account: {e}", file=sys.stderr)
    return None

def get_alpaca_positions():
    """Fetch current positions from Alpaca."""
    if not ALPACA_API_KEY:
        return []
    try:
        import requests
        resp = requests.get(
            f"{ALPACA_BASE_URL}/v2/positions",
            headers={
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Error fetching positions: {e}", file=sys.stderr)
    return []

def get_alpaca_orders(status='closed', after=None):
    """Fetch orders from Alpaca."""
    if not ALPACA_API_KEY:
        return []
    try:
        import requests
        params = {'status': status, 'limit': 50, 'direction': 'desc'}
        if after:
            params['after'] = after.isoformat() + 'Z'
        resp = requests.get(
            f"{ALPACA_BASE_URL}/v2/orders",
            headers={
                'APCA-API-KEY-ID': ALPACA_API_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
            },
            params=params,
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Error fetching orders: {e}", file=sys.stderr)
    return []

def format_currency(value):
    """Format number as currency string."""
    value = float(value)
    sign = '+' if value > 0 else ''
    return f"{sign}${abs(value):,.2f}" if value != 0 else "$0.00"

def format_pct(value):
    """Format number as percentage."""
    value = float(value)
    sign = '+' if value > 0 else ''
    return f"{sign}{value:.2f}%"

def get_pnl_emoji(value):
    """Get emoji based on P&L direction."""
    value = float(value)
    if value > 0:
        return "📈"
    elif value < 0:
        return "📉"
    return "➡️"

def generate_daily_report():
    """Generate full daily P&L summary."""
    account = get_alpaca_account()
    positions = get_alpaca_positions()
    
    # If no Alpaca connection, try local DB
    if not account:
        return generate_local_report()
    
    equity = float(account.get('equity', 0))
    cash = float(account.get('cash', 0))
    buying_power = float(account.get('buying_power', 0))
    last_equity = float(account.get('last_equity', equity))
    
    daily_pnl = equity - last_equity
    daily_pnl_pct = (daily_pnl / last_equity * 100) if last_equity > 0 else 0
    initial_capital = 10000  # From env/config
    total_return = equity - initial_capital
    total_return_pct = (total_return / initial_capital * 100) if initial_capital > 0 else 0
    
    pnl_emoji = get_pnl_emoji(daily_pnl)
    total_emoji = get_pnl_emoji(total_return)
    
    today = datetime.now().strftime('%B %d, %Y')
    
    report = f"""📊 *Daily Trading Report — {today}*

{pnl_emoji} *Today's P&L:* {format_currency(daily_pnl)} ({format_pct(daily_pnl_pct)})
{total_emoji} *Total Return:* {format_currency(total_return)} ({format_pct(total_return_pct)})

💰 *Account Summary*
├ Portfolio Value: ${equity:,.2f}
├ Cash Available: ${cash:,.2f}
├ Buying Power: ${buying_power:,.2f}
└ Starting Capital: ${initial_capital:,.2f}

"""
    
    if positions:
        report += f"📋 *Open Positions ({len(positions)})*\n"
        
        # Sort by unrealized P&L descending
        sorted_positions = sorted(positions, key=lambda p: float(p.get('unrealized_pl', 0)), reverse=True)
        
        for i, pos in enumerate(sorted_positions):
            symbol = pos.get('symbol', '?')
            qty = pos.get('qty', '0')
            current_price = float(pos.get('current_price', 0))
            avg_entry = float(pos.get('avg_entry_price', 0))
            market_value = float(pos.get('market_value', 0))
            unrealized_pl = float(pos.get('unrealized_pl', 0))
            unrealized_plpc = float(pos.get('unrealized_plpc', 0)) * 100
            
            pos_emoji = get_pnl_emoji(unrealized_pl)
            connector = "└" if i == len(sorted_positions) - 1 else "├"
            
            report += f"{connector} *{symbol}* — {qty} shares @ ${avg_entry:.2f}\n"
            report += f"{'  ' if i == len(sorted_positions) - 1 else '│ '} "
            report += f"Now: ${current_price:.2f} | P&L: {format_currency(unrealized_pl)} ({format_pct(unrealized_plpc)}) {pos_emoji}\n"
        
        report += "\n"
    else:
        report += "📋 *No open positions*\n\n"
    
    # Today's trades
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_orders = get_alpaca_orders(status='closed', after=today_start)
    filled_orders = [o for o in today_orders if o.get('status') == 'filled']
    
    if filled_orders:
        report += f"🔄 *Today's Trades ({len(filled_orders)})*\n"
        for i, order in enumerate(filled_orders):
            symbol = order.get('symbol', '?')
            side = order.get('side', '?').upper()
            qty = order.get('filled_qty', order.get('qty', '?'))
            fill_price = float(order.get('filled_avg_price', 0))
            side_emoji = "🟢" if side == 'BUY' else "🔴"
            connector = "└" if i == len(filled_orders) - 1 else "├"
            
            report += f"{connector} {side_emoji} {side} {qty}x {symbol} @ ${fill_price:.2f}\n"
        report += "\n"
    
    # Strategy status (from local DB if available)
    db = get_db()
    if db:
        try:
            strategies = db.execute(
                "SELECT name, type, status FROM strategies WHERE status = 'active'"
            ).fetchall()
            
            if strategies:
                report += f"🤖 *Active Strategies ({len(strategies)})*\n"
                for i, strat in enumerate(strategies):
                    connector = "└" if i == len(strategies) - 1 else "├"
                    status_emoji = "🟢" if strat['status'] == 'active' else "🟡"
                    report += f"{connector} {status_emoji} {strat['name']} ({strat['type']})\n"
                report += "\n"
            
            db.close()
        except:
            pass
    
    report += "─────────────────────────\n"
    report += "_PaperTrade Platform • gary-yong.com/trading_"
    
    return report

def generate_positions_report():
    """Generate positions snapshot."""
    positions = get_alpaca_positions()
    
    if not positions:
        return "📋 *Positions Snapshot*\n\nNo open positions."
    
    report = f"📋 *Positions Snapshot — {len(positions)} open*\n\n"
    
    total_value = 0
    total_pnl = 0
    
    sorted_positions = sorted(positions, key=lambda p: float(p.get('market_value', 0)), reverse=True)
    
    for pos in sorted_positions:
        symbol = pos.get('symbol', '?')
        qty = pos.get('qty', '0')
        current_price = float(pos.get('current_price', 0))
        market_value = float(pos.get('market_value', 0))
        unrealized_pl = float(pos.get('unrealized_pl', 0))
        unrealized_plpc = float(pos.get('unrealized_plpc', 0)) * 100
        
        total_value += market_value
        total_pnl += unrealized_pl
        
        emoji = get_pnl_emoji(unrealized_pl)
        report += f"{emoji} *{symbol}* — {qty} shares\n"
        report += f"   ${current_price:.2f} | Value: ${market_value:,.2f} | P&L: {format_currency(unrealized_pl)} ({format_pct(unrealized_plpc)})\n\n"
    
    total_emoji = get_pnl_emoji(total_pnl)
    report += f"─────────────────────────\n"
    report += f"{total_emoji} *Total:* ${total_value:,.2f} | P&L: {format_currency(total_pnl)}"
    
    return report

def generate_trades_report():
    """Generate today's trades report."""
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    orders = get_alpaca_orders(status='closed', after=today_start)
    filled = [o for o in orders if o.get('status') == 'filled']
    
    if not filled:
        return "🔄 *Today's Trades*\n\nNo trades executed today."
    
    report = f"🔄 *Today's Trades — {len(filled)} filled*\n\n"
    
    for order in filled:
        symbol = order.get('symbol', '?')
        side = order.get('side', '?').upper()
        qty = order.get('filled_qty', order.get('qty', '?'))
        fill_price = float(order.get('filled_avg_price', 0))
        total = float(qty) * fill_price
        side_emoji = "🟢" if side == 'BUY' else "🔴"
        filled_at = order.get('filled_at', '')[:16].replace('T', ' ')
        
        report += f"{side_emoji} *{side}* {qty}x *{symbol}*\n"
        report += f"   @ ${fill_price:.2f} (${total:,.2f}) — {filled_at}\n\n"
    
    return report

def generate_status_report():
    """Quick account status."""
    account = get_alpaca_account()
    
    if not account:
        return "⚠️ *Status:* Cannot connect to Alpaca API. Check API keys."
    
    equity = float(account.get('equity', 0))
    cash = float(account.get('cash', 0))
    last_equity = float(account.get('last_equity', equity))
    daily_pnl = equity - last_equity
    
    positions = get_alpaca_positions()
    
    emoji = get_pnl_emoji(daily_pnl)
    
    return f"""{emoji} *Quick Status*
💰 Equity: ${equity:,.2f}
💵 Cash: ${cash:,.2f}
📊 Positions: {len(positions)}
📈 Today: {format_currency(daily_pnl)}"""

def generate_local_report():
    """Fallback report from local DB when Alpaca is unavailable."""
    db = get_db()
    if not db:
        return "⚠️ No data available. Alpaca API not connected and no local database found."
    
    try:
        # Get all portfolios
        portfolios = db.execute("SELECT * FROM portfolios").fetchall()
        
        if not portfolios:
            return "📊 *Daily Report*\n\nNo portfolios created yet. Create one at gary-yong.com/trading"
        
        report = f"📊 *Daily Trading Report — {datetime.now().strftime('%B %d, %Y')}*\n\n"
        report += "⚠️ _Alpaca API not connected — showing local data_\n\n"
        
        for p in portfolios:
            total_val = p['cash_balance'] + (p.get('total_value', p['cash_balance']) - p['cash_balance'])
            pnl = total_val - p['starting_balance']
            pnl_pct = (pnl / p['starting_balance'] * 100) if p['starting_balance'] > 0 else 0
            emoji = get_pnl_emoji(pnl)
            
            report += f"{emoji} *{p['name']}*"
            if p.get('type') == 'strategy':
                report += " 🤖"
            report += f"\n   Value: ${total_val:,.2f} | Cash: ${p['cash_balance']:,.2f} | P&L: {format_currency(pnl)} ({format_pct(pnl_pct)})\n\n"
        
        db.close()
        return report
    except Exception as e:
        return f"⚠️ Error generating report: {e}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python report.py [daily|positions|trades|status]")
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    generators = {
        'daily': generate_daily_report,
        'positions': generate_positions_report,
        'trades': generate_trades_report,
        'status': generate_status_report,
    }
    
    if command not in generators:
        print(f"Unknown command: {command}")
        print(f"Available: {', '.join(generators.keys())}")
        sys.exit(1)
    
    report = generators[command]()
    print(report)

if __name__ == '__main__':
    main()
