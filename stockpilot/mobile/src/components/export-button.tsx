import { router } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorBox } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { datedName, shareSpreadsheet } from '@/lib/export';

type Cell = string | number | null | undefined;

/** Pro: export a table to a spreadsheet. Free users are shown what Pro includes instead. */
export function ExportButton({ what, rows, title = 'Export to spreadsheet' }: { what: string; rows: () => Cell[][]; title?: string }) {
  const { user } = useAuth();
  const pro = user?.billing.plan === 'pro';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = async () => {
    if (!pro) {
      router.push('/paywall');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shareSpreadsheet(datedName(what), rows());
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button title={pro ? title : `${title} (Pro)`} kind="secondary" onPress={run} loading={busy} />
      {error ? <ErrorBox error={error} /> : null}
    </>
  );
}
