import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { Badge, Button, Card, Empty, ErrorBox, Loading, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, num, orderWhen, shortDate } from '@/lib/format';
import type { ForecastItem } from '@/lib/types';

const NEEDS_ORDER = ['out_of_stock', 'reorder_now', 'low'];
const NO_SUPPLIER = 'No supplier set';

interface Group {
  supplier: string;
  items: ForecastItem[];
  cost: number;
  orderBy: string | null;
  runsOut: string | null;
}

/** Everything that needs ordering, grouped by supplier, with a message ready to send. */
export default function SupplierOrders() {
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const { data, error, loading, refreshing, refresh } = useApi(() => api.forecasts());
  const [copied, setCopied] = useState<string | null>(null);

  const groups: Group[] = [];
  for (const it of data?.items ?? []) {
    const plan = it.stock_plan;
    if (it.locked || !plan || plan.reorder_qty <= 0 || !NEEDS_ORDER.includes(plan.status)) continue;
    const name = it.product.supplier.trim() || NO_SUPPLIER;
    let g = groups.find((x) => x.supplier === name);
    if (!g) groups.push((g = { supplier: name, items: [], cost: 0, orderBy: null, runsOut: null }));
    g.items.push(it);
    g.cost += plan.reorder_qty * it.product.cost_price;
    if (plan.order_by && (!g.orderBy || plan.order_by < g.orderBy)) g.orderBy = plan.order_by;
    if (plan.stockout_date && (!g.runsOut || plan.stockout_date < g.runsOut)) g.runsOut = plan.stockout_date;
  }
  groups.sort((a, b) => (a.orderBy ?? '9').localeCompare(b.orderBy ?? '9'));

  const message = (g: Group) =>
    [
      g.supplier === NO_SUPPLIER ? 'Hi,' : `Hi ${g.supplier},`,
      '',
      "I'd like to place an order:",
      ...g.items.map((it) => `• ${num(it.stock_plan!.reorder_qty)} × ${it.product.name}${it.product.sku ? ` (SKU ${it.product.sku})` : ''}`),
      '',
      g.runsOut
        ? `My stock runs out around ${shortDate(g.runsOut)}, so please ship as soon as you can and confirm the price and delivery date.`
        : 'Please confirm the price and delivery date.',
      '',
      'Thanks,',
      user?.store_name || '',
    ]
      .join('\n')
      .trim();

  const send = (g: Group) => Share.share({ message: message(g), title: `Order for ${g.supplier}` }).catch(() => {});
  const copy = async (g: Group) => {
    await Clipboard.setStringAsync(message(g));
    setCopied(g.supplier);
    setTimeout(() => setCopied(null), 2000);
  };

  const total = groups.reduce((s, g) => s + g.cost, 0);
  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={refresh}>
      <T kind="secondary">
        Everything that needs ordering, grouped by supplier. Each order covers the supplier&apos;s delivery time, plus 2 weeks of
        sales, plus a safety buffer. Tap Send to share it by WhatsApp, email or text.
      </T>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}
      {data && !groups.length ? <Empty title="Nothing to order right now ✓" body="Your stock covers expected sales. We'll list orders here when something runs low." /> : null}
      {groups.length ? (
        <Card style={{ gap: 4 }}>
          <T kind="label">Total at cost price</T>
          <T kind="title">{money(total, cur)}</T>
          <T kind="secondary">
            {groups.length} supplier{groups.length > 1 ? 's' : ''} · {groups.reduce((s, g) => s + g.items.length, 0)} products
          </T>
        </Card>
      ) : null}
      {groups.map((g) => (
        <Card key={g.supplier} style={{ gap: Spacing.sm }}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <T kind="heading">{g.supplier}</T>
            {g.orderBy ? <Badge text={`Order ${orderWhen(g.orderBy)}`} tone={orderWhen(g.orderBy) === 'today' ? 'critical' : 'warning'} /> : null}
          </Row>
          {g.items.map((it) => (
            <Row key={it.product.id} style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }} numberOfLines={2} onPress={() => router.push(`/product/${it.product.id}`)}>
                {num(it.stock_plan!.reorder_qty)} × {it.product.name}
              </T>
              <T kind="label">{it.product.cost_price ? money(it.stock_plan!.reorder_qty * it.product.cost_price, cur) : 'cost?'}</T>
            </Row>
          ))}
          {g.supplier === NO_SUPPLIER ? (
            <T kind="muted">Tip: add the supplier on each product (Edit on the product page) and orders get grouped per supplier.</T>
          ) : null}
          <View style={{ gap: Spacing.xs }}>
            <Button title="Send order" onPress={() => send(g)} />
            <Button title={copied === g.supplier ? 'Copied ✓' : 'Copy message'} kind="secondary" onPress={() => copy(g)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
