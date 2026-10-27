"""Web-research loop shared by Trend Scout and Product Check.

Claude searches the web with the server-side web_search tool, then hands its
findings back by calling a client tool whose input we validate with Pydantic.
"""

from __future__ import annotations

import json
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import settings
from .client import FALLBACK_BETA, AIError, get_client, translate_errors

T = TypeVar("T", bound=BaseModel)

MAX_ROUNDS = 8


def _sources(content: list[Any], seen: dict[str, str]) -> None:
    for block in content:
        if block.type != "web_search_tool_result":
            continue
        # A failed search returns an error object instead of a list of results.
        if not isinstance(block.content, list):
            continue
        for result in block.content:
            url = getattr(result, "url", None)
            if url and url not in seen:
                seen[url] = getattr(result, "title", "") or url


def run(
    system: str,
    prompt: str,
    report_tool: dict,
    schema: type[T],
    max_searches: int = 8,
    effort: str = "high",
) -> tuple[T, list[dict]]:
    """Return (validated report, list of {url, title} sources Claude read)."""
    tools = [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": max_searches},
        {**report_tool, "eager_input_streaming": True},
    ]
    messages: list[dict] = [{"role": "user", "content": prompt}]
    sources: dict[str, str] = {}
    client = get_client()

    for _ in range(MAX_ROUNDS):
        try:
            with client.beta.messages.stream(
                model=settings.claude_model,
                max_tokens=32000,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                system=system,
                tools=tools,
                messages=messages,
                output_config={"effort": effort},
            ) as stream:
                msg = stream.get_final_message()
        except Exception as exc:  # noqa: BLE001 - mapped to AIError
            raise translate_errors(exc) from exc

        if msg.stop_reason == "refusal":
            raise AIError("The AI declined this research request. Try rephrasing it.", 422)
        if msg.stop_reason == "max_tokens":
            raise AIError("The research ran too long. Try a narrower niche.", 502)
        _sources(msg.content, sources)
        messages.append({"role": "assistant", "content": msg.content})

        if msg.stop_reason == "pause_turn":
            continue  # long server-side search turn; send it back to resume

        report = next((b for b in msg.content if b.type == "tool_use" and b.name == report_tool["name"]), None)
        if report is None:
            messages.append(
                {"role": "user", "content": f"Please call {report_tool['name']} now with your findings."}
            )
            continue
        try:
            raw = report.input if isinstance(report.input, dict) else json.loads(report.input)
            return schema.model_validate(raw), [{"url": u, "title": t} for u, t in sources.items()]
        except (ValidationError, json.JSONDecodeError, TypeError) as err:
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": report.id,
                            "is_error": True,
                            "content": f"INVALID_INPUT: {err}. Call {report_tool['name']} again with input matching the schema.",
                        }
                    ],
                }
            )

    raise AIError("The research did not finish. Please try again.", 502)
