"""Database tables."""

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    store_name: str = ""
    niche: str = ""  # e.g. "pet accessories", used by Trend Scout
    target_market: str = ""  # e.g. "UK", "US"
    currency: str = "USD"
    plan: str = "free"  # "free" | "pro"
    plan_expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class Product(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "sku"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    sku: str
    name: str
    category: str = ""
    cost_price: float = 0.0  # what you pay the supplier per unit (incl. shipping)
    sell_price: float = 0.0
    stock_qty: int = 0  # own stock, or the supplier's stock for dropship items
    incoming_qty: int = 0  # already ordered, not yet received
    lead_time_days: int = 7  # supplier processing + shipping time
    supplier: str = ""
    fulfilment: str = "own_stock"  # "own_stock" | "dropship"
    image_url: str = ""
    archived: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Sale(SQLModel, table=True):
    """One order line: N units of a product sold at a price."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    quantity: int
    unit_price: float
    channel: str = ""  # "shopify", "tiktok", "amazon", ...
    order_ref: str = ""
    sold_at: datetime = Field(default_factory=utcnow, index=True)


class AIReport(SQLModel, table=True):
    """Saved output of an AI feature. Also the ledger for monthly AI quotas."""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    kind: str = Field(index=True)  # "weekly_brief" | "trend_scout" | "assistant" | "listing"
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow, index=True)
