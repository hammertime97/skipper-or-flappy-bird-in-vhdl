import { router } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Row, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { money } from '@/lib/format';
import type { BriefAction, Insights, SmartPlan } from '@/lib/types';

const PRIORITY_TONE = { high: 'critical', medium: 'warning', low: 'neutral' } as const;

/** One to-do from a weekly plan, coloured by priority. */
export function ActionCard({ a }: { a: BriefAction }) {
  const c = useTheme();
  const open = a.kind === 'setup' ? () => router.push({ pathname: '/stock-counts', params: { tab: /cost/.test(a.title) ? 'cost' : 'stock' } }) : undefined;
  return (
    <Card
      onPress={open}
      style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: a.priority === 'high' ? c.critical : a.priority === 'medium' ? c.warning : c.border }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge text={`${a.priority} priority`} tone={PRIORITY_TONE[a.priority]} />
        {a.sku ? <T kind="muted">{a.sku}</T> : null}
      </Row>
      <T style={{ fontWeight: '700' }}>{a.title}</T>
      <T kind="secondary">{a.detail}</T>
    </Card>
  );
}

/** Home-screen teaser for this week's plan. */
export function PlanCard({ plan }: { plan: SmartPlan }) {
  const urgent = plan.actions.filter((a) => a.priority === 'high').length;
  const n = plan.actions.length;
  return (
    <Card style={{ gap: 4 }} onPress={() => router.push('/ai/weekly-plan')}>
      <T kind="label">This week&apos;s plan</T>
      <T style={{ fontWeight: '700' }}>{plan.headline}</T>
      <T kind="secondary">
        {n ? `${n} thing${n > 1 ? 's' : ''} on your list${urgent ? ` · ${urgent} urgent` : ''}` : 'Nothing to do right now'} →
      </T>
    </Card>
  );
}

/** 80/20 profit focus and products bought together. */
export function InsightSections({ data, cur }: { data: Insights; cur: string }) {
  const c = useTheme();
  const top = data.focus.items.filter((r) => r.group === 'A').slice(0, 6);
  const losing = data.focus.items.filter((r) => r.group === 'losing');
  return (
    <>
      <Section title={`Your money makers (${data.focus.days} days)`}>
        <Card style={{ gap: Spacing.sm }}>
          <T>{data.focus.summary}</T>
          {top.map((r) => (
            <View key={r.id} style={{ gap: 3 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T numberOfLines={1} style={{ flex: 1 }} onPress={() => router.push(`/product/${r.id}`)}>
                  {r.name}
                </T>
                <T kind="label">
                  {money(r.profit, cur)} · {Math.round(r.share * 100)}%
                </T>
              </Row>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
                <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, Math.round(r.share * 100))}%`, backgroundColor: c.tint }} />
              </View>
            </View>
          ))}
          {losing.length ? (
            <T style={{ color: c.critical }}>
              Losing money: {losing.slice(0, 3).map((r) => `${r.name} (${money(r.profit, cur)})`).join(', ')}. Check the price or what you pay.
            </T>
          ) : null}
          {data.focus.missing_cost ? (
            <T kind="muted">
              {data.focus.missing_cost} selling products have no cost yet, so their profit looks higher than it is.
            </T>
          ) : null}
        </Card>
      </Section>
      <Section title="Bought together">
        <Card style={{ gap: Spacing.sm }}>
          {data.bundles.pairs.length ? (
            data.bundles.pairs.slice(0, 4).map((p) => (
              <View key={`${p.a.id}-${p.b.id}`} style={{ gap: 2 }}>
                <T style={{ fontWeight: '700' }}>
                  {p.a.name} + {p.b.name}
                </T>
                <T kind="secondary">
                  In {p.orders_together} orders, {p.lift}× more often than chance. Offer a bundle, or show one on the other&apos;s page.
                </T>
              </View>
            ))
          ) : (
            <T kind="secondary">{data.bundles.note}</T>
          )}
        </Card>
      </Section>
    </>
  );
}
