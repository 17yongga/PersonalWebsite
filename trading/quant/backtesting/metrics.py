"""Performance metrics for backtesting results."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
from datetime import datetime

def calculate_performance_metrics(
    portfolio_values: pd.Series,
    trades: List[Any],
    initial_capital: float
) -> Dict[str, float]:
    """
    Calculate comprehensive performance metrics.
    
    Args:
        portfolio_values: Time series of portfolio values
        trades: List of completed trades
        initial_capital: Starting capital
    
    Returns:
        Dictionary of performance metrics
    """
    if len(portfolio_values) == 0:
        return {}
    
    # Basic return metrics
    final_value = portfolio_values.iloc[-1]
    total_return = (final_value - initial_capital) / initial_capital
    
    # Time-based metrics
    start_date = portfolio_values.index[0]
    end_date = portfolio_values.index[-1]
    days = (end_date - start_date).days
    years = days / 365.25
    
    annualized_return = (final_value / initial_capital) ** (1/years) - 1 if years > 0 else 0
    
    # Daily returns
    returns = portfolio_values.pct_change().dropna()
    
    # Risk metrics
    volatility = returns.std() * np.sqrt(252)  # Annualized
    downside_returns = returns[returns < 0]
    downside_volatility = downside_returns.std() * np.sqrt(252) if len(downside_returns) > 0 else 0
    
    # Sharpe ratio (assuming 0% risk-free rate)
    sharpe_ratio = annualized_return / volatility if volatility > 0 else 0
    
    # Sortino ratio
    sortino_ratio = annualized_return / downside_volatility if downside_volatility > 0 else 0
    
    # Maximum drawdown
    rolling_max = portfolio_values.expanding().max()
    drawdown = (portfolio_values - rolling_max) / rolling_max
    max_drawdown = drawdown.min()
    max_drawdown_duration = _calculate_max_drawdown_duration(drawdown)
    
    # Trade-based metrics
    trade_metrics = _calculate_trade_metrics(trades) if trades else {}
    
    # Calmar ratio
    calmar_ratio = annualized_return / abs(max_drawdown) if max_drawdown != 0 else 0
    
    # Win rate and profit factor from trades
    win_rate = trade_metrics.get('win_rate', 0)
    profit_factor = trade_metrics.get('profit_factor', 0)
    
    # Risk-adjusted returns
    var_95 = np.percentile(returns, 5) if len(returns) > 0 else 0
    expected_shortfall = returns[returns <= var_95].mean() if len(returns) > 0 and var_95 < 0 else 0
    
    return {
        # Return metrics
        'total_return': total_return,
        'annualized_return': annualized_return,
        'final_value': final_value,
        'total_pnl': final_value - initial_capital,
        
        # Risk metrics
        'volatility': volatility,
        'downside_volatility': downside_volatility,
        'max_drawdown': max_drawdown,
        'max_drawdown_duration_days': max_drawdown_duration,
        
        # Risk-adjusted metrics
        'sharpe_ratio': sharpe_ratio,
        'sortino_ratio': sortino_ratio,
        'calmar_ratio': calmar_ratio,
        
        # Trade metrics
        'total_trades': len(trades),
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'avg_trade_duration': trade_metrics.get('avg_duration', 0),
        'avg_win': trade_metrics.get('avg_win', 0),
        'avg_loss': trade_metrics.get('avg_loss', 0),
        'largest_win': trade_metrics.get('largest_win', 0),
        'largest_loss': trade_metrics.get('largest_loss', 0),
        
        # Additional risk metrics
        'var_95': var_95,
        'expected_shortfall': expected_shortfall,
        
        # Time metrics
        'backtest_days': days,
        'backtest_years': years,
        
        # Benchmark metrics (vs buy-and-hold)
        'excess_return': 0,  # Would need benchmark data
        'beta': 0,           # Would need benchmark data
        'alpha': 0,          # Would need benchmark data
        'information_ratio': 0  # Would need benchmark data
    }

def _calculate_trade_metrics(trades: List[Any]) -> Dict[str, float]:
    """Calculate metrics based on completed trades."""
    if not trades:
        return {}
    
    # Extract P&L data
    pnls = [trade.pnl for trade in trades]
    durations = [trade.duration_days for trade in trades]
    
    winning_trades = [pnl for pnl in pnls if pnl > 0]
    losing_trades = [pnl for pnl in pnls if pnl < 0]
    
    # Win rate
    win_rate = len(winning_trades) / len(trades) if trades else 0
    
    # Profit factor
    total_wins = sum(winning_trades) if winning_trades else 0
    total_losses = abs(sum(losing_trades)) if losing_trades else 0
    profit_factor = total_wins / total_losses if total_losses > 0 else float('inf') if total_wins > 0 else 0
    
    # Average metrics
    avg_win = np.mean(winning_trades) if winning_trades else 0
    avg_loss = np.mean(losing_trades) if losing_trades else 0
    avg_duration = np.mean(durations) if durations else 0
    
    # Extreme values
    largest_win = max(pnls) if pnls else 0
    largest_loss = min(pnls) if pnls else 0
    
    # Consecutive wins/losses
    max_consecutive_wins = _calculate_max_consecutive(pnls, positive=True)
    max_consecutive_losses = _calculate_max_consecutive(pnls, positive=False)
    
    return {
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'avg_duration': avg_duration,
        'largest_win': largest_win,
        'largest_loss': largest_loss,
        'max_consecutive_wins': max_consecutive_wins,
        'max_consecutive_losses': max_consecutive_losses,
        'total_winning_trades': len(winning_trades),
        'total_losing_trades': len(losing_trades)
    }

def _calculate_max_drawdown_duration(drawdown: pd.Series) -> int:
    """Calculate the maximum drawdown duration in days."""
    in_drawdown = drawdown < 0
    
    if not in_drawdown.any():
        return 0
    
    # Find consecutive periods of drawdown
    drawdown_periods = []
    current_period = 0
    
    for is_dd in in_drawdown:
        if is_dd:
            current_period += 1
        else:
            if current_period > 0:
                drawdown_periods.append(current_period)
                current_period = 0
    
    # Don't forget the last period if it ends in drawdown
    if current_period > 0:
        drawdown_periods.append(current_period)
    
    return max(drawdown_periods) if drawdown_periods else 0

def _calculate_max_consecutive(pnls: List[float], positive: bool = True) -> int:
    """Calculate maximum consecutive wins or losses."""
    if not pnls:
        return 0
    
    max_consecutive = 0
    current_consecutive = 0
    
    for pnl in pnls:
        is_target = (pnl > 0) if positive else (pnl < 0)
        
        if is_target:
            current_consecutive += 1
            max_consecutive = max(max_consecutive, current_consecutive)
        else:
            current_consecutive = 0
    
    return max_consecutive

def calculate_rolling_metrics(
    portfolio_values: pd.Series,
    window_days: int = 252
) -> pd.DataFrame:
    """Calculate rolling performance metrics."""
    returns = portfolio_values.pct_change().dropna()
    
    rolling_metrics = pd.DataFrame(index=returns.index)
    
    # Rolling returns (annualized)
    rolling_metrics['rolling_return'] = (
        (portfolio_values / portfolio_values.shift(window_days)) ** (252/window_days) - 1
    )
    
    # Rolling volatility (annualized)
    rolling_metrics['rolling_volatility'] = (
        returns.rolling(window=window_days).std() * np.sqrt(252)
    )
    
    # Rolling Sharpe ratio
    rolling_metrics['rolling_sharpe'] = (
        rolling_metrics['rolling_return'] / rolling_metrics['rolling_volatility']
    )
    
    # Rolling max drawdown
    rolling_max = portfolio_values.rolling(window=window_days).max()
    rolling_drawdown = (portfolio_values - rolling_max) / rolling_max
    rolling_metrics['rolling_max_drawdown'] = (
        rolling_drawdown.rolling(window=window_days).min()
    )
    
    return rolling_metrics

def generate_performance_report(metrics: Dict[str, float]) -> str:
    """Generate a formatted performance report."""
    report = []
    report.append("=" * 60)
    report.append("BACKTEST PERFORMANCE REPORT")
    report.append("=" * 60)
    
    # Return metrics
    report.append("\nRETURN METRICS:")
    report.append(f"Total Return:        {metrics.get('total_return', 0):.2%}")
    report.append(f"Annualized Return:   {metrics.get('annualized_return', 0):.2%}")
    report.append(f"Total P&L:           ${metrics.get('total_pnl', 0):,.2f}")
    report.append(f"Final Value:         ${metrics.get('final_value', 0):,.2f}")
    
    # Risk metrics
    report.append("\nRISK METRICS:")
    report.append(f"Volatility:          {metrics.get('volatility', 0):.2%}")
    report.append(f"Maximum Drawdown:    {metrics.get('max_drawdown', 0):.2%}")
    report.append(f"Max DD Duration:     {metrics.get('max_drawdown_duration_days', 0):.0f} days")
    
    # Risk-adjusted metrics
    report.append("\nRISK-ADJUSTED METRICS:")
    report.append(f"Sharpe Ratio:        {metrics.get('sharpe_ratio', 0):.2f}")
    report.append(f"Sortino Ratio:       {metrics.get('sortino_ratio', 0):.2f}")
    report.append(f"Calmar Ratio:        {metrics.get('calmar_ratio', 0):.2f}")
    
    # Trade metrics
    report.append("\nTRADE METRICS:")
    report.append(f"Total Trades:        {metrics.get('total_trades', 0):.0f}")
    report.append(f"Win Rate:            {metrics.get('win_rate', 0):.2%}")
    report.append(f"Profit Factor:       {metrics.get('profit_factor', 0):.2f}")
    report.append(f"Avg Trade Duration:  {metrics.get('avg_trade_duration', 0):.1f} days")
    report.append(f"Average Win:         ${metrics.get('avg_win', 0):.2f}")
    report.append(f"Average Loss:        ${metrics.get('avg_loss', 0):.2f}")
    report.append(f"Largest Win:         ${metrics.get('largest_win', 0):.2f}")
    report.append(f"Largest Loss:        ${metrics.get('largest_loss', 0):.2f}")
    
    report.append("\n" + "=" * 60)
    
    return "\n".join(report)

def benchmark_against_buy_and_hold(
    portfolio_values: pd.Series,
    benchmark_prices: pd.Series,
    initial_capital: float
) -> Dict[str, float]:
    """Compare strategy performance against buy-and-hold benchmark."""
    if len(benchmark_prices) == 0:
        return {}
    
    # Calculate buy-and-hold returns
    start_price = benchmark_prices.iloc[0]
    end_price = benchmark_prices.iloc[-1]
    
    shares_bought = initial_capital / start_price
    benchmark_final_value = shares_bought * end_price
    benchmark_return = (benchmark_final_value - initial_capital) / initial_capital
    
    # Strategy returns
    strategy_final_value = portfolio_values.iloc[-1]
    strategy_return = (strategy_final_value - initial_capital) / initial_capital
    
    # Excess return
    excess_return = strategy_return - benchmark_return
    
    # Beta calculation (simplified)
    strategy_returns = portfolio_values.pct_change().dropna()
    benchmark_returns = benchmark_prices.pct_change().dropna()
    
    # Align the series
    common_dates = strategy_returns.index.intersection(benchmark_returns.index)
    strategy_aligned = strategy_returns.loc[common_dates]
    benchmark_aligned = benchmark_returns.loc[common_dates]
    
    if len(strategy_aligned) > 10:
        covariance = np.cov(strategy_aligned, benchmark_aligned)[0, 1]
        benchmark_variance = np.var(benchmark_aligned)
        beta = covariance / benchmark_variance if benchmark_variance > 0 else 1
        
        # Alpha (Jensen's alpha)
        alpha = strategy_return - beta * benchmark_return
    else:
        beta = 1
        alpha = 0
    
    return {
        'benchmark_return': benchmark_return,
        'excess_return': excess_return,
        'beta': beta,
        'alpha': alpha,
        'benchmark_final_value': benchmark_final_value
    }