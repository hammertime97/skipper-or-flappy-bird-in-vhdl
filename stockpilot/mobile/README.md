# StockPilot mobile app

Expo (SDK 58) + Expo Router app for Android (Google Play). See `../README.md` for the full setup and launch guide.

```bash
cp .env.example .env.local   # set EXPO_PUBLIC_API_URL and the RevenueCat key
npm install
npx expo start               # Expo Go works for everything except subscriptions
npm run typecheck && npx expo lint
```

In-app purchases need a development build (`npx eas-cli@latest build --profile development --platform android`),
because `react-native-purchases` contains native code that Expo Go doesn't include.
