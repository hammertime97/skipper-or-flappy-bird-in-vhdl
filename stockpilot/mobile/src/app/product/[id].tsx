import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { BarChart } from '@/components/charts';
import { Bullets, Button, Card, ErrorBox, Input, Loading, Row, Screen, StatTile, StatusPill, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, num, orderWhen, pct, shortDate } from '@/lib/format';
import type { Forecast, ProductDetail, StockPlan } from '@/lib/types';

const TREND = { rising: 'Rising', declining: 'Declining', stable: 'Stable', new: 'New product', no_sales: 'No sales yet' };

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const { data: p, error, loading, refreshing, refresh } = useApi(() => api.product(pid));
  const [qty, setQty] = useState('1');
  const [stockDelta, setStockDelta] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(e as Error);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (error || !p) return <Screen edges={[]}>{error ? <ErrorBox error={error} onRetry={refresh} /> : null}</Screen>;

  const fc = p.forecast;
  const plan = p.stock_plan;

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: p.sku }} />
      <View style={{ gap: 4 }}>
        <T kind="title">{p.name}</T>
        <T kind="muted">
          {p.category || 'No category'} · {p.fulfilment === 'dropship' ? 'Dropship' : 'Own stock'}
          {p.supplier ? ` · ${p.supplier}` : ''}
        </T>
        {plan ? <StatusPill status={plan.status} /> : null}
      </View>

      {p.locked || !fc || !plan ? (
        <Card style={{ gap: Spacing.sm }}>
          <T style={{ fontWeight: '700' }}>🔒 Forecast and stock plan are part of Pro</T>
          <T kind="secondary">On the Free plan, forecasts cover your top sellers. This product is outside them.</T>
          <Button title="See Pro" onPress={() => router.push('/paywall')} />
        </Card>
      ) : (
        <ForecastBlock p={p} fc={fc} plan={plan} cur={cur} />
      )}

      <Card style={{ gap: Spacing.sm }}>
        <T kind="heading">Numbers</T>
        <Row style={{ flexWrap: 'wrap' }}>
          <StatTile label="Price" value={money(p.sell_price, cur)} />
          <StatTile label="Unit cost" value={money(p.cost_price, cur)} />
        </Row>
        <Row style={{ flexWrap: 'wrap' }}>
          <StatTile label="Margin" value={pct(p.margin_pct ?? null, false)} />
          <StatTile label="Sold, 30 days" value={num(p.units_30d ?? 0)} />
        </Row>
      </Card>

      <Card style={{ gap: Spacing.md }}>
        <T kind="heading">Quick actions</T>
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="Units sold" value={qty} onChangeText={setQty} keyboardType="number-pad" />
          </View>
          <Button
            title="Record sale"
            style={{ alignSelf: 'flex-end' }}
            loading={busy === 'sale'}
            disabled={!(Number(qty) > 0)}
            onPress={() => act('sale', () => api.recordSale(p.id, Number(qty)))}
          />
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Input
              label="Stock received (+) or removed (−)"
              value={stockDelta}
              onChangeText={setStockDelta}
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. 50 or -3"
            />
          </View>
          <Button
            title="Update"
            style={{ alignSelf: 'flex-end' }}
            loading={busy === 'stock'}
            disabled={!Number(stockDelta)}
            onPress={() =>
              act('stock', async () => {
                await api.adjustStock(p.id, Number(stockDelta), Number(stockDelta) > 0 && p.incoming_qty > 0);
                setStockDelta('');
              })
            }
          />
        </Row>
        {actionError ? <ErrorBox error={actionError} /> : null}
        <Button title="Write a listing" kind="secondary" onPress={() => router.push({ pathname: '/ai/listing', params: { productId: String(p.id) } })} />
        <Button title="Edit product" kind="secondary" onPress={() => router.push({ pathname: '/product/edit', params: { id: String(p.id) } })} />
        <Button
          title="Archive product"
          kind="danger"
          onPress={() =>
            Alert.alert('Archive this product?', 'It disappears from lists and forecasts. Its sales history is kept.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Archive', style: 'destructive', onPress: () => act('archive', () => api.archiveProduct(p.id)).then(() => router.back()) },
            ])
          }
        />
      </Card>

      {p.recent_sales.length ? (
        <Card style={{ gap: Spacing.xs }}>
          <T kind="heading">Recent sales</T>
          {p.recent_sales.map((s) => (
            <Row key={s.id} style={{ justifyContent: 'space-between' }}>
              <T kind="secondary">
                {shortDate(s.sold_at)} · {s.channel || 'direct'}
              </T>
              <T>
                {s.quantity} × {money(s.unit_price, cur)}
              </T>
            </Row>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function ForecastBlock({ p, fc, plan, cur }: { p: ProductDetail; fc: Forecast; plan: StockPlan; cur: string }) {
  const c = useTheme();
  const recentWeeks = p.weekly_units.slice(-12);
  const bars = [
    ...recentWeeks.map((v, i) => ({ label: i === 0 ? `${recentWeeks.length} wks ago` : '', value: v })),
    ...fc.weeks.map((v, i) => ({ label: `+${i + 1} wk`, value: v, forecast: true })),
  ];
  return (
    <>
      <Card style={{ gap: Spacing.sm }}>
        <T kind="label">Next 7 days forecast</T>
        <T kind="hero">{num(fc.next_week)} units</T>
        <T kind="secondary">
          Likely between {num(fc.lower[0])} and {num(fc.upper[0])} · {money(fc.next_week * p.sell_price, cur)} revenue ·{' '}
          {TREND[fc.trend]}
          {fc.trend === 'rising' || fc.trend === 'declining' ? ` ${pct(fc.trend_pct)} vs prior 4 weeks` : ''}
        </T>
        <T kind="muted">
          {fc.accuracy != null
            ? `Tested on the last ${fc.tested_weeks} weeks of your sales: ${Math.round(fc.accuracy * 100)}% accurate.`
            : 'Not enough history to test this forecast yet. It gets sharper after 8 weeks of sales.'}
          {fc.seasonal ? ' Uses the same time last year.' : ''}
        </T>
        <BarChart
          data={bars}
          readout={(d) => `${d.forecast ? `Forecast ${d.label}` : 'Week'}: ${num(d.value, 1)} units`}
          format={(v) => num(v)}
        />
      </Card>

      <Card style={{ gap: Spacing.sm }}>
        <T kind="heading">Stock plan</T>
        {plan.order_by ? (
          <T style={{ fontWeight: '700', color: plan.status === 'low' ? c.text : c.critical }}>
            Order {num(plan.reorder_qty)} units {orderWhen(plan.order_by)}
          </T>
        ) : null}
        <T>{plan.reason}</T>
        {plan.status === 'stock_unknown' ? (
          <Button title="Add stock counts" onPress={() => router.push('/stock-counts')} />
        ) : (
          <>
            <Row style={{ flexWrap: 'wrap' }}>
              <StatTile label={p.fulfilment === 'dropship' ? 'Supplier stock' : 'In stock'} value={num(p.stock_qty)} />
              <StatTile label="Runs out" value={plan.stockout_date ? shortDate(plan.stockout_date) : 'Not soon'} />
            </Row>
            <Row style={{ flexWrap: 'wrap' }}>
              <StatTile label="Suggested order" value={`${num(plan.reorder_qty)} units`} />
              <StatTile label="Weeks of cover" value={plan.weeks_of_cover == null ? '–' : num(plan.weeks_of_cover, 1)} />
            </Row>
            <T kind="muted">
              The order covers {p.lead_time_days} days supplier lead time + 2 weeks of sales, plus {plan.safety_stock} units
              safety stock{p.incoming_qty ? `, minus ${p.incoming_qty} already on order` : ''}.
            </T>
          </>
        )}
        {plan.notes.length ? <Bullets items={plan.notes} /> : null}
      </Card>
    </>
  );
}
