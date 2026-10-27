"""AI Weekly Plan: turns the statistical forecasts into a prioritised to-do list."""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel

from .client import structured

SYSTEM = """You are the planning analyst inside StockPilot, an app for e-commerce and dropshipping sellers.
Each week you receive the seller's KPIs and a statistical demand forecast per product (units for the next weeks, \
an 80% range, trend, confidence and a stock plan with reorder quantities). Write the seller's weekly plan.

Rules:
- Use only the numbers provided. Never invent sales, prices or quantities. Quote the forecast figures when you cite them.
- Be concrete: name the SKU, the quantity to order, the day it runs out, the price to test.
- Prioritise by money at stake: stock-outs on good sellers first, then rising products to push, then dead stock to clear.
- Say when confidence is low, so the seller doesn't over-commit cash on a shaky forecast.
- Dropship items: the stock figure is the supplier's, so the action is to confirm supplier capacity, not to buy stock.
- Plain, friendly English for a busy small-business owner. Short sentences. No jargon like "Holt" or "Croston"."""


class Action(BaseModel):
    priority: Literal["high", "medium", "low"]
    kind: Literal["reorder", "restock_urgent", "promote", "clear_stock", "pricing", "listing", "supplier", "marketing", "other"]
    title: str
    detail: str
    sku: str  # empty string for store-wide actions


class WeeklyBrief(BaseModel):
    headline: str
    summary: str
    next_week_outlook: str
    actions: list[Action]
    risks: list[str]
    opportunities: list[str]


def _compact(forecast: dict, dashboard: dict) -> str:
    rows = []
    for it in forecast["items"]:
        if it["locked"]:
            continue
        p, fc, plan = it["product"], it["forecast"], it["stock_plan"]
        rows.append(
            {
                "sku": p["sku"],
                "name": p["name"],
                "fulfilment": p["fulfilment"],
                "price": p["sell_price"],
                "unit_cost": p["cost_price"],
                "stock": p["stock_qty"],
                "incoming": p["incoming_qty"],
                "lead_time_days": p["lead_time_days"],
                "last_8_weeks_units": fc["history"][-8:],
                "next_weeks_units": fc["weeks"],
                "next_week_range": [fc["lower"][0], fc["upper"][0]],
                "trend": fc["trend"],
                "trend_vs_last_4_weeks": fc["trend_pct"],
                "confidence": fc["confidence"],
                "stock_status": plan["status"],
                "runs_out_on": plan["stockout_date"],
                "suggested_reorder_qty": plan["reorder_qty"],
            }
        )
    payload = {
        "currency": forecast["currency"],
        "kpis_last_7_days": dashboard["kpis"]["7d"],
        "kpis_last_30_days": dashboard["kpis"]["30d"],
        "inventory": dashboard["inventory"],
        "store_forecast": forecast["store"],
        "products": rows,
    }
    return json.dumps(payload, separators=(",", ":"), default=str)


def generate(forecast: dict, dashboard: dict, store_name: str, niche: str) -> WeeklyBrief:
    content = (
        f"Store: {store_name or 'unnamed'}; niche: {niche or 'not set'}.\n"
        "Here is this week's data (JSON):\n"
        f"{_compact(forecast, dashboard)}\n\n"
        "Write this week's plan. 3-8 actions, most important first."
    )
    return structured(SYSTEM, content, WeeklyBrief, effort="medium")
