import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { Button, Chips, Empty, ErrorBox, Input, Loading, Row, Screen, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, num, pct } from '@/lib/format';
import type { Product } from '@/lib/types';

type Filter = 'all' | 'low' | 'out' | 'dead' | 'dropship';

function matches(p: Product, f: Filter) {
  switch (f) {
    case 'low':
      return p.days_of_stock != null && p.days_of_stock <= Math.max(14, p.lead_time_days + 7) && p.stock_qty > 0;
    case 'out':
      return p.stock_known && p.stock_qty <= 0;
    case 'dead':
      return p.stock_qty > 0 && (p.units_30d ?? 0) === 0;
    case 'dropship':
      return p.fulfilment === 'dropship';
    default:
      return true;
  }
}

export default function InventoryScreen() {
  const c = useTheme();
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const { data, error, loading, refreshing, refresh } = useApi(() => api.products());
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data ?? []).filter(
      (p) => matches(p, filter) && (!ql || p.name.toLowerCase().includes(ql) || p.sku.toLowerCase().includes(ql) || p.category.toLowerCase().includes(ql)),
    );
  }, [data, q, filter]);

  return (
    <Screen scroll={false}>
      <View style={{ padding: Spacing.lg, gap: Spacing.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T kind="title">Inventory</T>
          <Button title="+ Add" onPress={() => router.push('/product/edit')} style={{ minHeight: 38 }} />
        </Row>
        <Input value={q} onChangeText={setQ} placeholder="Search name, SKU or category" autoCorrect={false} />
        <Chips
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: 'Running low' },
            { value: 'out', label: 'Out of stock' },
            { value: 'dead', label: 'Not selling' },
            { value: 'dropship', label: 'Dropship' },
          ]}
        />
      </View>
      {loading ? <Loading /> : null}
      {error ? (
        <View style={{ paddingHorizontal: Spacing.lg }}>
          <ErrorBox error={error} onRetry={refresh} />
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl * 2, gap: Spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          !loading && !error ? (
            <Empty
              title={data?.length ? 'Nothing matches' : 'No products yet'}
              body={data?.length ? 'Try another search or filter.' : 'Add your first product or import a CSV.'}
              action={data?.length ? undefined : <Button title="Import my sales" kind="secondary" onPress={() => router.push('/import')} />}
            />
          ) : undefined
        }
        renderItem={({ item: p }) => {
          const out = p.stock_known && p.stock_qty <= 0;
          const low = matches(p, 'low');
          return (
            <Pressable
              onPress={() => router.push(`/product/${p.id}`)}
              style={({ pressed }) => [
                { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
                pressed && { opacity: 0.7 },
              ]}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <T numberOfLines={1} style={{ fontWeight: '700' }}>
                    {p.name}
                  </T>
                  <T kind="muted">
                    {p.sku}
                    {p.fulfilment === 'dropship' ? ' · dropship' : ''}
                    {p.category ? ` · ${p.category}` : ''}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T style={{ fontWeight: '800', color: out ? c.critical : c.text }}>
                    {!p.stock_known ? '?' : out ? 'Out' : num(p.stock_qty)}
                  </T>
                  <T kind="muted">{!p.stock_known ? 'add stock' : p.fulfilment === 'dropship' ? 'supplier stock' : 'in stock'}</T>
                </View>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <T kind="secondary">
                  {num(p.units_30d ?? 0)} sold / 30d · {money(p.sell_price, cur)} · margin {pct(p.margin_pct ?? null, false)}
                </T>
                {p.days_of_stock != null && !out ? (
                  <T kind="label" style={low ? { color: c.text } : undefined}>
                    {low ? '▾ ' : ''}
                    {Math.round(p.days_of_stock)}d left
                  </T>
                ) : null}
              </Row>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
