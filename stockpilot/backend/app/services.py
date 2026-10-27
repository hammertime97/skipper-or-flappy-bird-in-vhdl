"""Queries and aggregation shared by the API routes and the AI features."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from sqlmodel import Session, select

from .forecasting import forecast_weekly, plan_stock, weekly_buckets
from .models import Product, Sale, User, utcnow

HISTORY_WEEKS = 26


def active_products(session: Session, user_id: int) -> list[Product]:
    return list(
        session.exec(
            select(Product).where(Product.user_id == user_id, Product.archived == False).order_by(Product.name)  # noqa: E712
        )
    )


def sales_since(session: Session, user_id: int, since: datetime) -> list[Sale]:
    return list(session.exec(select(Sale).where(Sale.user_id == user_id, Sale.sold_at >= since)))


def _pct_change(cur: float, prev: float) -> float | None:
    if prev == 0:
        return None
    return round((cur - prev) / prev, 3)


def product_stats(products: list[Product], sales: list[Sale], now: datetime) -> dict[int, dict]:
    """Simple per-product sales numbers for the inventory screen."""
    d7, d30 = now - timedelta(days=7), now - timedelta(days=30)
    stats: dict[int, dict] = {p.id: {"units_7d": 0, "units_30d": 0, "revenue_30d": 0.0, "last_sold_at": None} for p in products}
    for s in sales:
        st = stats.get(s.product_id)
        if st is None:
            continue
        if s.sold_at >= d30:
            st["units_30d"] += s.quantity
            st["revenue_30d"] += s.quantity * s.unit_price
        if s.sold_at >= d7:
            st["units_7d"] += s.quantity
        if st["last_sold_at"] is None or s.sold_at > st["last_sold_at"]:
            st["last_sold_at"] = s.sold_at
    for p in products:
        st = stats[p.id]
        daily = st["units_30d"] / 30
        st["days_of_stock"] = round(p.stock_qty / daily, 1) if daily > 0 else None
        st["revenue_30d"] = round(st["revenue_30d"], 2)
        st["margin_pct"] = round((p.sell_price - p.cost_price) / p.sell_price, 3) if p.sell_price > 0 else None
    return stats


def product_out(p: Product, stats: dict | None = None) -> dict:
    out = p.model_dump(exclude={"user_id"})
    if stats:
        out.update(stats)
    return out


def dashboard(session: Session, user: User, now: datetime | None = None) -> dict:
    """KPIs for the home screen. Plain arithmetic, no AI."""
    now = now or utcnow()
    products = active_products(session, user.id)
    by_id = {p.id: p for p in products}
    sales = sales_since(session, user.id, now - timedelta(days=60))

    def window(start: datetime, end: datetime) -> dict:
        rows = [s for s in sales if start <= s.sold_at < end and s.product_id in by_id]
        revenue = sum(s.quantity * s.unit_price for s in rows)
        cost = sum(s.quantity * by_id[s.product_id].cost_price for s in rows)
        orders = len({s.order_ref or f"row-{s.id}" for s in rows})
        return {
            "revenue": round(revenue, 2),
            "profit": round(revenue - cost, 2),
            "units": sum(s.quantity for s in rows),
            "orders": orders,
            "avg_order_value": round(revenue / orders, 2) if orders else 0.0,
        }

    end = now
    kpis = {}
    for label, days in (("7d", 7), ("30d", 30)):
        cur = window(end - timedelta(days=days), end)
        prev = window(end - timedelta(days=2 * days), end - timedelta(days=days))
        cur["change"] = {k: _pct_change(cur[k], prev[k]) for k in ("revenue", "profit", "units", "orders")}
        kpis[label] = cur

    # Daily revenue/units for the last 30 days (oldest first)
    day0 = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
    daily = [{"date": (day0 + timedelta(days=i)).date().isoformat(), "revenue": 0.0, "units": 0} for i in range(30)]
    channels: dict[str, float] = defaultdict(float)
    for s in sales:
        if s.product_id not in by_id or s.sold_at < day0:
            continue
        idx = (s.sold_at - day0).days
        if 0 <= idx < 30:
            daily[idx]["revenue"] = round(daily[idx]["revenue"] + s.quantity * s.unit_price, 2)
            daily[idx]["units"] += s.quantity
        channels[s.channel or "direct"] += s.quantity * s.unit_price

    stats = product_stats(products, sales, now)
    top = sorted(products, key=lambda p: stats[p.id]["revenue_30d"], reverse=True)[:5]
    low = sorted(
        (p for p in products if stats[p.id]["days_of_stock"] is not None and stats[p.id]["days_of_stock"] <= max(14, p.lead_time_days + 7)),
        key=lambda p: stats[p.id]["days_of_stock"],
    )
    out_of_stock = [p for p in products if p.stock_qty <= 0 and stats[p.id]["units_30d"] > 0]
    dead = [p for p in products if p.stock_qty > 0 and stats[p.id]["units_30d"] == 0]

    return {
        "store_name": user.store_name,
        "currency": user.currency,
        "kpis": kpis,
        "daily": daily,
        "channels": [{"channel": c, "revenue": round(v, 2)} for c, v in sorted(channels.items(), key=lambda kv: -kv[1])],
        "inventory": {
            "skus": len(products),
            "units_on_hand": sum(max(0, p.stock_qty) for p in products),
            "stock_value_cost": round(sum(max(0, p.stock_qty) * p.cost_price for p in products), 2),
            "stock_value_retail": round(sum(max(0, p.stock_qty) * p.sell_price for p in products), 2),
            "out_of_stock": len(out_of_stock),
            "low_stock": len(low),
            "dead_stock": len(dead),
        },
        "top_sellers": [product_out(p, stats[p.id]) for p in top],
        "low_stock": [product_out(p, stats[p.id]) for p in low[:10]],
        "dead_stock": [product_out(p, stats[p.id]) for p in dead[:10]],
    }


def uncensor(history: list[float], stock: int) -> list[float]:
    """Drop the latest week if it's zero only because the product is sold out.

    A stock-out week records zero sales but not zero demand; feeding it to the
    model would make it under-forecast exactly the products that sell best.
    """
    if stock <= 0 and len(history) > 1 and history[-1] == 0 and any(history[:-1]):
        return history[:-1]
    return history


def forecasts(
    session: Session,
    user: User,
    now: datetime | None = None,
    horizon: int = 4,
    max_products: int | None = None,
) -> dict:
    """Weekly demand forecast + stock plan for every product, and store totals.

    `max_products` limits full forecasts to the best sellers (free plan); the rest
    are returned with `locked: true`.
    """
    now = now or utcnow()
    products = active_products(session, user.id)
    sales = sales_since(session, user.id, now - timedelta(days=7 * HISTORY_WEEKS))
    per_product: dict[int, list[tuple[datetime, float]]] = defaultdict(list)
    for s in sales:
        per_product[s.product_id].append((s.sold_at, s.quantity))

    recent_cutoff = now - timedelta(weeks=8)
    ranked = sorted(
        products,
        key=lambda p: sum(q for t, q in per_product[p.id] if t >= recent_cutoff) * p.sell_price,
        reverse=True,
    )
    unlocked = {p.id for p in (ranked if max_products is None else ranked[:max_products])}

    items = []
    hist_total = [0.0] * HISTORY_WEEKS
    fc_units = [0.0] * horizon
    fc_revenue = [0.0] * horizon
    fc_profit = [0.0] * horizon
    for p in ranked:
        history = weekly_buckets(per_product[p.id], now, HISTORY_WEEKS)
        for i, v in enumerate(history):
            hist_total[i] += v * p.sell_price
        if p.id not in unlocked:
            items.append({"product": product_out(p), "locked": True})
            continue
        fc = forecast_weekly(uncensor(history, p.stock_qty), horizon)
        plan = plan_stock(fc, p.stock_qty, p.incoming_qty, p.lead_time_days, now, fulfilment=p.fulfilment)
        for k in range(horizon):
            fc_units[k] += fc.weeks[k]
            fc_revenue[k] += fc.weeks[k] * p.sell_price
            fc_profit[k] += fc.weeks[k] * (p.sell_price - p.cost_price)
        items.append(
            {
                "product": product_out(p),
                "locked": False,
                "forecast": fc.to_dict(),
                "next_week_revenue": round(fc.next_week * p.sell_price, 2),
                "next_week_profit": round(fc.next_week * (p.sell_price - p.cost_price), 2),
                "stock_plan": plan.to_dict(),
            }
        )

    # Trim leading weeks before the store had any sales.
    first = next((i for i, v in enumerate(hist_total) if v > 0), HISTORY_WEEKS)
    store_hist = [round(v, 2) for v in hist_total[first:]]
    store_fc = forecast_weekly(store_hist, horizon) if store_hist else None

    status_rank = {"out_of_stock": 0, "reorder_now": 1, "low": 2, "dead_stock": 3, "overstock": 4, "healthy": 5, "no_demand": 6}
    items.sort(key=lambda it: (it["locked"], status_rank.get(it.get("stock_plan", {}).get("status"), 9), -it.get("next_week_revenue", 0)))

    return {
        "generated_at": now.isoformat(),
        "horizon_weeks": horizon,
        "currency": user.currency,
        "store": {
            "weekly_revenue_history": store_hist,
            "next_weeks_units": [round(v, 1) for v in fc_units],
            "next_weeks_revenue": [round(v, 2) for v in fc_revenue],
            "next_weeks_profit": [round(v, 2) for v in fc_profit],
            # Store-level band from forecasting the store's own revenue series.
            "revenue_band": (
                {"lower": [round(v, 2) for v in store_fc.lower], "upper": [round(v, 2) for v in store_fc.upper]} if store_fc else None
            ),
            "trend": store_fc.trend if store_fc else "no_sales",
        },
        "items": items,
        "locked_count": sum(1 for it in items if it["locked"]),
    }
