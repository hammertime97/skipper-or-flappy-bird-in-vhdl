import io


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


def test_csv_import(client, auth):
    h, _ = auth
    products = "sku,name,cost_price,sell_price,stock_qty,fulfilment\nB1,Bowl,1.5,9.99,20,dropship\n,missing,1,1,1,\n"
    r = client.post("/import/products", headers=h, files={"file": ("p.csv", io.BytesIO(products.encode()), "text/csv")}).json()
    assert r["created"] == 1 and len(r["errors"]) == 1
    sales = "sku,quantity,unit_price,sold_at\nB1,2,9.99,2026-10-01\nZZ,1,1,2026-10-01\n"
    r = client.post("/import/sales", headers=h, files={"file": ("s.csv", io.BytesIO(sales.encode()), "text/csv")}).json()
    assert r["imported"] == 1 and "unknown sku" in r["errors"][0]


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
