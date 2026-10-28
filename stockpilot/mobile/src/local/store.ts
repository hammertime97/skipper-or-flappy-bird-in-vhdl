/** Keeps the on-phone store in a JSON file in the app's private documents folder (localStorage on web). */
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { Engine, type LocalStore } from './engine';

const FILE_NAME = 'stockpilot-local.json';
const WEB_KEY = 'stockpilot.local';

export interface Saved {
  store: LocalStore;
  plan: 'free' | 'pro';
  email: string;
}

function serialise(s: Saved): string {
  const st = s.store;
  return JSON.stringify({
    plan: s.plan,
    email: s.email,
    products: st.products,
    sales: st.sales.map((x) => [x.pid, x.qty, x.price, x.when, x.channel, x.order]),
    keys: [...st.keys],
    nextId: st.nextId,
    user: st.user,
  });
}

function parse(raw: string): Saved {
  const d = JSON.parse(raw);
  const st = Engine.newStore();
  st.products = d.products ?? [];
  st.sales = (d.sales ?? []).map(([pid, qty, price, when, channel, order]: [number, number, number, number, string, string]) => ({
    pid, qty, price, when, channel, order,
  }));
  st.keys = new Set(d.keys ?? []);
  st.nextId = d.nextId ?? 1;
  st.user = { ...st.user, ...(d.user ?? {}) };
  return { store: st, plan: d.plan === 'pro' ? 'pro' : 'free', email: d.email ?? '' };
}

export async function load(): Promise<Saved | null> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(WEB_KEY);
      return raw ? parse(raw) : null;
    }
    const f = new File(Paths.document, FILE_NAME);
    return f.exists ? parse(await f.text()) : null;
  } catch (e) {
    console.warn('Could not read the on-phone store', e);
    return null;
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Save soon (several changes in a row are written once). */
export function save(s: Saved) {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void write(s);
  }, 300);
}

async function write(s: Saved) {
  try {
    const raw = serialise(s);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(WEB_KEY, raw);
      return;
    }
    const f = new File(Paths.document, FILE_NAME);
    if (!f.exists) f.create();
    await f.write(raw);
  } catch (e) {
    console.warn('Could not save the on-phone store', e);
  }
}

// The latest trends list downloaded from EXPO_PUBLIC_TRENDS_URL, kept for offline use.
const TRENDS_FILE = 'stockpilot-trends.json';
const TRENDS_KEY = 'stockpilot.trends';

export async function loadTrends(): Promise<{ fetchedAt: number; lib: unknown } | null> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(TRENDS_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    const f = new File(Paths.document, TRENDS_FILE);
    return f.exists ? JSON.parse(await f.text()) : null;
  } catch {
    return null;
  }
}

export async function saveTrends(value: { fetchedAt: number; lib: unknown }) {
  try {
    const raw = JSON.stringify(value);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(TRENDS_KEY, raw);
      return;
    }
    const f = new File(Paths.document, TRENDS_FILE);
    if (!f.exists) f.create();
    await f.write(raw);
  } catch {
    // Not critical: the bundled list still works.
  }
}

export async function wipe() {
  if (pending) clearTimeout(pending);
  pending = null;
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(WEB_KEY);
    return;
  }
  const f = new File(Paths.document, FILE_NAME);
  if (f.exists) f.delete();
}

/** Bytes of a file the seller picked: a File object on web, a file:// or content:// URI on the phone. */
export async function readPicked(asset: { uri: string; file?: Blob }): Promise<ArrayBuffer> {
  if (asset.file) return asset.file.arrayBuffer();
  if (Platform.OS === 'web') return (await fetch(asset.uri)).arrayBuffer();
  return new File(asset.uri).arrayBuffer();
}
