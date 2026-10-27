from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import billing, demo, fees, services
from ..auth import current_user
from ..config import settings
from ..db import get_session
from ..forecasting import forecast_weekly, plan_stock, weekly_buckets
from ..models import Product, Sale, User, utcnow

router = APIRouter()


class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category: str = ""
    cost_price: float = Field(default=0, ge=0)
    sell_price: float = Field(default=0, ge=0)
    stock_qty: int = 0
    incoming_qty: int = Field(default=0, ge=0)
    lead_time_days: int = Field(default=7, ge=0, le=180)
    supplier: str = ""
    fulfilment: Literal["own_stock", "dropship"] = "own_stock"
    image_url: str = ""


class ProductPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    cost_price: float | None = Field(default=None, ge=0)
    sell_price: float | None = Field(default=None, ge=0)
    stock_qty: int | None = None
    incoming_qty: int | None = Field(default=None, ge=0)
    lead_time_days: int | None = Field(default=None, ge=0, le=180)
    supplier: str | None = None
    fulfilment: Literal["own_stock", "dropship"] | None = None
    image_url: str | None = None


class StockAdjust(BaseModel):
    delta: int  # +received, -damaged/lost
    receive_incoming: bool = False  # true: also reduce incoming_qty by delta


class SaleIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1)
    unit_price: float | None = Field(default=None, ge=0)  # defaults to the product's price
    channel: str = ""
    order_ref: str = ""
    sold_at: datetime | None = None
    adjust_stock: bool = True


def _as_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _own_product(session: Session, user: User, product_id: int) -> Product:
    p = session.get(Product, product_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return p


@router.get("/dashboard")
def get_dashboard(user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    return services.dashboard(session, user)


@router.get("/products")
def list_products(
    q: str = "",
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[dict]:
    now = utcnow()
    products = services.active_products(session, user.id)
    if q:
        ql = q.lower()
        products = [p for p in products if ql in p.name.lower() or ql in p.sku.lower() or ql in p.category.lower()]
    table = fees.fee_table(user.channel_fees)
    stats = services.product_stats(products, services.sales_since(session, user.id, now - timedelta(days=30)), now, table)
    return [services.product_out(p, stats[p.id]) for p in products]


class StockCount(BaseModel):
    id: int
    stock_qty: int


class StockCounts(BaseModel):
    items: list[StockCount]


@router.post("/products/stock-counts")
def set_stock_counts(body: StockCounts, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    """Type in stock for several products at once (after importing a sales file)."""
    updated = 0
    for item in body.items:
        p = session.get(Product, item.id)
        if p is None or p.user_id != user.id:
            continue
        p.stock_qty, p.stock_known = item.stock_qty, True
        session.add(p)
        updated += 1
    session.commit()
    return {"updated": updated}


class CostItem(BaseModel):
    id: int
    cost_price: float = Field(ge=0)


class CostItems(BaseModel):
    items: list[CostItem]


@router.post("/products/costs")
def set_costs(body: CostItems, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    """Type in what you pay per item for several products at once."""
    updated = 0
    for item in body.items:
        p = session.get(Product, item.id)
        if p is None or p.user_id != user.id:
            continue
        p.cost_price = item.cost_price
        session.add(p)
        updated += 1
    session.commit()
    return {"updated": updated}


@router.post("/products", status_code=201)
def create_product(body: ProductIn, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    existing = session.exec(select(Product).where(Product.user_id == user.id, Product.sku == body.sku)).first()
    if existing and not existing.archived:
        raise HTTPException(status.HTTP_409_CONFLICT, f"SKU {body.sku} already exists")
    if existing:  # re-adding an archived SKU brings it back
        for k, v in body.model_dump().items():
            setattr(existing, k, v)
        existing.archived = False
        p = existing
    else:
        p = Product(user_id=user.id, **body.model_dump())
    session.add(p)
    session.commit()
    session.refresh(p)
    return services.product_out(p)


@router.get("/products/{product_id}")
def get_product(product_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    p = _own_product(session, user, product_id)
    now = utcnow()
    sales = list(session.exec(select(Sale).where(Sale.product_id == p.id, Sale.sold_at >= now - timedelta(weeks=services.HISTORY_WEEKS))))
    stats = services.product_stats([p], sales, now, fees.fee_table(user.channel_fees))[p.id]
    out = services.product_out(p, stats)
    history = weekly_buckets(((s.sold_at, s.quantity) for s in sales), now, services.HISTORY_WEEKS)
    out["weekly_units"] = history
    # Free plan: full forecasts only for the top sellers, the same rule as the Forecast tab.
    locked = not billing.is_pro(user) and p.id not in services.unlocked_product_ids(
        session, user, settings.free_forecast_products, now
    )
    out["locked"] = locked
    if not locked:
        fc = forecast_weekly(services.uncensor(history, p.stock_qty, p.stock_known), 4)
        out["forecast"] = fc.to_dict()
        out["stock_plan"] = plan_stock(
            fc, p.stock_qty, p.incoming_qty, p.lead_time_days, now, fulfilment=p.fulfilment, stock_known=p.stock_known
        ).to_dict()
    out["recent_sales"] = [
        {"id": s.id, "quantity": s.quantity, "unit_price": s.unit_price, "channel": s.channel, "sold_at": s.sold_at.isoformat()}
        for s in sorted(sales, key=lambda s: s.sold_at, reverse=True)[:20]
    ]
    return out


@router.patch("/products/{product_id}")
def update_product(
    product_id: int, body: ProductPatch, user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict:
    p = _own_product(session, user, product_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    if body.stock_qty is not None:
        p.stock_known = True
    session.add(p)
    session.commit()
    session.refresh(p)
    return services.product_out(p)


@router.delete("/products/{product_id}", status_code=204)
def archive_product(product_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)) -> None:
    p = _own_product(session, user, product_id)
    p.archived = True  # keep sales history intact
    session.add(p)
    session.commit()


@router.post("/products/{product_id}/stock")
def adjust_stock(
    product_id: int, body: StockAdjust, user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict:
    p = _own_product(session, user, product_id)
    p.stock_qty = (p.stock_qty if p.stock_known else 0) + body.delta
    p.stock_known = True
    if body.receive_incoming and body.delta > 0:
        p.incoming_qty = max(0, p.incoming_qty - body.delta)
    session.add(p)
    session.commit()
    session.refresh(p)
    return services.product_out(p)


@router.post("/sales", status_code=201)
def record_sale(body: SaleIn, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    p = _own_product(session, user, body.product_id)
    sale = Sale(
        user_id=user.id,
        product_id=p.id,
        quantity=body.quantity,
        unit_price=p.sell_price if body.unit_price is None else body.unit_price,
        channel=body.channel,
        order_ref=body.order_ref,
        sold_at=_as_utc(body.sold_at) if body.sold_at else utcnow(),
    )
    if body.adjust_stock:
        p.stock_qty -= body.quantity
        session.add(p)
    session.add(sale)
    session.commit()
    session.refresh(sale)
    return sale.model_dump(exclude={"user_id"})


@router.get("/sales")
def list_sales(
    days: int = Query(default=30, ge=1, le=365),
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[dict]:
    rows = services.sales_since(session, user.id, utcnow() - timedelta(days=days))
    names = {p.id: (p.sku, p.name) for p in session.exec(select(Product).where(Product.user_id == user.id))}
    rows.sort(key=lambda s: s.sold_at, reverse=True)
    return [
        {**s.model_dump(exclude={"user_id"}), "sku": names.get(s.product_id, ("", ""))[0], "name": names.get(s.product_id, ("", ""))[1]}
        for s in rows[:500]
    ]


@router.get("/forecasts")
def get_forecasts(
    horizon: int = Query(default=4, ge=1, le=8),
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> dict:
    limit = None if billing.is_pro(user) else settings.free_forecast_products
    return services.forecasts(session, user, horizon=horizon, max_products=limit)


@router.post("/demo/seed")
def seed_demo(user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    """Replace this account's data with a demo pet-supplies store."""
    return demo.seed(session, user)
