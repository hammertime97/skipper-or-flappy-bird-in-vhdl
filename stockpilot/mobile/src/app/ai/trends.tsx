import { router } from 'expo-router';
import { useState } from 'react';

import { KV, Sources, Working } from '@/components/ai-bits';
import { Badge, Bullets, Button, Card, ErrorBox, Input, Row, Screen, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import type { TrendReport } from '@/lib/types';

const MOMENTUM = { exploding: '🚀 Exploding', rising: '▲ Rising', steady: '→ Steady' };

export default function Trends() {
  const { user } = useAuth();
  const [niche, setNiche] = useState(user?.niche ?? '');
  const [market, setMarket] = useState(user?.target_market ?? '');
  const latest = useApi(() => api.reports<TrendReport>('trend_scout', 1));
  const [fresh, setFresh] = useState<TrendReport | null>(null);
  const { run, running, error } = useAiRun(api.trendScout);
  const report = fresh ?? latest.data?.[0] ?? null;

  const scan = async () => {
    const r = await run(niche.trim(), market.trim());
    if (r) setFresh(r);
  };

  return (
    <Screen edges={[]}>
      <Card style={{ gap: Spacing.md }}>
        <T kind="secondary">
          Trend Scout searches the web for what&apos;s selling in your niche right now and what competitors are pushing.
        </T>
        <Input label="Niche" value={niche} onChangeText={setNiche} placeholder="e.g. pet accessories" />
        <Input label="Market" value={market} onChangeText={setMarket} placeholder="e.g. UK" />
        <Button title="Scan my niche" onPress={scan} loading={running} disabled={!niche.trim()} />
      </Card>
      {running ? <Working text="Searching TikTok Shop, Amazon, Google Trends and competitor stores. This takes a minute or two." /> : null}
      {error ? <ErrorBox error={error} onRetry={scan} /> : null}

      {report && !running ? (
        <>
          <Card style={{ gap: Spacing.sm }}>
            <T kind="muted">
              {report.niche} · {ago(report.created_at)}
            </T>
            <T>{report.report.niche_summary}</T>
          </Card>
          <Section title="Add these to your store">
            {report.report.trending_products.map((tp, i) => (
              <Card key={i} style={{ gap: Spacing.sm }}>
                <T kind="heading">
                  {i + 1}. {tp.name}
                </T>
                <Row style={{ flexWrap: 'wrap' }}>
                  <Badge text={MOMENTUM[tp.momentum]} tone="tint" />
                  <Badge text={`${tp.competition} competition`} />
                  <Badge text={tp.typical_retail_price} />
                </Row>
                <KV k="Why it's trending" v={tp.why_trending} />
                <KV k="Evidence" v={tp.evidence} />
                <KV k="Fit with your store" v={tp.fit_with_store} />
                <KV k="How to sell it" v={tp.how_to_sell_it} />
                <KV k="Supplier cost" v={tp.typical_supplier_cost} />
                <KV k="Risk" v={tp.risk} />
                <Row>
                  <Button
                    title="Check it"
                    kind="secondary"
                    onPress={() => router.push({ pathname: '/ai/product-check', params: { idea: tp.name } })}
                  />
                  <Button
                    title="Add product"
                    kind="secondary"
                    onPress={() => router.push('/product/edit')}
                  />
                </Row>
              </Card>
            ))}
          </Section>
          {report.report.fading_trends.length ? (
            <Section title="Cooling off">
              <Card>
                <Bullets items={report.report.fading_trends} />
              </Card>
            </Section>
          ) : null}
          {report.report.competitor_moves.length ? (
            <Section title="What competitors are doing">
              <Card>
                <Bullets items={report.report.competitor_moves} />
              </Card>
            </Section>
          ) : null}
          {report.report.content_ideas.length ? (
            <Section title="Video & ad hooks">
              <Card>
                <Bullets items={report.report.content_ideas} />
              </Card>
            </Section>
          ) : null}
          <Sources sources={report.sources} />
        </>
      ) : null}
    </Screen>
  );
}
