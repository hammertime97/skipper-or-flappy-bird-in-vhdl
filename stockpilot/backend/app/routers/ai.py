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
from ..models import AIReport, Product, User

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
        brief = weekly_brief.generate(fc, dash, user.store_name, user.niche)
    except AIError as err:
        raise _ai_failed(err)
    return _save(session, user, "weekly_brief", {"brief": brief.model_dump(), "store_forecast": fc["store"]})


@router.post("/trend-scout")
def run_trend_scout(
    body: TrendScoutIn, user: User = Depends(billing.require_ai_quota), session: Session = Depends(get_session)
) -> dict:
    niche = (body.niche or user.niche).strip()
    if not niche:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"code": "no_niche", "message": "Tell us your niche first."})
    catalogue = [p.name for p in services.active_products(session, user.id)]
    try:
        report, sources = trend_scout.generate(niche, body.market or user.target_market, catalogue)
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
