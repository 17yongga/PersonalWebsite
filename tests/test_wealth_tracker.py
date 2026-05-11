import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "wealth_tracker.py"
spec = importlib.util.spec_from_file_location("wealth_tracker", MODULE_PATH)
wealth_tracker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wealth_tracker)


def test_tfsa_usd_holdings_are_converted_to_cad_with_current_fx():
    positions = [
        {"symbol": "SPY", "shares": 2, "currency": "USD"},
        {"symbol": "CASH", "cash_cad": 100, "currency": "CAD"},
    ]
    prices = {"SPY": 10}

    value = wealth_tracker.calculate_tfsa_value(positions, prices, usd_cad=1.35)

    assert value == 127.0


def test_rrsp_uses_lifepath_proxy_when_base_price_is_available():
    value = wealth_tracker.calculate_rrsp_value(
        baseline_cad=21406.74,
        current_proxy_price=156,
        base_proxy_price=150,
    )

    assert value == 22263.01


def test_snapshot_history_appends_without_dropping_existing_points():
    existing = {
        "history": [
            {"timestamp": "2026-05-08T12:00:00Z", "netWorth": 49301.0}
        ]
    }
    snapshot = {"timestamp": "2026-05-11T16:00:00Z", "netWorth": 50123.45}

    updated = wealth_tracker.with_appended_snapshot(existing, snapshot)

    assert len(updated["history"]) == 2
    assert updated["latest"]["netWorth"] == 50123.45


def test_snapshot_history_replaces_same_hour_point():
    existing = {
        "history": [
            {"timestamp": "2026-05-11T16:12:00Z", "netWorth": 50000.0}
        ]
    }
    snapshot = {"timestamp": "2026-05-11T16:50:00Z", "netWorth": 50100.0}

    updated = wealth_tracker.with_appended_snapshot(existing, snapshot)

    assert len(updated["history"]) == 1
    assert updated["history"][0]["netWorth"] == 50100.0
