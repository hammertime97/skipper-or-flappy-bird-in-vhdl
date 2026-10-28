"""Build the self-contained web preview (preview/dist/stockpilot-preview.html).

The preview runs the same importer and forecasting logic as the backend, ported to
JavaScript in engine.js. Shared tables (column names, platform fingerprints, guides,
fees) are exported from the backend here, so the two can't drift apart.

    python preview/build_preview.py          # from the stockpilot/ folder, with backend deps installed
                                             # (also refreshes the app's on-phone engine in mobile/src/local/generated)
    node preview/parity-check.js             # optional: compare engine.js with the Python backend
"""

import base64
import json
import pathlib
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))

from app import fees, forecasting, guides, importer, insights, samples, trend_library  # noqa: E402
from app.models import Product, Sale  # noqa: E402
from app.forecasting import forecast_weekly, weekly_buckets  # noqa: E402

DIST = HERE / "dist"


def config() -> dict:
    return {
        "role_synonyms": importer.ROLE_SYNONYMS,
        "role_labels": importer.ROLE_LABELS,
        "platform_signatures": [[p, k, sorted(s)] for p, k, s in importer.PLATFORM_SIGNATURES],
        "platform_names": importer.PLATFORM_NAMES,
        "platform_overrides": importer.PLATFORM_OVERRIDES,
        "line_total_price_platforms": sorted(importer.LINE_TOTAL_PRICE_PLATFORMS),
        "guides": guides.GUIDES,
        "default_fees": fees.DEFAULT_FEES,
        "model_labels": forecasting.MODEL_LABELS,
        "trend_library": trend_library.library_payload(),
    }


def sample_bundle() -> list[dict]:
    out = []
    for key, store in samples.STORES.items():
        fn, data = samples.build(key)
        files = [{"name": fn, "b64": base64.b64encode(data).decode()}]
        if key == "shopify":
            files.append(dict(zip(("name", "b64"), _b64(*samples.build("shopify-products")))))
        elif key != "spreadsheet":
            files.append(dict(zip(("name", "b64"), _b64(*samples.stock_csv(key)))))
        out.append({"key": key, "platform": store.platform, "title": store.title, "store_name": store.store_name,
                    "niche": store.niche, "files": files})
    return out


def _b64(name: str, data: bytes) -> tuple[str, str]:
    return name, base64.b64encode(data).decode()


def parity_fixtures() -> None:
    """Sample files + the backend's own results, for parity-check.js."""
    fx = DIST / "parity"
    fx.mkdir(parents=True, exist_ok=True)
    (fx / "config.json").write_text(json.dumps(config()))
    now = datetime(2026, 10, 27, tzinfo=timezone.utc)
    expected = {}
    for key in ["ebay", "amazon", "shopify", "shopify-products", "etsy", "tiktok", "spreadsheet"]:
        fn, data = samples.build(key, now=now)
        (fx / fn).write_bytes(data)
        res = []
        for sheet, rows in importer.read_tables(fn, data):
            a = importer.analyse(rows)
            x = importer.extract(rows, a)
            per: dict[str, list] = {}
            for o in x.orders:
                per.setdefault(o.key, []).append((o.sold_at, o.quantity))
            fcs = {}
            for k, pts in sorted(per.items()):
                fc = forecast_weekly(weekly_buckets(pts, now, 104), 4)
                fcs[k] = {"next": round(fc.next_week, 6), "lo": round(fc.lower[0], 6), "hi": round(fc.upper[1], 6),
                          "acc": None if fc.accuracy is None else round(fc.accuracy, 6), "models": [m.name for m in fc.models]}
            res.append({"file": fn, "sheet": sheet, "platform": a.platform, "kind": a.kind,
                        "mapping": {k: a.columns[v] for k, v in a.mapping.items()}, "orders": len(x.orders),
                        "units": sum(o.quantity for o in x.orders), "stock": len(x.stock),
                        "cancelled": x.skipped_cancelled, "invalid": x.skipped_invalid,
                        "summary": importer.summary(a, x)["headline"], "forecasts": fcs})
        expected[key] = res
    expected["_insights"] = insight_fixture(now)
    (fx / "expected.json").write_text(json.dumps(expected, indent=1))


def insight_fixture(now: datetime) -> dict:
    """A small random store with multi-item orders, and the backend's 80/20, bundle and calculator results."""
    import random
    from datetime import timedelta

    rng = random.Random(7)
    products = [Product(id=i + 1, user_id=1, sku=f"P{i + 1}", name=f"Product {i + 1}", cost_price=[2, 3, 0, 5, 9, 1.5, 4, 12][i],
                        sell_price=[10, 12, 8, 20, 11, 6, 15, 30][i]) for i in range(8)]
    weights = [30, 18, 12, 9, 6, 4, 3, 1]
    sales = []
    for n in range(500):
        when = now - timedelta(days=rng.uniform(0, 200))
        picks = {rng.choices(range(8), weights)[0] for _ in range(rng.choice([1, 1, 1, 2, 3]))}
        if 0 in picks and rng.random() < 0.5:
            picks.add(3)  # P1 and P4 often bought together
        ch = rng.choice(["eBay", "Amazon", "Shopify", "TikTok Shop", ""])
        for i in picks:
            p = products[i]
            sales.append(Sale(user_id=1, product_id=p.id, quantity=rng.choice([1, 1, 2]), unit_price=p.sell_price, channel=ch,
                              order_ref=f"o{n}", sold_at=when))
    table = fees.fee_table({})
    return {
        "products": [{"id": p.id, "sku": p.sku, "name": p.name, "cost_price": p.cost_price, "sell_price": p.sell_price} for p in products],
        "sales": [[s.product_id, s.quantity, s.unit_price, int(s.sold_at.timestamp() * 1000), s.channel, s.order_ref] for s in sales],
        "focus": insights.focus_list(products, sales, now, table),
        "bundles": insights.bundles(products, sales, now),
        "calc": [insights.profit_calc(*args) for args in [(30, 8, 4, 10, 0.3, 6), (12, 7, 3, 15, 0, 4), (0, 1, 1, 5, 0, 0), (20, 4, 2, 95, 0, 0)]],
        "calc_args": [[30, 8, 4, 10, 0.3, 6], [12, 7, 3, 15, 0, 4], [0, 1, 1, 5, 0, 0], [20, 4, 2, 95, 0, 0]],
    }


def mobile_files(engine: str) -> None:
    """The app's on-phone mode runs the same engine: copy it and its tables into mobile/src/local."""
    out = HERE.parent / "mobile" / "src" / "local" / "generated"
    out.mkdir(parents=True, exist_ok=True)
    note = "// Generated by preview/build_preview.py from preview/engine.js. Do not edit; edit engine.js and rebuild.\n"
    (out / "engine.js").write_text(note + engine)
    (out / "engine.d.ts").write_text(note + "// The engine sets globalThis.Engine; see mobile/src/local/engine.ts for its types.\nexport {};\n")
    (out / "engine-config.json").write_text(json.dumps(config()))
    (out / "samples.json").write_text(json.dumps(sample_bundle()))


def main() -> None:
    DIST.mkdir(exist_ok=True)
    page = (HERE / "preview.template.html").read_text()
    engine = (HERE / "engine.js").read_text()
    assert "</script" not in engine
    safe = lambda obj: json.dumps(obj).replace("</", "<\\/")  # noqa: E731
    page = (
        page.replace("/*__CONFIG__*/null", safe(config()))
        .replace("/*__ENGINE__*/", engine)
        .replace("/*__SAMPLES__*/[]", safe(sample_bundle()))
    )
    (DIST / "stockpilot-preview.html").write_text(page)
    parity_fixtures()
    mobile_files(engine)
    print(f"wrote {DIST / 'stockpilot-preview.html'} ({len(page) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
