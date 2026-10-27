"""Ask StockPilot: a chat assistant that answers questions from the seller's own data via tools."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta
from typing import Any, Callable

from sqlmodel import Session

from .. import services
from ..config import settings
from ..models import User, utcnow
from .client import FALLBACK_BETA, AIError, get_client, translate_errors

MAX_ROUNDS = 8

SYSTEM = """You are StockPilot's assistant for an e-commerce / dropshipping seller.
Answer questions about their store using the tools; they read the seller's live data.
Always look the numbers up rather than guessing, and quote them. Forecasts come from the get_forecasts tool; \
don't make up your own. Keep answers short and practical: lead with the answer, then up to 3 bullet points. \
Use the store's currency. If the data can't answer the question, say what is missing."""

TOOLS: list[dict] = [
    {
        "name": "get_dashboard",
        "description": "Store KPIs for the last 7 and 30 days (revenue, profit, units, orders, % change vs the previous period), "
        "inventory totals, top sellers, low stock and dead stock.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_forecasts",
        "description": "Weekly demand forecast and stock plan (status, run-out date, reorder quantity) per product. "
        "Optionally filter to one SKU or to a stock status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sku": {"type": "string", "description": "Exact SKU, or empty for all products."},
                "status": {
                    "type": "string",
                    "enum": ["any", "out_of_stock", "reorder_now", "low", "healthy", "overstock", "dead_stock", "no_demand"],
                },
            },
            "required": ["sku", "status"],
            "additionalProperties": False,
        },
    },
    {
        "name": "search_products",
        "description": "Find products by name, SKU or category; returns stock, prices, margin and recent sales.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Text to match, or empty for all products."}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_sales_by_day",
        "description": "Units and revenue per day for the last N days (max 180), for the whole store or one SKU.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "1-180"},
                "sku": {"type": "string", "description": "Exact SKU, or empty for the whole store."},
            },
            "required": ["days", "sku"],
            "additionalProperties": False,
        },
    },
]
for _t in TOOLS:
    _t["strict"] = True


def _tool_impls(session: Session, user: User) -> dict[str, Callable[[dict], Any]]:
    def get_dashboard(_: dict) -> Any:
        return services.dashboard(session, user)

    def get_forecasts(args: dict) -> Any:
        data = services.forecasts(session, user)
        sku = (args.get("sku") or "").strip().lower()
        status = args.get("status") or "any"
        items = [it for it in data["items"] if not it["locked"]]
        if sku:
            items = [it for it in items if it["product"]["sku"].lower() == sku]
        if status != "any":
            items = [it for it in items if it["stock_plan"]["status"] == status]
        for it in items:
            it["forecast"].pop("history", None)
        return {"store": data["store"], "items": items[:40], "currency": data["currency"]}

    def search_products(args: dict) -> Any:
        q = (args.get("query") or "").strip().lower()
        now = utcnow()
        products = services.active_products(session, user.id)
        if q:
            products = [p for p in products if q in p.name.lower() or q in p.sku.lower() or q in p.category.lower()]
        sales = services.sales_since(session, user.id, now - timedelta(days=30))
        stats = services.product_stats(products, sales, now)
        return [services.product_out(p, stats[p.id]) for p in products[:40]]

    def get_sales_by_day(args: dict) -> Any:
        days = max(1, min(180, int(args.get("days") or 30)))
        sku = (args.get("sku") or "").strip().lower()
        now = utcnow()
        products = {p.id: p for p in services.active_products(session, user.id)}
        if sku:
            products = {pid: p for pid, p in products.items() if p.sku.lower() == sku}
            if not products:
                return {"error": f"No product with SKU {args.get('sku')}"}
        per_day: dict[str, dict] = defaultdict(lambda: {"units": 0, "revenue": 0.0})
        for s in services.sales_since(session, user.id, now - timedelta(days=days)):
            if s.product_id in products:
                d = per_day[s.sold_at.date().isoformat()]
                d["units"] += s.quantity
                d["revenue"] = round(d["revenue"] + s.quantity * s.unit_price, 2)
        return [{"date": k, **v} for k, v in sorted(per_day.items())]

    return {
        "get_dashboard": get_dashboard,
        "get_forecasts": get_forecasts,
        "search_products": search_products,
        "get_sales_by_day": get_sales_by_day,
    }


def chat(session: Session, user: User, history: list[dict], question: str) -> str:
    """`history` is prior turns as [{"role": "user"|"assistant", "content": str}]."""
    impls = _tool_impls(session, user)
    system = f"{SYSTEM}\nStore: {user.store_name or 'unnamed'}. Niche: {user.niche or 'not set'}. Currency: {user.currency}. Today: {utcnow().date().isoformat()}."
    messages: list[dict] = [
        {"role": m["role"], "content": m["content"]} for m in history[-20:] if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    messages.append({"role": "user", "content": question})
    client = get_client()

    for _ in range(MAX_ROUNDS):
        try:
            with client.beta.messages.stream(
                model=settings.claude_model,
                max_tokens=16000,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                system=system,
                tools=[{**t, "eager_input_streaming": True} for t in TOOLS],
                messages=messages,
                output_config={"effort": "medium"},
            ) as stream:
                msg = stream.get_final_message()
        except Exception as exc:  # noqa: BLE001 - mapped to AIError
            raise translate_errors(exc) from exc

        if msg.stop_reason == "refusal":
            raise AIError("The assistant can't help with that one. Try asking differently.", 422)
        if msg.stop_reason == "max_tokens":
            raise AIError("The answer was too long. Try a narrower question.", 502)

        if msg.stop_reason != "tool_use":
            return "\n".join(b.text for b in msg.content if b.type == "text").strip()

        messages.append({"role": "assistant", "content": msg.content})
        results = []
        for block in msg.content:
            if block.type != "tool_use":
                continue
            impl = impls.get(block.name)
            try:
                args = block.input if isinstance(block.input, dict) else json.loads(block.input)
                if impl is None:
                    raise ValueError(f"unknown tool {block.name}")
                output = json.dumps(impl(args), default=str, separators=(",", ":"))
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
            except (ValueError, TypeError, json.JSONDecodeError) as err:
                results.append({"type": "tool_result", "tool_use_id": block.id, "is_error": True, "content": f"INVALID_INPUT: {err}"})
        messages.append({"role": "user", "content": results})

    raise AIError("The assistant took too many steps. Try a simpler question.", 502)
