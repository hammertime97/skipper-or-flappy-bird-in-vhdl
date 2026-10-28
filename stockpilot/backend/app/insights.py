"""Insights that need no AI: where the profit comes from, what sells together,
a weekly to-do list built from the forecasts, and a profit / ad-spend calculator.

These work for every seller on every plan, instantly and at no running cost.
The AI features build on top of them.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from itertools import combinations

from . import fees as fees_mod
from .models import Product, Sale

SYMBOLS = {"USD": "$", "GBP": "£", "EUR": "€", "AUD": "A$", "CAD": "C$"}

# Shopping moments big enough to plan stock for, whatever the niche.
BIG_EVENTS = {
    "Black Friday", "Cyber Monday", "Christmas", "Boxing Day", "Singles' Day (11.11)", "Valentine's Day",
    "Mother's Day (UK)", "Mother's Day (US)", "Father's Day (US & UK)",
}


def money(v: float, currency: str) -> str:
    sym = SYMBOLS.get(currency)
    s = f"{abs(v):,.0f}" if abs(v) >= 100 else f"{abs(v):,.2f}"
    return ("-" if v < 0 else "") + (f"{sym}{s}" if sym else f"{s} {currency}")


# ---------------------------------------------------------------------------------------------
# 80/20: which products make the money
# ---------------------------------------------------------------------------------------------


def focus_list(products: list[Product], sales: list[Sale], now: datetime, fee_table: dict, days: int = 90) -> dict:
    """Group products by their share of profit (after cost and selling fees) over `days`.

    A = the few products that together make ~80% of profit (protect their stock),
    B = the next 15%, C = the long tail, plus anything losing money.
    """
    since = now - timedelta(days=days)
    by_id = {p.id: p for p in products}
    agg: dict[int, dict] = {p.id: {"units": 0, "revenue": 0.0, "fees": 0.0} for p in products}
    for s in sales:
        if s.product_id in agg and since <= s.sold_at < now:
            a = agg[s.product_id]
            a["units"] += s.quantity
            a["revenue"] += s.quantity * s.unit_price
            a["fees"] += fees_mod.sale_fee(fee_table, s.channel, s.quantity * s.unit_price)
    rows = []
    for pid, a in agg.items():
        p = by_id[pid]
        profit = a["revenue"] - a["fees"] - a["units"] * p.cost_price
        rows.append({"id": pid, "sku": p.sku, "name": p.name, "units": a["units"], "revenue": round(a["revenue"], 2),
                     "profit": round(profit, 2), "cost_known": p.cost_price > 0})
    rows.sort(key=lambda r: -r["profit"])
    positive = sum(r["profit"] for r in rows if r["profit"] > 0)
    cum = 0.0
    for r in rows:
        if r["profit"] < 0:
            r["group"], r["share"] = "losing", 0.0
            continue
        share = r["profit"] / positive if positive else 0.0
        before = cum
        cum += share
        r["share"] = round(share, 4)
        r["group"] = "A" if before < 0.8 else "B" if before < 0.95 else "C"
    a_count = sum(1 for r in rows if r["group"] == "A")
    sold = [r for r in rows if r["units"] > 0]
    if not positive or not sold:
        summary = "Not enough sales yet to see where your profit comes from."
    elif a_count / len(sold) > 0.6:
        summary = "Your profit is spread across most of your products, so no single one carries the store."
    else:
        summary = f"{a_count} of your {len(sold)} selling products make about 80% of your profit. Never let them run out."
    missing_cost = sum(1 for r in sold if not r["cost_known"])
    return {
        "days": days,
        "total_profit": round(sum(r["profit"] for r in rows), 2),
        "summary": summary,
        "missing_cost": missing_cost,
        "items": rows,
    }


# ---------------------------------------------------------------------------------------------
# Bundles: what customers buy together
# ---------------------------------------------------------------------------------------------


def bundles(products: list[Product], sales: list[Sale], now: datetime, days: int = 180, min_together: int = 3) -> dict:
    """Pairs of products that often appear in the same order, with lift (how much more often than chance)."""
    since = now - timedelta(days=days)
    names = {p.id: p.name for p in products}
    orders: dict[str, set[int]] = defaultdict(set)
    for s in sales:
        if s.order_ref and s.product_id in names and since <= s.sold_at < now and not s.order_ref.startswith("manual"):
            orders[s.order_ref].add(s.product_id)
    n_orders = len(orders)
    single: Counter[int] = Counter()
    pairs: Counter[tuple[int, int]] = Counter()
    for items in orders.values():
        single.update(items)
        if len(items) > 1:
            pairs.update(combinations(sorted(items), 2))
    out = []
    for (a, b), together in pairs.most_common():
        if together < min_together:
            break
        lift = (together * n_orders) / (single[a] * single[b]) if single[a] and single[b] else 0.0
        if lift <= 1.0:
            continue
        out.append({
            "a": {"id": a, "name": names[a]}, "b": {"id": b, "name": names[b]},
            "orders_together": together, "lift": round(lift, 2),
            "tip": f"Bought together in {together} orders. Offer them as a bundle or show one on the other's page.",
        })
        if len(out) >= 6:
            break
    multi = sum(1 for items in orders.values() if len(items) > 1)
    note = "" if out else (
        "Your sales file has no order numbers, so we can't see which products are bought together." if not n_orders
        else "Not enough orders with two or more different products yet." if multi < 10
        else "Your customers mostly buy one product at a time, so no strong pairs yet."
    )
    return {"days": days, "orders": n_orders, "multi_item_orders": multi, "pairs": out, "note": note}


# ---------------------------------------------------------------------------------------------
# Weekly plan without AI
# ---------------------------------------------------------------------------------------------


def _fmt_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d:%a} {d.day} {d:%b}"


def smart_plan(forecast: dict, dashboard: dict, focus: dict, bundle_data: dict, currency: str, today: str = "") -> dict:
    """A prioritised to-do list built from the numbers alone. `today` is an ISO date, so due dates read "today"."""
    m = lambda v: money(v, currency)  # noqa: E731
    when = lambda iso: "today" if today and iso <= today else f"by {_fmt_date(iso)}"  # noqa: E731
    items = [it for it in forecast["items"] if not it["locked"]]
    actions: list[dict] = []

    def add(priority: str, kind: str, title: str, detail: str, sku: str = "") -> None:
        actions.append({"priority": priority, "kind": kind, "title": title, "detail": detail, "sku": sku})

    a_group = {r["id"] for r in focus["items"] if r["group"] == "A"}
    for it in items:
        p, fc, plan = it["product"], it["forecast"], it["stock_plan"]
        star = " It's one of your top earners." if p["id"] in a_group else ""
        if plan["status"] == "out_of_stock":
            add("high", "restock_urgent", f"Restock {p['name']} today: order {plan['reorder_qty']} units",
                f"Sold out while customers still buy about {fc['next_week']:.0f} a week.{star}", p["sku"])
        elif plan["status"] == "reorder_now":
            add("high", "reorder", f"Order {plan['reorder_qty']} × {p['name']} {when(plan['order_by'])}",
                f"{plan['reason']}{star}", p["sku"])
    for it in items:
        p, plan = it["product"], it["stock_plan"]
        if plan["status"] == "low" and plan["order_by"]:
            add("medium", "reorder", f"Plan an order of {plan['reorder_qty']} × {p['name']} {when(plan['order_by'])}",
                plan["reason"], p["sku"])

    unknown = [it for it in items if it["stock_plan"]["status"] == "stock_unknown"]
    if unknown:
        add("medium", "setup", f"Add stock counts for {len(unknown)} products",
            "Without them we can't tell you when to reorder. It takes a minute on the Stock & costs screen.")
    if dashboard["inventory"].get("cost_missing"):
        add("medium", "setup", f"Add your cost per item for {dashboard['inventory']['cost_missing']} products",
            "Profit and the restock budget need what you pay per item.")

    rising = sorted(
        (it for it in items if it["forecast"]["trend"] == "rising" and (it["forecast"]["accuracy"] or 0) >= 0.55),
        key=lambda it: -it["next_week_revenue"],
    )[:2]
    for it in rising:
        p, fc = it["product"], it["forecast"]
        add("medium", "promote", f"Push {p['name']}: sales up {fc['trend_pct'] * 100:.0f}%",
            f"Sales rose {fc['trend_pct'] * 100:.0f}% over the last 4 weeks. A short video or a featured spot could add to it.", p["sku"])

    top = sorted(items, key=lambda it: -it["next_week_revenue"])[:3]
    # Warn early enough to reorder: supplier lead time of the best sellers plus a week and a half.
    window = max([21] + [it["product"]["lead_time_days"] + 10 for it in top])
    for ev in forecast.get("events", []):
        if ev["name"] in BIG_EVENTS and ev["in_days"] <= window:
            need = ", ".join(f"{it['product']['name']} ({it['stock_plan']['target_stock']})" for it in top)
            add("medium", "marketing", f"Get ready for {ev['name']} in {ev['in_days']} days",
                f"Check stock on your best sellers. Units to have available: {need}.")
            break

    pair_for = {}
    for pr in bundle_data.get("pairs", []):
        pair_for.setdefault(pr["a"]["id"], pr["b"]["name"])
        pair_for.setdefault(pr["b"]["id"], pr["a"]["name"])
    best = max(items, key=lambda it: it["next_week_revenue"], default=None)
    dead = sorted(
        (it for it in items if it["stock_plan"]["status"] == "dead_stock"),
        key=lambda it: -(it["product"]["stock_qty"] * it["product"]["cost_price"]),
    )[:2]
    k30 = dashboard["kpis"]["30d"]
    fee_rate = k30["fees"] / k30["revenue"] if k30["revenue"] else 0.0
    for it in dead:
        p = it["product"]
        partner = pair_for.get(p["id"]) or (best["product"]["name"] if best and best is not it else None)
        tip = f"Bundle it with {partner}" if partner else "Try a bundle"
        # Lowest price at which a sale still covers what the item cost plus the platform's cut.
        floor = p["cost_price"] / (1 - fee_rate) if p["cost_price"] > 0 and fee_rate < 1 else 0
        floor_tip = f" Don't go below {m(floor)}: under that, each sale loses money." if floor else ""
        add("low", "clear_stock", f"Clear {p['name']}: {m(p['stock_qty'] * p['cost_price'])} tied up",
            f"{p['stock_qty']} in stock and no sales in 30 days. {tip}, or a 15–20% discount.{floor_tip}", p["sku"])
    for it in items:
        p, plan = it["product"], it["stock_plan"]
        if plan["status"] == "overstock":
            add("low", "reorder", f"Pause reordering {p['name']}", plan["reason"], p["sku"])

    k7 = dashboard["kpis"]["7d"]
    st = forecast["store"]
    change = k7["change"]["revenue"]
    trend_word = "" if change is None else f", {'up' if change >= 0 else 'down'} {abs(change) * 100:.0f}% on the week before"
    first_high = next((a for a in actions if a["priority"] == "high"), None)
    headline = first_high["title"] if first_high else "Nothing urgent this week. Use the time to grow your best sellers."
    budget = st["restock_budget"]["now"]
    return {
        "headline": headline,
        "summary": f"Last 7 days: {m(k7['revenue'])} revenue and {m(k7['profit'])} profit after fees{trend_word}. {focus['summary']}",
        "next_week_outlook": (
            f"Expect about {st['next_weeks_units'][0]:.0f} units, {m(st['next_weeks_revenue'][0])} revenue and "
            f"{m(st['next_weeks_profit'][0])} profit next week."
            + (f" Orders to place now cost about {m(budget)}." if budget > 0 else "")
        ),
        "actions": actions[:10],
        "made_by": "numbers",
    }


# ---------------------------------------------------------------------------------------------
# Profit and ad-spend calculator
# ---------------------------------------------------------------------------------------------


def price_for_margin(product_cost: float, shipping: float, fee_pct: float, fee_fixed: float, ad_cost_per_sale: float, margin: float) -> float | None:
    """The selling price that leaves `margin` (0.3 = 30%) of the price as profit after fees and ads."""
    keep = 1 - fee_pct / 100 - margin
    return round((product_cost + shipping + fee_fixed + ad_cost_per_sale) / keep, 2) if keep > 0 else None


def profit_calc(price: float, product_cost: float, shipping: float, fee_pct: float, fee_fixed: float, ad_cost_per_sale: float = 0.0) -> dict:
    """What one sale really earns, and how much advertising it can afford."""
    fee = price * fee_pct / 100 + fee_fixed
    before_ads = price - product_cost - shipping - fee
    profit = before_ads - ad_cost_per_sale
    return {
        "price_for_30pct_margin": price_for_margin(product_cost, shipping, fee_pct, fee_fixed, ad_cost_per_sale, 0.3),
        "fees": round(fee, 2),
        "profit_before_ads": round(before_ads, 2),
        "profit": round(profit, 2),
        "margin_pct": round(profit / price * 100, 1) if price else 0.0,
        # Spend more than this on ads per sale and you lose money.
        "max_ad_cost_per_sale": round(max(0.0, before_ads), 2),
        # Revenue needed per 1 of ad spend to break even (ROAS).
        "break_even_roas": round(price / before_ads, 2) if before_ads > 0 else None,
    }
