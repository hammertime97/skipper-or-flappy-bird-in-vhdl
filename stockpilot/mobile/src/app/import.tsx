import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';

import { Bullets, Button, Card, ErrorBox, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

export default function ImportScreen() {
  const [busy, setBusy] = useState<'products' | 'sales' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const pick = async (kind: 'products' | 'sales') => {
    setError(null);
    setResult(null);
    setProblems([]);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const file = res.assets[0];
    setBusy(kind);
    try {
      const out = await api.importCsv(kind, { uri: file.uri, name: file.name, mimeType: file.mimeType });
      setResult(
        kind === 'products'
          ? `${out.created ?? 0} products added, ${out.updated ?? 0} updated.`
          : `${out.imported ?? 0} sales imported.`,
      );
      setProblems(out.errors);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={[]}>
      <Card style={{ gap: Spacing.sm }}>
        <T kind="heading">1. Products</T>
        <T kind="secondary">
          Columns: sku, name, category, cost_price, sell_price, stock_qty, lead_time_days, supplier, fulfilment (own_stock or
          dropship). A Shopify product export works too.
        </T>
        <Button title="Choose products CSV" onPress={() => pick('products')} loading={busy === 'products'} />
      </Card>
      <Card style={{ gap: Spacing.sm }}>
        <T kind="heading">2. Sales history</T>
        <T kind="secondary">
          Columns: sku, quantity, unit_price, sold_at (YYYY-MM-DD), channel. A Shopify orders export works too. More history means
          better forecasts; 8+ weeks is ideal.
        </T>
        <Button title="Choose sales CSV" onPress={() => pick('sales')} loading={busy === 'sales'} />
      </Card>
      {result ? (
        <Card style={{ gap: Spacing.sm }}>
          <T style={{ fontWeight: '700' }}>{result}</T>
          {problems.length ? (
            <>
              <T kind="secondary">Rows skipped:</T>
              <Bullets items={problems} />
            </>
          ) : null}
        </Card>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}
    </Screen>
  );
}
