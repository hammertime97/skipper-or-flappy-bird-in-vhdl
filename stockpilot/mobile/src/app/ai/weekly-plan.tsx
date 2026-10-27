import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Sources, Working } from '@/components/ai-bits';
import { Badge, Bullets, Button, Card, Empty, ErrorBox, Loading, Row, Screen, Section, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, money } from '@/lib/format';
import type { WeeklyBriefReport } from '@/lib/types';

export default function WeeklyPlan() {
  const c = useTheme();
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const latest = useApi(() => api.reports<WeeklyBriefReport>('weekly_brief', 1));
  const [fresh, setFresh] = useState<WeeklyBriefReport | null>(null);
  const { run, running, error } = useAiRun(api.weeklyBrief);
  const report = fresh ?? latest.data?.[0] ?? null;

  const generate = async () => {
    const r = await run();
    if (r) setFresh(r);
  };

  const priorityTone = { high: 'critical', medium: 'warning', low: 'neutral' } as const;

  return (
    <Screen edges={[]}>
      <T kind="secondary">
        Your forecasts and stock levels, turned into this week&apos;s to-do list. Make a new plan each Monday.
      </T>
      {running ? <Working text="Reading your sales and forecasts, and checking upcoming events and news. This takes 1–2 minutes." /> : null}
      {error ? <ErrorBox error={error} onRetry={generate} /> : null}
      {latest.loading ? <Loading /> : null}

      {!report && !latest.loading && !running ? (
        <Empty title="No plan yet" body="Generate your first weekly plan." action={<Button title="Make my plan" onPress={generate} />} />
      ) : null}

      {report && !running ? (
        <>
          <Card style={{ gap: Spacing.sm }}>
            <T kind="muted">Made {ago(report.created_at)}</T>
            <T kind="heading">{report.brief.headline}</T>
            <T>{report.brief.summary}</T>
          </Card>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Next week revenue" value={money(report.store_forecast.next_weeks_revenue[0] ?? 0, cur)} />
            <StatTile label="Next week profit" value={money(report.store_forecast.next_weeks_profit[0] ?? 0, cur)} />
          </Row>
          <Card>
            <T kind="label">Outlook</T>
            <T>{report.brief.next_week_outlook}</T>
          </Card>
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
          <Section title="Do this week">
            {report.brief.actions.map((a, i) => (
              <Card key={i} style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: a.priority === 'high' ? c.critical : a.priority === 'medium' ? c.warning : c.border }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Badge text={`${a.priority} priority`} tone={priorityTone[a.priority]} />
                  {a.sku ? <T kind="muted">{a.sku}</T> : null}
                </Row>
                <T style={{ fontWeight: '700' }}>{a.title}</T>
                <T kind="secondary">{a.detail}</T>
              </Card>
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
          <View>
            <Button title="Make a new plan" kind="secondary" onPress={generate} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
