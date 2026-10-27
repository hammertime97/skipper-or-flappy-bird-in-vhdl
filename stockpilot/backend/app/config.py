"""Runtime settings, read once from environment variables."""

import os
from dataclasses import dataclass, field


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", "sqlite:///./stockpilot.db"))
    jwt_secret: str = field(default_factory=lambda: os.environ.get("JWT_SECRET", "dev-only-change-me"))
    jwt_ttl_days: int = field(default_factory=lambda: _env_int("JWT_TTL_DAYS", 30))
    claude_model: str = field(default_factory=lambda: os.environ.get("CLAUDE_MODEL", "claude-opus-5-5"))
    # Shared secret RevenueCat sends in the Authorization header of its webhooks.
    revenuecat_webhook_secret: str = field(default_factory=lambda: os.environ.get("REVENUECAT_WEBHOOK_SECRET", ""))
    # AI calls a free-plan user gets each calendar month (a taste of Pro).
    free_ai_calls_per_month: int = field(default_factory=lambda: _env_int("FREE_AI_CALLS_PER_MONTH", 3))
    # Free plan sees statistical forecasts for this many products.
    free_forecast_products: int = field(default_factory=lambda: _env_int("FREE_FORECAST_PRODUCTS", 10))
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
    )


settings = Settings()
