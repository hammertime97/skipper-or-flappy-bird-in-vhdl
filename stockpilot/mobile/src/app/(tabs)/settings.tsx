import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Badge, Button, Card, ErrorBox, Input, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function SettingsScreen() {
  const { user, setUser, signOut, refreshUser } = useAuth();
  const [form, setForm] = useState({
    store_name: user?.store_name ?? '',
    niche: user?.niche ?? '',
    target_market: user?.target_market ?? '',
    currency: user?.currency ?? 'USD',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setUser(await api.updateMe({ ...form, currency: form.currency.trim().toUpperCase() }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const loadDemo = () =>
    Alert.alert('Load demo store?', 'This replaces all products and sales in this account with a demo pet-supplies store.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Replace my data',
        style: 'destructive',
        onPress: async () => {
          await api.seedDemo();
          await refreshUser();
          router.navigate('/');
        },
      },
    ]);

  const b = user?.billing;
  return (
    <Screen>
      <T kind="title">Settings</T>

      <Card style={{ gap: Spacing.md }}>
        <T kind="heading">Your store</T>
        <Input label="Store name" value={form.store_name} onChangeText={(v) => setForm({ ...form, store_name: v })} />
        <Input
          label="Niche (used by Trend Scout)"
          value={form.niche}
          onChangeText={(v) => setForm({ ...form, niche: v })}
          placeholder="e.g. pet accessories, home gym, phone cases"
        />
        <Input
          label="Main market"
          value={form.target_market}
          onChangeText={(v) => setForm({ ...form, target_market: v })}
          placeholder="e.g. UK, US, EU"
        />
        <Input
          label="Currency"
          value={form.currency}
          onChangeText={(v) => setForm({ ...form, currency: v })}
          autoCapitalize="characters"
          maxLength={3}
        />
        {error ? <ErrorBox error={error} /> : null}
        <Button title={saved ? 'Saved ✓' : 'Save'} onPress={save} loading={saving} />
      </Card>

      {b ? (
        <Card style={{ gap: Spacing.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T kind="heading">Plan</T>
            <Badge text={b.plan === 'pro' ? 'Pro' : 'Free'} tone={b.plan === 'pro' ? 'good' : 'neutral'} />
          </Row>
          <T kind="secondary">
            {b.ai_calls_used} of {b.ai_calls_limit} AI requests used this month
            {b.plan_expires_at ? ` · renews or ends ${new Date(b.plan_expires_at).toLocaleDateString()}` : ''}
          </T>
          <Button title={b.plan === 'pro' ? 'Manage subscription' : 'Upgrade to Pro'} kind={b.plan === 'pro' ? 'secondary' : 'primary'} onPress={() => router.push('/paywall')} />
        </Card>
      ) : null}

      <Card style={{ gap: Spacing.sm }}>
        <T kind="heading">Data</T>
        <Button title="Import products or sales (CSV)" kind="secondary" onPress={() => router.push('/import')} />
        <Button title="Load demo store" kind="secondary" onPress={loadDemo} />
      </Card>

      <View style={{ gap: Spacing.sm }}>
        <T kind="muted">Signed in as {user?.email}</T>
        <Button title="Sign out" kind="danger" onPress={signOut} />
      </View>
    </Screen>
  );
}
