import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ForecastLineChart } from '@/components/charts';
import { Button, Card, Chips, Empty, ErrorBox, Loading, Row, Screen, StatTile, StatusPill, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { money, num, pct } from '@/lib/format';
import type { ForecastItem, StockStatus } from '@/lib/types';

const TREND_LABEL = { rising: '▲ Rising', declining: '▼ Declining', stable: '→ Stable', new: '★ New', no_sales: '– No sales' };

type Filter = 'action' | 'all' | 'rising' | 'declining';
const ACTION: StockStatus[] = ['out_of_stock', 'reorder_now', 'low'];

export default function ForecastScreen() {
  const { data, error, loading, refreshing, refresh } = useApi(() => api.forecasts(4));
  const [filter, setFilter] = useState<Filter>('action');
  const cur = data?.currency ?? 'USD';

  const items = (data?.items ?? []).filter((it) => {
    if (it.locked) return filter === 'all';
    if (filter === 'action') return ACTION.includes(it.stock_plan!.status);
    if (filter === 'rising') return it.forecast!.trend === 'rising';
    if (filter === 'declining') return it.forecast!.trend === 'declining';
    return true;
  });

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View>
        <T kind="title">Next week</T>
        <T kind="secondary">Forecast from your sales history, refreshed every time you open this screen.</T>
      </View>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}
      {data && data.items.length === 0 ? (
        <Empty title="No products yet" body="Add products and a few weeks of sales to get forecasts." />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Expected revenue" value={money(data.store.next_weeks_revenue[0] ?? 0, cur)} />
            <StatTile label="Expected profit" value={money(data.store.next_weeks_profit[0] ?? 0, cur)} />
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Expected units" value={num(data.store.next_weeks_units[0] ?? 0)} />
            <StatTile label="Next 4 weeks revenue" value={money(data.store.next_weeks_revenue.reduce((a, b) => a + b, 0), cur)} />
          </Row>

          {data.store.weekly_revenue_history.length > 1 ? (
            <Card style={{ gap: Spacing.sm }}>
              <T kind="heading">Weekly revenue</T>
              <ForecastLineChart
                history={data.store.weekly_revenue_history.slice(-16)}
                forecast={data.store.next_weeks_revenue}
                lower={data.store.revenue_band?.lower}
                upper={data.store.revenue_band?.upper}
                readout={(i, v, isFc) => {
                  const hist = Math.min(16, data.store.weekly_revenue_history.length);
                  const label = isFc ? `Forecast, week +${i - hist + 1}` : i === hist - 1 ? 'Last 7 days' : `${hist - 1 - i} wks ago`;
                  return `${label}: ${money(v, cur)}`;
                }}
              />
            </Card>
          ) : null}

          {data.locked_count > 0 ? (
            <Card style={{ gap: Spacing.sm }}>
              <T style={{ fontWeight: '700' }}>
                {data.locked_count} more products have forecasts waiting
              </T>
              <T kind="secondary">Free shows your top sellers. Pro forecasts every product, every week.</T>
              <Button title="Unlock with Pro" onPress={() => router.push('/paywall')} />
            </Card>
          ) : null}

          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'action', label: 'Needs action' },
              { value: 'rising', label: 'Rising' },
              { value: 'declining', label: 'Declining' },
              { value: 'all', label: 'All' },
            ]}
          />
          {items.length === 0 ? <Empty title="All clear" body="Nothing in this list right now." /> : null}
          {items.map((it) => (
            <ForecastRow key={it.product.id} item={it} cur={cur} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function ForecastRow({ item, cur }: { item: ForecastItem; cur: string }) {
  const c = useTheme();
  const p = item.product;
  if (item.locked) {
    return (
      <Pressable onPress={() => router.push('/paywall')}>
        <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md }}>
          <T style={{ fontWeight: '700' }}>{p.name}</T>
          <T kind="muted">🔒 Pro forecast</T>
        </View>
      </Pressable>
    );
  }
  const fc = item.forecast!;
  const plan = item.stock_plan!;
  return (
    <Pressable onPress={() => router.push(`/product/${p.id}`)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <T numberOfLines={1} style={{ fontWeight: '700' }}>
              {p.name}
            </T>
            <T kind="muted">
              {TREND_LABEL[fc.trend]}
              {fc.trend === 'rising' || fc.trend === 'declining' ? ` ${pct(fc.trend_pct)}` : ''} · {fc.confidence} confidence
            </T>
          </View>
          <StatusPill status={plan.status} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T kind="hero" style={{ fontSize: 20 }}>
              {num(fc.next_week)} units
            </T>
            <T kind="muted">
              likely {num(fc.lower[0])}–{num(fc.upper[0])} · {money(item.next_week_revenue ?? 0, cur)}
            </T>
          </View>
          {plan.reorder_qty > 0 ? (
            <View style={{ alignItems: 'flex-end' }}>
              <T kind="label">Order</T>
              <T style={{ fontWeight: '800' }}>{num(plan.reorder_qty)} units</T>
            </View>
          ) : null}
        </Row>
        {plan.reason ? <T kind="secondary">{plan.reason}</T> : null}
      </View>
    </Pressable>
  );
}
