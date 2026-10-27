import io

import pytest

from app import importer, samples


@pytest.mark.parametrize(
    "key,platform,kind",
    [
        ("ebay", "ebay", "orders"),
        ("amazon", "amazon", "orders"),
        ("shopify", "shopify", "orders"),
        ("shopify-products", "shopify", "stock"),
        ("etsy", "etsy", "orders"),
        ("tiktok", "tiktok", "orders"),
    ],
)
def test_sample_files_are_recognised(key, platform, kind):
    filename, data = samples.build(key)
    [(_, rows)] = importer.read_tables(filename, data)
    a = importer.analyse(rows)
    assert (a.platform, a.kind) == (platform, kind)
    assert a.confident and not a.missing
    x = importer.extract(rows, a)
    assert (x.orders if kind == "orders" else x.stock)
    assert x.skipped_invalid == 0


def test_amazon_item_price_is_per_line_so_we_divide_by_quantity():
    rows = [
        ["amazon-order-id", "purchase-date", "order-status", "product-name", "sku", "quantity", "item-price"],
        ["111-1", "2026-10-01T10:00:00+00:00", "Shipped", "Garlic Press", "KN-G", "2", "29.98"],
        ["111-2", "2026-10-02T10:00:00+00:00", "Cancelled", "Garlic Press", "KN-G", "1", "14.99"],
    ]
    a = importer.analyse(rows)
    x = importer.extract(rows, a)
    assert len(x.orders) == 1 and x.orders[0].unit_price == pytest.approx(14.99)
    assert x.skipped_cancelled == 1


def test_ebay_title_row_footer_and_missing_custom_label():
    filename, data = samples.build("ebay")
    [(_, rows)] = importer.read_tables(filename, data)
    a = importer.analyse(rows)
    x = importer.extract(rows, a)
    keys = {o.key for o in x.orders}
    assert any(k.startswith("EBAY-") for k in keys)  # listings without a custom label get one
    assert all("record(s)" not in o.name for o in x.orders)


def test_shopify_multi_item_orders_inherit_date_and_cancellations():
    rows = [
        ["Name", "Financial Status", "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Cancelled at"],
        ["#1", "paid", "2026-10-01 10:00:00 +0000", "1", "Band", "29.00", "B", ""],
        ["#1", "", "", "2", "Grip", "15.00", "G", ""],
        ["#2", "refunded", "2026-10-02 10:00:00 +0000", "1", "Band", "29.00", "B", "2026-10-03"],
        ["#2", "", "", "1", "Grip", "15.00", "G", ""],
    ]
    a = importer.analyse(rows)
    x = importer.extract(rows, a)
    assert [(o.key, o.quantity, o.sold_at.day) for o in x.orders] == [("B", 1, 1), ("G", 2, 1)]
    assert x.skipped_cancelled == 2


def test_plain_spreadsheet_with_uk_dates_and_decimal_commas():
    rows = [
        ["Weekly sales"],
        ["Date", "Product", "Units", "Price (€)"],
        ["03/04/2026", "Mug", "2", "12,50"],
        ["25/04/2026", "Mug", "1", "1.234,00"],
    ]
    a = importer.analyse(rows)
    assert a.platform == "spreadsheet" and a.kind == "orders" and a.header_row == 1
    x = importer.extract(rows, a)
    assert x.orders[0].sold_at.month == 4 and x.orders[0].sold_at.day == 3
    assert x.orders[0].unit_price == pytest.approx(12.5)
    assert x.orders[1].unit_price == pytest.approx(1234.0)


def test_excel_with_sales_and_stock_tabs():
    filename, data = samples.build("spreadsheet")
    tables = importer.read_tables(filename, data)
    kinds = sorted(importer.analyse(rows).kind for _, rows in tables)
    assert kinds == ["orders", "stock"]


def test_tiktok_am_pm_dates():
    assert importer.parse_date("10/27/2026 03:04:05 PM").hour == 15


def test_old_excel_gets_a_helpful_message():
    with pytest.raises(importer.ImportError_, match="Save as"):
        importer.read_tables("orders.xls", b"\xd0\xcf\x11\xe0junk")


def test_unknown_columns_are_reported_missing():
    a = importer.analyse([["Foo", "Bar"], ["1", "2"]])
    assert a.missing and not a.confident


# ---- full flow through the API ----------------------------------------------------------------


def _upload(client, h, name, data):
    return client.post("/import/upload", headers=h, files={"file": (name, io.BytesIO(data), "text/csv")})


def test_upload_confirm_and_duplicate_upload(client, auth):
    h, _ = auth
    filename, data = samples.build("etsy")
    prev = _upload(client, h, filename, data).json()
    assert prev["ready"] and prev["sheets"][0]["platform_name"] == "Etsy"
    assert "items sold" in prev["sheets"][0]["headline"]
    assert {r["label"] for r in prev["sheets"][0]["reads"]} >= {"Sale date", "Product name", "Quantity sold"}
    res = client.post(f"/import/{prev['job_id']}/confirm", headers=h, json={}).json()
    assert res["sales_added"] > 500 and res["products_created"] == 5
    assert len(res["needs_stock"]) == 5  # sales files don't include stock
    again = _upload(client, h, filename, data).json()
    res2 = client.post(f"/import/{again['job_id']}/confirm", headers=h, json={}).json()
    assert res2["sales_added"] == 0 and res2["duplicates_skipped"] == res["sales_added"]


def test_sales_then_stock_file_match_up(client, auth):
    h, _ = auth
    prev = client.post("/import/samples/shopify/try", headers=h).json()
    client.post(f"/import/{prev['job_id']}/confirm", headers=h, json={})
    prev = client.post("/import/samples/shopify-products/try", headers=h).json()
    res = client.post(f"/import/{prev['job_id']}/confirm", headers=h, json={}).json()
    assert res["products_created"] == 0 and res["products_updated"] == 6 and res["needs_stock"] == []
    products = client.get("/products", headers=h).json()
    assert all(p["cost_price"] > 0 and p["stock_known"] for p in products)


def test_excel_import_attaches_sales_to_stock_tab_skus(client, auth):
    h, _ = auth
    prev = client.post("/import/samples/spreadsheet/try", headers=h).json()
    assert len(prev["sheets"]) == 2
    res = client.post(f"/import/{prev['job_id']}/confirm", headers=h, json={}).json()
    assert res["products_created"] == 5 and res["needs_stock"] == []
    skus = {p["sku"] for p in client.get("/products", headers=h).json()}
    assert skus == {"BB-POOBAG", "BB-BAMBOWL", "BB-HEMPTOY", "BB-CORKBED", "BB-SHAMPOO"}


def test_manual_column_choice_rescues_unknown_file(client, auth, monkeypatch):
    h, _ = auth
    from app import services_import

    monkeypatch.setattr(services_import, "_try_ai_mapping", lambda a: (a, False))
    data = b"When,What,How many\n2026-10-01,Mug,2\n2026-10-02,Mug,1\n"
    prev = _upload(client, h, "odd.csv", data).json()
    assert not prev["ready"]
    body = {"sheets": [{"index": 0, "kind": "orders", "mapping": {"date": "When", "name": "What", "quantity": "How many"}}]}
    res = client.post(f"/import/{prev['job_id']}/confirm", headers=h, json=body).json()
    assert res["sales_added"] == 2


def test_guides_and_samples_listed(client):
    g = client.get("/import/guides").json()
    assert {x["key"] for x in g["guides"]} >= {"ebay", "amazon", "shopify", "etsy", "tiktok", "spreadsheet"}
    assert all(len(x["steps"]) >= 4 for x in g["guides"])
    r = client.get("/import/samples/amazon")
    assert r.status_code == 200 and r.text.startswith("amazon-order-id")
