import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { BarChart } from '@/components/charts';
import { Button, Card, Chips, Empty, ErrorBox, Loading, Row, Screen, Section, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, num, shortDate } from '@/lib/format';
import type { Product } from '@/lib/types';

export default function DashboardScreen() {
  const { user } = useAuth();
  const c = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi(api.dashboard);
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [seeding, setSeeding] = useState(false);
  const cur = data?.currency ?? user?.currency ?? 'USD';

  const seed = async () => {
    setSeeding(true);
    try {
      await api.seedDemo();
      await refresh();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View>
        <T kind="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</T>
        <T kind="title">{data?.store_name || user?.store_name || 'Your store'}</T>
      </View>

      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}

      {data && data.inventory.skus === 0 ? (
        <Empty
          title="Let's get your store in"
          body="Add products and sales, import a CSV from Shopify or your spreadsheet, or load a demo store to look around."
          action={
            <View style={{ gap: Spacing.sm, alignSelf: 'stretch' }}>
              <Button title="Add a product" onPress={() => router.push('/product/edit')} />
              <Button title="Import CSV" kind="secondary" onPress={() => router.push('/import')} />
              <Button title="Load demo store" kind="secondary" onPress={seed} loading={seeding} />
            </View>
          }
        />
      ) : null}

      {data && data.inventory.skus > 0 ? (
        <>
          <Chips
            value={period}
            onChange={setPeriod}
            options={[
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
            ]}
          />
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Revenue" value={money(data.kpis[period].revenue, cur)} change={data.kpis[period].change.revenue} />
            <StatTile label="Profit" value={money(data.kpis[period].profit, cur)} change={data.kpis[period].change.profit} />
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Orders" value={num(data.kpis[period].orders)} change={data.kpis[period].change.orders} />
            <StatTile label="Units sold" value={num(data.kpis[period].units)} change={data.kpis[period].change.units} />
          </Row>

          <Card style={{ gap: Spacing.sm }}>
            <T kind="heading">Daily revenue, last 30 days</T>
            <BarChart
              data={data.daily.map((d) => ({ label: shortDate(d.date), value: d.revenue }))}
              readout={(d) => `${d.label}: ${money(d.value, cur)}`}
            />
          </Card>

          <Section title="Inventory">
            <Row style={{ flexWrap: 'wrap' }}>
              <StatTile label="Products" value={num(data.inventory.skus)} />
              <StatTile label="Units on hand" value={num(data.inventory.units_on_hand)} />
            </Row>
            <Row style={{ flexWrap: 'wrap' }}>
              <StatTile label="Stock value (cost)" value={money(data.inventory.stock_value_cost, cur)} />
              <StatTile label="Stock value (retail)" value={money(data.inventory.stock_value_retail, cur)} />
            </Row>
            <Card style={{ gap: Spacing.xs }}>
              <AlertLine color={c.critical} icon="⛔" text={`${data.inventory.out_of_stock} out of stock and still selling`} />
              <AlertLine color={c.warning} icon="▾" text={`${data.inventory.low_stock} running low`} />
              <AlertLine color={c.textMuted} icon="•" text={`${data.inventory.dead_stock} not sold in 30 days`} />
            </Card>
          </Section>

          {data.low_stock.length ? (
            <Section title="Running low">
              <ProductList products={data.low_stock} cur={cur} detail={(p) => `${p.days_of_stock} days left · ${p.stock_qty} in stock`} />
            </Section>
          ) : null}

          <Section title="Top sellers (30 days)">
            <ProductList products={data.top_sellers} cur={cur} detail={(p) => `${money(p.revenue_30d ?? 0, cur)} · ${p.units_30d} sold`} />
          </Section>

          {data.dead_stock.length ? (
            <Section title="Not selling">
              <ProductList
                products={data.dead_stock}
                cur={cur}
                detail={(p) => `${p.stock_qty} in stock · ${money(p.stock_qty * p.cost_price, cur)} tied up`}
              />
            </Section>
          ) : null}

          {data.channels.length ? (
            <Section title="Revenue by channel (30 days)">
              <Card style={{ gap: Spacing.sm }}>
                {data.channels.map((ch) => (
                  <Row key={ch.channel} style={{ justifyContent: 'space-between' }}>
                    <T style={{ textTransform: 'capitalize' }}>{ch.channel}</T>
                    <T kind="label">{money(ch.revenue, cur)}</T>
                  </Row>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function AlertLine({ color, icon, text }: { color: string; icon: string; text: string }) {
  return (
    <Row>
      <T style={{ color, fontWeight: '800', width: 18 }}>{icon}</T>
      <T>{text}</T>
    </Row>
  );
}

function ProductList({ products, detail }: { products: Product[]; cur: string; detail: (p: Product) => string }) {
  return (
    <Card style={{ paddingVertical: Spacing.sm }}>
      {products.map((p, i) => (
        <View key={p.id}>
          {i > 0 ? <View style={{ height: 1, opacity: 0.08, backgroundColor: '#888' }} /> : null}
          <Row style={{ paddingVertical: Spacing.sm, justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T numberOfLines={1} style={{ fontWeight: '600' }} >
                {p.name}
              </T>
              <T kind="muted">{detail(p)}</T>
            </View>
            <Button kind="secondary" title="Open" onPress={() => router.push(`/product/${p.id}`)} style={{ minHeight: 34 }} />
          </Row>
        </View>
      ))}
    </Card>
  );
}
