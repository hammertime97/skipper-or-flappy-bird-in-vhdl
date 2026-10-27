"""Selling fees per channel, so profit is what the seller actually keeps.

The defaults are typical published rates for most categories, as a starting point
only: fees differ by category, country, plan and promotions. Sellers can change
them in the app (Account > Selling fees).
"""

from __future__ import annotations

DEFAULT_FEES: dict[str, dict] = {
    "ebay": {"label": "eBay", "pct": 13.25, "fixed": 0.30},
    "amazon": {"label": "Amazon", "pct": 15.0, "fixed": 0.0},
    "etsy": {"label": "Etsy", "pct": 9.5, "fixed": 0.45},
    "tiktok": {"label": "TikTok Shop", "pct": 8.0, "fixed": 0.0},
    "shopify": {"label": "Shopify / own website", "pct": 2.9, "fixed": 0.30},
    "other": {"label": "Other channels", "pct": 0.0, "fixed": 0.0},
}

_ALIASES = [
    ("ebay", "ebay"),
    ("amazon", "amazon"),
    ("etsy", "etsy"),
    ("tiktok", "tiktok"),
    ("shopify", "shopify"),
    ("web", "shopify"),
    ("shop_app", "shopify"),
    ("instagram", "shopify"),
    ("online store", "shopify"),
]


def channel_key(channel: str) -> str:
    c = (channel or "").lower()
    for needle, key in _ALIASES:
        if needle in c:
            return key
    return "other"


def fee_table(user_fees: dict | None) -> dict[str, dict]:
    table = {k: dict(v) for k, v in DEFAULT_FEES.items()}
    for k, v in (user_fees or {}).items():
        if k in table and isinstance(v, dict):
            for f in ("pct", "fixed"):
                if isinstance(v.get(f), (int, float)) and v[f] >= 0:
                    table[k][f] = float(v[f])
    return table


def sale_fee(table: dict[str, dict], channel: str, revenue: float, orders: int = 1) -> float:
    """Fee for one sale line. Fixed fees are charged per order line here, a slight overestimate for multi-item orders."""
    f = table[channel_key(channel)]
    return revenue * f["pct"] / 100 + f["fixed"] * orders
