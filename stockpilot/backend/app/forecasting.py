"""Weekly demand forecasting and stock planning.

Pure Python, no I/O. The numbers here are what the app shows the seller; the
AI layer only explains and prioritises them, it never invents its own figures.

Model choice per product:
  * no sales             -> zero forecast
  * < 4 weeks of history -> recency-weighted mean (low confidence)
  * intermittent demand  -> Croston / SBA (many zero weeks, e.g. slow movers)
  * otherwise            -> damped Holt (level + trend), parameters fitted by
                            grid search on one-step-ahead error
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from statistics import mean, pstdev
from typing import Iterable

Z_80 = 1.2816  # two-sided 80% interval
SERVICE_Z = 1.2816  # safety stock for ~90% cycle service level

TREND_THRESHOLD = 0.15  # +/-15% vs recent average counts as rising/declining


@dataclass
class Forecast:
    method: str
    history: list[float]  # weekly units, oldest -> newest (leading zero weeks trimmed)
    weeks: list[float]  # point forecast for the next N weeks
    lower: list[float]
    upper: list[float]
    trend: str  # "rising" | "stable" | "declining" | "new" | "no_sales"
    trend_pct: float  # last 4 weeks vs the 4 before, e.g. 0.25 = +25%
    confidence: str  # "high" | "medium" | "low"
    residual_std: float = 0.0

    @property
    def next_week(self) -> float:
        return self.weeks[0] if self.weeks else 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["next_week"] = round(self.next_week, 2)
        for k in ("weeks", "lower", "upper", "history"):
            d[k] = [round(v, 2) for v in d[k]]
        d["trend_pct"] = round(self.trend_pct, 3)
        d["residual_std"] = round(self.residual_std, 3)
        return d


@dataclass
class StockPlan:
    status: str  # "out_of_stock" | "reorder_now" | "low" | "healthy" | "overstock" | "dead_stock" | "no_demand"
    weeks_of_cover: float | None  # None = infinite (no demand)
    stockout_in_days: int | None  # None = not within the planning horizon
    stockout_date: str | None
    reorder_qty: int
    safety_stock: int
    reason: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        if d["weeks_of_cover"] is not None:
            d["weeks_of_cover"] = round(d["weeks_of_cover"], 1)
        return d


def weekly_buckets(sales: Iterable[tuple[datetime, float]], end: datetime, weeks: int) -> list[float]:
    """Sum units into rolling 7-day buckets ending at `end` (oldest first).

    The last bucket is the 7 days up to `end`, so "next week" means the next 7 days.
    """
    buckets = [0.0] * weeks
    start = end - timedelta(days=7 * weeks)
    for sold_at, qty in sales:
        if sold_at < start or sold_at >= end:
            continue
        idx = int((sold_at - start).total_seconds() // (7 * 86400))
        buckets[min(idx, weeks - 1)] += qty
    return buckets


def _trim_leading_zeros(y: list[float]) -> list[float]:
    for i, v in enumerate(y):
        if v > 0:
            return y[i:]
    return []


def _holt_damped(y: list[float], alpha: float, beta: float, phi: float, horizon: int) -> tuple[list[float], float]:
    """Return (forecasts, sse of one-step-ahead errors)."""
    level = y[0]
    if len(y) >= 4:
        trend = (mean(y[2:4]) - mean(y[0:2])) / 2
    else:
        trend = y[1] - y[0]
    sse = 0.0
    for t in range(1, len(y)):
        fc = level + phi * trend
        err = y[t] - fc
        sse += err * err
        new_level = alpha * y[t] + (1 - alpha) * (level + phi * trend)
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        level = new_level
    out = []
    damp = 0.0
    for k in range(1, horizon + 1):
        damp += phi**k
        out.append(max(0.0, level + damp * trend))
    return out, sse


def _fit_holt(y: list[float], horizon: int) -> tuple[list[float], float]:
    best: tuple[float, list[float]] | None = None
    for alpha in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        for beta in (0.05, 0.1, 0.2, 0.3):
            for phi in (0.8, 0.9, 0.98):
                fc, sse = _holt_damped(y, alpha, beta, phi, horizon)
                if best is None or sse < best[0]:
                    best = (sse, fc)
    assert best is not None
    sse, fc = best
    resid_std = math.sqrt(sse / max(1, len(y) - 2))
    return fc, resid_std


def _croston_sba(y: list[float], horizon: int, alpha: float = 0.15) -> tuple[list[float], float]:
    """Syntetos-Boylan approximation of Croston's method for intermittent demand."""
    demands = [(i, v) for i, v in enumerate(y) if v > 0]
    z = demands[0][1]
    p = float(demands[0][0] + 1)
    last = demands[0][0]
    for i, v in demands[1:]:
        z = alpha * v + (1 - alpha) * z
        p = alpha * (i - last) + (1 - alpha) * p
        last = i
    rate = (1 - alpha / 2) * z / p
    return [rate] * horizon, pstdev(y)


def _recent_mean(y: list[float], horizon: int) -> tuple[list[float], float]:
    weights = list(range(1, len(y) + 1))  # newer weeks count more
    rate = sum(w * v for w, v in zip(weights, y)) / sum(weights)
    return [rate] * horizon, (pstdev(y) if len(y) > 1 else rate * 0.5)


def forecast_weekly(raw_history: list[float], horizon: int = 4) -> Forecast:
    """Forecast the next `horizon` weeks of unit sales from weekly history."""
    y = _trim_leading_zeros(list(raw_history))
    if not y:
        zeros = [0.0] * horizon
        return Forecast("none", [], zeros, zeros, zeros, "no_sales", 0.0, "low")

    zero_share = sum(1 for v in y if v == 0) / len(y)
    if len(y) < 4:
        method = "recent_mean"
        fc, std = _recent_mean(y, horizon)
    elif zero_share >= 0.4 and len(y) >= 6:
        method = "croston_sba"
        fc, std = _croston_sba(y, horizon)
    else:
        method = "holt_damped"
        fc, std = _fit_holt(y, horizon)

    lower = [max(0.0, f - Z_80 * std * math.sqrt(k)) for k, f in enumerate(fc, 1)]
    upper = [f + Z_80 * std * math.sqrt(k) for k, f in enumerate(fc, 1)]

    # Momentum: last 4 weeks vs the 4 before (observed), or forecast vs last 4 weeks
    # when there isn't enough history for that.
    recent = mean(y[-4:])
    if len(y) >= 8 and mean(y[-8:-4]) > 0:
        trend_pct = (recent - mean(y[-8:-4])) / mean(y[-8:-4])
    else:
        trend_pct = (fc[0] - recent) / recent if recent > 0 else 0.0
    if len(y) < 4:
        trend = "new"
    elif trend_pct >= TREND_THRESHOLD:
        trend = "rising"
    elif trend_pct <= -TREND_THRESHOLD:
        trend = "declining"
    else:
        trend = "stable"

    level = mean(y[-8:]) or 1.0
    cv = std / level
    if len(y) >= 12 and cv < 0.35:
        confidence = "high"
    elif len(y) >= 6 and cv < 0.7:
        confidence = "medium"
    else:
        confidence = "low"

    return Forecast(method, y, fc, lower, upper, trend, trend_pct, confidence, std)


def plan_stock(
    fc: Forecast,
    stock: int,
    incoming: int,
    lead_time_days: int,
    today: datetime,
    cover_weeks: float = 2.0,
    fulfilment: str = "own_stock",
) -> StockPlan:
    """Turn a demand forecast into stock-out timing and a reorder suggestion.

    Reorder target = expected demand over (lead time + `cover_weeks`) plus safety
    stock, minus what is on hand and already incoming.
    """
    weekly = fc.next_week
    lead_weeks = max(0, lead_time_days) / 7
    horizon_weeks = lead_weeks + cover_weeks

    safety = math.ceil(SERVICE_Z * fc.residual_std * math.sqrt(max(horizon_weeks, 1))) if weekly > 0 else 0

    # Expected demand over the planning horizon, walking through the weekly forecast
    # and holding the last week's rate beyond it.
    demand = 0.0
    remaining = horizon_weeks
    i = 0
    while remaining > 0:
        rate = fc.weeks[min(i, len(fc.weeks) - 1)] if fc.weeks else 0.0
        demand += rate * min(1.0, remaining)
        remaining -= 1
        i += 1

    # Day on which on-hand stock runs out (incoming stock is ignored on purpose:
    # it may not land in time; the reorder qty accounts for it).
    stockout_days: int | None = None
    if weekly > 0:
        left = float(stock)
        for day in range(0, 7 * 26):
            rate = fc.weeks[min(day // 7, len(fc.weeks) - 1)] / 7
            if left <= 0:
                stockout_days = day
                break
            left -= rate
    weeks_of_cover = (stock / weekly) if weekly > 0 else None

    reorder = max(0, math.ceil(demand + safety - stock - incoming)) if weekly > 0 else 0
    notes: list[str] = []

    if weekly <= 0.05:
        if stock > 0 and fc.trend != "no_sales":
            status, reason = "dead_stock", "Stock on hand but almost no recent demand."
        elif stock > 0:
            status, reason = "dead_stock", "Stock on hand and no sales yet."
        else:
            status, reason = "no_demand", "No recent sales."
        reorder = 0
    elif stock <= 0:
        status, reason = "out_of_stock", "Out of stock while customers are still buying."
    elif stockout_days is not None and stockout_days <= lead_time_days + 3:
        status = "reorder_now"
        reason = f"Runs out in ~{stockout_days} days but the supplier needs ~{lead_time_days} days."
    elif stockout_days is not None and stockout_days <= lead_time_days + 14:
        status, reason = "low", f"About {stockout_days} days of stock left."
    elif weeks_of_cover is not None and weeks_of_cover > 12:
        status, reason = "overstock", f"{weeks_of_cover:.0f} weeks of stock at the current sales rate."
        reorder = 0
    else:
        status, reason = "healthy", "Stock covers expected demand."
        reorder = 0  # nothing to order yet

    if fulfilment == "dropship":
        notes.append("Dropship item: stock figure is the supplier's. Confirm they can cover the reorder quantity.")
        if status in ("reorder_now", "out_of_stock"):
            notes.append("Line up a backup supplier so listings don't go dark.")
    if incoming:
        notes.append(f"{incoming} units already incoming are counted in the reorder quantity.")

    stockout_date = (today + timedelta(days=stockout_days)).date().isoformat() if stockout_days is not None else None
    return StockPlan(status, weeks_of_cover, stockout_days, stockout_date, reorder, safety, reason, notes)
