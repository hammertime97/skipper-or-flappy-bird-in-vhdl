import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { KV, Sources, Working } from '@/components/ai-bits';
import { ScoreBar } from '@/components/charts';
import { Badge, Bullets, Button, Card, Chips, ErrorBox, Input, Row, Screen, Section, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { checkProduct, type CheckResult } from '@/lib/offline-tools';
import type { ProductCheckReport } from '@/lib/types';

const MOMENTUM = { exploding: '🚀 Exploding', rising: '▲ Rising', steady: '→ Steady' };

/** "Should I sell this?": margin after fees, trend match and red flags, instantly and without AI. */
export default function ProductCheck() {
  const c = useTheme();
  const { user, local } = useAuth();
  const cur = user?.currency ?? 'USD';
  const params = useLocalSearchParams<{ idea?: string; price?: string }>();
  const fees = useApi(api.fees);
  const lib = useApi(api.trendLibrary);
  const [idea, setIdea] = useState(params.idea ?? '');
  const [price, setPrice] = useState(params.price ?? '');
  const [cost, setCost] = useState('');
  const [ship, setShip] = useState('');
  const [ads, setAds] = useState('');
  const [channel, setChannel] = useState('ebay');
  const [result, setResult] = useState<(CheckResult & { idea: string }) | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [aiResult, setAiResult] = useState<ProductCheckReport | null>(null);
  const { run, running, error } = useAiRun(api.productCheck);
  const aiAvailable = SERVER_ENABLED && !local;

  const n = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const fee = fees.data?.fees[channel] ?? { label: '', pct: 0, fixed: 0 };

  const check = () => {
    setSaved(false);
    setAiResult(null);
    setResult({ idea: idea.trim(), ...checkProduct(idea, { price: n(price), cost: n(cost), shipping: n(ship), ads: n(ads), feePct: fee.pct, feeFixed: fee.fixed }, lib.data, cur) });
  };

  const save = async () => {
    setSaveError(null);
    try {
      await api.addIdea({ name: idea.trim(), est_price: n(price) || undefined, est_cost: n(cost) || undefined });
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setSaved(true);
      else setSaveError(e as Error);
    }
  };

  const deeper = async () => {
    const r = await run(idea.trim(), n(cost) || undefined, n(price) || undefined);
    if (r) setAiResult(r);
  };

  const VERDICT = {
    go: { label: '✓ The numbers work', color: c.good },
    test_small: { label: '◐ Test it small first', color: c.warning },
    skip: { label: '✕ Skip it at this price', color: c.critical },
    need_numbers: { label: 'Add your numbers', color: c.border },
  };
  const AI_VERDICT = { go: '✓ Go for it', test_small: '◐ Test it small first', skip: '✕ Skip it' };
  const calc = result?.calc;

  return (
    <Screen edges={[]}>
      <T kind="secondary">Thinking of selling something new? Check the margin, whether it&apos;s trending and what could go wrong, before you buy stock.</T>
      <Card style={{ gap: Spacing.md }}>
        <Input label="Product idea" value={idea} onChangeText={setIdea} placeholder="e.g. heated pet bed with timer" multiline />
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="You sell it for" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="24.99" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="You pay per item" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="6.50" />
          </View>
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="Shipping you pay" value={ship} onChangeText={setShip} keyboardType="decimal-pad" placeholder="3.20" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Ad cost per sale" value={ads} onChangeText={setAds} keyboardType="decimal-pad" placeholder="0" />
          </View>
        </Row>
        <T kind="label">Where you&apos;ll sell it</T>
        {fees.data ? (
          <Chips value={channel} onChange={setChannel} options={Object.entries(fees.data.fees).map(([k, f]) => ({ value: k, label: `${f.label} ${f.pct}%` }))} />
        ) : null}
        <Button title="Should I sell this?" onPress={check} disabled={idea.trim().length < 3} />
      </Card>

      {result ? (
        <>
          <Card style={{ gap: Spacing.xs, borderLeftWidth: 4, borderLeftColor: VERDICT[result.verdict].color }}>
            <T kind="muted">{result.idea}</T>
            <T kind="heading">{VERDICT[result.verdict].label}</T>
            <T>{result.why}</T>
          </Card>
          {calc ? (
            <>
              <Row style={{ flexWrap: 'wrap' }}>
                <StatTile label="Profit per sale" value={money(calc.profit, cur)} />
                <StatTile label="Platform fees" value={money(calc.fees, cur)} />
              </Row>
              <Row style={{ flexWrap: 'wrap' }}>
                <StatTile label="Most you can spend on ads per sale" value={money(calc.maxAdCost, cur)} />
                <StatTile label="Price for a 30% margin" value={calc.priceFor30 == null ? '–' : money(calc.priceFor30, cur)} />
              </Row>
            </>
          ) : null}

          <Section title="Is it trending?">
            {result.trends.length ? (
              result.trends.map(({ item, niche }) => (
                <Card key={item.name} style={{ gap: Spacing.xs }}>
                  <T style={{ fontWeight: '700' }}>{item.name}</T>
                  <T kind="muted">{niche}</T>
                  <Row style={{ flexWrap: 'wrap' }}>
                    <Badge text={MOMENTUM[item.momentum]} tone="tint" />
                    <Badge text={`${item.competition} competition`} />
                  </Row>
                  <T kind="secondary">{item.signal}</T>
                  <T kind="muted" style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL(item.source)}>
                    Source ↗
                  </T>
                </Card>
              ))
            ) : (
              <Card>
                <T kind="secondary">
                  Not in our trends list. That can be good (less competition) but means less proof of demand. Look it up on TikTok Shop and
                  Amazon best-sellers before buying stock.
                </T>
              </Card>
            )}
          </Section>

          <Section title="Red flags to check">
            <Card>
              {result.flags.length ? (
                <Bullets items={result.flags} />
              ) : (
                <T kind="secondary">No common rule or shipping problems spotted from the name. Still ask the supplier for photos of the real product and its packaging.</T>
              )}
            </Card>
          </Section>

          <Section title="Cheap test plan">
            <Card>
              <Bullets
                items={[
                  'Order 1–3 samples and check quality and real delivery time.',
                  'List it (or offer it as dropship) with your own photos or a short video.',
                  `Spend at most ${money(result.testBudget, cur)} on ads over a week.`,
                  'Keep it if it sells at a profit; cut it if not. No big stock order until then.',
                ]}
              />
            </Card>
          </Section>
          {saveError ? <ErrorBox error={saveError} /> : null}
          <Button title={saved ? 'Saved to your ideas ✓' : 'Add to my ideas'} kind="secondary" onPress={save} disabled={saved} />

          {aiAvailable ? (
            <Card style={{ gap: Spacing.sm }}>
              <T style={{ fontWeight: '700' }}>Deeper check (optional)</T>
              <T kind="secondary">AI searches the web for demand, saturation, typical prices and customer complaints for this exact product.</T>
              <Button title="Check with AI" kind="secondary" onPress={deeper} loading={running} />
            </Card>
          ) : null}
        </>
      ) : null}

      {running ? <Working text="Checking demand, competition, prices and red flags across the web…" /> : null}
      {error ? <ErrorBox error={error} onRetry={deeper} /> : null}
      {aiResult && !running ? (
        <>
          <Card style={{ gap: Spacing.sm }}>
            <T kind="label">AI view</T>
            <T kind="heading">{AI_VERDICT[aiResult.result.verdict]}</T>
            <T>{aiResult.result.one_line}</T>
          </Card>
          <Card style={{ gap: Spacing.md }}>
            <ScoreBar label="Demand" score={aiResult.result.demand_score} />
            <ScoreBar label="Competition" score={aiResult.result.competition_score} invert />
            <ScoreBar label="Margin" score={aiResult.result.margin_score} />
          </Card>
          <Card style={{ gap: Spacing.md }}>
            <KV k="Typical retail price" v={aiResult.result.typical_retail_price} />
            <KV k="Seasonality" v={aiResult.result.seasonality} />
            <KV k="Target customer" v={aiResult.result.target_customer} />
            <KV k="Best channels" v={aiResult.result.best_channels.join(', ')} />
          </Card>
          {aiResult.result.angles.length ? (
            <Section title="Angles to beat competitors">
              <Card>
                <Bullets items={aiResult.result.angles} />
              </Card>
            </Section>
          ) : null}
          <Sources sources={aiResult.sources} />
        </>
      ) : null}
    </Screen>
  );
}
