import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chips, ErrorBox, Input, Loading, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';

/** Type stock (or cost per item) for many products at once, e.g. right after importing a sales file. */
export default function StockCounts() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const [tab, setTab] = useState<'stock' | 'cost'>(params.tab === 'cost' ? 'cost' : 'stock');
  const { data, error, loading, refresh } = useApi(() => api.products());
  const [values, setValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [showAll, setShowAll] = useState(false);

  const rows = (data ?? []).filter((p) =>
    showAll ? true : tab === 'stock' ? !p.stock_known : p.cost_price <= 0,
  );

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const items = Object.entries(values)
        .filter(([, v]) => v.trim() !== '' && !Number.isNaN(Number(v)))
        .map(([id, v]) => ({ id: Number(id), value: Number(v) }));
      if (tab === 'stock') await api.setStockCounts(items.map((i) => ({ id: i.id, stock_qty: Math.round(i.value) })));
      else await api.setCosts(items.map((i) => ({ id: i.id, cost_price: Math.max(0, i.value) })));
      setValues({});
      await refresh();
    } catch (e) {
      setSaveError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const filled = Object.values(values).filter((v) => v.trim() !== '').length;

  return (
    <Screen edges={[]}>
      <Chips
        value={tab}
        onChange={(t) => {
          setTab(t);
          setValues({});
        }}
        options={[
          { value: 'stock', label: 'Stock counts' },
          { value: 'cost', label: 'Cost per item' },
        ]}
      />
      <T kind="secondary">
        {tab === 'stock'
          ? 'How many of each do you have right now? For dropshipping, use your supplier’s stock if you know it.'
          : 'What you pay per item, including shipping to you or to the customer. This makes your profit numbers right.'}
      </T>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}
      {data && rows.length === 0 ? (
        <Card style={{ gap: Spacing.sm }}>
          <T style={{ fontWeight: '700' }}>All done here ✓</T>
          <Button title="Show all products" kind="secondary" onPress={() => setShowAll(true)} />
          <Button title="Back to dashboard" onPress={() => router.navigate('/')} />
        </Card>
      ) : null}
      {rows.map((p) => (
        <Card key={p.id} style={{ paddingVertical: Spacing.md }}>
          <Row>
            <View style={{ flex: 1 }}>
              <T numberOfLines={2} style={{ fontWeight: '600' }}>
                {p.name}
              </T>
              <T kind="muted">
                {p.sku} · sells for {money(p.sell_price, cur)}
                {tab === 'stock' && p.stock_known ? ` · now ${p.stock_qty}` : ''}
                {tab === 'cost' && p.cost_price > 0 ? ` · now ${money(p.cost_price, cur)}` : ''}
              </T>
            </View>
            <View style={{ width: 96 }}>
              <Input
                value={values[p.id] ?? ''}
                onChangeText={(v) => setValues({ ...values, [p.id]: v })}
                keyboardType={tab === 'stock' ? 'number-pad' : 'decimal-pad'}
                placeholder={tab === 'stock' ? 'Qty' : '0.00'}
                accessibilityLabel={`${tab === 'stock' ? 'Stock' : 'Cost'} for ${p.name}`}
              />
            </View>
          </Row>
        </Card>
      ))}
      {saveError ? <ErrorBox error={saveError} /> : null}
      {rows.length ? <Button title={filled ? `Save ${filled}` : 'Save'} onPress={save} loading={saving} disabled={!filled} /> : null}
    </Screen>
  );
}
