# Google Play: listing text and form answers

Copy these into Play Console. Words in [brackets] are yours to fill in.

## Main store listing

**App name** (30 characters max)
StockPilot: Reorder & Forecast

**Short description** (80 characters max)
Know what to reorder and when. Forecasts for eBay, Amazon & Shopify sellers.

**Full description**

Stop guessing what to reorder. StockPilot reads your sales from eBay, Amazon, Shopify, Etsy, TikTok Shop or your own spreadsheet. It then tells you what will sell next week, what to reorder and the last day to order it.

No account. No setup. Your data stays on your phone.

HOW IT WORKS
1. Download your orders file from eBay, Amazon, Shopify, Etsy or TikTok Shop. StockPilot shows you exactly where to tap.
2. Pick the file in StockPilot. It works out the columns by itself and shows what it found before saving anything.
3. Get your plan: forecasts, reorder dates and supplier orders, in plain English.

WHAT YOU GET
• Ask StockPilot: "Why did sales drop this week?" "How many water bottles did I sell in October?" "What if I raise the price by 10%?" Answers from your own numbers in seconds, with how it worked them out
• Profit leak finder: where money quietly slips away (prices below cost after fees, thin margins, discounts left on, missed sales from sell-outs, cash stuck in stock), each with the fix
• Smart alerts: what needs you today, plus a Monday digest and a reminder on the day each supplier order is due
• Weekly sales forecast for every product, checked against your own sales history, with how accurate it is
• Reorder dates: "Order 54 by Friday" so you never sell out, and never over-order
• Supplier orders: everything to reorder, grouped by supplier, with the message written. Send it by WhatsApp or email in one tap
• This week's plan: what to restock, what to push, what to clear, and how to get ready for Black Friday and Christmas
• Profit after fees: eBay, Amazon, Etsy, TikTok and Shopify fees taken off automatically
• Profit & ads calculator: what one sale really earns, and the most you can spend on ads
• Trending products: what's selling now in your niche, updated every few weeks
• Product Check: the margin, trend and red flags for a product before you buy stock
• Listing drafts for eBay, Amazon, Etsy, Shopify and TikTok Shop
• Works offline; handles stores with hundreds of products

STOCKPILOT PRO
• Track up to 600 products (Free: 200)
• Every profit leak with its fix (Free: the top 3)
• Your money makers: which products earn your profit, and which lose money
• Bought together: bundle ideas from your own orders
• Export orders, forecasts and stock to a spreadsheet

PRIVATE BY DESIGN
Your sales data never leaves your phone. No ads, no tracking.

Questions or ideas? [your contact email]

**Category:** Business
**Tags (pick up to 5):** Inventory, Ecommerce, Business tools, Productivity, Finance
**Contact email:** [your contact email]
**Privacy policy URL:** publish `privacy-policy.md` on a web page and paste its address. A free Google Site works.

**Screenshots** (at least 2, phone, 1080×1920 or similar): take them on your phone with the big demo store loaded (Account → Load big demo store). Show these screens: Home (with "Needs your attention"), Ask StockPilot answering "Why did sales drop this week?", Profit leaks, Supplier orders, Forecast, Pro comparison.
**Feature graphic** (1024×500): the blue app icon on the left, with "Know what to reorder and when" on the right.

## Data safety form

- **Does your app collect or share any of the required user data types?** Yes, because of subscriptions (RevenueCat). If you launch without subscriptions, the answer is No.
  - Collected: **Purchase history** (for app functionality: checking whether the user has Pro). Not shared. Processed through RevenueCat.
  - Check RevenueCat's own Data safety guidance and add anything it lists for its SDK (for example an app-generated user ID).
- **Is all user data encrypted in transit?** Yes (HTTPS).
- **Do you provide a way for users to request that their data is deleted?** Yes: Account → Delete everything on this phone, or uninstall the app.
- Sales and stock data: **not collected**. It stays on the device and is never sent to you.
- Notifications are scheduled on the phone itself (no push server), so they collect nothing.

## Content rating questionnaire

Category: **Utility, productivity, communication or other**. Answer **No** to violence, sexuality, language, controlled substances, gambling and user-generated content shared with others. Expected rating: **Everyone**.

## Target audience

18 and over (a business tool). Not designed for children.

## Subscriptions (Monetize → Products → Subscriptions)

- Product ID: `stockpilot_pro`, with two base plans:
  - `monthly`: auto-renewing, 1 month
  - `yearly`: auto-renewing, 1 year
- Suggested prices: **$12.99 a month** and **$99.99 a year** (about 2 months free).
- Add a **7-day free trial** offer to both. Trials are the easiest way to turn Free users into Pro.
- In RevenueCat, attach both to the entitlement **`pro`** and put them in the **current** offering. The app shows whatever prices Google Play returns, in the buyer's currency.

## Web demo for outreach

Every build also publishes a browser demo of the full app with the 554-product sample store: https://hammertime97.github.io/skipper-or-flappy-bird-in-vhdl/ (works on any phone or computer, nothing to install). Turn it on once: GitHub → the repository → Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: **gh-pages**, folder **/ (root)** → Save. Once the app is on Google Play, set the repository variable `STOCKPILOT_GET_APP_URL` (Settings → Secrets and variables → Actions → Variables) to its Play Store link, so the demo's "Get the app" button goes there.

## Before you press Publish

- Build with your RevenueCat key (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`). Without it the app shows a Free/Pro test switch instead of real payments.
- Use a Play Store build (an `.aab` from EAS), not the test APK.
- Test a purchase with a licence-tester account on the internal testing track.
