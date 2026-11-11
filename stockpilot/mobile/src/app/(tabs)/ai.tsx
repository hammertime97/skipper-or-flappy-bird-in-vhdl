import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const FEATURES: { title: string; body: string; href: Href; cta: string; instant?: boolean }[] = [
  {
    title: 'Ask StockPilot',
    body: '“Why did sales drop this week?” “How many water bottles did I sell in October?” “What if I raise the price by 10%?” Answers from your own numbers, with how it worked them out.',
    href: '/ai/assistant',
    cta: 'Ask a question',
    instant: true,
  },
  {
    title: 'Profit leak finder',
    body: 'Where money quietly slips away: prices below cost after fees, thin margins, discounts left on, missed sales from sell-outs, cash stuck in stock. Each with the fix.',
    href: '/leaks',
    cta: 'Find my profit leaks',
    instant: true,
  },
  {
    title: 'Smart alerts',
    body: 'What needs you today: sell-outs, order deadlines, sudden drops or spikes in sales. Plus a Monday digest and order-day reminders on your phone.',
    href: '/alerts',
    cta: 'See my alerts',
    instant: true,
  },
  {
    title: 'Weekly Plan',
    body: 'Your forecasts turned into a to-do list: what to reorder and by which day, what to push, what to clear.',
    href: '/ai/weekly-plan',
    cta: 'Open this week’s plan',
    instant: true,
  },
  {
    title: 'Supplier orders',
    body: 'Everything that needs reordering, grouped by supplier, with the order message written for you. Send it by WhatsApp or email in one tap.',
    href: '/orders',
    cta: 'See what to order',
    instant: true,
  },
  {
    title: 'Profit & ads calculator',
    body: 'What one sale really earns after product cost, shipping and platform fees, and how much you can spend on ads before you lose money.',
    href: '/calculator',
    cta: 'Work out my profit',
    instant: true,
  },
  {
    title: 'Trending products',
    body: 'What’s selling now in 9 niches, updated every few weeks, ready to add to your store.',
    href: '/trends',
    cta: 'Open the Trends tab',
    instant: true,
  },
  {
    title: 'Product Check',
    body: 'Thinking of adding something? See the profit after fees, whether it’s trending, and rule or shipping red flags, before you spend a cent.',
    href: '/ai/product-check',
    cta: 'Check a product idea',
    instant: true,
  },
  {
    title: 'Listing Writer',
    body: 'A ready-to-edit title, bullet points, description and hashtags for Shopify, TikTok Shop, Amazon, eBay or Etsy.',
    href: '/ai/listing',
    cta: 'Write a listing',
    instant: true,
  },
];

export default function AIScreen() {
  const { user, refreshUser, local } = useAuth();
  const b = user?.billing;
  useFocusEffect(
    useCallback(() => {
      refreshUser().catch(() => {});
    }, [refreshUser]),
  );
  return (
    <Screen>
      <View>
        <T kind="title">Tools</T>
        <T kind="secondary">
          Built on your real sales data. Every tool works instantly{SERVER_ENABLED && !local ? ', and AI can add a second opinion with live web research' : ', right on your phone'}.
        </T>
      </View>
      {b ? (
        <Card style={{ gap: Spacing.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ fontWeight: '700' }}>{b.plan === 'pro' ? 'StockPilot Pro' : 'Free plan'}</T>
            <Badge text={local ? 'Works offline' : `${b.ai_calls_used}/${b.ai_calls_limit} AI requests this month`} />
          </Row>
          {b.plan === 'free' ? <Button title="Upgrade to Pro" onPress={() => router.push('/paywall')} /> : null}
        </Card>
      ) : null}
      {FEATURES.map((f) => (
        <Card key={f.title} style={{ gap: Spacing.sm }} onPress={() => router.push(f.href)}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <T kind="heading">{f.title}</T>
            <Badge text={f.instant ? 'Instant' : 'AI'} tone={f.instant ? 'good' : 'tint'} />
          </Row>
          <T kind="secondary">{f.body}</T>
          <T style={{ fontWeight: '700' }}>{f.cta} →</T>
        </Card>
      ))}
    </Screen>
  );
}
