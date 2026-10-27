from datetime import datetime, timedelta

from app.forecasting import forecast_weekly, plan_stock, weekly_buckets

NOW = datetime(2026, 10, 27, 12, 0)


def test_weekly_buckets_last_bucket_is_last_7_days():
    sales = [(NOW - timedelta(days=1), 2), (NOW - timedelta(days=8), 5), (NOW - timedelta(days=400), 99)]
    assert weekly_buckets(sales, NOW, 4) == [0, 0, 5, 2]


def test_no_sales():
    fc = forecast_weekly([0, 0, 0, 0])
    assert fc.trend == "no_sales" and fc.weeks == [0, 0, 0, 0]


def test_steady_series_forecasts_near_level():
    fc = forecast_weekly([20, 21, 19, 20, 22, 20, 19, 21, 20, 20, 21, 19])
    assert 18 <= fc.next_week <= 22
    assert fc.trend == "stable"
    assert fc.confidence == "high"
    assert fc.lower[0] <= fc.next_week <= fc.upper[0]


def test_rising_series_detected():
    fc = forecast_weekly([5, 7, 9, 12, 15, 18, 22, 26, 31, 36])
    assert fc.trend == "rising"
    assert fc.next_week > 36


def test_declining_series_detected_and_never_negative():
    fc = forecast_weekly([40, 35, 30, 25, 20, 15, 10, 6, 3, 1], horizon=8)
    assert fc.trend == "declining"
    assert all(v >= 0 for v in fc.weeks + fc.lower)


def test_intermittent_uses_croston():
    fc = forecast_weekly([0, 4, 0, 0, 3, 0, 0, 5, 0, 0, 4, 0])
    assert fc.method == "croston_sba"
    assert 0.5 < fc.next_week < 3


def test_short_history_is_new_low_confidence():
    fc = forecast_weekly([0, 0, 3, 5])
    assert fc.trend == "new" and fc.confidence == "low"
    assert fc.history == [3, 5]


def test_plan_reorder_now_when_stock_runs_out_before_lead_time():
    fc = forecast_weekly([14] * 12)  # 2/day
    plan = plan_stock(fc, stock=10, incoming=0, lead_time_days=14, today=NOW)
    assert plan.status == "reorder_now"
    assert plan.stockout_in_days == 5
    # 14 days lead + 14 days cover at 2/day = 56, minus 10 on hand
    assert 44 <= plan.reorder_qty <= 50


def test_plan_counts_incoming():
    fc = forecast_weekly([14] * 12)
    a = plan_stock(fc, stock=10, incoming=0, lead_time_days=14, today=NOW)
    b = plan_stock(fc, stock=10, incoming=20, lead_time_days=14, today=NOW)
    assert b.reorder_qty == a.reorder_qty - 20


def test_plan_statuses():
    fc = forecast_weekly([14] * 12)
    assert plan_stock(fc, 0, 0, 7, NOW).status == "out_of_stock"
    assert plan_stock(fc, 400, 0, 7, NOW).status == "overstock"
    assert plan_stock(fc, 60, 0, 7, NOW).status == "healthy"
    dead = forecast_weekly([0] * 12)
    assert plan_stock(dead, 50, 0, 7, NOW).status == "dead_stock"
    assert plan_stock(dead, 0, 0, 7, NOW).status == "no_demand"


def test_dropship_note():
    fc = forecast_weekly([14] * 12)
    plan = plan_stock(fc, 5, 0, 10, NOW, fulfilment="dropship")
    assert any("supplier" in n.lower() for n in plan.notes)
