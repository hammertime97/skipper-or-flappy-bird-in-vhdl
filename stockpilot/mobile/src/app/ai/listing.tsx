import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Working } from '@/components/ai-bits';
import { Bullets, Button, Card, Chips, ErrorBox, Input, Row, Screen, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { api, SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { draftListing, type ListingDraft } from '@/lib/offline-tools';
import type { ListingPlatform } from '@/lib/types';

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
  const { local } = useAuth();
  const aiAvailable = SERVER_ENABLED && !local;
  const [l, setListing] = useState<(Omit<ListingDraft, 'titleLimit'> & { titleLimit?: ListingDraft['titleLimit'] }) | null>(null);
  const [polished, setPolished] = useState(false);
  const { run, running, error } = useAiRun(api.listing);

  // Opened from a product page: start from that product's name.
  useEffect(() => {
    if (productId) api.product(Number(productId)).then((p) => setName(p.name)).catch(() => {});
  }, [productId]);

  /** Instant draft from what the seller typed; nothing is invented. */
  const write = () => {
    setListing(draftListing(name.trim(), details, platform));
    setPolished(false);
  };

  const polish = async () => {
    const r = await run({ product_id: productId ? Number(productId) : undefined, name: name.trim() || undefined, details, platform, tone });
    if (r) {
      setListing({ ...r.listing, titleLimit: l?.titleLimit });
      setPolished(true);
    }
  };

  const fullText = l
    ? [l.title, '', l.short_description, '', ...l.bullet_points.map((b) => `• ${b}`), '', l.description, '', l.hashtags.join(' ')].join('\n')
    : '';

  return (
    <Screen edges={[]}>
      <Card style={{ gap: Spacing.md }}>
        <Input label="Product name" value={name} onChangeText={setName} placeholder="e.g. Self-cleaning slicker brush" />
        <Input
          label="Details, one per line (materials, sizes, what's in the box, who it's for)"
          value={details}
          onChangeText={setDetails}
          multiline
          style={{ minHeight: 90, textAlignVertical: 'top' }}
        />
        <View style={{ gap: Spacing.xs }}>
          <T kind="label">Platform</T>
          <Chips value={platform} onChange={setPlatform} options={PLATFORMS} />
        </View>
        <Button title="Write listing" onPress={write} disabled={!name.trim()} />
      </Card>
      {running ? <Working text="Polishing your listing…" /> : null}
      {error ? <ErrorBox error={error} onRetry={polish} /> : null}

      {l && !running ? (
        <>
          <Card style={{ gap: Spacing.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T kind="label">Title</T>
              <T kind="muted">
                {l.title.length}
                {l.titleLimit ? ` / ${l.titleLimit[0]} (${l.titleLimit[1]})` : ' characters'}
              </T>
            </Row>
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
          {aiAvailable && !polished ? (
            <Card style={{ gap: Spacing.sm }}>
              <T kind="secondary">Want it to read better? AI rewrites it in the platform&apos;s style, with the search terms shoppers use.</T>
              <Input label="Tone (optional)" value={tone} onChangeText={setTone} placeholder="e.g. playful, premium, no-nonsense" />
              <Button title="Polish with AI" kind="secondary" onPress={polish} loading={running} />
            </Card>
          ) : null}
          {polished ? <T kind="muted">Polished by AI. Check every claim before you publish.</T> : <T kind="muted">Draft built only from your details. Replace the [brackets] and edit freely.</T>}
        </>
      ) : null}
    </Screen>
  );
}
