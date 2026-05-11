#!/usr/bin/env python3
"""Hourly safe wealth tracker for Gary's private dashboard.

No brokerage login. Uses public market data for known holdings and keeps a
persistent JSON history for the dashboard chart.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import urllib.request
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "wealth-live.json"
S3_URI = "s3://gary-yong.com/data/wealth-live.json"
AWS_PROFILE = "clawdbot-deploy"

BASELINE_DATE = "2026-05-08"
GOAL_CAD = 190_000
BASELINE = {
    "netWorth": 49300.84,
    "tfsa": 23017.21,
    "rrsp": 21406.74,
    "crypto": 1843.38,
    "cash": 3033.51,
}

# Screenshot holdings from May 8, 2026. USD positions are valued with live USD
# quotes and live USD/CAD. Cash is already CAD.
TFSA_POSITIONS = [
    {"symbol": "SPY", "shares": 9.7726, "currency": "USD", "baseline_usd": 7209.59},
    {"symbol": "NVDA", "shares": 8.5398, "currency": "USD", "baseline_usd": 1836.48},
    {"symbol": "AMD", "shares": 3.961, "currency": "USD", "baseline_usd": 1826.81},
    {"symbol": "TSLA", "shares": 3.7126, "currency": "USD", "baseline_usd": 1588.92},
    {"symbol": "QQQ", "shares": 1.0, "currency": "USD", "baseline_usd": 712.11},
    {"symbol": "GLD", "shares": 1.4554, "currency": "USD", "baseline_usd": 629.94},
    {"symbol": "ICLN", "shares": 28.9536, "currency": "USD", "baseline_usd": 613.82},
    {"symbol": "MSFT", "shares": 1.0, "currency": "USD", "baseline_usd": 415.10},
    {"symbol": "BKSY", "shares": 10.0, "currency": "USD", "baseline_usd": 391.31},
    {"symbol": "ARKK", "shares": 3.2657, "currency": "USD", "baseline_usd": 258.38},
    {"symbol": "PLTR", "shares": 0.1944, "currency": "USD", "baseline_usd": 26.65},
    {"symbol": "BIRD", "shares": 1.0, "currency": "USD", "baseline_usd": 5.64},
    {"symbol": "CASH", "cash_cad": 1780.63, "currency": "CAD"},
]

CRYPTO_POSITIONS = [
    {"id": "bitcoin", "symbol": "BTC", "units": 0.016204},
    {"id": "usd-coin", "symbol": "USDC", "units": 2.100393},
    {"id": "ethereum", "symbol": "ETH", "units": 0.000003},
    {"id": "CASH", "symbol": "CASH", "cash_cad": 15.40},
]

PUBLIC_PRICE_SYMBOLS = [
    p["symbol"] for p in TFSA_POSITIONS if p.get("currency") == "USD"
] + ["VT"]

MANUAL_HISTORY = [
    {"timestamp": "2026-03-13T12:00:00Z", "date": "2026-03-13", "netWorth": 42900, "tfsa": 17405, "rrsp": None, "crypto": None, "cash": None, "note": "First snapshot"},
    {"timestamp": "2026-03-23T12:00:00Z", "date": "2026-03-23", "netWorth": 43591, "tfsa": 17584, "rrsp": None, "crypto": None, "cash": None, "note": "GLD hedge added"},
    {"timestamp": "2026-04-01T12:00:00Z", "date": "2026-04-01", "netWorth": 43666, "tfsa": 17705, "rrsp": None, "crypto": None, "cash": None, "note": "Monthly auto-buys"},
    {"timestamp": "2026-04-07T12:00:00Z", "date": "2026-04-07", "netWorth": 42244, "tfsa": 18736, "rrsp": 19445, "crypto": 1446, "cash": 2631, "note": "Market dip, MKT -54%"},
    {"timestamp": "2026-04-22T12:00:00Z", "date": "2026-04-22", "netWorth": 44620, "tfsa": 20509, "rrsp": 20228, "crypto": 1651, "cash": 2631, "note": "AMD rally +133%, sold MKT"},
    {"timestamp": "2026-04-24T12:00:00Z", "date": "2026-04-24", "netWorth": 45100, "tfsa": 20989, "rrsp": 20228, "crypto": 1651, "cash": 2831, "note": "AMD trimmed, SPY strengthened"},
    {"timestamp": "2026-04-29T12:00:00Z", "date": "2026-04-29", "netWorth": 46279, "tfsa": 20989, "rrsp": 21407, "crypto": 1651, "cash": 2831, "note": "RRSP refreshed +$1,179"},
    {"timestamp": "2026-05-08T12:00:00Z", "date": "2026-05-08", "netWorth": 49301, "tfsa": 23017, "rrsp": 21407, "crypto": 1843, "cash": 3034, "note": "Full Wealthsimple refresh"},
]


def money(value: float) -> float:
    return round(float(value), 2)


def calculate_tfsa_value(positions: list[dict[str, Any]], prices: dict[str, float], usd_cad: float) -> float:
    total = 0.0
    for position in positions:
        if position.get("currency") == "CAD":
            total += position["cash_cad"]
            continue
        total += position["shares"] * prices[position["symbol"]] * usd_cad
    return money(total)


def calculate_crypto_value(positions: list[dict[str, Any]], prices_cad: dict[str, float]) -> float:
    total = 0.0
    for position in positions:
        if position["id"] == "CASH":
            total += position["cash_cad"]
        else:
            total += position["units"] * prices_cad[position["id"]]
    return money(total)


def calculate_rrsp_value(baseline_cad: float, current_proxy_price: float, base_proxy_price: float | None) -> float:
    if not base_proxy_price or base_proxy_price <= 0:
        return money(baseline_cad)
    return money(baseline_cad * (current_proxy_price / base_proxy_price))


def same_utc_hour(a: str, b: str) -> bool:
    return a[:13] == b[:13]


def with_appended_snapshot(existing: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    updated = deepcopy(existing)
    history = list(updated.get("history") or [])
    if history and same_utc_hour(history[-1]["timestamp"], snapshot["timestamp"]):
        history[-1] = snapshot
    else:
        history.append(snapshot)
    updated["history"] = history[-24 * 370:]  # >1 year hourly cap, keeps file small
    updated["latest"] = snapshot
    return updated


def fetch_stooq_close(symbol: str) -> float:
    stooq_symbol = "usdcad" if symbol == "USDCAD" else f"{symbol.lower()}.us"
    url = f"https://stooq.com/q/l/?s={stooq_symbol}&f=sd2t2ohlcv&h&e=csv"
    with urllib.request.urlopen(url, timeout=20) as response:
        rows = list(csv.DictReader(response.read().decode().splitlines()))
    if not rows or rows[0]["Close"] in {"N/D", ""}:
        raise RuntimeError(f"No public quote returned for {symbol}")
    return float(rows[0]["Close"])


def fetch_public_prices() -> tuple[dict[str, float], float]:
    prices = {symbol: fetch_stooq_close(symbol) for symbol in PUBLIC_PRICE_SYMBOLS}
    usd_cad = fetch_stooq_close("USDCAD")
    return prices, usd_cad


def fetch_crypto_prices_cad() -> dict[str, float]:
    ids = ",".join(p["id"] for p in CRYPTO_POSITIONS if p["id"] != "CASH")
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=cad"
    with urllib.request.urlopen(url, timeout=20) as response:
        payload = json.loads(response.read().decode())
    return {asset_id: float(values["cad"]) for asset_id, values in payload.items()}


def load_existing(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text())
    return {
        "schemaVersion": 1,
        "asOfBaseline": BASELINE_DATE,
        "methodology": "Estimated live values from public market prices. No Wealthsimple login/API access.",
        "rrspMethodology": "RRSP is BlackRock LifePath 2065 from screenshots, estimated using VT as a public global-equity proxy until next manual screenshot reconciliation.",
        "baseline": BASELINE,
        "positions": {"tfsa": TFSA_POSITIONS, "crypto": CRYPTO_POSITIONS},
        "metadata": {},
        "history": MANUAL_HISTORY,
        "latest": MANUAL_HISTORY[-1],
    }


def build_snapshot(existing: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    prices, usd_cad = fetch_public_prices()
    crypto_prices = fetch_crypto_prices_cad()

    metadata = existing.setdefault("metadata", {})
    rrsp_base_proxy = metadata.get("rrspProxyBasePrice") or prices["VT"]
    metadata["rrspProxyBasePrice"] = rrsp_base_proxy
    metadata["rrspProxySymbol"] = "VT"
    metadata["rrspProduct"] = "BlackRock LifePath 2065"

    tfsa = calculate_tfsa_value(TFSA_POSITIONS, prices, usd_cad)
    crypto = calculate_crypto_value(CRYPTO_POSITIONS, crypto_prices)
    rrsp = calculate_rrsp_value(BASELINE["rrsp"], prices["VT"], rrsp_base_proxy)
    cash = BASELINE["cash"]
    net_worth = money(tfsa + crypto + rrsp + cash)

    holdings = []
    for position in TFSA_POSITIONS:
        if position.get("currency") == "CAD":
            value_cad = position["cash_cad"]
        else:
            value_cad = position["shares"] * prices[position["symbol"]] * usd_cad
        holdings.append({
            "symbol": position["symbol"],
            "valueCad": money(value_cad),
            "weightPct": round(value_cad / tfsa * 100, 1) if tfsa else 0,
        })

    return {
        "timestamp": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "date": now.date().isoformat(),
        "netWorth": net_worth,
        "tfsa": tfsa,
        "rrsp": rrsp,
        "crypto": crypto,
        "cash": cash,
        "goalPct": round(net_worth / GOAL_CAD * 100, 1),
        "changeSinceBaseline": money(net_worth - BASELINE["netWorth"]),
        "source": "public-market-estimate",
        "note": "Hourly public-price estimate",
        "prices": {
            "usdCad": usd_cad,
            "public": prices,
            "cryptoCad": crypto_prices,
        },
        "holdings": {"tfsa": holdings},
    }


def save(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")


def upload(path: Path) -> None:
    subprocess.run([
        "aws", "s3", "cp", str(path), S3_URI,
        "--profile", AWS_PROFILE,
        "--content-type", "application/json",
        "--cache-control", "max-age=300",
    ], check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DATA_PATH)
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args(argv)

    existing = load_existing(args.output)
    snapshot = build_snapshot(existing)
    updated = with_appended_snapshot(existing, snapshot)
    save(args.output, updated)
    if args.upload:
        upload(args.output)
    print(
        f"wealth-live updated: ${snapshot['netWorth']:,.2f} "
        f"(TFSA ${snapshot['tfsa']:,.2f}, RRSP ${snapshot['rrsp']:,.2f}, "
        f"crypto ${snapshot['crypto']:,.2f}) @ {snapshot['timestamp']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
