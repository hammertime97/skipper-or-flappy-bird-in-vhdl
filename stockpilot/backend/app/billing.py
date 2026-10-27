"""Plans and AI quotas.

Subscriptions are sold through Google Play and managed by RevenueCat. The app
calls `Purchases.logIn(<our user id>)`, so RevenueCat's `app_user_id` is our
User.id; RevenueCat's webhook then tells us when a user's Pro access starts or ends.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlmodel import Session, func, select

from .auth import current_user
from .config import settings
from .db import get_session
from .models import AIReport, User, utcnow

PRO_ENTITLEMENT = "pro"

# What each plan includes; returned to the app so the paywall can render it.
PLANS = {
    "free": {
        "name": "Free",
        "features": [
            "Inventory & sales dashboard",
            f"Weekly forecasts for your top {settings.free_forecast_products} products",
            f"{settings.free_ai_calls_per_month} AI requests per month",
        ],
    },
    "pro": {
        "name": "Pro",
        "features": [
            "Weekly forecasts for every product",
            "AI Weekly Plan every week",
            "Trend Scout: what's booming in your niche",
            "Product Check: should I sell this?",
            "Ask StockPilot assistant",
            "AI listing writer",
        ],
    },
}

# Fair-use ceiling for Pro so one account can't run up an unbounded AI bill.
PRO_AI_CALLS_PER_MONTH = 400


def is_pro(user: User, now: datetime | None = None) -> bool:
    if user.plan != "pro":
        return False
    if user.plan_expires_at is None:
        return True
    return user.plan_expires_at > (now or utcnow())


def ai_calls_this_month(session: Session, user_id: int, now: datetime | None = None) -> int:
    now = now or utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return session.exec(
        select(func.count()).select_from(AIReport).where(AIReport.user_id == user_id, AIReport.created_at >= month_start)
    ).one()


def status_for(session: Session, user: User) -> dict:
    pro = is_pro(user)
    limit = PRO_AI_CALLS_PER_MONTH if pro else settings.free_ai_calls_per_month
    used = ai_calls_this_month(session, user.id)
    return {
        "plan": "pro" if pro else "free",
        "plan_expires_at": user.plan_expires_at.isoformat() if pro and user.plan_expires_at else None,
        "ai_calls_used": used,
        "ai_calls_limit": limit,
        "plans": PLANS,
    }


def require_ai_quota(user: User = Depends(current_user), session: Session = Depends(get_session)) -> User:
    """Dependency for AI endpoints: 402 when the monthly allowance is used up."""
    pro = is_pro(user)
    limit = PRO_AI_CALLS_PER_MONTH if pro else settings.free_ai_calls_per_month
    if ai_calls_this_month(session, user.id) >= limit:
        detail = (
            {"code": "upgrade_required", "message": "You've used your free AI requests this month. Upgrade to Pro for more."}
            if not pro
            else {"code": "fair_use_limit", "message": "Monthly AI limit reached. It resets on the 1st."}
        )
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail)
    return user


def require_pro(user: User = Depends(current_user)) -> User:
    if not is_pro(user):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            {"code": "upgrade_required", "message": "This feature is part of StockPilot Pro."},
        )
    return user


# RevenueCat event types: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
_GRANTS = {"INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT"}
_REVOKES = {"EXPIRATION"}


def apply_revenuecat_event(session: Session, event: dict) -> str:
    """Update a user's plan from one RevenueCat webhook event. Returns what happened."""
    etype = event.get("type", "")
    entitlements = event.get("entitlement_ids") or []
    if entitlements and PRO_ENTITLEMENT not in entitlements:
        return "ignored: other entitlement"

    candidates = [event.get("app_user_id"), event.get("original_app_user_id"), *(event.get("aliases") or [])]
    user = None
    for cid in candidates:
        if cid and str(cid).isdigit():
            user = session.get(User, int(cid))
            if user:
                break
    if user is None:
        return "ignored: unknown user"

    if etype in _GRANTS:
        user.plan = "pro"
        ms = event.get("expiration_at_ms")
        user.plan_expires_at = datetime.fromtimestamp(ms / 1000, tz=timezone.utc) if ms else None
    elif etype in _REVOKES:
        user.plan = "free"
        user.plan_expires_at = None
    else:
        # CANCELLATION, BILLING_ISSUE, ...: access continues until EXPIRATION arrives.
        return f"ignored: {etype or 'no type'}"
    session.add(user)
    session.commit()
    return f"{etype}: user {user.id} -> {user.plan}"
