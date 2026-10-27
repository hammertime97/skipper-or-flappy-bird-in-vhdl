"""AI Weekly Plan: the statistical forecasts, checked against the outside world and turned into a to-do list.

The forecasting engine only knows the seller's own history. Before writing the plan,
Claude searches the web for things that history can't show: upcoming shopping events,
news or viral moments for these products, competitor stock-outs, supplier problems.
It then suggests bounded adjustments to the forecast, each with a reason the seller
can read. The original statistical forecast is always kept and shown alongside.
"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, field_validator

from . import research

SYSTEM = """You are the planning analyst inside StockPilot, an app for e-commerce and dropshipping sellers.
You receive the seller's KPIs and, per product, a statistical demand forecast tested on their own sales
(units for the next weeks, a likely range, trend, accuracy) and a stock plan with reorder quantities.
You also get the shopping events coming up.

Your job:
1. Do a few quick web searches about what could make next week different from the past: the upcoming
   events for this niche and market, recent news or viral moments for the top products, seasonality,
   competitor or supply issues. Keep it focused; 3-6 searches is usually enough.
2. Suggest forecast adjustments ONLY where you found a concrete reason that the seller's history can't
   already reflect. Most products need no adjustment. Each adjustment is a percentage change to next
   week's statistical forecast, between -60 and +150, with a one-sentence reason and the source URL.
   If a product has more than a year of history and the event happened last year, the forecast has already
   seen it: adjust only for what's different this year.
3. Write the weekly plan.

Rules for the plan:
- Use the numbers provided. Never invent sales, prices or quantities. Quote the forecast figures you cite.
- Be concrete: name the product, the quantity to order, the day it runs out, the price to test.
- Prioritise by money at stake: stock-outs on good sellers first, then rising products to push,
  then dead stock to clear (with the cash tied up).
- Where accuracy is below 60% or confidence is low, say the forecast is rough so they don't over-order.
- Dropship items: the stock figure is the supplier's; the action is to check supplier capacity.
- Products with stock_known=false: ask the seller to enter stock; give the target units instead.
- Plain, friendly English for a busy small-business owner. Short sentences, no jargon.

When done, call report_weekly_plan exactly once."""

REPORT_TOOL = {
    "name": "report_weekly_plan",
    "description": "Submit this week's plan and any forecast adjustments.",
    "input_schema": {
        "type": "object",
        "properties": {
            "headline": {"type": "string", "description": "One sentence: the single most important thing this week."},
            "summary": {"type": "string", "description": "2-3 sentences on how the store is doing."},
            "next_week_outlook": {"type": "string", "description": "Expected units, revenue and profit next week, in one or two sentences."},
            "actions": {
                "type": "array",
                "description": "3-8 actions, most important first.",
                "items": {
                    "type": "object",
                    "properties": {
                        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                        "kind": {
                            "type": "string",
                            "enum": ["reorder", "restock_urgent", "promote", "clear_stock", "pricing", "listing", "supplier", "marketing", "setup", "other"],
                        },
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "sku": {"type": "string", "description": "Product SKU, or empty for store-wide actions."},
                    },
                    "required": ["priority", "kind", "title", "detail", "sku"],
                    "additionalProperties": False,
                },
            },
            "adjustments": {
                "type": "array",
                "description": "Forecast changes backed by something you found. Empty if none.",
                "items": {
                    "type": "object",
                    "properties": {
                        "sku": {"type": "string"},
                        "change_pct": {"type": "number", "description": "-60 to 150"},
                        "reason": {"type": "string"},
                        "source_url": {"type": "string"},
                    },
                    "required": ["sku", "change_pct", "reason", "source_url"],
                    "additionalProperties": False,
                },
            },
            "market_notes": {"type": "array", "items": {"type": "string"}, "description": "What you found outside the store that matters."},
            "risks": {"type": "array", "items": {"type": "string"}},
            "opportunities": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["headline", "summary", "next_week_outlook", "actions", "adjustments", "market_notes", "risks", "opportunities"],
        "additionalProperties": False,
    },
}


class Action(BaseModel):
    priority: Literal["high", "medium", "low"]
    kind: Literal["reorder", "restock_urgent", "promote", "clear_stock", "pricing", "listing", "supplier", "marketing", "setup", "other"]
    title: str
    detail: str
    sku: str


class Adjustment(BaseModel):
    sku: str
    change_pct: float
    reason: str
    source_url: str

    @field_validator("change_pct")
    @classmethod
    def _bound(cls, v: float) -> float:
        return max(-60.0, min(150.0, v))


class WeeklyBrief(BaseModel):
    headline: str
    summary: str
    next_week_outlook: str
    actions: list[Action]
    adjustments: list[Adjustment]
    market_notes: list[str]
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
                "category": p["category"],
                "fulfilment": p["fulfilment"],
                "price": p["sell_price"],
                "unit_cost": p["cost_price"],
                "stock": p["stock_qty"],
                "stock_known": p["stock_known"],
                "incoming": p["incoming_qty"],
                "lead_time_days": p["lead_time_days"],
                "weeks_of_history": len(fc["history"]),
                "last_8_weeks_units": fc["history"][-8:],
                "next_weeks_units": fc["weeks"],
                "next_week_range": [fc["lower"][0], fc["upper"][0]],
                "trend": fc["trend"],
                "trend_vs_prior_4_weeks": fc["trend_pct"],
                "forecast_accuracy": fc["accuracy"],
                "uses_last_year": fc["seasonal"],
                "stock_status": plan["status"],
                "runs_out_on": plan["stockout_date"],
                "suggested_reorder_qty": plan["reorder_qty"],
                "target_stock": plan["target_stock"],
                "profit_last_30_days": p.get("profit_30d"),
            }
        )
    payload = {
        "currency": forecast["currency"],
        "kpis_last_7_days": dashboard["kpis"]["7d"],
        "kpis_last_30_days": dashboard["kpis"]["30d"],
        "inventory": dashboard["inventory"],
        "store_forecast": forecast["store"],
        "upcoming_events": forecast["events"],
        "products": rows,
    }
    return json.dumps(payload, separators=(",", ":"), default=str)


def generate(forecast: dict, dashboard: dict, store_name: str, niche: str, market: str, today: str) -> tuple[WeeklyBrief, list[dict]]:
    prompt = (
        f"Today is {today}. Store: {store_name or 'unnamed'}; niche: {niche or 'not set'}; market: {market or 'not set'}.\n"
        "This week's data (JSON):\n"
        f"{_compact(forecast, dashboard)}\n\n"
        "Check the outside world, then write this week's plan."
    )
    return research.run(SYSTEM, prompt, REPORT_TOOL, WeeklyBrief, max_searches=6, effort="high")


def apply_adjustments(forecast: dict, brief: WeeklyBrief) -> list[dict]:
    """Per-product next-week numbers before and after the AI's adjustments."""
    by_sku = {it["product"]["sku"].upper(): it for it in forecast["items"] if not it["locked"]}
    out = []
    for adj in brief.adjustments:
        it = by_sku.get(adj.sku.upper())
        if not it:
            continue
        base = it["forecast"]["next_week"]
        out.append(
            {
                "sku": it["product"]["sku"],
                "name": it["product"]["name"],
                "base_next_week": base,
                "adjusted_next_week": round(base * (1 + adj.change_pct / 100), 1),
                "change_pct": adj.change_pct,
                "reason": adj.reason,
                "source_url": adj.source_url,
            }
        )
    return out
