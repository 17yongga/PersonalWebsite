# Trading Platform — Tech Debt

## Signal Reasoning — Remaining Strategies
**Added:** 2026-03-04
**Context:** Phase 1 added `reasoning: dict = None` to Signal base class and implemented it in `momentum.py` only.

The following strategies still return `reasoning=None` and need to be updated to emit structured reasoning when generating buy/sell signals:

| Strategy | File | Priority |
|----------|------|----------|
| Mean Reversion | `quant/strategies/mean_reversion.py` | High |
| Volatility Breakout | `quant/strategies/volatility_breakout.py` | High |
| Sentiment | `quant/strategies/sentiment.py` | Medium |
| Sector Rotation | `quant/strategies/sector_rotation.py` | Medium |
| Value/Dividend | `quant/strategies/value_dividend.py` | Low |

**Format to follow** (from momentum.py implementation):
```python
reasoning = {
    "indicators": {
        "rsi": round(rsi_value, 2),
        "macd_signal": "bullish" or "bearish",
        "ema_cross": "above" or "below",
    },
    "condition": "Human-readable trigger description",
    "decision": "BUY" or "SELL"
}
```

---

## Historical Reasoning Backfill
**Added:** 2026-03-04
**Context:** Phase 1 migration script only backfills reasoning for past trades using replayed indicators. Accuracy is ~90% — real-time signal timing may differ slightly from replay due to data latency at time of execution.

- If Alpaca historical data is unavailable for a trade timestamp, reasoning defaults to `{"condition": "Historical data unavailable for replay", "decision": "<action>"}`
- Consider storing raw indicator snapshot at signal time (in-memory → DB) for future trades to avoid this gap

---

## Error Handling — Python alpaca_client.py
**Added:** 2026-03-04
**Context:** Several `except Exception as e: print(e)` patterns remain in alpaca_client.py. Phase 1 added Node-side fallback (Alpaca fail → mock data), but the Python client should eventually surface structured errors rather than bare prints.
