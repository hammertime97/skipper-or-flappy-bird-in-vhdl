import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { AlertCard } from '@/components/alert-card';
import { BarChart } from '@/components/charts';
import { Icon } from '@/components/icons';
import { InsightSections, PlanCard, ProTeaser } from '@/components/insights';
import { Button, Card, Chips, Empty, ErrorBox, Loading, Row, Screen, Section, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api, DEMO, GET_APP_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, num, shortDate } from '@/lib/format';
import { notificationsOn, notificationsSupported, scheduleNotifications, turnOnNotifications } from '@/lib/notify';
import { tokenStore } from '@/lib/token-store';
import type { Product } from '@/lib/types';

export default function DashboardScreen() {
  const { user, local } = useAuth();
  const c = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi(api.dashboard);
  const plan = useApi(api.plan);
  const insights = useApi(api.insights);
  // The on-phone brain: alerts and profit leaks (server accounts don't have them).
  const alerts = useApi(async () => (local ? api.alerts() : null));
  const leaks = useApi(async () => (local ? api.leaks() : null));
  const [offerNotify, setOfferNotify] = useState(false);
  useEffect(() => {
    if (!alerts.data) return;
    void scheduleNotifications(alerts.data);
    if (!notificationsSupported) return;
    void (async () => {
      if ((await tokenStore.get(NOTIFY_ASKED)) || (await notificationsOn())) return;
      setOfferNotify(true);
    })();
  }, [alerts.data]);
  const answerNotify = async (yes: boolean) => {
    setOfferNotify(false);
    await tokenStore.set(NOTIFY_ASKED, '1');
    if (yes && (await turnOnNotifications()) && alerts.data) await scheduleNotifications(alerts.data);
  };
  const refreshAll = () => Promise.all([refresh(), plan.refresh(), insights.refresh(), alerts.refresh(), leaks.refresh()]);
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [seeding, setSeeding] = useState<string | null>(null);
  const cur = data?.currency ?? user?.currency ?? 'USD';
  const pro = user?.billing.plan === 'pro';

  const seed = async (key?: string) => {
    setSeeding(key ?? 'small');
    try {
      await api.seedDemo(key);
      await refreshAll();
    } finally {
      setSeeding(null);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refreshAll}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <T kind="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</T>
          <T kind="title">{data?.store_name || user?.store_name || 'Your store'}</T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.push('/account')} style={{ padding: 6 }}>
          <Icon name="gear" color={c.textSecondary} />
        </Pressable>
      </Row>

      {DEMO ? (
        <Card style={{ gap: Spacing.sm, borderColor: c.tint, borderWidth: 2 }}>
          <T style={{ fontWeight: '700' }}>You’re trying StockPilot with a sample store: 554 products, 6 months of eBay sales, everything unlocked.</T>
          <T kind="secondary">Tap around: Ask StockPilot a question, open your profit leaks, check what to reorder. To try your own sales file, go to Account → Import sales or stock. It all runs in your browser; nothing is uploaded.</T>
          {GET_APP_URL ? <Button title="Get the app" onPress={() => Linking.openURL(GET_APP_URL)} /> : null}
        </Card>
      ) : null}
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}

      {data && data.inventory.skus === 0 ? (
        <Empty
          title="Let's bring in your sales"
          body="Download your sales file from eBay, Amazon, Shopify, Etsy, TikTok Shop or Excel and upload it here. We show you exactly where to click."
          action={
            <View style={{ gap: Spacing.sm, alignSelf: 'stretch' }}>
              <Button title="Import my sales (2 minutes)" onPress={() => router.push('/import')} />
              <Button title="Just look around with a demo store" kind="secondary" onPress={() => seed()} loading={seeding === 'small'} disabled={!!seeding} />
              {local ? (
                <Button
                  title="Try a big demo store (550 products)"
                  kind="secondary"
                  onPress={() => seed('bigstore')}
                  loading={seeding === 'bigstore'}
                  disabled={!!seeding}
                />
              ) : null}
              <Button title="Add a product by hand" kind="secondary" onPress={() => router.push('/product/edit')} />
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
          {data.todo.map((t) => (
            <Card key={t.key} style={{ gap: Spacing.sm, borderColor: c.warning }}>
              <T style={{ fontWeight: '700' }}>{t.text}</T>
              <Button
                title={t.key === 'stock' ? 'Add stock counts' : 'Add costs'}
                onPress={() => router.push({ pathname: '/stock-counts', params: { tab: t.key } })}
              />
            </Card>
          ))}
          {plan.data ? <PlanCard plan={plan.data} /> : null}
          {alerts.data ? <AttentionCard report={alerts.data} /> : null}
          {offerNotify ? (
            <Card style={{ gap: Spacing.sm }}>
              <T style={{ fontWeight: '700' }}>Want a nudge when something needs you?</T>
              <T kind="secondary">A short digest every Monday morning, and a reminder on the day each supplier order is due. All worked out on your phone.</T>
              <Row>
                <Button title="Turn on" onPress={() => answerNotify(true)} />
                <Button title="Not now" kind="secondary" onPress={() => answerNotify(false)} />
              </Row>
            </Card>
          ) : null}
          {leaks.data && leaks.data.count > 0 ? (
            <Card style={{ gap: 4 }} onPress={() => router.push('/leaks')}>
              <T kind="label">Profit leaks</T>
              <T style={{ fontWeight: '700' }}>
                About {money(leaks.data.monthly_total, cur)} a month is slipping away{leaks.data.cash_total > 0 ? `, and ${money(leaks.data.cash_total, cur)} is stuck in stock` : ''}
              </T>
              <T kind="secondary">{leaks.data.count} found, each with the fix →</T>
            </Card>
          ) : null}
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Revenue" value={money(data.kpis[period].revenue, cur)} change={data.kpis[period].change.revenue} />
            <StatTile label="Profit after fees" value={money(data.kpis[period].profit, cur)} change={data.kpis[period].change.profit} />
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

          {insights.data ? (
            pro ? (
              <InsightSections data={insights.data} cur={cur} />
            ) : (
              <ProTeaser
                title="Your money makers & bought together"
                body="See which few products earn most of your profit, which ones lose money, and which products customers buy together, so you can bundle them."
              />
            )
          ) : null}

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

const NOTIFY_ASKED = 'stockpilot.notify-asked';

/** The few things that need the seller now, from the on-phone alerts. */
function AttentionCard({ report }: { report: import('@/lib/types').AlertReport }) {
  const c = useTheme();
  const top = report.items.filter((a) => a.severity === 'urgent' || a.severity === 'warning').slice(0, 3);
  const total = report.counts.urgent + report.counts.warning;
  if (!top.length) {
    return (
      <Card style={{ gap: 4 }} onPress={() => router.push('/alerts')}>
        <T kind="label">Needs your attention</T>
        <T style={{ fontWeight: '700', color: c.good }}>All clear: nothing urgent today ✓</T>
      </Card>
    );
  }
  return (
    <View style={{ gap: Spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T kind="heading">Needs your attention</T>
        <T style={{ color: c.tint, fontWeight: '700' }} onPress={() => router.push('/alerts')}>
          See all {total} →
        </T>
      </Row>
      {top.map((a) => (
        <AlertCard key={a.id} a={a} compact />
      ))}
    </View>
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
