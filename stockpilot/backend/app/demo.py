"""Realistic demo store so a new user (or a Play Store reviewer) sees every screen working."""

from __future__ import annotations

import math
import random
from datetime import timedelta

from sqlmodel import Session, delete

from .models import AIReport, Product, Sale, User, utcnow

# sku, name, category, cost, price, stock, lead days, fulfilment, base weekly units, weekly growth, pattern
CATALOGUE = [
    ("PET-001", "Self-Cleaning Slicker Brush", "Grooming", 4.20, 19.99, 140, 12, "own_stock", 30, 0.01, "steady"),
    ("PET-002", "No-Pull Dog Harness (M)", "Walking", 6.80, 29.99, 38, 14, "own_stock", 22, 0.025, "rising"),
    ("PET-003", "Interactive Cat Laser Toy", "Toys", 5.10, 24.99, 0, 10, "own_stock", 18, 0.0, "steady"),
    ("PET-004", "Collapsible Silicone Travel Bowl", "Feeding", 1.30, 9.99, 420, 12, "own_stock", 26, -0.01, "steady"),
    ("PET-005", "Orthopedic Calming Dog Bed (L)", "Beds", 18.50, 69.99, 25, 21, "own_stock", 9, 0.03, "rising"),
    ("PET-006", "Pet Hair Remover Roller", "Cleaning", 2.40, 14.99, 75, 10, "own_stock", 20, 0.01, "viral"),
    ("PET-007", "Automatic Water Fountain 2L", "Feeding", 9.90, 39.99, 60, 14, "dropship", 12, 0.02, "steady"),
    ("PET-008", "LED Safety Collar", "Walking", 2.10, 16.99, 300, 12, "own_stock", 20, -0.05, "declining"),
    ("PET-009", "Lick Mat Slow Feeder", "Feeding", 1.10, 12.99, 90, 10, "own_stock", 16, 0.03, "steady"),
    ("PET-010", "Dog Raincoat with Hood", "Apparel", 5.60, 27.99, 210, 18, "own_stock", 6, 0.0, "seasonal"),
    ("PET-011", "Cat Window Hammock", "Beds", 6.20, 32.99, 15, 14, "dropship", 4, 0.0, "intermittent"),
    ("PET-012", "Paw Cleaner Cup", "Cleaning", 2.90, 18.99, 180, 12, "own_stock", 0, 0.0, "dead"),
    ("PET-013", "GPS Tag Holder Clip", "Accessories", 0.90, 8.99, 55, 10, "dropship", 25, 0.0, "new"),
    ("PET-014", "Puzzle Treat Ball", "Toys", 3.20, 15.99, 95, 12, "own_stock", 11, 0.0, "steady"),
]

CHANNELS = ["shopify", "shopify", "shopify", "tiktok", "tiktok", "amazon"]


def seed(session: Session, user: User, weeks: int = 26, rng_seed: int = 7) -> dict:
    """Replace the user's products and sales with the demo catalogue."""
    rng = random.Random(rng_seed)
    session.exec(delete(Sale).where(Sale.user_id == user.id))
    session.exec(delete(Product).where(Product.user_id == user.id))
    session.exec(delete(AIReport).where(AIReport.user_id == user.id))
    session.commit()

    now = utcnow()
    n_sales = 0
    for sku, name, cat, cost, price, stock, lead, fulfil, base, growth, pattern in CATALOGUE:
        p = Product(
            user_id=user.id, sku=sku, name=name, category=cat, cost_price=cost, sell_price=price,
            stock_qty=stock, lead_time_days=lead, fulfilment=fulfil,
            supplier="CJ Dropshipping" if fulfil == "dropship" else "Shenzhen PetGoods Co.",
            incoming_qty=40 if sku == "PET-003" else 0,
        )
        session.add(p)
        session.flush()
        for day in range(weeks * 7, 0, -1):
            week_idx = weeks - day / 7  # 0 .. weeks
            rate = base / 7 * (1 + growth) ** week_idx
            if pattern == "viral":
                rate *= 1 + 2.0 / (1 + math.exp(-(week_idx - (weeks - 4))))  # took off ~4 weeks ago
            elif pattern == "seasonal":
                rate *= 1 + 0.8 * math.cos((week_idx - weeks) / 52 * 2 * math.pi)
            elif pattern == "new" and week_idx < weeks - 5:
                rate = 0
            elif pattern == "intermittent":
                rate = rate * 4 if rng.random() < 0.25 else 0
            elif pattern == "dead":
                rate = 0
            if pattern == "steady" and sku == "PET-003" and day <= 6:
                rate = 0  # sold out this week
            if (now - timedelta(days=day)).weekday() >= 5:
                rate *= 1.25  # weekend bump
            qty = _poisson(rng, rate)
            for _ in range(qty):
                sold_at = now - timedelta(days=day, hours=rng.uniform(0, 23.9))
                session.add(
                    Sale(
                        user_id=user.id, product_id=p.id, quantity=1,
                        unit_price=round(price * rng.choice([1, 1, 1, 0.9]), 2),
                        channel=rng.choice(CHANNELS), order_ref=f"#{rng.randint(10000, 99999)}", sold_at=sold_at,
                    )
                )
                n_sales += 1
    if not user.store_name:
        user.store_name = "Pawsome Supplies (demo)"
    if not user.niche:
        user.niche = "pet accessories for dogs and cats"
    session.add(user)
    session.commit()
    return {"products": len(CATALOGUE), "sales": n_sales}


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1
