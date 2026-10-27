"""Product Check: "should I sell this?" - researches one product idea and scores it."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, field_validator

from . import research

SYSTEM = """You are Product Check inside StockPilot, a tool for e-commerce and dropshipping sellers.
The seller is considering adding one product. Research it on the web and give a clear go / test / skip verdict.

Look for: current demand and momentum (search trends, social buzz, marketplace rankings and review counts), \
saturation (how many stores and ads already push it), typical retail prices, supplier costs, shipping or \
quality complaints, seasonality, and platform or legal restrictions (e.g. batteries, cosmetics, kids' products).

Work out the margin from the seller's numbers when they give them; otherwise from prices you found, and say so.
Be direct. A "skip" with a good reason saves the seller money.
When done, call report_product_check exactly once."""

_SCORE = {"type": "integer"}

REPORT_TOOL = {
    "name": "report_product_check",
    "description": "Submit the verdict on the product idea.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["go", "test_small", "skip"]},
            "one_line": {"type": "string"},
            "demand_score": {**_SCORE, "description": "1-10; 10 = huge and growing demand"},
            "competition_score": {**_SCORE, "description": "1-10; 10 = very saturated"},
            "margin_score": {**_SCORE, "description": "1-10; 10 = excellent margin after ads and shipping"},
            "estimated_margin": {"type": "string"},
            "typical_retail_price": {"type": "string"},
            "seasonality": {"type": "string"},
            "best_channels": {"type": "array", "items": {"type": "string"}},
            "target_customer": {"type": "string"},
            "angles": {"type": "array", "items": {"type": "string"}, "description": "Marketing angles that could beat competitors."},
            "red_flags": {"type": "array", "items": {"type": "string"}},
            "first_test_plan": {"type": "string", "description": "How to test cheaply: units, budget, what result means go."},
            "source_urls": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "verdict", "one_line", "demand_score", "competition_score", "margin_score", "estimated_margin",
            "typical_retail_price", "seasonality", "best_channels", "target_customer", "angles", "red_flags",
            "first_test_plan", "source_urls",
        ],
        "additionalProperties": False,
    },
}


class ProductCheck(BaseModel):
    verdict: Literal["go", "test_small", "skip"]
    one_line: str
    demand_score: int
    competition_score: int
    margin_score: int
    estimated_margin: str
    typical_retail_price: str
    seasonality: str
    best_channels: list[str]
    target_customer: str
    angles: list[str]
    red_flags: list[str]
    first_test_plan: str
    source_urls: list[str]

    @field_validator("demand_score", "competition_score", "margin_score")
    @classmethod
    def _clamp(cls, v: int) -> int:
        return max(1, min(10, v))


def generate(
    idea: str,
    niche: str,
    market: str,
    unit_cost: float | None,
    sell_price: float | None,
    currency: str,
    today: date | None = None,
) -> tuple[ProductCheck, list[dict]]:
    today = today or date.today()
    numbers = []
    if unit_cost is not None:
        numbers.append(f"landed cost per unit {unit_cost:.2f} {currency}")
    if sell_price is not None:
        numbers.append(f"planned selling price {sell_price:.2f} {currency}")
    prompt = (
        f"Today is {today.isoformat()}.\n"
        f"Product idea: {idea}\n"
        f"My store's niche: {niche or 'not set'}; market: {market or 'not specified'}.\n"
        f"My numbers: {', '.join(numbers) if numbers else 'none yet'}.\n\n"
        "Should I sell this?"
    )
    return research.run(SYSTEM, prompt, REPORT_TOOL, ProductCheck, max_searches=6)
