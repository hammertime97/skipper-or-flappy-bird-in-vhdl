import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { Bullets, Button, Card, ErrorBox, Loading, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { buy, getPackages, purchasesAvailable, restore } from '@/lib/purchases';

const PERIOD: Record<string, string> = { P1W: 'week', P1M: 'month', P3M: '3 months', P6M: '6 months', P1Y: 'year' };

export default function Paywall() {
  const { user, refreshUser, local, setLocalPlan } = useAuth();
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
      if (await buy(pkg)) await waitForServer();
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
      if (await restore()) await waitForServer();
      else setError(new Error('No active subscription found for this Google account.'));
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
        <T kind="secondary">Forecast every product, get your AI plan every week, and spot trends before your competitors.</T>
      </View>

      {plans ? (
        <Card style={{ gap: Spacing.sm }}>
          <T kind="heading">{plans.pro.name}</T>
          <Bullets items={plans.pro.features} />
          <T kind="muted">Free plan: {plans.free.features.join(' · ')}</T>
        </Card>
      ) : null}

      {local ? (
        <Card style={{ gap: Spacing.sm }}>
          <T style={{ fontWeight: '700' }}>Test build</T>
          <T kind="secondary">
            Payments aren&apos;t connected in this test version. Switch between Free and Pro to see what each plan includes.
          </T>
          <Button title={isPro ? 'Switch back to Free' : 'Try Pro on this phone'} onPress={() => setLocalPlan(isPro ? 'free' : 'pro').then(() => router.back())} />
        </Card>
      ) : isPro ? (
        <Button
          title="Manage in Google Play"
          kind="secondary"
          onPress={() => Linking.openURL('https://play.google.com/store/account/subscriptions')}
        />
      ) : !purchasesAvailable() ? (
        <Card>
          <T kind="secondary">Subscriptions are available in the Android app from Google Play.</T>
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
            Billed through Google Play. Cancel anytime in Play Store → Payments & subscriptions. The subscription renews automatically
            until cancelled.
          </T>
        </View>
      )}
      {waiting ? <T kind="secondary">Activating Pro…</T> : null}
      {error ? <ErrorBox error={error} /> : null}
    </Screen>
  );
}
