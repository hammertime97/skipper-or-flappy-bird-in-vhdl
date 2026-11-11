# Apple App Store: steps, listing text and form answers

The iPhone version is the same app. Every build in GitHub Actions compiles it for the iPhone simulator, installs it and opens it (job "ios"), so the code is ready. What's left needs your Apple account. Words in [brackets] are yours to fill in.

## What you need

- **Apple Developer Program**: $99 a year, at developer.apple.com/programs. Sign up as an individual (your name shows as the seller) or as a company (needs a D-U-N-S number, which is free but takes a few days).
- **A Mac is not needed.** Expo's build service (EAS) builds and signs the app in the cloud.

## Steps

1. **Check the app ID is free.** App IDs are unique across the whole App Store. If `com.stockpilot.app` is taken when you create the app in step 2, pick your own (for example `com.[yourname].stockpilot`) and change `ios.bundleIdentifier` in `stockpilot/mobile/app.json`. Google Play package names are unique too: change `android.package` the same way if Play Console says it's taken.
2. **App Store Connect → Apps → + → New App**: platform iOS, name "StockPilot: Reorder & Forecast" (or another free name), language English, bundle ID from step 1, SKU `stockpilot`.
3. **Subscriptions** (App Store Connect → your app → Monetization → Subscriptions): create a group "StockPilot Pro" with two subscriptions, `stockpilot_pro_monthly` and `stockpilot_pro_yearly`, at the same prices as on Android ($12.99 a month and $99.99 a year are suggested), each with a 1-week free trial as an introductory offer.
4. **RevenueCat**: add an App Store app to your RevenueCat project, attach both subscriptions to the entitlement `pro` and the current offering (next to the Google Play ones), and copy the **Apple public SDK key**.
5. **Build**, from `stockpilot/mobile` on any computer with Node installed:
   ```
   npm install -g eas-cli
   eas login
   EXPO_PUBLIC_REVENUECAT_IOS_KEY=[your Apple SDK key] EXPO_PUBLIC_PRIVACY_URL=[your privacy policy link] eas build --platform ios --profile production
   ```
   EAS asks to sign in to your Apple account and makes the certificates for you.
6. **Upload**: `eas submit --platform ios` sends the build to App Store Connect.
7. **Test on your own iPhone with TestFlight** (App Store Connect → TestFlight). Buy Pro with a sandbox tester account to check payments.
8. Fill in the listing below, add screenshots, and **Submit for Review**. Apple usually answers within a day or two.

## Listing text

**Name** (30 characters max): StockPilot: Reorder & Forecast

**Subtitle** (30 max): Stock forecasts for sellers

**Promotional text** (170 max): Know what to reorder and when. Ask why sales dropped, find where profit leaks, and get a Monday digest. For eBay, Amazon, Shopify, Etsy & TikTok Shop sellers.

**Keywords** (100 max, commas, no spaces): inventory,reorder,stock,forecast,ebay,shopify,etsy,amazon,seller,dropshipping,profit,tiktok shop

**Description**: use the full description from `play-store-listing.md` as it is.

**Category**: Business (secondary: Productivity)

**Support URL**: a page with your contact email (a free Google Site works). **Privacy policy URL**: the same page as for Google Play.

**Screenshots**: iPhone 6.9-inch display (1320 × 2868) is required. Take them on an iPhone 15/16 Pro Max, or on the simulator, with the big demo store loaded: Home, Ask StockPilot, Profit leaks, Supplier orders, Forecast.

## App Privacy ("nutrition label")

- **Data collection**: Yes, only because of subscriptions (RevenueCat):
  - **Purchases → Purchase History**: used for App Functionality, not linked to identity, not used for tracking.
  - **Identifiers → User ID** (RevenueCat's anonymous app user ID): App Functionality, not linked to identity, not used for tracking.
  - Check RevenueCat's App Privacy guidance for anything else it lists.
- Sales, stock and store data: **not collected**. It stays on the phone.
- **Tracking**: No. The app has no ads and no analytics.

## App Review notes (paste into "Notes")

> StockPilot needs no account. On first open, tap "Just look around with a demo store" to load sample data, or "Try a big demo store" for 554 products. Everything runs on the device. Pro is an auto-renewing subscription (monthly or yearly) bought in the app; Restore purchase is on the same screen. Notifications are local (scheduled on the device) and optional.

## Age rating

Answer **None** to every question. Expected rating: **4+**.

## Already done in the app

- App icon, launch screen, and no unneeded permissions.
- Paywall shows price, period, auto-renewal terms, Restore purchase, and links to the Terms of Use (Apple's standard licence) and your privacy policy (`EXPO_PUBLIC_PRIVACY_URL`).
- "Uses non-exempt encryption: No" is set, so no export-compliance questions.
- Apple's privacy manifest (required-reason APIs) is declared in `app.json`.
