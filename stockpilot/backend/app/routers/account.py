from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select

from .. import billing
from ..auth import create_token, current_user, hash_password, verify_password
from ..config import settings
from ..db import get_session
from ..models import User

router = APIRouter()


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class ProfileUpdate(BaseModel):
    store_name: str | None = Field(default=None, max_length=120)
    niche: str | None = Field(default=None, max_length=200)
    target_market: str | None = Field(default=None, max_length=80)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


def user_out(user: User, session: Session) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "store_name": user.store_name,
        "niche": user.niche,
        "target_market": user.target_market,
        "currency": user.currency,
        "billing": billing.status_for(session, user),
    }


@router.post("/auth/register", status_code=201)
def register(body: Credentials, session: Session = Depends(get_session)) -> dict:
    email = body.email.lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(email=email, password_hash=hash_password(body.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"token": create_token(user.id), "user": user_out(user, session)}


@router.post("/auth/login")
def login(body: Credentials, session: Session = Depends(get_session)) -> dict:
    user = session.exec(select(User).where(User.email == body.email.lower())).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    return {"token": create_token(user.id), "user": user_out(user, session)}


@router.get("/me")
def me(user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    return user_out(user, session)


@router.patch("/me")
def update_me(body: ProfileUpdate, user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v.upper() if k == "currency" else v.strip())
    session.add(user)
    session.commit()
    return user_out(user, session)


@router.get("/billing/status")
def billing_status(user: User = Depends(current_user), session: Session = Depends(get_session)) -> dict:
    return billing.status_for(session, user)


@router.post("/billing/revenuecat-webhook")
def revenuecat_webhook(
    payload: dict,
    authorization: str = Header(default=""),
    session: Session = Depends(get_session),
) -> dict:
    secret = settings.revenuecat_webhook_secret
    if not secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Webhook secret not configured")
    supplied = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied, secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad webhook secret")
    return {"result": billing.apply_revenuecat_event(session, payload.get("event") or {})}
