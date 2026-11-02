export function money(value: number, currency = 'USD', compact = false): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact || Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Currencies sellers can pick (ISO codes). A list, not free text, so a typo can't break every price. */
export const CURRENCIES = [
  'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NZD', 'AED', 'SAR', 'INR', 'PKR', 'NGN', 'ZAR', 'KES', 'EGP', 'TRY', 'MXN', 'BRL',
  'JPY', 'CNY', 'HKD', 'SGD', 'MYR', 'IDR', 'PHP', 'THB', 'VND', 'KRW', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ILS',
] as const;

export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

export function pct(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined) return '–';
  const s = `${Math.round(value * 100)}%`;
  return signed && value > 0 ? `+${s}` : s;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "today" when the date has passed or is today, else "by Tue 3 Nov". */
export function orderWhen(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (iso <= today) return 'today';
  return `by ${new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}
