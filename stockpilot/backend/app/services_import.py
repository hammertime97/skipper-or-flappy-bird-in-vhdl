"""Upload -> preview -> confirm flow for sales and stock files."""

from __future__ import annotations

import logging
import statistics
from datetime import timedelta

from sqlmodel import Session, select

from . import importer
from .importer import Analysis, ImportError_
from .models import ImportJob, Product, Sale, User, utcnow

log = logging.getLogger(__name__)

PREVIEW_ROWS = 4


def _analysis_to_dict(a: Analysis, ai_mapped: bool = False) -> dict:
    return {
        "platform": a.platform,
        "kind": a.kind,
        "header_row": a.header_row,
        "columns": a.columns,
        "mapping": a.mapping,
        "missing": a.missing,
        "confident": a.confident,
        "ai_mapped": ai_mapped,
    }


def _analysis_from_dict(d: dict, rows: list[list[str]]) -> Analysis:
    h = d["header_row"]
    return Analysis(
        d["platform"], d["kind"], h, d["columns"], {k: int(v) for k, v in d["mapping"].items()},
        d["missing"], d["confident"], rows[h + 1 : h + 6],
    )


def _try_ai_mapping(a: Analysis) -> tuple[Analysis, bool]:
    """Ask Claude which column is which when our own matching came up short."""
    from .ai import column_mapper
    from .ai.client import AIError

    try:
        g = column_mapper.guess(a.columns, a.sample_rows)
    except AIError as err:
        log.info("AI column mapping unavailable: %s", err)
        return a, False
    if g.kind == "unknown":
        return a, False
    by_name = {h.strip().lower(): i for i, h in enumerate(a.columns)}
    mapping = dict(a.mapping)
    for role in importer.ROLE_LABELS:
        header = getattr(g, role, "") if role in type(g).model_fields else ""
        idx = by_name.get((header or "").strip().lower())
        if idx is not None and role not in mapping and idx not in mapping.values():
            mapping[role] = idx
    a2 = Analysis(a.platform, g.kind, a.header_row, a.columns, mapping, [], True, a.sample_rows)
    a2.missing = [r for r in importer.required_roles(g.kind) if r not in mapping]
    if not any(r in mapping for r in ("sku", "item_id", "name")):
        a2.missing.append("name")
    a2.confident = not a2.missing
    return a2, True


NOTHING_ADDED = "Nothing was added: no row had a date, product and quantity we could read."


def _sheet_preview(rows: list[list[str]], a: Analysis, ai_mapped: bool, sheet: str) -> dict:
    x = importer.extract(rows, a) if not a.missing else importer.Extracted()
    if a.kind == "orders":
        examples = [
            {"date": o.sold_at.date().isoformat(), "product": o.name, "quantity": o.quantity, "price": o.unit_price}
            for o in x.orders[:PREVIEW_ROWS]
        ]
    else:
        examples = [
            {"product": s.name, "sku": s.sku, "stock": s.stock, "cost": s.cost, "price": s.price}
            for s in x.stock[:PREVIEW_ROWS]
        ]
    return {
        "sheet": sheet,
        "platform": a.platform,
        "platform_name": importer.PLATFORM_NAMES.get(a.platform, a.platform),
        "kind": a.kind,
        "columns": a.columns,
        "reads": a.describe(),
        "missing": [importer.ROLE_LABELS[m] for m in a.missing],
        "ready": not a.missing and bool(x.orders or x.stock),
        "ai_mapped": ai_mapped,
        "examples": examples,
        **importer.summary(a, x),
    }


def _forget_old_uploads(session: Session) -> None:
    """Uploads nobody confirmed within a day hold raw file contents we no longer need: delete them."""
    cutoff = utcnow() - timedelta(days=1)
    for job in session.exec(select(ImportJob).where(ImportJob.status == "pending", ImportJob.created_at < cutoff)):
        session.delete(job)


def create_job(session: Session, user: User, filename: str, data: bytes, use_ai: bool = True) -> dict:
    tables = importer.read_tables(filename, data)
    if all(not rows or len(rows) <= importer.find_header(rows) + 1 for _, rows in tables):
        raise importer.ImportError_(
            "We found the column headings but no rows under them. Check the date range when you download the file."
        )
    _forget_old_uploads(session)
    stored, previews = [], []
    for sheet, rows in tables:
        a = importer.analyse(rows)
        ai_mapped = False
        if not a.confident and use_ai:
            a, ai_mapped = _try_ai_mapping(a)
        stored.append({"sheet": sheet, "rows": rows, "analysis": _analysis_to_dict(a, ai_mapped)})
        previews.append(_sheet_preview(rows, a, ai_mapped, sheet))
    job = ImportJob(user_id=user.id, filename=filename, sheets=stored)
    session.add(job)
    session.commit()
    session.refresh(job)
    return {
        "job_id": job.id,
        "filename": filename,
        "sheets": previews,
        "ready": any(p["ready"] for p in previews),
    }


def _norm_name(name: str) -> str:
    return importer.norm(name)


class _Catalogue:
    """The seller's products, looked up by SKU or by name."""

    def __init__(self, session: Session, user: User):
        self.session, self.user = session, user
        self.products = list(session.exec(select(Product).where(Product.user_id == user.id)))
        self.by_sku = {p.sku.upper(): p for p in self.products}
        self.by_name = {_norm_name(p.name): p for p in self.products}
        self.created: list[Product] = []
        self.updated: set[int] = set()

    def find(self, key: str, name: str) -> Product | None:
        return self.by_sku.get(key.upper()) or (self.by_name.get(_norm_name(name)) if name else None)

    def add(self, p: Product) -> Product:
        self.session.add(p)
        self.session.flush()
        self.products.append(p)
        self.by_sku[p.sku.upper()] = p
        self.by_name[_norm_name(p.name)] = p
        self.created.append(p)
        return p


def _apply_stock(cat: _Catalogue, x: importer.Extracted, platform: str) -> None:
    for rec in x.stock:
        p = cat.find(rec.key, rec.name)
        if p is None:
            p = cat.add(
                Product(
                    user_id=cat.user.id, sku=rec.sku or rec.key, name=rec.name, stock_qty=rec.stock or 0,
                    stock_known=rec.stock is not None, source=platform,
                )
            )
        elif p.id is not None:
            cat.updated.add(p.id)
        if rec.stock is not None:
            p.stock_qty, p.stock_known = rec.stock, True
        if rec.price is not None:
            p.sell_price = rec.price
        if rec.cost is not None:
            p.cost_price = rec.cost
        if rec.category:
            p.category = rec.category
        if rec.supplier:
            p.supplier = rec.supplier
        if rec.lead_time_days is not None:
            p.lead_time_days = rec.lead_time_days
        if rec.name and p.name == p.sku:
            p.name = rec.name
        p.archived = False
        cat.session.add(p)


def _apply_orders(cat: _Catalogue, x: importer.Extracted, platform: str) -> tuple[int, int, int]:
    session, user = cat.session, cat.user
    existing = set(
        session.exec(select(Sale.import_key).where(Sale.user_id == user.id, Sale.import_key.is_not(None)))  # type: ignore[union-attr]
    )
    prices: dict[str, list[float]] = {}
    for o in x.orders:
        if o.unit_price is not None:
            prices.setdefault(o.key, []).append(o.unit_price)
    added = dupes = units = 0
    for o in x.orders:
        if o.import_key in existing:
            dupes += 1
            continue
        p = cat.find(o.key, o.name)
        if p is None:
            p = cat.add(
                Product(
                    user_id=user.id, sku=o.sku or o.key, name=o.name or o.key,
                    sell_price=round(statistics.median(prices[o.key]), 2) if prices.get(o.key) else 0.0,
                    stock_qty=0, stock_known=False, source=platform,
                )
            )
        elif p.sell_price == 0 and prices.get(o.key):
            p.sell_price = round(statistics.median(prices[o.key]), 2)
            session.add(p)
        session.add(
            Sale(
                user_id=user.id, product_id=p.id, quantity=o.quantity,
                unit_price=o.unit_price if o.unit_price is not None else p.sell_price,
                channel=o.channel, order_ref=o.order_ref, sold_at=o.sold_at, import_key=o.import_key,
            )
        )
        existing.add(o.import_key)
        added += 1
        units += o.quantity
    return added, dupes, units


def confirm_job(session: Session, user: User, job_id: int, overrides: list[dict] | None = None) -> dict:
    job = session.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        raise ImportError_("This upload has expired. Please upload the file again.")
    if job.status == "done":
        return job.result
    if job.created_at < utcnow() - timedelta(hours=6):
        raise ImportError_("This upload has expired. Please upload the file again.")

    by_index = {o.get("index"): o for o in (overrides or [])}
    sheets = []
    for i, s in enumerate(job.sheets):
        a = _analysis_from_dict(s["analysis"], s["rows"])
        ov = by_index.get(i) or {}
        if ov.get("skip"):
            continue
        if ov.get("kind") in ("orders", "stock"):
            a.kind = ov["kind"]
        for role, col in (ov.get("mapping") or {}).items():
            if role not in importer.ROLE_LABELS:
                continue
            if col in (None, ""):
                a.mapping.pop(role, None)
            elif col in a.columns:
                a.mapping[role] = a.columns.index(col)
        a.missing = [r for r in importer.required_roles(a.kind) if r not in a.mapping]
        if not any(r in a.mapping for r in ("sku", "item_id", "name")):
            a.missing.append("name")
        if a.missing:
            continue
        sheets.append((a, importer.extract(s["rows"], a)))
    if not sheets:
        raise ImportError_("We couldn't find the columns we need. Pick them on the previous screen and try again.")

    cat = _Catalogue(session, user)
    # Stock lists first, so sales from the same upload attach to products with their real SKUs.
    for a, x in sorted(sheets, key=lambda ax: ax[0].kind != "stock"):
        if a.kind == "stock":
            _apply_stock(cat, x, a.platform)
    sales_added = dupes = cancelled = units_added = 0
    for a, x in sheets:
        if a.kind == "orders":
            n, d, u = _apply_orders(cat, x, a.platform)
            sales_added += n
            units_added += u
            dupes += d
            cancelled += x.skipped_cancelled
    session.commit()

    needs_stock = [p for p in cat.products if not p.stock_known and not p.archived and p.stage == "active"]
    needs_cost = [p for p in cat.products if p.cost_price <= 0 and not p.archived and p.stage == "active"]
    lines = []
    if sales_added:
        lines.append(f"Added {importer.plural(sales_added, 'sale')} ({importer.plural(units_added, 'item')} sold).")
    if dupes:
        lines.append(f"Skipped {importer.plural(dupes, 'sale')} you had already uploaded.")
    if cat.created:
        lines.append(f"Created {importer.plural(len(cat.created), 'new product')}.")
    if cat.updated:
        lines.append(f"Updated {importer.plural(len(cat.updated), 'product')}.")
    if cancelled:
        lines.append(f"Left out {importer.plural(cancelled, 'cancelled or refunded order')}.")
    result = {
        "sales_added": sales_added,
        "duplicates_skipped": dupes,
        "products_created": len(cat.created),
        "products_updated": len(cat.updated),
        "summary": lines or [NOTHING_ADDED],
        "needs_stock": [{"id": p.id, "sku": p.sku, "name": p.name} for p in needs_stock],
        "needs_cost": [{"id": p.id, "sku": p.sku, "name": p.name, "sell_price": p.sell_price} for p in needs_cost],
    }
    job.status, job.result, job.sheets = "done", result, []  # drop the raw rows once imported
    session.add(job)
    session.commit()
    return result
