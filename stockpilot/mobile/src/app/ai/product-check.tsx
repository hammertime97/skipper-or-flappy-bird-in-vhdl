import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { KV, Sources, Working } from '@/components/ai-bits';
import { ScoreBar } from '@/components/charts';
import { Bullets, Button, Card, ErrorBox, Input, Row, Screen, Section, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import type { ProductCheckReport } from '@/lib/types';

export default function ProductCheck() {
  const c = useTheme();
  const params = useLocalSearchParams<{ idea?: string }>();
  const [idea, setIdea] = useState(params.idea ?? '');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [result, setResult] = useState<ProductCheckReport | null>(null);
  const { run, running, error } = useAiRun(api.productCheck);

  const check = async () => {
    const r = await run(idea.trim(), cost ? Number(cost) : undefined, price ? Number(price) : undefined);
    if (r) setResult(r);
  };

  const VERDICT = {
    go: { label: '✓ Go for it', color: c.good },
    test_small: { label: '◐ Test it small first', color: c.warning },
    skip: { label: '✕ Skip it', color: c.critical },
  };

  return (
    <Screen edges={[]}>
      <Card style={{ gap: Spacing.md }}>
        <Input label="Product idea" value={idea} onChangeText={setIdea} placeholder="e.g. heated pet bed with timer" multiline />
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="Your unit cost (optional)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Planned price (optional)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          </View>
        </Row>
        <Button title="Should I sell this?" onPress={check} loading={running} disabled={idea.trim().length < 3} />
      </Card>
      {running ? <Working text="Checking demand, competition, prices and red flags across the web…" /> : null}
      {error ? <ErrorBox error={error} onRetry={check} /> : null}

      {result && !running ? (
        <>
          <Card style={{ gap: Spacing.sm, borderLeftWidth: 4, borderLeftColor: VERDICT[result.result.verdict].color }}>
            <T kind="heading">{VERDICT[result.result.verdict].label}</T>
            <T>{result.result.one_line}</T>
          </Card>
          <Card style={{ gap: Spacing.md }}>
            <ScoreBar label="Demand" score={result.result.demand_score} />
            <ScoreBar label="Competition" score={result.result.competition_score} invert />
            <ScoreBar label="Margin" score={result.result.margin_score} />
          </Card>
          <Card style={{ gap: Spacing.md }}>
            <KV k="Estimated margin" v={result.result.estimated_margin} />
            <KV k="Typical retail price" v={result.result.typical_retail_price} />
            <KV k="Seasonality" v={result.result.seasonality} />
            <KV k="Target customer" v={result.result.target_customer} />
            <KV k="Best channels" v={result.result.best_channels.join(', ')} />
          </Card>
          <Section title="Cheap test plan">
            <Card>
              <T>{result.result.first_test_plan}</T>
            </Card>
          </Section>
          {result.result.angles.length ? (
            <Section title="Angles to beat competitors">
              <Card>
                <Bullets items={result.result.angles} />
              </Card>
            </Section>
          ) : null}
          {result.result.red_flags.length ? (
            <Section title="Red flags">
              <Card>
                <Bullets items={result.result.red_flags} />
              </Card>
            </Section>
          ) : null}
          <Sources sources={result.sources} />
        </>
      ) : null}
    </Screen>
  );
}
