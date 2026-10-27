# StockPilot

An AI co-pilot for e-commerce and dropshipping sellers, built as an Android app for Google Play with a Pro subscription.

| Dashboard | Weekly forecast | Product + stock plan | AI Weekly Plan |
|---|---|---|---|
| ![](docs/screenshots/dashboard.png) | ![](docs/screenshots/forecast.png) | ![](docs/screenshots/product.png) | ![](docs/screenshots/weekly-plan.png) |

*(Screenshots use the built-in demo store. The Weekly Plan text in the last one is a hand-written sample, because no AI key was available when the screenshots were taken.)*

## What it does

**1. Bring in sales from anywhere, without technical knowledge**
- Sellers pick where they sell (eBay, Amazon, Shopify, Etsy, TikTok Shop, or their own Excel/Google sheet) and get numbered, one-line steps showing where to click to download their file.
- Upload CSV, Amazon's tab-separated .txt, or Excel (every tab is read, so one workbook can hold both sales and stock).
- The app recognises the platform from the column names and works out which column is which. If a sheet is unfamiliar, Claude reads the column names; if that still isn't enough, the seller picks columns from plain questions ("Which column is the quantity sold?").
- Before anything is saved, it shows what it read in plain words ("We found 2,236 items sold across 7 products from 28 Apr to 26 Oct in your eBay file. 62 cancelled orders will be left out.").
- Cancelled and refunded orders are left out. Uploading the same file again doesn't double-count.
- Sales files don't contain stock, so afterwards the app asks for stock counts and cost per item on one simple screen.
- **Dummy files** for every platform live in [`docs/sample-data`](docs/sample-data); the app also has "Try a sample file" buttons.

**2. Inventory dashboard (no AI needed)**
- Revenue, **profit after selling fees**, orders and units for 7 and 30 days, with change vs the period before.
- Fees per platform start from typical rates and can be edited.
- Daily revenue chart, revenue by channel, stock value, and out-of-stock, running-low and not-selling lists. A to-do card appears when stock counts or costs are missing.

**3. Weekly demand forecast**
- For each product, several proven forecasting methods are fitted: smoothed average, damped trend, Theta, and "same weeks last year" when there's more than a year of history. Slow sellers use methods made for lumpy demand (Croston, TSB).
- Each method is **tested on that product's own past weeks**. The best three are blended, weighted by accuracy, and the seller sees the accuracy score and which methods were used.
- The likely range accounts for normal sales randomness. In testing, the real figure landed inside the range about 77% of the time (it aims for 80%).
- A sold-out week isn't treated as "no demand", so best sellers aren't under-forecast.
- Stock plan per product: run-out date, reorder now or not, and how many units to order (supplier lead time + 2 weeks + safety stock, minus stock already on order).
- **Restock budget**: the cash needed for the suggested orders.
- **Shopping calendar**: Black Friday, Christmas, Mother's Day and so on, worked out for each year.

How accurate is it? On 200+ simulated products, the forecasts were about 70% accurate week to week. That is close to the limit, because a lot of week-to-week variation in small-shop sales is pure chance. The blend's advantages are reliability across very different products, honest ranges, use of last year, and telling the seller how much to trust each number.

**4. Works without AI, for everyone**

Every screen works instantly with no AI request, on every plan. AI adds a second opinion where it helps.

| Feature | What the seller gets |
|---|---|
| **Weekly Plan** | A prioritised to-do list from the numbers: what to reorder and the **last day to order** so stock arrives before it runs out, what to push, what to clear (with a bundle partner), and which big shopping event to prepare for. |
| **Your money makers** | 80/20 view: the few products that make most of the profit (after cost and fees), and any product that loses money. |
| **Bought together** | Pairs of products customers buy in the same order, more often than chance. Use them for bundles and cross-selling. |
| **Profit & ads calculator** | Profit per sale after product cost, shipping and the platform's fee; the most you can spend on ads per sale; break-even ROAS; and the price for a 30% margin. |
| **Trends library** | Researched trending products for 9 niches (pets, kitchen, beauty, fitness, tech, jewelry, home decor, baby, car & outdoor) with momentum, competition, what the data shows, what to search for on supplier sites, and a source link. The seller's niche is matched automatically. "Add to my store" works here too. |

The trends library was researched on 27 Oct 2026 (`backend/app/trend_library.py`) and needs refreshing every month or two. Sales figures in it come from third-party trackers, which estimate, so the app presents them as signals to check.

**5. AI features (Claude)**

AI runs on StockPilot's own servers with StockPilot's API key, so sellers never need a Claude account.

| Feature | What the seller gets |
|---|---|
| **Weekly Plan: AI second opinion** | Claude searches the web for upcoming events, news and viral moments around the seller's products. It suggests bounded forecast adjustments (each with a reason and a source), then writes a prioritised to-do list: what to reorder and how many, what to promote, what to clear. The statistical forecast is always shown next to the adjusted one. |
| **Trends tab: live Trend Scout** | For the seller's exact niche, searches TikTok Shop, Amazon best-sellers, Google Trends and competitor stores for the seller's niche. Recommends 4–8 products with evidence, momentum, competition, prices, what to search for on supplier sites, and sources. **"Add to my store"** saves a product to an ideas list; "Start selling" moves it into the inventory. |
| **Product Check** | "Should I sell this?" Returns go / test small / skip, with demand, competition and margin scores, red flags and a cheap test plan. |
| **Ask StockPilot** | A chat that answers questions by looking up the seller's live data. |
| **Listing Writer** | Title, bullets, description, keywords and hashtags for Shopify, TikTok Shop, Amazon, eBay, Etsy or WooCommerce. |

**Models:**
- **Research and planning** (Weekly Plan, Trend Scout, Product Check) use `claude-fable-5-1`, Anthropic's most capable model. Set it with `CLAUDE_RESEARCH_MODEL`.
- **Everyday work** (chat, listings, reading spreadsheets) uses `claude-opus-5-5`. Set it with `CLAUDE_MODEL`.
- The research model costs about 2.5× as much per token, so check that the Pro AI cap fits the subscription price.
- All requests turn on Anthropic's server-side fallback (`fallbacks: "default"`), so a request a safety filter declines is retried on another model.

**Free vs Pro**
- Free: dashboard, stock, import, the weekly to-do plan, money makers, bundles, calculator and trends library; forecasts for the top 10 products (also enforced on product pages); 3 AI requests a month.
- Pro: forecasts for every product and up to 400 AI requests a month.
- Set the free limits with `FREE_AI_CALLS_PER_MONTH` and `FREE_FORECAST_PRODUCTS`. The Pro cap is `PRO_AI_CALLS_PER_MONTH` in `backend/app/billing.py`.

## How it's built

```
stockpilot/
├── backend/   Python FastAPI API
│   ├── app/importer.py         reads platform files; app/services_import.py saves them
│   ├── app/samples.py          dummy store generator (same layouts as real downloads)
│   ├── app/guides.py           step-by-step download instructions per platform
│   ├── app/forecasting.py      tested forecast blend, stock planning, shopping calendar
│   ├── app/fees.py             selling fees per channel
│   ├── app/insights.py         money makers (80/20), bought together, weekly to-do plan, profit calculator
│   ├── app/trend_library.py    researched trending products per niche (no AI)
│   ├── app/ai/                 weekly_brief, trend_scout, product_check, assistant, listing, column_mapper
│   └── tests/                  52 tests (importer on every sample file, forecasting, API, AI flows with Claude faked)
├── mobile/    Expo / React Native app (Android), Expo Router
├── preview/   self-contained web preview: the same importer and forecasting ported to JavaScript
└── docs/      screenshots, sample (dummy) files
```

**The web preview** (`preview/`) runs the import, dashboard, forecasting, insights and trends library entirely in the browser, with no account and no AI needed. Its optional "Check with AI" buttons work when the page is opened inside Claude. It reuses the backend's tables, and `parity-check.js` confirms `engine.js` gives the same results as the Python code on every sample file and on the money makers, bundles and calculator:
```bash
python preview/build_preview.py && (cd preview && npm i xlsx@0.18.5 && node parity-check.js)
```

**Subscriptions** use Google Play Billing through RevenueCat. RevenueCat's webhook tells the backend when Pro starts or ends, so the server decides who has Pro.

## Run it locally

**Backend**
```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # fill in ANTHROPIC_API_KEY and JWT_SECRET
set -a && . ./.env && set +a
uvicorn app.main:app --reload --port 8000
pytest                 # 52 tests, no API key needed
```

**App**
```bash
cd mobile
cp .env.example .env.local     # EXPO_PUBLIC_API_URL=http://10.0.2.2:8000 for the Android emulator
npm install
npx expo start
```
Sign up, tap **Import my sales**, pick a platform and **Try a sample file**.

## Launching on Google Play: checklist

1. **Deploy the backend** to any host that runs Docker (Railway, Render, Fly.io, Cloud Run…) using `backend/Dockerfile`. Set:
   - `ANTHROPIC_API_KEY`
   - `JWT_SECRET`: a long random string
   - `DATABASE_URL`: Postgres (also add `psycopg[binary]` to `requirements.txt`)
   - `REVENUECAT_WEBHOOK_SECRET`
   - `CLAUDE_MODEL` / `CLAUDE_RESEARCH_MODEL`: optional
2. **Google Play Console** ($25 one-time): create the app (package `com.stockpilot.app`, or change it in `mobile/app.json`), then create a subscription under *Monetize → Subscriptions*.
3. **RevenueCat**: connect the Play app, create an entitlement named **`pro`**, attach the subscription products, and put them in the current offering. Point the webhook to `https://YOUR-API/billing/revenuecat-webhook` with your secret as the Authorization header.
4. **Build:** set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, then run `npx eas-cli@latest build --platform android --profile production` and `npx eas-cli@latest submit --platform android --profile production`.
5. **Store listing:** privacy policy URL (required), the Data safety form, screenshots and content rating. Test purchases with a licence-tester account on the internal track.

## Worth knowing
- **Download steps:** the platform steps were written from each platform's help pages and are kept short. Platforms move menus around, so check them against your own seller accounts before launch.
- **Column names:** the importer matches many name variants, with AI and the seller's own choice as fallbacks. TikTok Shop's and WooCommerce's exact export headers couldn't be confirmed from public documentation, so test those two with a real export.
- **Fees:** the default fee rates are typical published rates and differ by category, country and plan. Sellers can edit them.

## What to build next
- Direct Shopify / eBay / Amazon / TikTok Shop connections (OAuth), so sellers don't have to download files at all
- A Monday push notification: "Your plan is ready: 2 products need reordering"
- Automatic weekly Trend Scout runs for Pro users, with alerts when a new product starts trending
- Supplier management and purchase-order drafts
- Ad-spend import, so profit includes marketing cost
