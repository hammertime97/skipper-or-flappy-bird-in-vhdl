import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Badge, Bullets, Button, Card, Chips, ErrorBox, Loading, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import type { ImportGuide, ImportPreview, ImportResult, ImportSheet } from '@/lib/types';

type Step = 'pick' | 'guide' | 'preview' | 'done';

/**
 * Import wizard: pick where you sell -> follow the steps to download your file ->
 * upload it (or try a sample) -> check what we read -> import.
 */
export default function ImportScreen() {
  const params = useLocalSearchParams<{ platform?: string }>();
  const [guides, setGuides] = useState<ImportGuide[] | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [step, setStep] = useState<Step>('pick');
  const [guide, setGuide] = useState<ImportGuide | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overrides, setOverrides] = useState<Record<number, { kind?: string; mapping: Record<string, string> }>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    api
      .importGuides()
      .then((g) => {
        setGuides(g.guides);
        setRoles(g.roles);
        const pre = g.guides.find((x) => x.key === params.platform);
        if (pre) {
          setGuide(pre);
          setStep('guide');
        }
      })
      .catch((e) => setError(e));
  }, [params.platform]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error(String(e)));
    } finally {
      setBusy(null);
    }
  };

  const pickFile = () =>
    run('file', async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'text/tab-separated-values',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets[0]) return;
      const f = res.assets[0];
      setPreview(await api.uploadFile({ uri: f.uri, name: f.name, mimeType: f.mimeType }));
      setOverrides({});
      setStep('preview');
    });

  const trySample = () =>
    run('sample', async () => {
      setPreview(await api.trySample(guide?.key ?? 'spreadsheet'));
      setOverrides({});
      setStep('preview');
    });

  const confirm = () =>
    run('confirm', async () => {
      if (!preview) return;
      const sheets = Object.entries(overrides).map(([i, o]) => ({ index: Number(i), kind: o.kind, mapping: o.mapping }));
      setResult(await api.confirmImport(preview.job_id, sheets));
      setStep('done');
    });

  if (!guides && !error) return <Loading />;

  return (
    <Screen edges={[]}>
      {error ? <ErrorBox error={error} /> : null}

      {step === 'pick' && guides ? (
        <>
          <View style={{ gap: 4 }}>
            <T kind="title">Where do you sell?</T>
            <T kind="secondary">Pick one. We&apos;ll show you exactly how to download your sales file. It takes about 2 minutes.</T>
          </View>
          {guides.map((g) => (
            <Card
              key={g.key}
              onPress={() => {
                setGuide(g);
                setStep('guide');
              }}>
              <T kind="heading">{g.name}</T>
              <T kind="secondary">{g.what}</T>
            </Card>
          ))}
          <T kind="muted">Sell in more than one place? Do them one after the other. Everything adds up in one dashboard.</T>
        </>
      ) : null}

      {step === 'guide' && guide ? (
        <>
          <View style={{ gap: 4 }}>
            <T kind="title">Get your {guide.name} file</T>
            <T kind="secondary">{guide.file_hint}</T>
          </View>
          <Card style={{ gap: Spacing.md }}>
            {guide.steps.map((s, i) => (
              <Row key={i} style={{ alignItems: 'flex-start' }}>
                <StepNumber n={i + 1} />
                <T style={{ flex: 1 }}>{s}</T>
              </Row>
            ))}
          </Card>
          <Card style={{ gap: Spacing.xs }}>
            <T kind="label">Tip</T>
            <T kind="secondary">{guide.tip}</T>
            <T kind="secondary">{guide.stock_tip}</T>
          </Card>
          <Button title="I have my file: choose it" onPress={pickFile} loading={busy === 'file'} />
          <Button title={`No file yet? Try a sample ${guide.key === 'spreadsheet' ? 'Excel' : guide.name} file`} kind="secondary" onPress={trySample} loading={busy === 'sample'} />
          <T kind="muted">The sample is made-up data in the same layout as a real {guide.name} download, so you can see how it works.</T>
          <Button title="Back" kind="secondary" onPress={() => setStep('pick')} />
        </>
      ) : null}

      {step === 'preview' && preview ? (
        <>
          <View style={{ gap: 4 }}>
            <T kind="title">Check what we found</T>
            <T kind="secondary">Nothing is saved until you tap Import.</T>
          </View>
          {preview.sheets.map((sh, i) => (
            <SheetCard
              key={i}
              sheet={sh}
              roles={roles}
              override={overrides[i]}
              onChange={(o) => setOverrides({ ...overrides, [i]: o })}
            />
          ))}
          <Button
            title="Looks right: import"
            onPress={confirm}
            loading={busy === 'confirm'}
            disabled={!preview.sheets.some((sh, i) => sh.ready || isFixed(sh, overrides[i], roles))}
          />
          <Button title="Choose a different file" kind="secondary" onPress={() => setStep('guide')} />
        </>
      ) : null}

      {step === 'done' && result ? (
        <>
          <T kind="title">Done</T>
          <Card>
            <Bullets items={result.summary} />
          </Card>
          {result.needs_stock.length ? (
            <Card style={{ gap: Spacing.sm }}>
              <T style={{ fontWeight: '700' }}>Next: how many do you have?</T>
              <T kind="secondary">
                Sales files don&apos;t include stock. Type the stock for {result.needs_stock.length} products and we&apos;ll
                tell you what to reorder and when. Dropshipping? Use your supplier&apos;s stock, or skip this.
              </T>
              <Button title="Add stock counts" onPress={() => router.replace('/stock-counts')} />
            </Card>
          ) : null}
          {result.needs_cost.length ? (
            <Card style={{ gap: Spacing.sm }}>
              <T style={{ fontWeight: '700' }}>Then: what do you pay per item?</T>
              <T kind="secondary">Add the cost for {result.needs_cost.length} products so your profit is right.</T>
              <Button title="Add costs" kind="secondary" onPress={() => router.replace({ pathname: '/stock-counts', params: { tab: 'cost' } })} />
            </Card>
          ) : null}
          <Button title="See my dashboard" kind={result.needs_stock.length ? 'secondary' : 'primary'} onPress={() => router.navigate('/')} />
          <Button title="Upload another file" kind="secondary" onPress={() => setStep('pick')} />
        </>
      ) : null}
    </Screen>
  );
}

function isFixed(sh: ImportSheet, o: { kind?: string; mapping: Record<string, string> } | undefined, roles: Record<string, string>) {
  if (!o) return false;
  const labelToRole = Object.fromEntries(Object.entries(roles).map(([k, v]) => [v, k]));
  return sh.missing.every((label) => o.mapping[labelToRole[label]]);
}

function StepNumber({ n }: { n: number }) {
  const c = useTheme();
  return (
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color: c.tintText, fontWeight: '800', fontSize: 13 }}>{n}</T>
    </View>
  );
}

function SheetCard({
  sheet,
  roles,
  override,
  onChange,
}: {
  sheet: ImportSheet;
  roles: Record<string, string>;
  override?: { kind?: string; mapping: Record<string, string> };
  onChange: (o: { kind?: string; mapping: Record<string, string> }) => void;
}) {
  const labelToRole = Object.fromEntries(Object.entries(roles).map(([k, v]) => [v, k]));
  const o = override ?? { mapping: {} };
  return (
    <Card style={{ gap: Spacing.sm }}>
      <Row style={{ flexWrap: 'wrap' }}>
        <Badge text={sheet.platform === 'spreadsheet' ? 'Spreadsheet' : sheet.platform_name} tone="tint" />
        <Badge text={sheet.kind === 'orders' ? 'Sales' : 'Stock list'} />
        {sheet.sheet ? <Badge text={`Tab: ${sheet.sheet}`} /> : null}
        {sheet.ai_mapped ? <Badge text="Columns read by AI" /> : null}
      </Row>
      <T style={{ fontWeight: '700' }}>{sheet.headline}</T>
      {sheet.notes.length ? <Bullets items={sheet.notes} /> : null}
      {sheet.reads.length ? (
        <View style={{ gap: 2 }}>
          <T kind="label">We read</T>
          {sheet.reads.map((r) => (
            <T key={r.role} kind="secondary">
              {r.label} ← “{r.column}”
            </T>
          ))}
        </View>
      ) : null}
      {sheet.examples.length ? (
        <View style={{ gap: 2 }}>
          <T kind="label">First rows</T>
          {sheet.examples.map((e, i) => (
            <T key={i} kind="muted" numberOfLines={1}>
              {Object.values(e)
                .filter((v) => v !== null && v !== '')
                .join(' · ')}
            </T>
          ))}
        </View>
      ) : null}
      {sheet.missing.length ? (
        <View style={{ gap: Spacing.sm }}>
          <T style={{ fontWeight: '700' }}>Help us with {sheet.missing.length === 1 ? 'one column' : 'a few columns'}</T>
          {sheet.platform === 'spreadsheet' ? (
            <View style={{ gap: 4 }}>
              <T kind="label">This sheet is a…</T>
              <Chips
                value={o.kind ?? sheet.kind}
                onChange={(kind) => onChange({ ...o, kind })}
                options={[
                  { value: 'orders', label: 'List of sales' },
                  { value: 'stock', label: 'Stock list' },
                ]}
              />
            </View>
          ) : null}
          {sheet.missing.map((label) => {
            const role = labelToRole[label];
            return (
              <View key={label} style={{ gap: 4 }}>
                <T kind="label">Which column is “{label}”?</T>
                <Chips
                  value={o.mapping[role] ?? ''}
                  onChange={(col) => onChange({ ...o, mapping: { ...o.mapping, [role]: col } })}
                  options={sheet.columns.filter(Boolean).map((col) => ({ value: col, label: col }))}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}
