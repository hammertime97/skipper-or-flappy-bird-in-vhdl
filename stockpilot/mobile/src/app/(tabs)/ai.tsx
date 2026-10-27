import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

const FEATURES: { title: string; body: string; href: Href; cta: string }[] = [
  {
    title: 'Weekly Plan',
    body: 'Your forecasts turned into a to-do list: what to reorder, what to push, what to clear, and how much next week should bring in.',
    href: '/ai/weekly-plan',
    cta: 'Open this week’s plan',
  },
  {
    title: 'Trend Scout',
    body: 'Searches TikTok Shop, Amazon movers, Google Trends and competitor stores in your niche, and tells you which products are booming right now.',
    href: '/ai/trends',
    cta: 'Find trending products',
  },
  {
    title: 'Product Check',
    body: 'Thinking of adding something? Get a go / test / skip verdict with demand, saturation and margin scores before you spend a cent.',
    href: '/ai/product-check',
    cta: 'Check a product idea',
  },
  {
    title: 'Ask StockPilot',
    body: '“What should I reorder?” “Which product made me the most profit this month?” Ask in plain English; answers come from your own data.',
    href: '/ai/assistant',
    cta: 'Ask a question',
  },
  {
    title: 'Listing Writer',
    body: 'SEO titles, bullet points, descriptions and hashtags for Shopify, TikTok Shop, Amazon, eBay or Etsy.',
    href: '/ai/listing',
    cta: 'Write a listing',
  },
];

export default function AIScreen() {
  const { user, refreshUser } = useAuth();
  const b = user?.billing;
  useFocusEffect(
    useCallback(() => {
      refreshUser().catch(() => {});
    }, [refreshUser]),
  );
  return (
    <Screen>
      <View>
        <T kind="title">AI tools</T>
        <T kind="secondary">Built on your real sales data and live web research.</T>
      </View>
      {b ? (
        <Card style={{ gap: Spacing.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T style={{ fontWeight: '700' }}>{b.plan === 'pro' ? 'StockPilot Pro' : 'Free plan'}</T>
            <Badge text={`${b.ai_calls_used}/${b.ai_calls_limit} AI requests this month`} />
          </Row>
          {b.plan === 'free' ? <Button title="Upgrade to Pro" onPress={() => router.push('/paywall')} /> : null}
        </Card>
      ) : null}
      {FEATURES.map((f) => (
        <Card key={f.title} style={{ gap: Spacing.sm }} onPress={() => router.push(f.href)}>
          <T kind="heading">{f.title}</T>
          <T kind="secondary">{f.body}</T>
          <T style={{ fontWeight: '700' }}>{f.cta} →</T>
        </Card>
      ))}
    </Screen>
  );
}
