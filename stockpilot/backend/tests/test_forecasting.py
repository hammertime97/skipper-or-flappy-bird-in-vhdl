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


def test_intermittent_uses_slow_seller_models():
    fc = forecast_weekly([0, 4, 0, 0, 3, 0, 0, 5, 0, 0, 4, 0])
    assert fc.intermittent
    assert {m.name for m in fc.models} <= {"croston_sba", "tsb", "mean4", "ses"}
    assert 0.5 < fc.next_week < 3


def test_short_history_is_new_low_confidence():
    fc = forecast_weekly([0, 0, 3, 5])
    assert fc.trend == "new" and fc.confidence == "low"
    assert fc.history == [3, 5]
    assert fc.accuracy is None


def test_ensemble_is_backtested_and_reports_accuracy():
    fc = forecast_weekly([20, 21, 19, 20, 22, 20, 19, 21, 20, 20, 21, 19, 20, 22])
    assert fc.method == "ensemble"
    assert fc.tested_weeks >= 4 and fc.accuracy is not None and fc.accuracy > 0.85
    assert len(fc.models) == 3 and abs(sum(m.weight for m in fc.models) - 1) < 1e-9


def test_seasonal_model_used_with_a_year_of_history():
    import math

    y = [20 + 15 * math.sin(2 * math.pi * t / 52) for t in range(70)]
    fc = forecast_weekly(y)
    expected = 20 + 15 * math.sin(2 * math.pi * 70 / 52)
    assert fc.seasonal
    assert abs(fc.next_week - expected) < 4


def test_unknown_stock_gives_target_not_status():
    fc = forecast_weekly([14] * 12)
    plan = plan_stock(fc, 0, 0, 14, NOW, stock_known=False)
    assert plan.status == "stock_unknown" and plan.target_stock >= 56 and plan.reorder_qty == 0


def test_shopping_calendar():
    from datetime import date

    from app.forecasting import upcoming_events

    names = {e["name"]: e["date"] for e in upcoming_events(date(2026, 10, 27), weeks=6)}
    assert names["Black Friday"] == "2026-11-27" and names["Cyber Monday"] == "2026-11-30"
    assert "Halloween" in names


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
