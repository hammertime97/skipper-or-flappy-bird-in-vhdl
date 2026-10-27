import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorBox, Input, Loading, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

/** Selling fees per platform, so profit is what the seller really keeps. */
export default function FeesScreen() {
  const { data, error, loading, refresh } = useApi(() => api.fees());
  const [edits, setEdits] = useState<Record<string, { pct?: string; fixed?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = Object.fromEntries(
        Object.entries(data.fees).map(([k, f]) => [
          k,
          { pct: Number(edits[k]?.pct ?? f.pct) || 0, fixed: Number(edits[k]?.fixed ?? f.fixed) || 0 },
        ]),
      );
      await api.saveFees(body);
      setEdits({});
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={[]}>
      <T kind="secondary">
        Each platform takes a cut of every sale. We take these off your profit. The numbers below are typical rates for most
        categories; change them to match your account.
      </T>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}
      {data
        ? Object.entries(data.fees).map(([k, f]) => (
            <Card key={k} style={{ gap: Spacing.sm }}>
              <T style={{ fontWeight: '700' }}>{f.label}</T>
              <Row>
                <View style={{ flex: 1 }}>
                  <Input
                    label="% of each sale"
                    value={edits[k]?.pct ?? String(f.pct)}
                    onChangeText={(v) => setEdits({ ...edits, [k]: { ...edits[k], pct: v } })}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="+ fixed per order"
                    value={edits[k]?.fixed ?? String(f.fixed)}
                    onChangeText={(v) => setEdits({ ...edits, [k]: { ...edits[k], fixed: v } })}
                    keyboardType="decimal-pad"
                  />
                </View>
              </Row>
            </Card>
          ))
        : null}
      {saveError ? <ErrorBox error={saveError} /> : null}
      {data ? <Button title={saved ? 'Saved ✓' : 'Save'} onPress={save} loading={saving} /> : null}
    </Screen>
  );
}
