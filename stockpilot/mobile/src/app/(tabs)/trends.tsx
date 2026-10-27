import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { KV, Sources, Working } from '@/components/ai-bits';
import { Badge, Bullets, Button, Card, ErrorBox, Input, Row, Screen, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, money } from '@/lib/format';
import type { Product, TrendingProduct, TrendReport } from '@/lib/types';

const MOMENTUM = { exploding: '🚀 Exploding', rising: '▲ Rising', steady: '→ Steady' };

/** What's booming in the seller's niche, and their list of products to try. */
export default function TrendsScreen() {
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const [niche, setNiche] = useState(user?.niche ?? '');
  const [market, setMarket] = useState(user?.target_market ?? '');
  const [editing, setEditing] = useState(false);
  const latest = useApi(() => api.reports<TrendReport>('trend_scout', 1));
  const ideas = useApi(() => api.ideas());
  const [fresh, setFresh] = useState<TrendReport | null>(null);
  const { run, running, error } = useAiRun(api.trendScout);
  const report = fresh ?? latest.data?.[0] ?? null;
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [addError, setAddError] = useState<Error | null>(null);

  const scan = async () => {
    const r = await run(niche.trim(), market.trim());
    if (r) {
      setFresh(r);
      setEditing(false);
    }
  };

  const addToStore = async (tp: TrendingProduct) => {
    setAddError(null);
    try {
      await api.addIdea({
        name: tp.name,
        est_price: tp.est_retail_price || undefined,
        est_cost: tp.est_supplier_cost || undefined,
        note: tp.supplier_search,
        report_id: report?.id,
      });
      setAdded({ ...added, [tp.name]: true });
      await ideas.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setAdded({ ...added, [tp.name]: true });
      else setAddError(e as Error);
    }
  };

  const showForm = !report || editing;

  return (
    <Screen refreshing={latest.refreshing} onRefresh={() => Promise.all([latest.refresh(), ideas.refresh()])}>
      <View style={{ gap: 4 }}>
        <T kind="title">Trending now</T>
        <T kind="secondary">
          We search TikTok Shop, Amazon best-sellers, Google Trends and competitor stores for your niche, and tell you
          what to add to your store.
        </T>
      </View>

      {showForm ? (
        <Card style={{ gap: Spacing.md }}>
          <Input label="Your niche (what you sell)" value={niche} onChangeText={setNiche} placeholder="e.g. pet accessories, home gym" />
          <Input label="Where your customers are" value={market} onChangeText={setMarket} placeholder="e.g. UK, US" />
          <Button title="Find trending products" onPress={scan} loading={running} disabled={!niche.trim()} />
          <T kind="muted">Takes 1–2 minutes. Uses 1 AI request.</T>
        </Card>
      ) : (
        <Card style={{ gap: Spacing.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T kind="secondary" style={{ flex: 1 }}>
              {report?.niche} · checked {report ? ago(report.created_at) : ''}
            </T>
            <Button title="New scan" kind="secondary" onPress={() => setEditing(true)} style={{ minHeight: 34 }} />
          </Row>
        </Card>
      )}

      {running ? <Working text="Searching TikTok Shop, Amazon, Google Trends and competitor stores…" /> : null}
      {error ? <ErrorBox error={error} onRetry={scan} /> : null}

      {ideas.data && ideas.data.length ? <IdeaList ideas={ideas.data} cur={cur} onChange={ideas.refresh} /> : null}

      {report && !running ? (
        <>
          <Card>
            <T>{report.report.niche_summary}</T>
          </Card>
          <Section title="Add these to your store">
            {addError ? <ErrorBox error={addError} /> : null}
            {report.report.trending_products.map((tp, i) => (
              <Card key={tp.name} style={{ gap: Spacing.sm }}>
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
                <KV k="How to sell it" v={tp.how_to_sell_it} />
                <KV k="Fit with your store" v={tp.fit_with_store} />
                <KV k="Supplier cost" v={tp.typical_supplier_cost} />
                {tp.supplier_search ? <KV k="Search suppliers for" v={tp.supplier_search} /> : null}
                <KV k="Risk" v={tp.risk} />
                <Row>
                  <Button
                    title={added[tp.name] ? 'Added to your ideas ✓' : 'Add to my store'}
                    onPress={() => addToStore(tp)}
                    disabled={added[tp.name]}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Check it"
                    kind="secondary"
                    onPress={() => router.push({ pathname: '/ai/product-check', params: { idea: tp.name } })}
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

function IdeaList({ ideas, cur, onChange }: { ideas: Product[]; cur: string; onChange: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      onChange();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title={`Your ideas (${ideas.length})`}>
      <T kind="muted">Products you saved. When you list one, tap Start selling and it moves into your stock.</T>
      {ideas.map((p) => (
        <Card key={p.id} style={{ gap: Spacing.xs }}>
          <T style={{ fontWeight: '700' }}>{p.name}</T>
          <T kind="muted">
            {p.sell_price ? `Sell around ${money(p.sell_price, cur)}` : 'Price not set'}
            {p.cost_price ? ` · cost around ${money(p.cost_price, cur)}` : ''}
          </T>
          <Row>
            <Button
              title="Start selling"
              onPress={() => act(p.id, () => api.startSelling(p.id, {}))}
              loading={busy === p.id}
              style={{ flex: 1, minHeight: 38 }}
            />
            <Button title="Remove" kind="secondary" onPress={() => act(p.id, () => api.removeIdea(p.id))} style={{ minHeight: 38 }} />
          </Row>
        </Card>
      ))}
    </Section>
  );
}
