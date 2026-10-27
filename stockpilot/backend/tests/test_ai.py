"""AI routes with the Anthropic client faked out (no network, no API key)."""

from contextlib import contextmanager
from types import SimpleNamespace as NS

import pytest

from app.ai import client as ai_client


class FakeMessages:
    def __init__(self, parsed=None, stream_script=None):
        self.parsed = parsed
        self.stream_script = list(stream_script or [])
        self.calls = []

    def parse(self, **kw):
        self.calls.append(kw)
        return NS(stop_reason="end_turn", parsed_output=self.parsed)

    @contextmanager
    def stream(self, **kw):
        self.calls.append(kw)
        msg = self.stream_script.pop(0)
        yield NS(get_final_message=lambda: msg)


@pytest.fixture()
def fake(monkeypatch):
    def install(**kw):
        msgs = FakeMessages(**kw)
        monkeypatch.setattr(ai_client, "get_client", lambda: NS(beta=NS(messages=msgs)))
        # modules import get_client by name
        import app.ai.assistant as a
        import app.ai.research as r

        monkeypatch.setattr(a, "get_client", lambda: NS(beta=NS(messages=msgs)))
        monkeypatch.setattr(r, "get_client", lambda: NS(beta=NS(messages=msgs)))
        return msgs

    return install


BRIEF = {
    "headline": "Restock the laser toy",
    "summary": "s",
    "next_week_outlook": "o",
    "actions": [{"priority": "high", "kind": "restock_urgent", "title": "t", "detail": "d", "sku": "PET-003"}],
    "adjustments": [{"sku": "PET-006", "change_pct": 400, "reason": "Viral video", "source_url": "https://example.com/v"}],
    "market_notes": [],
    "risks": [],
    "opportunities": [],
}


def test_weekly_brief_and_free_quota(client, auth, fake):
    h, _ = auth
    msgs = fake(stream_script=[NS(stop_reason="tool_use", content=[_tool_use("report_weekly_plan", BRIEF)])] * 3)
    assert client.post("/ai/weekly-brief", headers=h).status_code == 400  # no data yet
    client.post("/demo/seed", headers=h)
    r = client.post("/ai/weekly-brief", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["brief"]["actions"][0]["sku"] == "PET-003"
    adj = body["adjusted"][0]
    assert adj["change_pct"] == 150  # capped
    assert adj["adjusted_next_week"] == round(adj["base_next_week"] * 2.5, 1)
    call = msgs.calls[-1]
    assert call["fallbacks"] == "default" and call["model"] == "claude-fable-5-1"
    assert "PET-003" in call["messages"][0]["content"] and "upcoming_events" in call["messages"][0]["content"]
    assert client.post("/ai/weekly-brief", headers=h).status_code == 200
    r = client.post("/ai/weekly-brief", headers=h)  # FREE_AI_CALLS_PER_MONTH=2 in tests
    assert r.status_code == 402 and r.json()["detail"]["code"] == "upgrade_required"
    assert len(client.get("/ai/reports?kind=weekly_brief", headers=h).json()) == 2


def test_ideas_flow(client, auth):
    h, _ = auth
    r = client.post("/ai/ideas", headers=h, json={"name": "Cooling mat", "est_price": 29.0, "est_cost": 8.0, "report_id": 1})
    assert r.status_code == 201 and r.json()["stage"] == "idea"
    assert client.post("/ai/ideas", headers=h, json={"name": "cooling mat"}).status_code == 409
    assert [i["name"] for i in client.get("/ai/ideas", headers=h).json()] == ["Cooling mat"]
    assert client.get("/products", headers=h).json() == []  # ideas aren't inventory yet
    pid = r.json()["id"]
    p = client.post(f"/ai/ideas/{pid}/start-selling", headers=h, json={"sku": "CM-1", "stock_qty": 20, "fulfilment": "dropship"}).json()
    assert p["stage"] == "active" and p["sku"] == "CM-1" and p["stock_known"]
    assert len(client.get("/products", headers=h).json()) == 1


def _tool_use(name, input_, id_="tu_1"):
    return NS(type="tool_use", name=name, input=input_, id=id_)


def test_trend_scout_loop(client, auth, fake):
    h, _ = auth
    client.patch("/me", headers=h, json={"niche": "home fitness"})
    report = {
        "niche_summary": "Hot.",
        "trending_products": [
            {
                "name": "Walking pad", "why_trending": "w", "evidence": "e", "momentum": "rising", "competition": "medium",
                "typical_retail_price": "$199-299", "typical_supplier_cost": "unknown", "fit_with_store": "f",
                "how_to_sell_it": "h", "risk": "r", "source_urls": ["https://example.com/a"],
            }
        ],
        "fading_trends": [], "competitor_moves": [], "content_ideas": [],
    }
    search = NS(type="web_search_tool_result", content=[NS(url="https://example.com/a", title="A")])
    script = [
        NS(stop_reason="pause_turn", content=[search]),
        NS(stop_reason="end_turn", content=[NS(type="text", text="done")]),  # forgot to call the tool
        NS(stop_reason="tool_use", content=[_tool_use("report_trends", {"niche_summary": "bad"})]),  # invalid
        NS(stop_reason="tool_use", content=[_tool_use("report_trends", report, "tu_2")]),
    ]
    msgs = fake(stream_script=script)
    r = client.post("/ai/trend-scout", headers=h, json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["niche"] == "home fitness"
    assert body["report"]["trending_products"][0]["name"] == "Walking pad"
    assert body["sources"] == [{"url": "https://example.com/a", "title": "A"}]
    assert msgs.calls[0]["tools"][0]["type"] == "web_search_20260209"
    # The final call's history ends with the error tool_result we sent for the invalid report
    # (the list is shared, so the assistant reply appended afterwards is at -1).
    last_user = msgs.calls[-1]["messages"][-2]["content"][0]
    assert last_user["type"] == "tool_result" and last_user["is_error"] is True


def test_assistant_runs_tools(client, auth, fake):
    h, _ = auth
    client.post("/demo/seed", headers=h)
    script = [
        NS(stop_reason="tool_use", content=[_tool_use("get_forecasts", {"sku": "PET-003", "status": "any"}), _tool_use("get_dashboard", {}, "tu_2")]),
        NS(stop_reason="end_turn", content=[NS(type="text", text="Reorder PET-003 now.")]),
    ]
    msgs = fake(stream_script=script)
    r = client.post("/ai/assistant", headers=h, json={"question": "What should I reorder?"})
    assert r.status_code == 200, r.text
    assert r.json()["answer"] == "Reorder PET-003 now."
    results = msgs.calls[1]["messages"][-1]["content"]
    assert [x["tool_use_id"] for x in results] == ["tu_1", "tu_2"]
    assert "PET-003" in results[0]["content"]


def test_refusal_maps_to_422(client, auth, fake):
    h, _ = auth
    fake(stream_script=[NS(stop_reason="refusal", content=[])])
    r = client.post("/ai/assistant", headers=h, json={"question": "hi"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "ai_error"
