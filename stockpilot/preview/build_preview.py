"""Build the self-contained web preview (preview/dist/stockpilot-preview.html).

The preview runs the same importer and forecasting logic as the backend, ported to
JavaScript in engine.js. Shared tables (column names, platform fingerprints, guides,
fees) are exported from the backend here, so the two can't drift apart.

    python preview/build_preview.py          # from the stockpilot/ folder, with backend deps installed
    node preview/parity-check.js             # optional: compare engine.js with the Python backend
"""

import base64
import json
import pathlib
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))

from app import fees, forecasting, guides, importer, samples  # noqa: E402
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
    (fx / "expected.json").write_text(json.dumps(expected, indent=1))


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
    print(f"wrote {DIST / 'stockpilot-preview.html'} ({len(page) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
