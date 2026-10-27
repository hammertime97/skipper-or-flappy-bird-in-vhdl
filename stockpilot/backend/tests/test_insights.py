from datetime import datetime, timedelta, timezone

from app import fees, insights
from app.models import Product, Sale

NOW = datetime(2026, 10, 27, tzinfo=timezone.utc)


def _p(i, cost=2.0, price=10.0):
    return Product(id=i, user_id=1, sku=f"S{i}", name=f"P{i}", cost_price=cost, sell_price=price)


def _s(pid, qty, order, days_ago=5, price=10.0):
    return Sale(user_id=1, product_id=pid, quantity=qty, unit_price=price, order_ref=order, channel="", sold_at=NOW - timedelta(days=days_ago))


def test_focus_list_groups_by_profit_share():
    ps = [_p(1), _p(2), _p(3), _p(4, cost=12.0)]
    sales = [_s(1, 80, "a"), _s(2, 15, "b"), _s(3, 5, "c"), _s(4, 3, "d")]
    f = insights.focus_list(ps, sales, NOW, fees.fee_table({"other": {"pct": 0, "fixed": 0}}))
    groups = {r["sku"]: r["group"] for r in f["items"]}
    assert groups == {"S1": "A", "S2": "B", "S3": "C", "S4": "losing"}
    assert f["items"][0]["profit"] == 80 * 8


def test_bundles_find_pairs_bought_together():
    ps = [_p(1), _p(2), _p(3)]
    sales = []
    for i in range(6):
        sales += [_s(1, 1, f"o{i}"), _s(2, 1, f"o{i}")]
    for i in range(20):
        sales.append(_s(3, 1, f"x{i}"))
    b = insights.bundles(ps, sales, NOW)
    assert len(b["pairs"]) == 1 and b["pairs"][0]["orders_together"] == 6 and b["pairs"][0]["lift"] > 1


def test_profit_calc():
    r = insights.profit_calc(price=30, product_cost=8, shipping=4, fee_pct=10, fee_fixed=0.3, ad_cost_per_sale=6)
    assert r["fees"] == 3.3 and r["profit_before_ads"] == 14.7 and r["profit"] == 8.7
    assert r["max_ad_cost_per_sale"] == 14.7 and r["break_even_roas"] == round(30 / 14.7, 2)
    target = r["price_for_30pct_margin"]
    assert insights.profit_calc(target, 8, 4, 10, 0.3, 6)["margin_pct"] == 30.0


def test_smart_plan_and_insights_endpoints(client, auth):
    h, _ = auth
    client.post("/demo/seed", headers=h)
    plan = client.get("/plan", headers=h).json()
    assert plan["made_by"] == "numbers" and plan["actions"]
    titles = " ".join(a["title"] for a in plan["actions"])
    assert "Restock Interactive Cat Laser Toy" in titles and " by " in titles
    assert plan["actions"][0]["priority"] == "high"
    ins = client.get("/insights", headers=h).json()
    assert ins["focus"]["items"][0]["group"] == "A" and "80%" in ins["focus"]["summary"]
    fc = client.get("/forecasts", headers=h).json()
    reorder = [it for it in fc["items"] if not it["locked"] and it["stock_plan"]["status"] == "reorder_now"]
    assert reorder and all(it["stock_plan"]["order_by"] for it in reorder)


def test_trend_library_matches_niche(client, auth):
    from app import trend_library
    assert trend_library.match_niche("Dog toys and cat beds") == "pets"
    assert trend_library.match_niche("vintage stamps") is None
    h, _ = auth
    client.patch("/me", headers=h, json={"niche": "skincare and makeup"})
    lib = client.get("/trends/library", headers=h).json()
    assert lib["match"] == "beauty" and len(lib["niches"]) >= 8
    assert all(it["source"].startswith("https://") for n in lib["niches"] for it in n["items"])
