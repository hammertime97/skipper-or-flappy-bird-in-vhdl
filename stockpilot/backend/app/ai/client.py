"""Thin wrapper around the Anthropic SDK used by every AI feature."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, TypeVar

import anthropic
from pydantic import BaseModel

from ..config import settings

log = logging.getLogger(__name__)

# Server-side fallback: if a safety classifier declines, the API retries on the
# model Anthropic recommends for that refusal category, inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

T = TypeVar("T", bound=BaseModel)


class AIError(Exception):
    """Raised for failures the API layer turns into a friendly HTTP error."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    # Credentials come from ANTHROPIC_API_KEY (or another SDK-supported source).
    return anthropic.Anthropic(max_retries=3)


def _check_stop(message: Any) -> None:
    if message.stop_reason == "refusal":
        raise AIError("The AI declined this request. Try rephrasing it.", 422)
    if message.stop_reason == "max_tokens":
        raise AIError("The AI response was cut off. Please try again.", 502)


def translate_errors(exc: Exception) -> AIError:
    if isinstance(exc, AIError):
        return exc
    if isinstance(exc, anthropic.AuthenticationError):
        log.error("Anthropic authentication failed: check ANTHROPIC_API_KEY")
        return AIError("AI features are not configured on the server.", 503)
    if isinstance(exc, anthropic.RateLimitError):
        return AIError("The AI is busy right now. Try again in a minute.", 503)
    if isinstance(exc, anthropic.BadRequestError):
        log.error("Anthropic rejected request: %s", exc.message)
        return AIError("The AI request was invalid.", 502)
    if isinstance(exc, anthropic.APIStatusError):
        log.error("Anthropic API error %s: %s", exc.status_code, exc.message)
        return AIError("The AI service had a problem. Try again shortly.", 502)
    if isinstance(exc, anthropic.APIConnectionError):
        return AIError("Could not reach the AI service.", 503)
    raise exc


def structured(
    system: str,
    user_content: str,
    schema: type[T],
    effort: str = "medium",
    max_tokens: int = 16000,
    model: str | None = None,
) -> T:
    """One request whose answer is validated against a Pydantic model."""
    try:
        response = get_client().beta.messages.parse(
            model=model or settings.claude_model,
            max_tokens=max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            system=system,
            messages=[{"role": "user", "content": user_content}],
            output_format=schema,
            output_config={"effort": effort},
        )
    except Exception as exc:  # noqa: BLE001 - mapped to AIError
        raise translate_errors(exc) from exc
    _check_stop(response)
    if response.parsed_output is None:
        raise AIError("The AI returned an unreadable answer. Please try again.")
    return response.parsed_output
