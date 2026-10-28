import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Share } from 'react-native';

import { Sources, Working } from '@/components/ai-bits';
import { ActionCard } from '@/components/insights';
import { Badge, Bullets, Button, Card, Empty, ErrorBox, Loading, Row, Screen, Section, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api, SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, money } from '@/lib/format';
import type { WeeklyBriefReport } from '@/lib/types';

export default function WeeklyPlan() {
  const c = useTheme();
  const { user, local } = useAuth();
  const cur = user?.currency ?? 'USD';
  const smart = useApi(api.plan);
  const latest = useApi(() => (SERVER_ENABLED && !local ? api.reports<WeeklyBriefReport>('weekly_brief', 1) : Promise.resolve([])));
  const [fresh, setFresh] = useState<WeeklyBriefReport | null>(null);
  const { run, running, error } = useAiRun(api.weeklyBrief);
  const report = fresh ?? latest.data?.[0] ?? null;

  const generate = async () => {
    const r = await run();
    if (r) setFresh(r);
  };

  const plan = smart.data;
  const aiAvailable = SERVER_ENABLED && !local;
  const sharePlan = () => {
    if (!plan) return;
    const lines = [`This week's plan${user?.store_name ? ` for ${user.store_name}` : ''}`, '', plan.summary, '', ...plan.actions.map((a) => `• ${a.title}`)];
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };
  const hasOrders = !!plan?.actions.some((a) => a.kind === 'reorder' || a.kind === 'restock_urgent');

  return (
    <Screen edges={[]} refreshing={smart.refreshing} onRefresh={smart.refresh}>
      {smart.loading ? <Loading /> : null}
      {smart.error ? <ErrorBox error={smart.error} onRetry={smart.refresh} /> : null}
      {plan ? (
        <>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <T kind="secondary" style={{ flex: 1 }}>
              Built from your forecasts, stock and profit. Updates whenever your data changes.
            </T>
            <Badge text="Instant · no AI needed" tone="good" />
          </Row>
          <Card style={{ gap: Spacing.sm }}>
            <T kind="heading">{plan.headline}</T>
            <T>{plan.summary}</T>
          </Card>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Next week revenue" value={money(plan.store_forecast.next_weeks_revenue[0] ?? 0, cur)} />
            <StatTile label="Next week profit" value={money(plan.store_forecast.next_weeks_profit[0] ?? 0, cur)} />
          </Row>
          <Card>
            <T kind="label">Outlook</T>
            <T>{plan.next_week_outlook}</T>
          </Card>
          <Section title="Do this week">
            {plan.actions.length ? (
              plan.actions.map((a, i) => <ActionCard key={i} a={a} />)
            ) : (
              <Empty title="All clear ✓" body="Stock covers expected sales on every product." />
            )}
          </Section>
          {hasOrders ? <Button title="Draft my supplier orders" onPress={() => router.push('/orders')} /> : null}
          <Button title="Share this plan" kind="secondary" onPress={sharePlan} />
        </>
      ) : null}

      {aiAvailable ? (
      <Card style={{ gap: Spacing.sm }}>
        <T style={{ fontWeight: '700' }}>Want a second opinion?</T>
        <T kind="secondary">
          AI checks upcoming events, news and viral moments around your products, and adjusts next week&apos;s forecast where
          your sales history can&apos;t know about them.
        </T>
        <Button title={report ? 'Check again with AI' : 'Check with AI'} kind="secondary" onPress={generate} loading={running} />
        <T kind="muted">Takes 1–2 minutes. Uses 1 AI request.</T>
      </Card>
      ) : null}
      {running ? <Working text="Reading your sales and forecasts, and checking upcoming events and news. This takes 1–2 minutes." /> : null}
      {error ? <ErrorBox error={error} onRetry={generate} /> : null}

      {report && !running ? (
        <>
          <Section title="AI second opinion">
            <Card style={{ gap: Spacing.sm }}>
              <T kind="muted">Made {ago(report.created_at)}</T>
              <T style={{ fontWeight: '700' }}>{report.brief.headline}</T>
              <T>{report.brief.summary}</T>
            </Card>
          </Section>
          {report.adjusted?.length ? (
            <Section title="AI forecast adjustments">
              <T kind="muted">Changes to next week&apos;s forecast for things your sales history can&apos;t know about.</T>
              {report.adjusted.map((a) => (
                <Card key={a.sku} style={{ gap: 4 }}>
                  <T style={{ fontWeight: '700' }}>{a.name}</T>
                  <T>
                    {Math.round(a.base_next_week)} → {Math.round(a.adjusted_next_week)} units next week ({a.change_pct > 0 ? '+' : ''}
                    {Math.round(a.change_pct)}%)
                  </T>
                  <T kind="secondary">{a.reason}</T>
                  {a.source_url ? (
                    <Pressable onPress={() => Linking.openURL(a.source_url)} accessibilityRole="link">
                      <T kind="muted" style={{ color: c.tint, textDecorationLine: 'underline' }}>
                        Source
                      </T>
                    </Pressable>
                  ) : null}
                </Card>
              ))}
            </Section>
          ) : null}
          {report.brief.market_notes?.length ? (
            <Section title="What's happening out there">
              <Card>
                <Bullets items={report.brief.market_notes} />
              </Card>
            </Section>
          ) : null}
          <Section title="AI to-do list">
            {report.brief.actions.map((a, i) => (
              <ActionCard key={i} a={a} />
            ))}
          </Section>
          {report.brief.opportunities.length ? (
            <Section title="Opportunities">
              <Card>
                <Bullets items={report.brief.opportunities} />
              </Card>
            </Section>
          ) : null}
          {report.brief.risks.length ? (
            <Section title="Watch out for">
              <Card>
                <Bullets items={report.brief.risks} />
              </Card>
            </Section>
          ) : null}
          {report.sources?.length ? <Sources sources={report.sources} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
