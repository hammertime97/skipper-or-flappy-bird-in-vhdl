"""Messy real-world files: each one must give a clear answer, never a crash."""

import base64
import io

import pytest

from app import importer, services_import

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


@pytest.fixture(autouse=True)
def _no_ai(monkeypatch):
    monkeypatch.setattr(services_import, "_try_ai_mapping", lambda a: (a, False))


def _upload(client, h, name, data):
    return client.post("/import/upload", headers=h, files={"file": (name, io.BytesIO(data), "text/csv")})


def _import(client, h, name, data):
    prev = _upload(client, h, name, data)
    assert prev.status_code == 200, prev.text
    body = prev.json()
    assert body["ready"], body
    return body, client.post(f"/import/{body['job_id']}/confirm", headers=h, json={}).json()


@pytest.mark.parametrize(
    "name,data,message",
    [
        ("a.csv", b"", "empty"),
        ("photo.csv", PNG, "doesn't look like a sales or stock file"),
        ("a.csv", b"Date,Product,Qty,Price\n", "no rows under them"),
        ("report.pdf", b"%PDF-1.4", "CSV, TXT or Excel"),
    ],
)
def test_unusable_files_get_a_plain_message(client, auth, name, data, message):
    h, _ = auth
    r = _upload(client, h, name, data)
    assert r.status_code == 400 and message in r.json()["detail"]["message"]


def test_windows_excel_csv_in_cp1252(client, auth):
    h, _ = auth
    data = "Date,Product,Qty,Price\n2026-10-01,Café mug,2,9.99\n2026-10-02,Crème jar,1,4.50\n".encode("cp1252")
    _, res = _import(client, h, "a.csv", data)
    assert res["sales_added"] == 2
    assert {p["name"] for p in client.get("/products", headers=h).json()} == {"Café mug", "Crème jar"}


def test_utf16_unicode_text_export(client, auth):
    h, _ = auth
    data = "Date\tProduct\tQty\n2026-10-01\tMug\t2\n".encode("utf-16")
    _, res = _import(client, h, "a.txt", data)
    assert res["sales_added"] == 1


@pytest.mark.parametrize(
    "headers",
    ["Datum;Produkt;Menge;Preis", "Fecha;Producto;Cantidad;Precio", "Date;Produit;Quantité;Prix", "Data;Prodotto;Quantità;Prezzo"],
)
def test_headers_in_other_languages(headers):
    rows = [headers.split(";"), ["13.10.2026", "Tasse", "2", "12,50 €"]]
    a = importer.analyse(rows)
    assert a.kind == "orders" and not a.missing
    x = importer.extract(rows, a)
    assert x.orders[0].quantity == 2 and x.orders[0].unit_price == 12.5 and x.orders[0].sold_at.month == 10


def test_date_styles_including_spreadsheet_serial_numbers():
    for v in ["2026-10-03", "Oct 3, 2026", "03-Oct-2026", "3 October 2026", "46298", "2026-10-03T09:15:00Z"]:
        d = importer.parse_date(v)
        assert d is not None and (d.year, d.month, d.day) == (2026, 10, 3), v


def test_future_dates_typos_and_refunds_are_left_out():
    rows = [
        ["Date", "Product", "Qty", "Price"],
        ["2026-10-01", "A", "2", "5"],
        ["2099-01-01", "A", "1", "5"],  # typo in the year
        ["2026-10-02", "A", "-1", "5"],  # refund line
        ["2026-10-03", "A", "5000000", "5"],  # quantity pasted into the wrong column
        ["2026-10-04", "A", "1", "99999999"],
    ]
    x = importer.extract(rows, importer.analyse(rows))
    assert [o.quantity for o in x.orders] == [2] and x.skipped_invalid == 4
    assert any("future" in p for p in x.problems)


def test_stock_list_with_a_plain_quantity_column():
    a = importer.analyse([["Product", "Quantity", "Cost"], ["Mug", "12", "2.10"]])
    assert a.kind == "stock" and not a.missing and a.columns[a.mapping["stock"]] == "Quantity"


def test_unknown_file_asks_about_sales_columns():
    a = importer.analyse([["Foo", "Bar"], ["1", "2"]])
    assert a.kind == "orders" and "date" in a.missing


def test_too_many_rows_is_explained(monkeypatch):
    monkeypatch.setattr(importer, "MAX_ROWS", 3)
    with pytest.raises(importer.ImportError_, match="shorter date range"):
        importer.read_tables("a.csv", b"Date,Product\n2026-10-01,A\n2026-10-02,A\n2026-10-03,A\n")


def test_overlapping_downloads_only_add_new_sales(client, auth):
    h, _ = auth
    head = "Order number,Date,Product,Qty\n"
    week1 = "".join(f"{n},2026-10-{n:02d},Mug,1\n" for n in range(1, 11))
    week2 = "".join(f"{n},2026-10-{n:02d},Mug,1\n" for n in range(6, 16))
    _, r1 = _import(client, h, "a.csv", (head + week1).encode())
    _, r2 = _import(client, h, "a.csv", (head + week2).encode())
    assert (r1["sales_added"], r2["sales_added"], r2["duplicates_skipped"]) == (10, 5, 5)


def test_confirming_twice_or_someone_elses_upload(client, auth):
    h, _ = auth
    body, first = _import(client, h, "a.csv", b"Date,Product,Qty\n2026-10-01,A,1\n")
    again = client.post(f"/import/{body['job_id']}/confirm", headers=h, json={}).json()
    assert again["sales_added"] == first["sales_added"] == 1  # a double tap doesn't add it twice
    assert len(client.get("/sales?days=365", headers=h).json()) == 1
    other = client.post("/auth/register", json={"email": "other-importer@example.com", "password": "password123"}).json()
    r = client.post(f"/import/{body['job_id']}/confirm", headers={"Authorization": f"Bearer {other['token']}"}, json={})
    assert r.status_code in (400, 404)


def test_unconfirmed_uploads_are_deleted_after_a_day(client, auth):
    from datetime import timedelta

    from sqlmodel import Session

    from app.db import engine
    from app.models import ImportJob, utcnow

    h, _ = auth
    old = _upload(client, h, "a.csv", b"Date,Product,Qty\n2026-10-01,A,1\n").json()["job_id"]
    with Session(engine) as s:
        job = s.get(ImportJob, old)
        job.created_at = utcnow() - timedelta(days=2)
        s.add(job)
        s.commit()
    new = _upload(client, h, "a.csv", b"Date,Product,Qty\n2026-10-01,A,1\n").json()["job_id"]
    with Session(engine) as s:
        assert s.get(ImportJob, old) is None and s.get(ImportJob, new) is not None
