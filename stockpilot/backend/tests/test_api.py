def test_register_login_and_me(client):
    r = client.post("/auth/register", json={"email": "Me@Example.com", "password": "password123"})
    assert r.status_code == 201
    assert client.post("/auth/register", json={"email": "me@example.com", "password": "password123"}).status_code == 409
    assert client.post("/auth/login", json={"email": "me@example.com", "password": "wrongpass1"}).status_code == 401
    token = client.post("/auth/login", json={"email": "me@example.com", "password": "password123"}).json()["token"]
    me = client.get("/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["email"] == "me@example.com" and me["billing"]["plan"] == "free"
    assert client.get("/me").status_code == 401


def test_products_sales_dashboard(client, auth):
    h, _ = auth
    p = client.post("/products", headers=h, json={"sku": "A1", "name": "Widget", "cost_price": 2, "sell_price": 10, "stock_qty": 50}).json()
    assert client.post("/products", headers=h, json={"sku": "A1", "name": "Dup"}).status_code == 409
    r = client.post("/sales", headers=h, json={"product_id": p["id"], "quantity": 3})
    assert r.status_code == 201 and r.json()["unit_price"] == 10
    prods = client.get("/products", headers=h).json()
    assert prods[0]["stock_qty"] == 47 and prods[0]["units_7d"] == 3
    dash = client.get("/dashboard", headers=h).json()
    assert dash["kpis"]["7d"]["revenue"] == 30 and dash["kpis"]["7d"]["profit"] == 24
    assert dash["inventory"]["units_on_hand"] == 47
    detail = client.get(f"/products/{p['id']}", headers=h).json()
    assert detail["weekly_units"][-1] == 3 and "stock_plan" in detail


def test_other_users_products_are_hidden(client, auth):
    h, _ = auth
    p = client.post("/products", headers=h, json={"sku": "S", "name": "Secret"}).json()
    other = client.post("/auth/register", json={"email": "intruder@example.com", "password": "password123"}).json()
    h2 = {"Authorization": f"Bearer {other['token']}"}
    assert client.get(f"/products/{p['id']}", headers=h2).status_code == 404
    assert client.post("/sales", headers=h2, json={"product_id": p["id"], "quantity": 1}).status_code == 404


def test_demo_seed_and_forecasts_free_limit(client, auth):
    h, _ = auth
    seeded = client.post("/demo/seed", headers=h).json()
    assert seeded["products"] == 14 and seeded["sales"] > 1000
    fc = client.get("/forecasts", headers=h).json()
    assert fc["locked_count"] == 4  # free plan: top 10 unlocked
    statuses = {it["product"]["sku"]: it["stock_plan"]["status"] for it in fc["items"] if not it["locked"]}
    assert statuses["PET-003"] == "out_of_stock"
    assert fc["store"]["next_weeks_revenue"][0] > 0
    dash = client.get("/dashboard", headers=h).json()
    assert dash["top_sellers"] and dash["kpis"]["30d"]["orders"] > 0
    assert dash["inventory"]["out_of_stock"] == 1
    assert "PET-003" not in {p["sku"] for p in dash["low_stock"]}  # sold out is not "running low"


def test_revenuecat_webhook_upgrades_and_expires(client, auth):
    h, user = auth
    event = {"event": {"type": "INITIAL_PURCHASE", "app_user_id": str(user["id"]), "entitlement_ids": ["pro"], "expiration_at_ms": 4102444800000}}
    assert client.post("/billing/revenuecat-webhook", json=event, headers={"Authorization": "Bearer nope"}).status_code == 401
    r = client.post("/billing/revenuecat-webhook", json=event, headers={"Authorization": "Bearer rc-secret"})
    assert r.status_code == 200 and "pro" in r.json()["result"]
    assert client.get("/billing/status", headers=h).json()["plan"] == "pro"
    client.post("/demo/seed", headers=h)
    assert client.get("/forecasts", headers=h).json()["locked_count"] == 0
    event["event"]["type"] = "EXPIRATION"
    client.post("/billing/revenuecat-webhook", json=event, headers={"Authorization": "Bearer rc-secret"})
    assert client.get("/billing/status", headers=h).json()["plan"] == "free"


def test_free_plan_locks_forecast_on_product_page_too(client, auth):
    h, _ = auth
    client.post("/demo/seed", headers=h)
    fc = client.get("/forecasts", headers=h).json()
    locked = [it["product"]["id"] for it in fc["items"] if it["locked"]]
    unlocked = [it["product"]["id"] for it in fc["items"] if not it["locked"]]
    d = client.get(f"/products/{locked[0]}", headers=h).json()
    assert d["locked"] and "forecast" not in d
    d = client.get(f"/products/{unlocked[0]}", headers=h).json()
    assert not d["locked"] and d["forecast"]["method"] in ("ensemble", "recent_mean")


def test_forecast_extras_and_fees(client, auth):
    h, _ = auth
    client.post("/demo/seed", headers=h)
    fc = client.get("/forecasts", headers=h).json()
    assert fc["store"]["restock_budget"]["now"] > 0
    assert isinstance(fc["events"], list)
    item = next(it for it in fc["items"] if not it["locked"] and it["forecast"]["accuracy"] is not None)
    assert 0 <= item["forecast"]["accuracy"] <= 1 and item["forecast"]["models"]
    before = client.get("/dashboard", headers=h).json()["kpis"]["30d"]
    assert before["fees"] > 0 and before["profit"] < before["revenue"]
    client.put("/me/fees", headers=h, json={k: {"pct": 0, "fixed": 0} for k in ["ebay", "amazon", "etsy", "tiktok", "shopify", "other"]})
    after = client.get("/dashboard", headers=h).json()["kpis"]["30d"]
    assert after["fees"] == 0 and after["profit"] > before["profit"]


def test_stock_unknown_after_sales_import_then_typed_in(client, auth):
    h, _ = auth
    prev = client.post("/import/samples/tiktok/try", headers=h).json()
    res = client.post(f"/import/{prev['job_id']}/confirm", headers=h, json={}).json()
    dash = client.get("/dashboard", headers=h).json()
    assert dash["inventory"]["stock_unknown"] == 5 and dash["todo"][0]["key"] == "stock"
    fc = client.get("/forecasts", headers=h).json()
    statuses = {it["stock_plan"]["status"] for it in fc["items"] if not it["locked"]}
    assert "stock_unknown" in statuses and "out_of_stock" not in statuses
    items = [{"id": p["id"], "stock_qty": 100} for p in res["needs_stock"]]
    assert client.post("/products/stock-counts", headers=h, json={"items": items}).json()["updated"] == 5
    assert client.get("/dashboard", headers=h).json()["inventory"]["stock_unknown"] == 0
