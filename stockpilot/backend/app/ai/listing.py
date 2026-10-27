"""Listing Writer: SEO title, bullets, description and tags for a product page."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .client import structured

Platform = Literal["shopify", "tiktok_shop", "amazon", "ebay", "etsy", "woocommerce"]

SYSTEM = """You write product listings that sell, for StockPilot users (e-commerce and dropshipping sellers).
Follow the target platform's conventions (title length, bullet style, what is allowed).
Lead with the benefit the buyer cares about, then the features. Use the search terms real shoppers type.
Never invent specs, certifications, materials or claims that weren't given; if something important is missing, \
list it in missing_info instead. No medical or "guaranteed" claims. No ALL CAPS."""


class Listing(BaseModel):
    title: str
    short_description: str
    bullet_points: list[str]
    description: str
    seo_keywords: list[str]
    hashtags: list[str]
    missing_info: list[str]


def generate(name: str, details: str, platform: Platform, tone: str, price: float | None, currency: str, market: str) -> Listing:
    content = (
        f"Platform: {platform}\n"
        f"Market: {market or 'not specified'}\n"
        f"Tone: {tone or 'friendly and confident'}\n"
        f"Product: {name}\n"
        f"Price: {f'{price:.2f} {currency}' if price else 'not given'}\n"
        f"Details from the seller:\n{details or '(none)'}\n\n"
        "Write the listing. 5 bullet points, 8-15 SEO keywords, 5-10 hashtags."
    )
    return structured(SYSTEM, content, Listing, effort="low", max_tokens=8000)
