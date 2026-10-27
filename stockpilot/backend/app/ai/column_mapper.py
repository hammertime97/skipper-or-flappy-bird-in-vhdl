"""AI fallback for spreadsheets whose columns we don't recognise."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from ..importer import ROLE_LABELS
from .client import structured

SYSTEM = """You read the first rows of a spreadsheet an online seller uploaded and say which column holds what.
The file is either a list of sales/orders (each row: a date, a product, a quantity, maybe a price)
or a stock list (each row: a product and how many are in stock, maybe cost and price).
Answer with the exact column heading text for each field, or an empty string when no column fits.
Never guess a column for a field it doesn't contain."""


class ColumnGuess(BaseModel):
    kind: Literal["orders", "stock", "unknown"]
    date: str
    order_id: str
    sku: str
    name: str
    quantity: str
    unit_price: str
    line_total: str
    status: str
    stock: str
    cost: str
    category: str
    supplier: str


def guess(headers: list[str], sample_rows: list[list[str]]) -> ColumnGuess:
    lines = [" | ".join(headers)] + [" | ".join(r[: len(headers)]) for r in sample_rows[:5]]
    fields = "\n".join(f"- {k}: {v}" for k, v in ROLE_LABELS.items() if k in ColumnGuess.model_fields)
    content = (
        "Column headings, then up to 5 example rows (cells separated by ' | '):\n"
        + "\n".join(lines)
        + f"\n\nFields:\n{fields}\n\nWhich heading holds each field?"
    )
    return structured(SYSTEM, content, ColumnGuess, effort="low", max_tokens=4000)
