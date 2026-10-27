"""Trend Scout: searches the web for what is selling in the seller's niche right now."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel

from . import research

SYSTEM = """You are Trend Scout inside StockPilot, a tool for e-commerce and dropshipping sellers.
Research what is selling right now in the seller's niche and market, and recommend products to add to their store.

How to research:
- Search the web for current signals: TikTok Shop / TikTok Made Me Buy It trends, Amazon Movers & Shakers and \
best-seller lists, Google Trends coverage, Etsy/eBay trending searches, AliExpress/CJ hot products, news, and what \
competitor stores in this niche are promoting.
- Prefer evidence from the last 60 days. Note the date of the evidence when you can.
- Don't recommend products the seller already sells; you may suggest variants or bundles of them.
- Be honest about saturation: a product every dropshipper already sells is a weak pick, say so.
- Only give price ranges you saw in your research, and say they are estimates.

When done, call report_trends exactly once with your findings."""

REPORT_TOOL = {
    "name": "report_trends",
    "description": "Submit the final Trend Scout report for the seller's niche.",
    "input_schema": {
        "type": "object",
        "properties": {
            "niche_summary": {"type": "string", "description": "2-3 sentences on where the niche is heading right now."},
            "trending_products": {
                "type": "array",
                "description": "4-8 products worth adding, best first.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "why_trending": {"type": "string"},
                        "evidence": {"type": "string", "description": "What you found and where, with dates when known."},
                        "momentum": {"type": "string", "enum": ["exploding", "rising", "steady"]},
                        "competition": {"type": "string", "enum": ["low", "medium", "high"]},
                        "typical_retail_price": {"type": "string", "description": "Range seen in research, e.g. '$19-29'."},
                        "typical_supplier_cost": {"type": "string", "description": "Range seen, or 'unknown'."},
                        "fit_with_store": {"type": "string", "description": "How it fits the seller's current catalogue."},
                        "how_to_sell_it": {"type": "string", "description": "Angle, channel and creative idea."},
                        "risk": {"type": "string"},
                        "source_urls": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": [
                        "name", "why_trending", "evidence", "momentum", "competition", "typical_retail_price",
                        "typical_supplier_cost", "fit_with_store", "how_to_sell_it", "risk", "source_urls",
                    ],
                    "additionalProperties": False,
                },
            },
            "fading_trends": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Products in this niche that are cooling off; flag any the seller stocks.",
            },
            "competitor_moves": {"type": "array", "items": {"type": "string"}},
            "content_ideas": {"type": "array", "items": {"type": "string"}, "description": "Short video/ad hooks."},
        },
        "required": ["niche_summary", "trending_products", "fading_trends", "competitor_moves", "content_ideas"],
        "additionalProperties": False,
    },
}


class TrendingProduct(BaseModel):
    name: str
    why_trending: str
    evidence: str
    momentum: Literal["exploding", "rising", "steady"]
    competition: Literal["low", "medium", "high"]
    typical_retail_price: str
    typical_supplier_cost: str
    fit_with_store: str
    how_to_sell_it: str
    risk: str
    source_urls: list[str]


class TrendReport(BaseModel):
    niche_summary: str
    trending_products: list[TrendingProduct]
    fading_trends: list[str]
    competitor_moves: list[str]
    content_ideas: list[str]


def generate(niche: str, market: str, catalogue: list[str], today: date | None = None) -> tuple[TrendReport, list[dict]]:
    today = today or date.today()
    listed = "\n".join(f"- {name}" for name in catalogue[:80]) or "- (no products yet)"
    prompt = (
        f"Today is {today.isoformat()}.\n"
        f"Niche: {niche}\n"
        f"Target market: {market or 'global / not specified'}\n"
        f"Products the seller already sells:\n{listed}\n\n"
        "Find what is trending in this niche right now and what I should add to my inventory."
    )
    return research.run(SYSTEM, prompt, REPORT_TOOL, TrendReport)
