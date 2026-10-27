import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Working } from '@/components/ai-bits';
import { Bullets, Button, Card, Chips, ErrorBox, Input, Row, Screen, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { api } from '@/lib/api';
import type { ListingPlatform, ListingReport } from '@/lib/types';

const PLATFORMS: { value: ListingPlatform; label: string }[] = [
  { value: 'shopify', label: 'Shopify' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'ebay', label: 'eBay' },
  { value: 'etsy', label: 'Etsy' },
  { value: 'woocommerce', label: 'WooCommerce' },
];

export default function ListingWriter() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [platform, setPlatform] = useState<ListingPlatform>('shopify');
  const [tone, setTone] = useState('');
  const [result, setResult] = useState<ListingReport | null>(null);
  const { run, running, error } = useAiRun(api.listing);

  const write = async () => {
    const r = await run({
      product_id: productId ? Number(productId) : undefined,
      name: name.trim() || undefined,
      details,
      platform,
      tone,
    });
    if (r) setResult(r);
  };

  const l = result?.listing;
  const fullText = l
    ? [l.title, '', l.short_description, '', ...l.bullet_points.map((b) => `• ${b}`), '', l.description, '', l.hashtags.join(' ')].join('\n')
    : '';

  return (
    <Screen edges={[]}>
      <Card style={{ gap: Spacing.md }}>
        {productId ? (
          <T kind="secondary">Writing for the product you opened. Add anything the AI should know below.</T>
        ) : (
          <Input label="Product name" value={name} onChangeText={setName} placeholder="e.g. Self-cleaning slicker brush" />
        )}
        <Input
          label="Details (materials, sizes, what's in the box, who it's for)"
          value={details}
          onChangeText={setDetails}
          multiline
          style={{ minHeight: 90, textAlignVertical: 'top' }}
        />
        <View style={{ gap: Spacing.xs }}>
          <T kind="label">Platform</T>
          <Chips value={platform} onChange={setPlatform} options={PLATFORMS} />
        </View>
        <Input label="Tone (optional)" value={tone} onChangeText={setTone} placeholder="e.g. playful, premium, no-nonsense" />
        <Button title="Write listing" onPress={write} loading={running} disabled={!productId && !name.trim()} />
      </Card>
      {running ? <Working text="Writing your listing…" /> : null}
      {error ? <ErrorBox error={error} onRetry={write} /> : null}

      {l && !running ? (
        <>
          <Card style={{ gap: Spacing.sm }}>
            <T kind="label">Title</T>
            <T style={{ fontWeight: '700' }}>{l.title}</T>
            <T kind="label">Short description</T>
            <T>{l.short_description}</T>
          </Card>
          <Section title="Bullet points">
            <Card>
              <Bullets items={l.bullet_points} />
            </Card>
          </Section>
          <Section title="Description">
            <Card>
              <T>{l.description}</T>
            </Card>
          </Section>
          <Card style={{ gap: Spacing.sm }}>
            <T kind="label">SEO keywords</T>
            <T>{l.seo_keywords.join(', ')}</T>
            <T kind="label">Hashtags</T>
            <T>{l.hashtags.join(' ')}</T>
          </Card>
          {l.missing_info.length ? (
            <Section title="Add these to make it stronger">
              <Card>
                <Bullets items={l.missing_info} />
              </Card>
            </Section>
          ) : null}
          <Row>
            <Button title="Copy all" onPress={() => Clipboard.setStringAsync(fullText)} style={{ flex: 1 }} />
          </Row>
        </>
      ) : null}
    </Screen>
  );
}
