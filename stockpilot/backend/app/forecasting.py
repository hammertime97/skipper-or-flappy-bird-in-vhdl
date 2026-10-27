"""Weekly demand forecasting and stock planning.

Pure Python, no I/O. The numbers here are what the app shows the seller; the AI
layer explains them and can suggest adjustments, but never replaces them.

How a product's forecast is made
--------------------------------
1. Weekly sales are taken from rolling 7-day windows ending today, so "next week"
   means the next 7 days. Weeks before the first sale are dropped.
2. Several proven forecasting methods are fitted:
     4-week average, simple exponential smoothing, damped trend (Holt),
     Theta (a strong performer in the M3/M4 forecasting competitions), and, when
     there is more than a year of data, "same weeks last year, scaled to now".
   Slow sellers with many zero weeks use methods built for lumpy demand instead
   (Croston/SBA and TSB, which also notices when a product stops selling).
3. Every method is tested on the product's own recent past: we pretend it is
   1, 2, ... 8 weeks ago, forecast the following weeks, and compare with what
   really sold (rolling-origin backtest).
4. The best three methods are blended, weighted by how accurate each was.
   Blending beats picking one model on average, which is a central finding of
   the M4 competition.
5. The likely range comes from the blend's own backtest misses (the 10th and 90th
   percentiles), so it is as wide as this product's real uncertainty.
6. The seller sees an accuracy score: how close the blend's next-week forecasts
   came over the tested weeks.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from statistics import mean, pstdev
from typing import Callable, Iterable

SERVICE_Z = 1.2816  # safety stock for ~90% cycle service level
TREND_THRESHOLD = 0.15  # +/-15% (last 4 weeks vs the 4 before) counts as rising/declining
BACKTEST_ORIGINS = 8
MIN_TRAIN = 6
SEASON = 52


@dataclass
class ModelScore:
    name: str
    weight: float
    wape: float  # weighted absolute percentage error in backtest (0.2 = off by 20% on average)


@dataclass
class Forecast:
    method: str  # "ensemble" | "recent_mean" | "none"
    history: list[float]  # weekly units, oldest -> newest (leading zero weeks trimmed)
    weeks: list[float]  # point forecast for the next N weeks
    lower: list[float]  # 80% range: 1 in 10 chance of selling less
    upper: list[float]  # 1 in 10 chance of selling more
    trend: str  # "rising" | "stable" | "declining" | "new" | "no_sales"
    trend_pct: float  # last 4 weeks vs the 4 before, e.g. 0.25 = +25%
    confidence: str  # "high" | "medium" | "low"
    residual_std: float = 0.0  # typical one-week miss, for safety stock
    accuracy: float | None = None  # 1 - WAPE of next-week forecasts in backtest; None = not enough history
    tested_weeks: int = 0
    models: list[ModelScore] = field(default_factory=list)
    seasonal: bool = False
    intermittent: bool = False

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
        d["accuracy"] = None if self.accuracy is None else round(self.accuracy, 3)
        d["models"] = [{"name": m.name, "weight": round(m.weight, 3), "wape": round(m.wape, 3)} for m in self.models]
        return d


@dataclass
class StockPlan:
    status: str  # out_of_stock | reorder_now | low | healthy | overstock | dead_stock | no_demand | stock_unknown
    weeks_of_cover: float | None  # None = infinite (no demand) or unknown
    stockout_in_days: int | None  # None = not within the planning horizon
    stockout_date: str | None
    reorder_qty: int
    safety_stock: int
    target_stock: int  # units to have available to cover lead time + cover period + safety
    reason: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        if d["weeks_of_cover"] is not None:
            d["weeks_of_cover"] = round(d["weeks_of_cover"], 1)
        return d


def weekly_buckets(sales: Iterable[tuple[datetime, float]], end: datetime, weeks: int) -> list[float]:
    """Sum units into rolling 7-day buckets ending at `end` (oldest first)."""
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


# ---------------------------------------------------------------------------------------------
# Forecasting methods. Each takes a history (oldest first) and returns `h` forecasts.
# ---------------------------------------------------------------------------------------------

Method = Callable[[list[float], int], list[float]]


def m_naive(y: list[float], h: int) -> list[float]:
    return [y[-1]] * h


def m_mean4(y: list[float], h: int) -> list[float]:
    return [mean(y[-4:])] * h


def _ses_fit(y: list[float]) -> tuple[float, float]:
    """Best smoothing weight by one-step error; returns (alpha, final level)."""
    best = (math.inf, 0.3, y[-1])
    for alpha in (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        level, sse = y[0], 0.0
        for v in y[1:]:
            sse += (v - level) ** 2
            level += alpha * (v - level)
        if sse < best[0]:
            best = (sse, alpha, level)
    return best[1], best[2]


def m_ses(y: list[float], h: int) -> list[float]:
    return [_ses_fit(y)[1]] * h


def m_holt(y: list[float], h: int) -> list[float]:
    """Damped additive trend, parameters chosen by one-step error."""
    best: tuple[float, list[float]] | None = None
    init_trend = (mean(y[2:4]) - mean(y[0:2])) / 2 if len(y) >= 4 else y[1] - y[0]
    for alpha in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        for beta in (0.05, 0.1, 0.2, 0.3):
            for phi in (0.8, 0.9, 0.98):
                level, trend, sse = y[0], init_trend, 0.0
                for v in y[1:]:
                    fc = level + phi * trend
                    sse += (v - fc) ** 2
                    new_level = alpha * v + (1 - alpha) * fc
                    trend = beta * (new_level - level) + (1 - beta) * phi * trend
                    level = new_level
                if best is None or sse < best[0]:
                    out, damp = [], 0.0
                    for k in range(1, h + 1):
                        damp += phi**k
                        out.append(level + damp * trend)
                    best = (sse, out)
    assert best is not None
    return best[1]


def m_theta(y: list[float], h: int) -> list[float]:
    """Theta method: exponential smoothing plus half the long-run linear trend (Hyndman & Billah 2003)."""
    n = len(y)
    alpha, level = _ses_fit(y)
    t_mean = (n - 1) / 2
    y_mean = mean(y)
    denom = sum((t - t_mean) ** 2 for t in range(n)) or 1.0
    slope = sum((t - t_mean) * (v - y_mean) for t, v in enumerate(y)) / denom
    a = max(alpha, 0.05)
    return [level + slope / 2 * (k - 1 + 1 / a - ((1 - a) ** n) / a) for k in range(1, h + 1)]


def m_seasonal(y: list[float], h: int) -> list[float]:
    """Same weeks last year (smoothed over neighbouring weeks), scaled by this year's level vs last year's."""
    n = len(y)
    now = mean(y[-8:])
    then = mean(y[n - SEASON - 8 : n - SEASON])
    scale = now / then if then > 0 else 1.0
    scale = min(max(scale, 0.25), 4.0)
    out = []
    for k in range(1, h + 1):
        i = n - SEASON + k - 1
        window = y[max(0, i - 1) : i + 2]
        out.append(mean(window) * scale)
    return out


def m_croston_sba(y: list[float], h: int, alpha: float = 0.15) -> list[float]:
    demands = [(i, v) for i, v in enumerate(y) if v > 0]
    if not demands:
        return [0.0] * h
    z, p, last = demands[0][1], float(demands[0][0] + 1), demands[0][0]
    for i, v in demands[1:]:
        z += alpha * (v - z)
        p += alpha * ((i - last) - p)
        last = i
    return [(1 - alpha / 2) * z / p] * h


def m_tsb(y: list[float], h: int, alpha: float = 0.15, beta: float = 0.1) -> list[float]:
    """Teunter-Syntetos-Babai: like Croston, but the chance of a sale decays when sales stop."""
    first = next((v for v in y if v > 0), 0.0)
    prob = sum(1 for v in y if v > 0) / len(y)
    size = first
    for v in y:
        if v > 0:
            prob += beta * (1 - prob)
            size += alpha * (v - size)
        else:
            prob += beta * (0 - prob)
    return [prob * size] * h


CONTINUOUS: dict[str, Method] = {
    "mean4": m_mean4,
    "ses": m_ses,
    "damped_trend": m_holt,
    "theta": m_theta,
}
INTERMITTENT: dict[str, Method] = {
    "croston_sba": m_croston_sba,
    "tsb": m_tsb,
    "mean4": m_mean4,
    "ses": m_ses,
}

MODEL_LABELS = {
    "naive": "Last week repeats",
    "mean4": "4-week average",
    "ses": "Smoothed average",
    "damped_trend": "Trend (damped)",
    "theta": "Theta",
    "seasonal": "Same time last year",
    "croston_sba": "Slow-seller model (Croston)",
    "tsb": "Slow-seller model (TSB)",
}


def _clip(fc: list[float]) -> list[float]:
    return [max(0.0, v) for v in fc]


def _quantile(values: list[float], q: float) -> float:
    s = sorted(values)
    if not s:
        return 0.0
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def _recent_mean(y: list[float], horizon: int) -> Forecast:
    weights = list(range(1, len(y) + 1))  # newer weeks count more
    rate = sum(w * v for w, v in zip(weights, y)) / sum(weights)
    std = pstdev(y) if len(y) > 1 else rate * 0.5
    lower = [max(0.0, rate - 1.2816 * std * math.sqrt(k)) for k in range(1, horizon + 1)]
    upper = [rate + 1.2816 * std * math.sqrt(k) for k in range(1, horizon + 1)]
    return Forecast("recent_mean", y, [rate] * horizon, lower, upper, "new", 0.0, "low", std)


def forecast_weekly(raw_history: list[float], horizon: int = 4) -> Forecast:
    """Forecast the next `horizon` weeks of unit sales from weekly history (oldest first)."""
    y = _trim_leading_zeros(list(raw_history))
    if not y:
        zeros = [0.0] * horizon
        return Forecast("none", [], zeros, zeros, zeros, "no_sales", 0.0, "low")
    if len(y) < 4:
        return _recent_mean(y, horizon)

    n = len(y)
    zero_share = sum(1 for v in y if v == 0) / n
    intermittent = zero_share >= 0.3
    methods: dict[str, Method] = dict(INTERMITTENT if intermittent else CONTINUOUS)
    seasonal = not intermittent and n >= SEASON + 8
    if seasonal:
        methods["seasonal"] = m_seasonal

    # Rolling-origin backtest: forecast from each of the last few weeks and compare with what sold.
    n_origins = min(BACKTEST_ORIGINS, n - MIN_TRAIN)
    origins = list(range(n - n_origins, n)) if n_origins > 0 else []
    backtest: dict[str, list[tuple[int, int, float]]] = {}  # name -> [(origin, k, forecast)]
    scores: dict[str, float] = {}
    for name, fn in methods.items():
        if name == "seasonal":
            usable = [o for o in origins if o >= SEASON + 8]
        else:
            usable = origins
        rows: list[tuple[int, int, float]] = []
        for o in usable:
            steps = min(horizon, n - o)
            fc = _clip(fn(y[:o], steps))
            rows.extend((o, k, fc[k]) for k in range(steps))
        if not rows:
            continue
        abs_err = sum(abs(y[o + k] - f) for o, k, f in rows)
        actual = sum(y[o + k] for o, k, _ in rows) or 1.0
        backtest[name] = rows
        scores[name] = abs_err / actual

    if scores:
        ranked = sorted(scores, key=lambda m: scores[m])[:3]
        inv = {m: 1.0 / max(scores[m], 0.02) for m in ranked}
        total = sum(inv.values())
        weights = {m: inv[m] / total for m in ranked}
    else:  # 4-6 weeks of history: nothing to test on yet, blend simple methods equally
        names = ["mean4", "ses"] if intermittent else ["mean4", "ses", "damped_trend"]
        weights = {m: 1 / len(names) for m in names}

    point = [0.0] * horizon
    for m, w in weights.items():
        for k, v in enumerate(_clip(methods[m](y, horizon))):
            point[k] += w * v

    # The blend's own backtest misses give the likely range and the accuracy score.
    blend: dict[tuple[int, int], float] = {}
    for m, w in weights.items():
        for o, k, f in backtest.get(m, []):
            blend[(o, k)] = blend.get((o, k), 0.0) + w * f
    # Only points every blended method was tested on (the seasonal model starts later).
    common = set(blend)
    for m in weights:
        common &= {(o, k) for o, k, _ in backtest.get(m, [])}
    complete = {key: blend[key] for key in common}
    misses: dict[int, list[float]] = {}
    for (o, k), f in complete.items():
        misses.setdefault(k, []).append(y[o + k] - f)

    accuracy: float | None = None
    tested = len(misses.get(0, []))
    if tested >= 4:
        h1 = [(o, f) for (o, k), f in complete.items() if k == 0]
        err = sum(abs(y[o] - f) for o, f in h1)
        act = sum(y[o] for o, _ in h1) or 1.0
        accuracy = max(0.0, 1 - err / act)

    pooled = [e for errs in misses.values() for e in errs]
    if len(pooled) >= 8:
        resid_std = math.sqrt(mean(e * e for e in misses.get(0, pooled)))
    else:
        resid_std = pstdev(y[-12:]) if len(y) > 2 else point[0] * 0.5
    lower, upper = [], []
    for k in range(horizon):
        # Sales are counts, so week-to-week randomness is at least Poisson (variance = mean);
        # a handful of backtest misses alone would understate it.
        spread = 1.5 * math.sqrt(max(resid_std**2, point[k]) * (1 + 0.15 * k))
        lo, hi = -spread, spread
        errs = misses.get(k, [])
        if len(errs) >= 6:
            lo, hi = min(lo, _quantile(errs, 0.1)), max(hi, _quantile(errs, 0.9))
        lower.append(max(0.0, min(point[k], point[k] + lo)))
        upper.append(max(point[k], point[k] + hi))

    recent = mean(y[-4:])
    if n >= 8 and mean(y[-8:-4]) > 0:
        trend_pct = (recent - mean(y[-8:-4])) / mean(y[-8:-4])
    else:
        trend_pct = (point[0] - recent) / recent if recent > 0 else 0.0
    if trend_pct >= TREND_THRESHOLD:
        trend = "rising"
    elif trend_pct <= -TREND_THRESHOLD:
        trend = "declining"
    else:
        trend = "stable"

    if accuracy is None:
        confidence = "low"
    elif accuracy >= 0.75 and n >= 12:
        confidence = "high"
    elif accuracy >= 0.55:
        confidence = "medium"
    else:
        confidence = "low"

    models = [ModelScore(m, weights[m], scores.get(m, float("nan"))) for m in sorted(weights, key=lambda m: -weights[m])]
    return Forecast(
        "ensemble", y, point, lower, upper, trend, trend_pct, confidence, resid_std,
        accuracy, tested, models, "seasonal" in weights, intermittent,
    )


# ---------------------------------------------------------------------------------------------
# Stock planning
# ---------------------------------------------------------------------------------------------


def plan_stock(
    fc: Forecast,
    stock: int,
    incoming: int,
    lead_time_days: int,
    today: datetime,
    cover_weeks: float = 2.0,
    fulfilment: str = "own_stock",
    stock_known: bool = True,
) -> StockPlan:
    """Turn a demand forecast into stock-out timing and a reorder suggestion.

    Target = expected demand over (lead time + `cover_weeks`) + safety stock.
    Reorder = target - on hand - already incoming.
    """
    weekly = fc.next_week
    lead_weeks = max(0, lead_time_days) / 7
    horizon_weeks = lead_weeks + cover_weeks
    safety = math.ceil(SERVICE_Z * fc.residual_std * math.sqrt(max(horizon_weeks, 1))) if weekly > 0 else 0

    demand, remaining, i = 0.0, horizon_weeks, 0
    while remaining > 0:
        rate = fc.weeks[min(i, len(fc.weeks) - 1)] if fc.weeks else 0.0
        demand += rate * min(1.0, remaining)
        remaining -= 1
        i += 1
    target = math.ceil(demand + safety) if weekly > 0 else 0

    notes: list[str] = []
    if not stock_known:
        if weekly <= 0.05:
            return StockPlan("no_demand", None, None, None, 0, 0, 0, "No recent sales.", notes)
        return StockPlan(
            "stock_unknown", None, None, None, 0, safety, target,
            f"Add your stock count to get reorder advice. You need about {target} units available "
            f"to cover the next {round(horizon_weeks)} weeks.",
            notes,
        )

    stockout_days: int | None = None
    if weekly > 0:
        left = float(stock)
        for day in range(0, 7 * 26):
            rate = fc.weeks[min(day // 7, len(fc.weeks) - 1)] / 7
            if left <= 1e-6:
                stockout_days = day
                break
            left -= rate
    weeks_of_cover = (stock / weekly) if weekly > 0 else None
    reorder = max(0, math.ceil(demand + safety - stock - incoming)) if weekly > 0 else 0

    if weekly <= 0.05:
        status = "dead_stock" if stock > 0 else "no_demand"
        reason = "Stock on hand but almost no recent sales." if stock > 0 else "No recent sales."
        reorder = 0
    elif stock <= 0:
        status, reason = "out_of_stock", "Out of stock while customers are still buying."
    elif stockout_days is not None and stockout_days <= lead_time_days + 3:
        status = "reorder_now"
        reason = f"Runs out in about {stockout_days} days, but the supplier needs about {lead_time_days} days."
    elif stockout_days is not None and stockout_days <= lead_time_days + 14:
        status, reason = "low", f"About {stockout_days} days of stock left."
    elif weeks_of_cover is not None and weeks_of_cover > 12:
        status, reason = "overstock", f"{weeks_of_cover:.0f} weeks of stock at the current sales rate."
        reorder = 0
    else:
        status, reason = "healthy", "Stock covers expected sales."
        reorder = 0

    if fulfilment == "dropship":
        notes.append("Dropship item: the stock figure is your supplier's. Check they can cover this amount.")
        if status in ("reorder_now", "out_of_stock"):
            notes.append("Line up a backup supplier so your listing doesn't go out of stock.")
    if incoming and reorder:
        notes.append(f"The {incoming} units already on order are taken off the suggested order.")

    stockout_date = (today + timedelta(days=stockout_days)).date().isoformat() if stockout_days is not None else None
    return StockPlan(status, weeks_of_cover, stockout_days, stockout_date, reorder, safety, target, reason, notes)


# ---------------------------------------------------------------------------------------------
# Shopping calendar
# ---------------------------------------------------------------------------------------------


def _easter(year: int) -> date:
    """Gregorian Easter Sunday (anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = ((h + l_ - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def shopping_events(year: int) -> list[tuple[date, str, str]]:
    """(date, name, markets) for the big retail moments of a year."""
    black_friday = _nth_weekday(year, 11, 3, 4) + timedelta(days=1)  # day after 4th Thursday
    easter = _easter(year)
    return [
        (date(year, 2, 14), "Valentine's Day", "all"),
        (easter - timedelta(days=21), "Mother's Day (UK)", "UK"),
        (easter, "Easter", "all"),
        (_nth_weekday(year, 5, 6, 2), "Mother's Day (US)", "US"),
        (_nth_weekday(year, 6, 6, 3), "Father's Day (US & UK)", "US, UK"),
        (date(year, 10, 31), "Halloween", "all"),
        (date(year, 11, 11), "Singles' Day (11.11)", "all"),
        (black_friday, "Black Friday", "all"),
        (black_friday + timedelta(days=3), "Cyber Monday", "all"),
        (date(year, 12, 25), "Christmas", "all"),
        (date(year, 12, 26), "Boxing Day", "UK, AU, CA"),
    ]


def upcoming_events(today: date, weeks: int = 6) -> list[dict]:
    end = today + timedelta(weeks=weeks)
    out = []
    for year in (today.year, today.year + 1):
        for d, name, markets in shopping_events(year):
            if today <= d <= end:
                out.append({"date": d.isoformat(), "name": name, "markets": markets, "in_days": (d - today).days})
    return sorted(out, key=lambda e: e["date"])
