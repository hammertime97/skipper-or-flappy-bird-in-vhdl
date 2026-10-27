"""Step-by-step help for getting a sales file out of each platform.

Written for people who have never exported a report. Menu names move around and
differ a little by country, so each guide ends with a fallback tip. The app shows
these as numbered steps with one short line each.
"""

GUIDES: list[dict] = [
    {
        "key": "ebay",
        "name": "eBay",
        "file_hint": "A .csv file called something like eBay-OrdersReport.csv",
        "what": "Your orders from the last few months.",
        "steps": [
            "Open eBay on a computer and sign in. Go to Seller Hub (top of the page, under My eBay).",
            "Click Orders, then All orders.",
            "Pick a period at the top. Choose the longest one offered (for example Last 90 days).",
            "Click Download report. If asked, choose All orders and click Download.",
            "The file goes to your Downloads folder. Upload it here.",
        ],
        "stock_tip": "For stock: Seller Hub > Listings > Active > Download report. Upload that file too.",
        "tip": "Upload a new report every week or two. We skip orders you've already uploaded.",
    },
    {
        "key": "amazon",
        "name": "Amazon",
        "file_hint": "A .txt file (that's normal, upload it as it is)",
        "what": "Your orders report.",
        "steps": [
            "Sign in to Seller Central on a computer.",
            "Open the menu and go to Reports, then Fulfillment.",
            "Under Sales on the left, click All Orders.",
            "Choose a date range (the last 3 to 6 months is ideal) and click Request .txt Download.",
            "Wait a minute, then click Download when it appears. Upload that file here.",
        ],
        "stock_tip": "For stock: Reports > Fulfillment > Inventory > Manage FBA Inventory, then Request download.",
        "tip": "Don't open and re-save the .txt file in Excel first; upload it exactly as Amazon gives it.",
    },
    {
        "key": "shopify",
        "name": "Shopify",
        "file_hint": "A .csv file (big exports arrive by email)",
        "what": "Your orders export, and your products export for stock.",
        "steps": [
            "Open your Shopify admin and click Orders.",
            "Click Export (top right).",
            "Choose All orders (or a date range of a few months) and Plain CSV file.",
            "Click Export orders. Small exports download straight away; bigger ones are emailed to you.",
            "Upload the file here.",
        ],
        "stock_tip": "For stock and costs: Products > Export > All products > Export products. Upload that too.",
        "tip": "The products export includes Cost per item, which lets us show your real profit.",
    },
    {
        "key": "etsy",
        "name": "Etsy",
        "file_hint": "A .csv file called something like EtsySoldOrderItems2026.csv",
        "what": "Your order items (one row per item sold).",
        "steps": [
            "Open Shop Manager on a computer.",
            "Go to Settings, then Options, then the Download Data tab.",
            "Under Orders, choose Order Items (not just Orders).",
            "Pick the month and year, or a full year, and click Download CSV.",
            "Upload the file here. Repeat for earlier months to give us more history.",
        ],
        "stock_tip": "Etsy doesn't export stock in this file. Type your stock in the app, or upload a stock list.",
        "tip": "Choose Order Items, not Orders. The Order Items file has the product names we need.",
    },
    {
        "key": "tiktok",
        "name": "TikTok Shop",
        "file_hint": "A .csv or .xlsx file",
        "what": "Your orders export.",
        "steps": [
            "Open TikTok Shop Seller Center on a computer.",
            "Go to Orders, then Manage orders.",
            "Pick a date range (the last 3 months or more).",
            "Click Export and choose all orders in that range. When it's ready, click Download.",
            "Upload the file here.",
        ],
        "stock_tip": "For stock: Products > Manage products > Export. Upload that file too.",
        "tip": "If Excel shows long order numbers as 5.76E+17, don't worry. Upload the original file.",
    },
    {
        "key": "spreadsheet",
        "name": "My own spreadsheet or another platform",
        "file_hint": "Excel (.xlsx) or CSV",
        "what": "Any sheet with a date, a product name and a quantity on each row.",
        "steps": [
            "Make sure the top row has headings, for example: Date | Product | Quantity | Price.",
            "One row per sale (or per product per day). Extra columns are fine; we ignore what we don't need.",
            "Stock can go on a second tab with: Product | Stock | Cost | Price.",
            "Save it as .xlsx or .csv (in Google Sheets: File > Download > .xlsx).",
            "Upload it here. We'll show you what we read before anything is saved.",
        ],
        "stock_tip": "No stock list? You can type stock for each product in the app after uploading sales.",
        "tip": "WooCommerce, Wix, Squarespace, BigCommerce and most other shops can export orders as CSV.",
    },
]
