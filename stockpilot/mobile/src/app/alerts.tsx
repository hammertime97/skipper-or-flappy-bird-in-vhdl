import { useEffect, useState } from 'react';

import { AlertCard } from '@/components/alert-card';
import { Button, Card, Empty, ErrorBox, Loading, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { notificationsOn, notificationsSupported, scheduleNotifications, turnOffNotifications, turnOnNotifications } from '@/lib/notify';


/** Everything StockPilot noticed, most urgent first, plus the phone-notification switch. */
export default function Alerts() {
  const c = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi(() => api.alerts());
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    void notificationsOn().then(setOn);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setNote('');
    try {
      if (on) {
        await turnOffNotifications();
        setOn(false);
      } else {
        const ok = await turnOnNotifications();
        setOn(ok);
        if (ok && data) await scheduleNotifications(data);
        if (!ok) setNote('Notifications are blocked for StockPilot. Turn them on in your phone’s Settings → Apps → StockPilot → Notifications.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={refresh}>
      <T kind="secondary">StockPilot watches your sales and stock every time it opens, and tells you what needs you before it costs money.</T>
      <Card style={{ gap: Spacing.sm }}>
        <T kind="heading">Phone notifications</T>
        {notificationsSupported ? (
          <>
            <T kind="secondary">
              A short digest every Monday at 9:00, and a reminder on the morning each supplier order is due. Worked out on your phone; nothing is sent
              anywhere.
            </T>
            {on === null ? null : (
              <Button title={on ? 'Turn off notifications' : 'Turn on notifications'} kind={on ? 'secondary' : 'primary'} onPress={toggle} loading={busy} />
            )}
            {on ? <T kind="muted">On. They update every time you open the app.</T> : null}
            {note ? <T style={{ color: c.critical }}>{note}</T> : null}
          </>
        ) : (
          <T kind="secondary">In the phone app, StockPilot sends a Monday digest and a reminder on the day each order is due. Here in the browser, alerts show on this page.</T>
        )}
      </Card>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox error={error} onRetry={refresh} /> : null}
      {data && !data.items.length ? <Empty title="All clear" body="Nothing needs you right now. Stock covers the coming weeks and sales are steady." /> : null}
      {data?.items.map((a) => <AlertCard key={a.id} a={a} />)}
    </Screen>
  );
}
