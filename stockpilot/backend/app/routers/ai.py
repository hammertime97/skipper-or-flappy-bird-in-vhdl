from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import billing, services
from ..ai import assistant, listing, product_check, trend_scout, weekly_brief
from ..ai.client import AIError
from ..auth import current_user
from ..config import settings
from ..db import get_session
from ..models import AIReport, Product, User, utcnow

router = APIRouter(prefix="/ai")


class TrendScoutIn(BaseModel):
    niche: str | None = Field(default=None, max_length=200)
    market: str | None = Field(default=None, max_length=80)


class ProductCheckIn(BaseModel):
    idea: str = Field(min_length=3, max_length=500)
    unit_cost: float | None = Field(default=None, ge=0)
    sell_price: float | None = Field(default=None, ge=0)


class ChatTurn(BaseModel):
    role: str
    content: str = Field(max_length=8000)


class AssistantIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = []


class ListingIn(BaseModel):
    product_id: int | None = None
    name: str = Field(default="", max_length=200)
    details: str = Field(default="", max_length=4000)
    platform: listing.Platform = "shopify"
    tone: str = Field(default="", max_length=100)


def _save(session: Session, user: User, kind: str, payload: dict) -> dict:
    report = AIReport(user_id=user.id, kind=kind, payload=payload)
    session.add(report)
    session.commit()
    session.refresh(report)
    return {"id": report.id, "kind": kind, "created_at": report.created_at.isoformat(), **payload}


def _ai_failed(err: AIError) -> HTTPException:
    return HTTPException(err.status_code, {"code": "ai_error", "message": str(err)})


@router.post("/weekly-brief")
def create_weekly_brief(user: User = Depends(billing.require_ai_quota), session: Session = Depends(get_session)) -> dict:
    fc = services.forecasts(session, user, max_products=None if billing.is_pro(user) else settings.free_forecast_products)
    if not any(not it["locked"] and it["forecast"]["history"] for it in fc["items"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "no_data", "message": "Add products and sales first."})
    dash = services.dashboard(session, user)
    try:
        brief, sources = weekly_brief.generate(
            fc, dash, user.store_name, user.niche, user.target_market, utcnow().date().isoformat()
        )
    except AIError as err:
        raise _ai_failed(err)
    return _save(
        session,
        user,
        "weekly_brief",
        {
            "brief": brief.model_dump(),
            "adjusted": weekly_brief.apply_adjustments(fc, brief),
            "store_forecast": fc["store"],
            "events": fc["events"],
            "sources": sources[:20],
        },
    )


@router.post("/trend-scout")
def run_trend_scout(
    body: TrendScoutIn, user: User = Depends(billing.require_ai_quota), session: Session = Depends(get_session)
) -> dict:
    niche = (body.niche or user.niche).strip()
    if not niche:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "no_niche", "message": "Tell us your niche first."})
    catalogue = [p.name for p in services.active_products(session, user.id)]
    ideas = [p.name for p in services.idea_products(session, user.id)]
    try:
        report, sources = trend_scout.generate(niche, body.market or user.target_market, catalogue, ideas=ideas)
    except AIError as err:
        raise _ai_failed(err)
    return _save(session, user, "trend_scout", {"niche": niche, "report": report.model_dump(), "sources": sources[:30]})


@router.post("/product-check")
def run_product_check(
    body: ProductCheckIn, user: User = Depends(billing.require_ai_quota), session: Session = Depends(get_session)
) -> dict:
    try:
        result, sources = product_check.generate(
            body.idea, user.niche, user.target_market, body.unit_cost, body.sell_price, user.currency
        )
    except AIError as err:
        raise _ai_failed(err)
    return _save(session, user, "product_check", {"idea": body.idea, "result": result.model_dump(), "sources": sources[:20]})


@router.post("/assistant")
def ask_assistant(
    body: AssistantIn, user: User = Depends(billing.require_ai_quota), session: Session = Depends(get_session)
) -> dict:
    try:
        answer = assistant.chat(session, user, [t.model_dump() for t in body.history], body.question)
    except AIError as err:
        raise _ai_failed(err)
    # Log the call for quota accounting without storing the whole conversation.
    saved = _save(session, user, "assistant", {"question": body.question[:300]})
    return {"id": saved["id"], "answer": answer}


@router.post("/listing")
def write_listing(body: ListingIn, user: User = Depends(billing.require_ai_quota), session: Session = Depends(get_session)) -> dict:
    name, price, details = body.name, None, body.details
    if body.product_id is not None:
        p = session.get(Product, body.product_id)
        if p is None or p.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
        name = name or p.name
        price = p.sell_price or None
        details = f"Category: {p.category}\n{details}".strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give a product name or product_id")
    try:
        result = listing.generate(name, details, body.platform, body.tone, price, user.currency, user.target_market)
    except AIError as err:
        raise _ai_failed(err)
    return _save(session, user, "listing", {"product_id": body.product_id, "name": name, "platform": body.platform, "listing": result.model_dump()})


@router.get("/reports")
def list_reports(
    kind: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[dict]:
    q = select(AIReport).where(AIReport.user_id == user.id, AIReport.kind != "assistant")
    if kind:
        q = q.where(AIReport.kind == kind)
    rows = session.exec(q.order_by(AIReport.created_at.desc()).limit(limit))
    return [{"id": r.id, "kind": r.kind, "created_at": r.created_at.isoformat(), **r.payload} for r in rows]



# ---- Ideas: products saved from Trend Scout or Product Check ---------------------------------------


class IdeaIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    est_price: float | None = Field(default=None, ge=0)
    est_cost: float | None = Field(default=None, ge=0)
    note: str = Field(default="", max_length=1000)
    report_id: int | None = None


def _idea_out(p: Product) -> dict:
    return services.product_out(p)


@router.get("/ideas")
def list_ideas(user: User = Depends(current_user), session: Session = Depends(get_session)) -> list[dict]:
    return [_idea_out(p) for p in services.idea_products(session, user.id)]


@router.post("/ideas", status_code=201)
def add_idea(body: IdeaIn, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    """Save a trending product to the seller's idea list ("Add to my store")."""
    existing = {p.name.lower() for p in services.idea_products(session, user.id)}
    if body.name.lower() in existing:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "exists", "message": "This idea is already on your list."})
    n = len(session.exec(select(Product.id).where(Product.user_id == user.id)).all()) + 1
    p = Product(
        user_id=user.id, sku=f"IDEA-{n:04d}", name=body.name, stage="idea", stock_known=False,
        sell_price=body.est_price or 0.0, cost_price=body.est_cost or 0.0, category=body.note[:120],
        source="trend_scout" if body.report_id else "",
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return _idea_out(p)


class StartSellingIn(BaseModel):
    sku: str | None = Field(default=None, max_length=64)
    sell_price: float | None = Field(default=None, ge=0)
    cost_price: float | None = Field(default=None, ge=0)
    stock_qty: int | None = None
    fulfilment: str | None = None


@router.post("/ideas/{product_id}/start-selling")
def start_selling(
    product_id: int, body: StartSellingIn, user: User = Depends(current_user), session: Session = Depends(get_session)
) -> dict:
    """Move an idea into the inventory once the seller lists it."""
    p = session.get(Product, product_id)
    if p is None or p.user_id != user.id or p.stage != "idea":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found")
    if body.sku:
        clash = session.exec(select(Product).where(Product.user_id == user.id, Product.sku == body.sku)).first()
        if clash and clash.id != p.id:
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "sku_taken", "message": f"SKU {body.sku} is already used."})
        p.sku = body.sku
    if body.sell_price is not None:
        p.sell_price = body.sell_price
    if body.cost_price is not None:
        p.cost_price = body.cost_price
    if body.stock_qty is not None:
        p.stock_qty, p.stock_known = body.stock_qty, True
    if body.fulfilment in ("own_stock", "dropship"):
        p.fulfilment = body.fulfilment
    p.stage = "active"
    session.add(p)
    session.commit()
    session.refresh(p)
    return services.product_out(p)


@router.delete("/ideas/{product_id}", status_code=204)
def remove_idea(product_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)) -> None:
    p = session.get(Product, product_id)
    if p is None or p.user_id != user.id or p.stage != "idea":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Idea not found")
    session.delete(p)
    session.commit()
