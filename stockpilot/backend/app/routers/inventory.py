from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import billing, demo, services
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
    stats = services.product_stats(products, services.sales_since(session, user.id, now - timedelta(days=30)), now)
    return [services.product_out(p, stats[p.id]) for p in products]


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
    stats = services.product_stats([p], sales, now)[p.id]
    out = services.product_out(p, stats)
    history = weekly_buckets(((s.sold_at, s.quantity) for s in sales), now, services.HISTORY_WEEKS)
    out["weekly_units"] = history
    fc = forecast_weekly(services.uncensor(history, p.stock_qty), 4)
    out["forecast"] = fc.to_dict()
    out["stock_plan"] = plan_stock(fc, p.stock_qty, p.incoming_qty, p.lead_time_days, now, fulfilment=p.fulfilment).to_dict()
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
    p.stock_qty += body.delta
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


# ---- CSV import -----------------------------------------------------------------------------------

def _rows(upload: UploadFile) -> list[dict]:
    raw = upload.file.read(5_000_000 + 1)
    if len(raw) > 5_000_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "CSV must be under 5 MB")
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return [{(k or "").strip().lower(): (v or "").strip() for k, v in row.items()} for row in reader]


def _num(v: str, default: float = 0.0) -> float:
    try:
        return float(v.replace(",", "").replace("$", "").replace("£", "").replace("€", "")) if v else default
    except ValueError:
        return default


def _date(v: str) -> datetime | None:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(v[:19], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        return _as_utc(datetime.fromisoformat(v))
    except ValueError:
        return None


@router.post("/import/products")
def import_products(
    file: UploadFile = File(...), user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict:
    """Columns: sku, name, category, cost_price, sell_price, stock_qty, lead_time_days, supplier, fulfilment."""
    created = updated = 0
    errors: list[str] = []
    existing = {p.sku: p for p in session.exec(select(Product).where(Product.user_id == user.id))}
    for i, row in enumerate(_rows(file), start=2):
        sku = row.get("sku") or row.get("variant sku") or ""
        name = row.get("name") or row.get("title") or ""
        if not sku or not name:
            errors.append(f"row {i}: sku and name are required")
            continue
        fields = {
            "name": name,
            "category": row.get("category") or row.get("type") or "",
            "cost_price": _num(row.get("cost_price") or row.get("cost per item") or ""),
            "sell_price": _num(row.get("sell_price") or row.get("price") or row.get("variant price") or ""),
            "stock_qty": int(_num(row.get("stock_qty") or row.get("inventory") or row.get("variant inventory qty") or "")),
            "lead_time_days": int(_num(row.get("lead_time_days") or "", 7)),
            "supplier": row.get("supplier") or row.get("vendor") or "",
            "fulfilment": "dropship" if (row.get("fulfilment") or "").lower().startswith("drop") else "own_stock",
        }
        if sku in existing:
            p = existing[sku]
            for k, v in fields.items():
                setattr(p, k, v)
            p.archived = False
            updated += 1
        else:
            p = Product(user_id=user.id, sku=sku, **fields)
            existing[sku] = p
            created += 1
        session.add(p)
    session.commit()
    return {"created": created, "updated": updated, "errors": errors[:50]}


@router.post("/import/sales")
def import_sales(
    file: UploadFile = File(...),
    adjust_stock: bool = False,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Columns: sku, quantity, unit_price, sold_at, channel, order_ref (Shopify order exports also work)."""
    products = {p.sku: p for p in session.exec(select(Product).where(Product.user_id == user.id))}
    imported = 0
    errors: list[str] = []
    for i, row in enumerate(_rows(file), start=2):
        sku = row.get("sku") or row.get("lineitem sku") or ""
        p = products.get(sku)
        if p is None:
            errors.append(f"row {i}: unknown sku '{sku}'")
            continue
        qty = int(_num(row.get("quantity") or row.get("lineitem quantity") or "", 1))
        when = _date(row.get("sold_at") or row.get("created at") or row.get("date") or "")
        if qty <= 0 or when is None:
            errors.append(f"row {i}: needs a positive quantity and a date")
            continue
        price = _num(row.get("unit_price") or row.get("lineitem price") or "", p.sell_price)
        session.add(
            Sale(
                user_id=user.id, product_id=p.id, quantity=qty, unit_price=price, sold_at=when,
                channel=row.get("channel") or row.get("source") or "", order_ref=row.get("order_ref") or row.get("name") or "",
            )
        )
        if adjust_stock:
            p.stock_qty -= qty
            session.add(p)
        imported += 1
    session.commit()
    return {"imported": imported, "errors": errors[:50]}


@router.post("/demo/seed")
def seed_demo(user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    """Replace this account's data with a demo pet-supplies store."""
    return demo.seed(session, user)
