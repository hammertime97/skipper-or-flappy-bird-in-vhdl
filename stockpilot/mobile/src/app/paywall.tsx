import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { Bullets, Button, Card, ErrorBox, Loading, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { buy, getPackages, purchasesAvailable, restore, STORE } from '@/lib/purchases';
import { FREE_PRODUCTS, PRO_PRODUCTS } from '@/local/api';

const PRIVACY_URL = (process.env.EXPO_PUBLIC_PRIVACY_URL ?? '').trim();
// Apple's standard licence agreement, unless the store listing names your own terms.
const TERMS_URL = (process.env.EXPO_PUBLIC_TERMS_URL ?? '').trim() || 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PERIOD: Record<string, string> = { P1W: 'week', P1M: 'month', P3M: '3 months', P6M: '6 months', P1Y: 'year' };

export default function Paywall() {
  const { user, refreshUser, local, setLocalPlan } = useAuth();
  const c = useTheme();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [waiting, setWaiting] = useState(false);
  const isPro = user?.billing.plan === 'pro';
  const plans = user?.billing.plans;

  useEffect(() => {
    getPackages()
      .then(setPackages)
      .catch((e) => {
        setError(e);
        setPackages([]);
      });
  }, []);

  // The server learns about a purchase from RevenueCat's webhook, a few seconds later.
  const waitForServer = async () => {
    setWaiting(true);
    try {
      for (let i = 0; i < 15; i++) {
        if ((await api.billing()).plan === 'pro') {
          await refreshUser();
          router.back();
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setError(new Error('Payment received. Pro will switch on within a few minutes; pull to refresh later.'));
    } finally {
      setWaiting(false);
    }
  };

  const purchase = async (pkg: PurchasesPackage) => {
    setBusy(pkg.identifier);
    setError(null);
    try {
      if (await buy(pkg)) {
        if (local) {
          await setLocalPlan('pro');
          router.back();
        } else await waitForServer();
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    setBusy('restore');
    setError(null);
    try {
      if (await restore()) {
        if (local) {
          await setLocalPlan('pro');
          router.back();
        } else await waitForServer();
      } else setError(new Error(`No active subscription found for this ${STORE.account}.`));
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={[]}>
      <View style={{ gap: Spacing.xs }}>
        <T kind="title">{isPro ? 'You’re on Pro' : 'Sell smarter with Pro'}</T>
        <T kind="secondary">
          {SERVER_ENABLED
            ? 'Forecast every product, get your AI plan every week, and spot trends before your competitors.'
            : 'Track 3 times as many products, see which ones make your money, find bundles, and export to spreadsheets.'}
        </T>
      </View>

      {SERVER_ENABLED && !local && plans ? (
        <Card style={{ gap: Spacing.sm }}>
          <T kind="heading">{plans.pro.name}</T>
          <Bullets items={plans.pro.features} />
          <T kind="muted">Free plan: {plans.free.features.join(' · ')}</T>
        </Card>
      ) : (
        <Compare free={FREE_PRODUCTS} pro={PRO_PRODUCTS} />
      )}

      {local && !purchasesAvailable() ? (
        <Card style={{ gap: Spacing.sm }}>
          <T style={{ fontWeight: '700' }}>{Platform.OS === 'web' ? 'Demo' : 'Test build'}</T>
          <T kind="secondary">
            {Platform.OS === 'web' ? 'This is the web demo.' : 'Payments aren’t connected in this test version.'} Switch between Free and Pro to see what each plan
            includes.
          </T>
          <Button
            title={isPro ? 'Switch back to Free' : Platform.OS === 'web' ? 'Try Pro here' : 'Try Pro on this phone'}
            onPress={() => setLocalPlan(isPro ? 'free' : 'pro').then(() => router.back())}
          />
        </Card>
      ) : isPro ? (
        <Button title={`Manage in ${STORE.name}`} kind="secondary" onPress={() => Linking.openURL(STORE.manage)} />
      ) : !purchasesAvailable() ? (
        <Card>
          <T kind="secondary">Subscriptions are available in the StockPilot app for Android and iPhone.</T>
        </Card>
      ) : packages === null ? (
        <Loading />
      ) : (
        <View style={{ gap: Spacing.sm }}>
          {packages.map((pkg) => {
            const period = pkg.product.subscriptionPeriod ? PERIOD[pkg.product.subscriptionPeriod] ?? '' : '';
            return (
              <Button
                key={pkg.identifier}
                title={`${pkg.product.priceString}${period ? ` / ${period}` : ''} · ${pkg.product.title.replace(/\s*\(.*\)$/, '')}`}
                onPress={() => purchase(pkg)}
                loading={busy === pkg.identifier}
                disabled={!!busy || waiting}
              />
            );
          })}
          {packages.length === 0 && !error ? <T kind="secondary">No plans available right now. Try again later.</T> : null}
          <Button title="Restore purchase" kind="secondary" onPress={doRestore} loading={busy === 'restore'} disabled={!!busy || waiting} />
          <T kind="muted">
            Billed through {STORE.name}. The subscription renews automatically at the price shown until you cancel, at least 24 hours before the
            end of the period. Cancel anytime in {STORE.where}.
          </T>
          <Row style={{ flexWrap: 'wrap' }}>
            {PRIVACY_URL ? <T style={{ color: c.tint }} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy policy</T> : null}
            <T style={{ color: c.tint }} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms of use
            </T>
          </Row>
        </View>
      )}
      {waiting ? <T kind="secondary">Activating Pro…</T> : null}
      {error ? <ErrorBox error={error} /> : null}
    </Screen>
  );
}

/** Free vs Pro, side by side. */
function Compare({ free, pro }: { free: number; pro: number }) {
  const c = useTheme();
  const rows: [string, string, string][] = [
    ['Products tracked: forecasts, reorder dates, weekly plan, supplier orders', `${free}`, `${pro}`],
    ['Your money makers (profit and losing products)', '–', '✓'],
    ['Profit leak finder', 'Top 3', 'All'],
    ['Bought together (bundle ideas)', '–', '✓'],
    ['Export orders, forecasts and stock to a spreadsheet', '–', '✓'],
    ['Imports from eBay, Amazon, Shopify, Etsy, TikTok Shop and Excel', '✓', '✓'],
    ['Ask StockPilot, smart alerts, Monday digest', '✓', '✓'],
    ['Dashboard, trends, calculator, product check, listing drafts', '✓', '✓'],
  ];
  return (
    <Card style={{ gap: Spacing.sm }}>
      <Row>
        <T kind="label" style={{ flex: 1 }}>
          {' '}
        </T>
        <T kind="label" style={{ width: 52, textAlign: 'center' }}>
          Free
        </T>
        <T kind="label" style={{ width: 52, textAlign: 'center', color: c.tint }}>
          Pro
        </T>
      </Row>
      {rows.map(([what, f, p]) => (
        <Row key={what} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: Spacing.sm }}>
          <T style={{ flex: 1 }}>{what}</T>
          <T style={{ width: 52, textAlign: 'center' }}>{f}</T>
          <T style={{ width: 52, textAlign: 'center', fontWeight: '700', color: c.tint }}>{p}</T>
        </Row>
      ))}
    </Card>
  );
}
