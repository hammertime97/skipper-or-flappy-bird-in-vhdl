"""Dummy export files that look like real platform downloads.

Every name, order number and buyer here is made up. The files let a new seller
(or a tester) try the import flow without their own data, and they're used in tests.
Dates are generated relative to today so the files always look recent.
"""

from __future__ import annotations

import csv
import io
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class SampleProduct:
    sku: str  # "" = the seller never set a SKU (common on eBay and Etsy)
    name: str
    price: float
    cost: float
    weekly: float  # typical units per week
    growth: float  # weekly growth rate
    pattern: str  # steady | rising | viral | declining | seasonal | intermittent | new
    stock: int
    lead_days: int
    item_id: str = ""


@dataclass(frozen=True)
class SampleStore:
    key: str
    platform: str
    title: str
    store_name: str
    niche: str
    filename: str
    products: tuple[SampleProduct, ...]


STORES: dict[str, SampleStore] = {
    s.key: s
    for s in [
        SampleStore(
            "ebay", "ebay", "eBay orders report", "RetroLoot (sample)", "retro gaming and tech gadgets",
            "ebay-orders-sample.csv",
            (
                SampleProduct("RG-35XX", "Handheld Retro Game Console 3.5in 64GB", 69.99, 38.00, 14, 0.02, "rising", 22, 14, "295810443211"),
                SampleProduct("", "Wireless Controller for Switch Pro Style", 24.99, 9.50, 20, 0.0, "steady", 60, 12, "295810443298"),
                SampleProduct("CRT-FLT", "CRT Scanline Filter HDMI Upscaler", 34.99, 14.20, 6, 0.0, "intermittent", 18, 18, "295810443305"),
                SampleProduct("GBA-SHL", "Clear Purple Replacement Shell for GBA", 12.99, 3.10, 16, -0.03, "declining", 140, 10, "295810443377"),
                SampleProduct("", "Mechanical Mini Keyboard 60% RGB", 49.99, 22.00, 9, 0.05, "viral", 15, 14, "295810443402"),
                SampleProduct("CART-RDR", "USB Cartridge Reader Dumper", 39.99, 17.50, 4, 0.0, "steady", 30, 21, "295810443489"),
                SampleProduct("LED-STRP", "Gaming Desk LED Strip 5m Sync", 19.99, 5.40, 11, 0.0, "seasonal", 75, 12, "295810443511"),
            ),
        ),
        SampleStore(
            "amazon", "amazon", "Amazon All Orders report", "Kitchen Nook (sample)", "kitchen gadgets",
            "amazon-all-orders-sample.txt",
            (
                SampleProduct("KN-GARLIC", "Garlic Press Rocker Stainless Steel", 14.99, 3.20, 30, 0.0, "steady", 210, 30, "B0D1EXAMP1"),
                SampleProduct("KN-SPIRAL", "Vegetable Spiralizer 5-Blade", 24.99, 7.80, 18, 0.03, "rising", 60, 35, "B0D1EXAMP2"),
                SampleProduct("KN-OILSPR", "Olive Oil Sprayer Glass 200ml", 12.99, 2.40, 24, 0.06, "viral", 45, 28, "B0D1EXAMP3"),
                SampleProduct("KN-SCALE", "Digital Kitchen Scale 5kg", 19.99, 6.10, 15, -0.02, "declining", 260, 30, "B0D1EXAMP4"),
                SampleProduct("KN-PASTA", "Pasta Drying Rack Bamboo", 21.99, 6.60, 5, 0.0, "seasonal", 90, 40, "B0D1EXAMP5"),
                SampleProduct("KN-CHOP", "Electric Mini Chopper 250W", 34.99, 13.00, 9, 0.0, "steady", 0, 30, "B0D1EXAMP6"),
            ),
        ),
        SampleStore(
            "shopify", "shopify", "Shopify orders export", "Iron & Oak Fitness (sample)", "home gym and fitness equipment",
            "shopify-orders-sample.csv",
            (
                SampleProduct("IO-BAND-SET", "Resistance Band Set (5 Levels)", 29.00, 7.50, 22, 0.02, "rising", 80, 21),
                SampleProduct("IO-GRIP", "Adjustable Hand Grip Strengthener", 15.00, 2.90, 18, 0.0, "steady", 150, 18),
                SampleProduct("IO-ROLLER", "Ab Roller Wheel with Knee Pad", 24.00, 6.20, 12, 0.0, "seasonal", 40, 21),
                SampleProduct("IO-MAT", "Extra Thick Yoga Mat 10mm", 39.00, 11.00, 9, 0.05, "viral", 25, 25),
                SampleProduct("IO-ROPE", "Weighted Jump Rope Ball Bearing", 19.00, 4.10, 10, -0.03, "declining", 190, 18),
                SampleProduct("IO-PUSHUP", "Push-Up Board 9-in-1", 34.00, 9.80, 6, 0.0, "new", 30, 21),
            ),
        ),
        SampleStore(
            "etsy", "etsy", "Etsy Order Items download", "Little Gem Studio (sample)", "handmade minimalist jewelry",
            "etsy-order-items-sample.csv",
            (
                SampleProduct("", "Personalized Initial Necklace Gold Filled", 38.00, 9.00, 12, 0.03, "seasonal", 0, 5, "1599001101"),
                SampleProduct("LG-HOOP", "Tiny Huggie Hoop Earrings Sterling Silver", 26.00, 5.50, 10, 0.0, "steady", 0, 5, "1599001102"),
                SampleProduct("", "Birthstone Stacking Ring Dainty", 32.00, 7.20, 7, 0.04, "rising", 0, 5, "1599001103"),
                SampleProduct("LG-CHARM", "Custom Pet Portrait Charm", 45.00, 11.00, 3, 0.0, "intermittent", 0, 7, "1599001104"),
                SampleProduct("", "Pearl Drop Bridal Earrings", 42.00, 10.50, 5, -0.02, "declining", 0, 5, "1599001105"),
            ),
        ),
        SampleStore(
            "tiktok", "tiktok", "TikTok Shop order export", "GlowLab (sample)", "beauty gadgets and skincare tools",
            "tiktok-orders-sample.csv",
            (
                SampleProduct("GL-ICEROLL", "Ice Roller for Face Depuffing", 16.99, 2.80, 40, 0.04, "viral", 120, 12, "1729500011"),
                SampleProduct("GL-LEDMASK", "LED Face Mask 7 Colours", 59.99, 19.00, 8, 0.03, "rising", 35, 15, "1729500012"),
                SampleProduct("GL-SCRUB", "Ultrasonic Skin Scrubber", 29.99, 7.40, 14, 0.0, "steady", 90, 12, "1729500013"),
                SampleProduct("GL-GUASHA", "Rose Quartz Gua Sha Set", 18.99, 3.60, 20, -0.04, "declining", 300, 12, "1729500014"),
                SampleProduct("GL-MIRROR", "Lighted Travel Makeup Mirror", 22.99, 6.90, 7, 0.0, "new", 50, 14, "1729500015"),
            ),
        ),
        SampleStore(
            "spreadsheet", "spreadsheet", "Your own Excel sheet", "Bloom & Bark (sample)", "eco-friendly pet products",
            "my-shop-spreadsheet-sample.xlsx",
            (
                SampleProduct("BB-POOBAG", "Compostable Poop Bags 240", 13.50, 3.20, 28, 0.0, "steady", 220, 14),
                SampleProduct("BB-BAMBOWL", "Bamboo Dog Bowl Set", 22.00, 6.80, 10, 0.02, "rising", 35, 21),
                SampleProduct("BB-HEMPTOY", "Hemp Rope Chew Toy", 11.00, 2.10, 16, 0.06, "viral", 40, 14),
                SampleProduct("BB-CORKBED", "Cork Cat Scratcher Bed", 35.00, 12.50, 4, 0.0, "intermittent", 26, 28),
                SampleProduct("BB-SHAMPOO", "Oatmeal Dog Shampoo 500ml", 15.00, 4.40, 12, -0.02, "declining", 130, 14),
            ),
        ),
    ]
}


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _daily_rate(p: SampleProduct, week_idx: float, weeks: int, day: datetime, rng: random.Random) -> float:
    rate = p.weekly / 7 * (1 + p.growth) ** (week_idx - weeks)  # base is "about now"
    if p.pattern == "viral":
        rate *= 0.45 + 1.4 / (1 + math.exp(-(week_idx - (weeks - 5))))
    elif p.pattern == "seasonal":
        rate *= 1 + 0.6 * math.cos((day.timetuple().tm_yday - 350) / 365 * 2 * math.pi)
    elif p.pattern == "new" and week_idx < weeks - 6:
        rate = 0
    elif p.pattern == "intermittent":
        rate = rate * 3.5 if rng.random() < 0.28 else 0
    if day.weekday() >= 5:
        rate *= 1.2
    return rate


@dataclass
class SimSale:
    product: SampleProduct
    when: datetime
    qty: int
    price: float
    order: int
    cancelled: bool


# (product index, often bought with product index, chance per order)
COMPANIONS: dict[str, list[tuple[int, int, float]]] = {
    "ebay": [(0, 1, 0.6)],          # console + controller
    "amazon": [(1, 2, 0.4)],        # spiralizer + oil sprayer
    "shopify": [(3, 0, 0.6)],       # yoga mat + resistance bands
    "etsy": [(0, 1, 0.6)],          # initial necklace + huggie hoops
    "tiktok": [(2, 0, 0.5)],        # skin scrubber + ice roller
}


def simulate(store: SampleStore, weeks: int = 26, now: datetime | None = None, seed: int = 11) -> list[SimSale]:
    """Order lines for the store, oldest first, ending yesterday."""
    rng = random.Random(f"{store.key}-{seed}")
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    end = now.replace(hour=0, minute=0, second=0)
    sales: list[SimSale] = []
    order_no = 1001
    for d in range(weeks * 7, 0, -1):
        day = end - timedelta(days=d)
        week_idx = weeks - d / 7
        for p in store.products:
            n = _poisson(rng, _daily_rate(p, week_idx, weeks, day, rng))
            for _ in range(n):
                qty = 2 if rng.random() < 0.08 else 1
                when = day + timedelta(seconds=rng.randint(7 * 3600, 23 * 3600))
                price = round(p.price * (0.9 if rng.random() < 0.12 else 1.0), 2)
                sales.append(SimSale(p, when, qty, price, 0, rng.random() < 0.025))
    sales.sort(key=lambda s: s.when)
    # Group some lines into multi-item orders.
    i = 0
    while i < len(sales):
        sales[i].order = order_no
        if i + 1 < len(sales) and rng.random() < 0.12 and (sales[i + 1].when - sales[i].when).seconds < 7200:
            sales[i + 1].order = order_no
            sales[i + 1].when = sales[i].when
            i += 1
        order_no += 1
        i += 1
    # Products customers often buy together (so the "Bought together" insight has something real to find).
    extra = [
        SimSale(store.products[b], s.when, 1, store.products[b].price, s.order, s.cancelled)
        for a, b, prob in COMPANIONS.get(store.key, [])
        for s in sales
        if s.product is store.products[a] and rng.random() < prob
    ]
    return sorted(sales + extra, key=lambda s: s.when)


def _csv(rows: list[list[str]], delimiter: str = ",") -> str:
    buf = io.StringIO()
    csv.writer(buf, delimiter=delimiter, lineterminator="\n").writerows(rows)
    return buf.getvalue()


FIRST = ["alex", "sam", "jordan", "casey", "taylor", "morgan", "jamie", "riley", "drew", "quinn"]


def _buyer(rng: random.Random) -> str:
    return f"{rng.choice(FIRST)}_{rng.randint(100, 9999)}"


def ebay_orders(store: SampleStore, sales: list[SimSale]) -> str:
    rng = random.Random("ebay-buyers")
    header = [
        "Sales Record Number", "Order Number", "Buyer Username", "Buyer Name", "Ship To City", "Ship To Country",
        "Item Number", "Item Title", "Custom Label", "Quantity", "Sold For", "Postage And Packaging",
        "Total Price", "Sale Date", "Paid On Date",
    ]
    rows: list[list[str]] = [[], header]
    for n, s in enumerate(reversed(sales), start=1):
        if s.cancelled:
            continue  # eBay leaves cancelled orders out of the default report
        buyer = _buyer(rng)
        rows.append([
            str(9000 + len(sales) - n), f"0{s.order}-2{s.order:05d}-{s.order % 97:05d}", buyer, "Sample Buyer",
            "Springfield", "United States", s.product.item_id, s.product.name, s.product.sku, str(s.qty),
            f"${s.price:.2f}", "$0.00", f"${s.price * s.qty:.2f}", s.when.strftime("%b-%d-%y"), s.when.strftime("%b-%d-%y"),
        ])
    rows += [[], [f"{len(rows) - 2} record(s) downloaded"], ["Seller ID : retroloot_sample"]]
    return _csv(rows)


def amazon_orders(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "amazon-order-id", "merchant-order-id", "purchase-date", "last-updated-date", "order-status",
        "fulfillment-channel", "sales-channel", "product-name", "sku", "asin", "item-status", "quantity",
        "currency", "item-price", "item-tax", "shipping-price",
    ]
    rows = [header]
    for s in reversed(sales):
        status = "Cancelled" if s.cancelled else "Shipped"
        oid = f"111-{s.order:07d}-{(s.order * 7919) % 10_000_000:07d}"
        rows.append([
            oid, "", s.when.strftime("%Y-%m-%dT%H:%M:%S+00:00"), (s.when + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            status, "Amazon", "Amazon.com", s.product.name, s.product.sku, s.product.item_id,
            "Cancelled" if s.cancelled else "Shipped", str(s.qty), "USD", f"{s.price * s.qty:.2f}", "0.00", "0.00",
        ])
    return _csv(rows, delimiter="\t")


def shopify_orders(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "Name", "Email", "Financial Status", "Paid at", "Fulfillment Status", "Currency", "Subtotal", "Total",
        "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Vendor", "Cancelled at", "Source",
    ]
    rows = [header]
    by_order: dict[int, list[SimSale]] = {}
    for s in sales:
        by_order.setdefault(s.order, []).append(s)
    rng = random.Random("shopify")
    for order, lines in sorted(by_order.items(), reverse=True):
        first = lines[0]
        subtotal = sum(line.price * line.qty for line in lines)
        stamp = first.when.strftime("%Y-%m-%d %H:%M:%S +0000")
        cancelled = any(line.cancelled for line in lines)
        source = rng.choice(["web", "web", "web", "shop_app", "instagram"])
        for j, line in enumerate(lines):
            if j == 0:
                rows.append([
                    f"#{order}", f"customer{order}@example.com", "refunded" if cancelled else "paid", stamp,
                    "" if cancelled else "fulfilled", "USD", f"{subtotal:.2f}", f"{subtotal:.2f}", stamp,
                    str(line.qty), line.product.name, f"{line.price:.2f}", line.product.sku, "Iron & Oak",
                    stamp if cancelled else "", source,
                ])
            else:  # Shopify only fills order-level columns on an order's first row
                rows.append([f"#{order}", f"customer{order}@example.com", "", "", "", "", "", "", "",
                             str(line.qty), line.product.name, f"{line.price:.2f}", line.product.sku, "Iron & Oak", "", ""])
    return _csv(rows)


def shopify_products(store: SampleStore) -> str:
    header = ["Handle", "Title", "Vendor", "Type", "Variant SKU", "Variant Inventory Qty", "Variant Price", "Cost per item", "Status"]
    rows = [header]
    for p in store.products:
        rows.append([p.sku.lower(), p.name, "Iron & Oak", "Fitness", p.sku, str(p.stock), f"{p.price:.2f}", f"{p.cost:.2f}", "active"])
    return _csv(rows)


def etsy_order_items(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "Sale Date", "Item Name", "Buyer", "Quantity", "Price", "Coupon Code", "Discount Amount", "Order Shipping",
        "Item Total", "Currency", "Transaction ID", "Listing ID", "Date Paid", "Order ID", "SKU",
    ]
    rows = [header]
    rng = random.Random("etsy")
    for s in reversed(sales):
        if s.cancelled:
            continue
        rows.append([
            s.when.strftime("%m/%d/%y"), s.product.name, _buyer(rng), str(s.qty), f"{s.product.price:.2f}", "", "0",
            "4.50", f"{s.price * s.qty:.2f}", "USD", str(3_100_000_000 + s.order * 3), s.product.item_id,
            s.when.strftime("%m/%d/%y"), str(2_900_000_000 + s.order), s.product.sku,
        ])
    return _csv(rows)


def tiktok_orders(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "Order ID", "Order Status", "SKU ID", "Seller SKU", "Product Name", "Variation", "Quantity",
        "SKU Unit Original Price", "SKU Subtotal After Discount", "Created Time", "Paid Time",
    ]
    rows = [header]
    for s in reversed(sales):
        oid = str(576_000_000_000_000_000 + s.order * 1_234_567)
        stamp = s.when.strftime("%m/%d/%Y %I:%M:%S %p")
        rows.append([
            oid, "Canceled" if s.cancelled else "Completed", s.product.item_id, s.product.sku, s.product.name, "Default",
            str(s.qty), f"{s.product.price:.2f}", f"{s.price * s.qty:.2f}", stamp, stamp,
        ])
    return _csv(rows)


def spreadsheet_xlsx(store: SampleStore, sales: list[SimSale]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"
    ws.append(["My sales log (sample data)"])
    ws.append([])
    ws.append(["Date", "Product", "Qty", "Price"])
    for s in sales:
        if not s.cancelled:
            ws.append([s.when.replace(tzinfo=None), s.product.name, s.qty, s.price])
    st = wb.create_sheet("Stock")
    st.append(["Product", "SKU", "In stock", "Cost", "Price", "Supplier", "Supplier days"])
    for i, p in enumerate(store.products):
        st.append([p.name, p.sku, p.stock, p.cost, p.price, supplier_for(store.key, i), p.lead_days])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build(key: str, now: datetime | None = None) -> tuple[str, bytes]:
    """Return (filename, file bytes) for a sample store."""
    if key == "shopify-products":
        return "shopify-products-sample.csv", shopify_products(STORES["shopify"]).encode()
    store = STORES[key]
    sales = simulate(store, now=now)
    if key == "ebay":
        return store.filename, ebay_orders(store, sales).encode()
    if key == "amazon":
        return store.filename, amazon_orders(store, sales).encode()
    if key == "shopify":
        return store.filename, shopify_orders(store, sales).encode()
    if key == "etsy":
        return store.filename, etsy_order_items(store, sales).encode()
    if key == "tiktok":
        return store.filename, tiktok_orders(store, sales).encode()
    if key == "spreadsheet":
        return store.filename, spreadsheet_xlsx(store, sales)
    raise KeyError(key)


# Made-up suppliers for the sample stock lists, so supplier orders have something to group by.
SUPPLIERS = {
    "ebay": ["Shenzhen RetroTech", "GameParts Wholesale"],
    "amazon": ["Yiwu KitchenPro", "HomeChef Supply"],
    "etsy": ["Silver Lane Findings", "Gemstone Direct"],
    "tiktok": ["GlowSource Beauty", "Guangzhou SkinTech"],
    "spreadsheet": ["EcoPet Supply", "Green Paws Trading"],
}


def supplier_for(key: str, i: int) -> str:
    names = SUPPLIERS.get(key, [""])
    return names[i % len(names)]


def stock_csv(key: str) -> tuple[str, bytes]:
    """A simple stock list for any sample store (sellers can also type stock in the app)."""
    store = STORES[key]
    rows = [["SKU", "Product", "Stock", "Cost", "Price", "Supplier", "Supplier days"]]
    for i, p in enumerate(store.products):
        sku = p.sku or ("EBAY-" + p.item_id if store.platform == "ebay" and p.item_id else "")
        rows.append([sku, p.name, str(p.stock), f"{p.cost:.2f}", f"{p.price:.2f}", supplier_for(key, i), str(p.lead_days)])
    return f"{key}-stock-sample.csv", _csv(rows).encode()
