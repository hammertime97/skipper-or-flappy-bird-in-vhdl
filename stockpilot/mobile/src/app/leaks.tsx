import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ExportButton } from '@/components/export-button';
import { ProTeaser } from '@/components/insights';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Row, Screen, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import type { Leak, LeakKind } from '@/lib/types';

const KIND: Record<LeakKind, string> = {
  loss: 'Selling at a loss',
  thin_margin: 'Thin margin',
  price_slip: 'Price slipped',
  stockout: 'Sold out',
  runs_out_early: 'Will run out',
  channel_gap: 'Channel difference',
  dead_stock: 'Stuck stock',
  overstock: 'Too much stock',
  missing_cost: 'Blind spot',
};

/** Where the store quietly loses money, in money per month, with the fix. */
export default function ProfitLeaks() {
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const pro = user?.billing.plan === 'pro';
  const { data, error, loading, refreshing, refresh } = useApi(() => api.leaks());
  const [showHow, setShowHow] = useState(false);

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={refresh}>
      <T kind="secondary">
        StockPilot checks every product for money slipping away: prices below cost after fees, thin margins, discounts left on, missed sales from
        sell-outs, and cash stuck in stock.
      </T>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}
      {data ? (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Slipping away a month" value={money(data.monthly_total, cur)} />
            <StatTile label="Cash stuck in stock" value={money(data.cash_total, cur)} />
          </Row>
          <Card style={{ gap: Spacing.xs }}>
            <T style={{ fontWeight: '700' }}>{data.headline}</T>
            <T kind="muted" onPress={() => setShowHow((v) => !v)}>
              {showHow ? data.how : 'How is this worked out? ›'}
            </T>
          </Card>
          {pro && data.items.length ? (
            <ExportButton
              what="profit-leaks"
              title="Export leaks to spreadsheet"
              rows={() => [
                ['Type', 'Product', 'Problem', 'Fix', 'Per month', 'Cash tied up', 'Suggested price'],
                ...data.items.map((l) => [KIND[l.kind], l.product_name ?? '', l.title, l.fix, Math.round(l.monthly * 100) / 100, Math.round(l.cash * 100) / 100, l.suggested_price ?? '']),
              ]}
            />
          ) : null}
          {data.count === 0 ? <Empty title="No leaks found" body="Prices cover cost and fees, and stock is moving. Check again after your next import." /> : null}
          {data.items.map((l) => (
            <LeakCard key={l.id} leak={l} cur={cur} />
          ))}
          {data.locked_count > 0 ? (
            <ProTeaser
              title={`${data.locked_count} more leak${data.locked_count === 1 ? '' : 's'} found`}
              body={`Free shows your top ${data.items.length}. Pro shows every leak, with the fix for each, so you can win back the full ${money(data.monthly_total, cur)} a month.`}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function LeakCard({ leak: l, cur }: { leak: Leak; cur: string }) {
  const c = useTheme();
  const color = l.severity === 'high' ? c.critical : l.severity === 'medium' ? c.warning : c.border;
  return (
    <Card style={{ gap: Spacing.xs, borderLeftWidth: 4, borderLeftColor: color }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Badge text={KIND[l.kind]} tone={l.severity === 'high' ? 'critical' : l.severity === 'medium' ? 'warning' : 'neutral'} />
        {l.monthly >= 1 ? <T kind="label">≈ {money(l.monthly, cur)}/month</T> : l.cash > 0 ? <T kind="label">{money(l.cash, cur)} tied up</T> : null}
      </Row>
      <T style={{ fontWeight: '700' }}>{l.title}</T>
      <T kind="secondary">{l.detail}</T>
      <View style={{ gap: 2 }}>
        <T kind="label">Fix</T>
        <T>{l.fix}</T>
      </View>
      {l.product_id ? (
        <Button kind="secondary" title="Open product" onPress={() => router.push(`/product/${l.product_id}`)} style={{ alignSelf: 'flex-start', minHeight: 34 }} />
      ) : l.kind === 'missing_cost' ? (
        <Button kind="secondary" title="Add costs" onPress={() => router.push({ pathname: '/stock-counts', params: { tab: 'cost' } })} style={{ alignSelf: 'flex-start', minHeight: 34 }} />
      ) : null}
    </Card>
  );
}
