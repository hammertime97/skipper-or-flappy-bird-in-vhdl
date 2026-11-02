/** Pro: export a table as a spreadsheet file (CSV opens in Excel, Google Sheets and Numbers) and share it. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  // Text from imported files could start like a formula; a leading quote keeps spreadsheets from running it.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Writes the file and opens the share sheet (save to Files or Drive, email, WhatsApp…). */
export async function shareSpreadsheet(filename: string, rows: Cell[][]): Promise<void> {
  const csv = '﻿' + toCsv(rows); // the byte-order mark makes Excel read accents and currency signs correctly
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing files is not available on this phone.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: filename, UTI: 'public.comma-separated-values-text' });
}

/** A file name like "stockpilot-orders-2026-11-02.csv". */
export const datedName = (what: string) => `stockpilot-${what}-${new Date().toISOString().slice(0, 10)}.csv`;
