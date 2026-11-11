/**
 * Phone notifications without a server: the app schedules them on the phone itself each time it
 * works out the alerts (when it opens or the data changes). A Monday-morning digest, and an
 * "order today" reminder on the day each supplier order is due.
 */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { tokenStore } from './token-store';
import type { AlertReport } from './types';

const KEY = 'stockpilot.notifications'; // "on" | "off"
const CHANNEL = 'alerts';
const HOUR = 9; // local time for every notification

export const notificationsSupported = Platform.OS !== 'web';

if (notificationsSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function notificationsOn(): Promise<boolean> {
  if (!notificationsSupported) return false;
  if ((await tokenStore.get(KEY)) !== 'on') return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

/** Asks the phone for permission (once) and turns the alerts on. Returns whether they're on. */
export async function turnOnNotifications(): Promise<boolean> {
  if (!notificationsSupported) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Stock alerts and Monday digest',
      // eslint-disable-next-line import/namespace -- re-exported enum the lint rule can't see
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  if (!granted && canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
  await tokenStore.set(KEY, granted ? 'on' : 'off');
  lastSchedule = '';
  return granted;
}

export async function turnOffNotifications() {
  await tokenStore.set(KEY, 'off');
  lastSchedule = '';
  if (notificationsSupported) await Notifications.cancelAllScheduledNotificationsAsync();
}

let lastSchedule = '';

/** Replaces the scheduled notifications with ones built from the latest alerts. */
export async function scheduleNotifications(report: AlertReport): Promise<number> {
  if (!(await notificationsOn())) return 0;
  const key = JSON.stringify([report.digest, report.reminders, new Date().toDateString()]);
  if (key === lastSchedule) return -1;
  lastSchedule = key;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = new Date();
  const at = (d: Date) => {
    const x = new Date(d);
    x.setHours(HOUR, 0, 0, 0);
    return x;
  };
  const jobs: { title: string; body: string; url: string; date: Date }[] = [];
  // The next four Mondays. The first carries this week's numbers if it's close; later ones just invite a look.
  const monday = at(now);
  monday.setDate(monday.getDate() + ((1 - now.getDay() + 7) % 7)); // today if it's Monday
  if (monday <= now) monday.setDate(monday.getDate() + 7);
  for (let w = 0; w < 4; w++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + 7 * w);
    const fresh = w === 0 && date.getTime() - now.getTime() < 3.5 * 86_400_000;
    jobs.push({
      ...(fresh ? report.digest : { title: 'Your Monday plan is ready', body: 'See how last week went, what to reorder and what needs you this week.' }),
      url: '/ai/weekly-plan',
      date,
    });
  }
  for (const r of report.reminders) {
    const date = at(new Date(`${r.date}T12:00:00`));
    if (date > now) jobs.push({ title: r.title, body: r.body, url: '/orders', date });
  }
  for (const j of jobs) {
    await Notifications.scheduleNotificationAsync({
      content: { title: j.title, body: j.body, data: { url: j.url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: j.date, channelId: CHANNEL },
    });
  }
  return jobs.length;
}

/** Opens the right screen when a notification is tapped (also when it started the app). */
export function listenForTaps(): () => void {
  if (!notificationsSupported) return () => {};
  const open = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url !== 'string' || !url.startsWith('/')) return;
    // Give the navigator a moment when the tap is what started the app.
    setTimeout(() => {
      try {
        router.push(url as never);
      } catch {
        // Not ready to navigate: the app stays on Home, which shows the same alerts.
      }
    }, 300);
  };
  void Notifications.getLastNotificationResponseAsync().then((r) => {
    if (r) {
      open(r);
      void Notifications.clearLastNotificationResponseAsync?.();
    }
  });
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
