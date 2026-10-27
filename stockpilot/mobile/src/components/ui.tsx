import { router } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ApiError } from '@/lib/api';
import type { StockStatus } from '@/lib/types';

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  edges = ['top'],
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  const c = useTheme();
  if (!scroll) {
    return (
      <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
        {children}
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

type TextKind = 'title' | 'heading' | 'body' | 'secondary' | 'muted' | 'label' | 'hero';

export function T({
  children,
  kind = 'body',
  style,
  numberOfLines,
}: {
  children: ReactNode;
  kind?: TextKind;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const c = useTheme();
  const color = kind === 'secondary' || kind === 'label' ? c.textSecondary : kind === 'muted' ? c.textMuted : c.text;
  return (
    <Text numberOfLines={numberOfLines} style={[textStyles[kind], { color }, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useTheme();
  const base = [styles.card, { backgroundColor: c.surface, borderColor: c.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  );
}

export function Row({ children, style, gap = Spacing.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const bg = kind === 'primary' ? c.tint : 'transparent';
  const fg = kind === 'primary' ? c.tintText : kind === 'danger' ? c.critical : c.tint;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? bg : c.border },
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input({ label, style, ...props }: TextInputProps & { label?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.xs }}>
      {label ? <T kind="label">{label}</T> : null}
      <TextInput
        placeholderTextColor={c.textMuted}
        {...props}
        style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.border }, style]}
      />
    </View>
  );
}

export function Chips<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const c = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              { borderColor: active ? c.tint : c.border, backgroundColor: active ? c.tint : c.surface },
            ]}>
            <Text style={{ color: active ? c.tintText : c.text, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A KPI tile: label, hero value, and change vs the previous period. */
export function StatTile({ label, value, change, style }: { label: string; value: string; change?: number | null; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const up = (change ?? 0) > 0;
  return (
    <Card style={[{ flex: 1, minWidth: 140, gap: 2 }, style]}>
      <T kind="label">{label}</T>
      <T kind="hero">{value}</T>
      {change !== undefined ? (
        <Text style={{ color: change === null ? c.textMuted : up ? c.positive : c.negative, fontSize: 13, fontWeight: '600' }}>
          {change === null ? 'no prior data' : `${up ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% vs prev.`}
        </Text>
      ) : null}
    </Card>
  );
}

const STATUS: Record<StockStatus, { label: string; icon: string; tone: 'critical' | 'serious' | 'warning' | 'good' | 'muted' }> = {
  out_of_stock: { label: 'Out of stock', icon: '⛔', tone: 'critical' },
  reorder_now: { label: 'Reorder now', icon: '!', tone: 'serious' },
  low: { label: 'Running low', icon: '▾', tone: 'warning' },
  healthy: { label: 'Healthy', icon: '✓', tone: 'good' },
  overstock: { label: 'Overstocked', icon: '▴', tone: 'muted' },
  dead_stock: { label: 'Not selling', icon: '•', tone: 'muted' },
  no_demand: { label: 'No sales', icon: '–', tone: 'muted' },
};

export function statusLabel(s: StockStatus) {
  return STATUS[s].label;
}

/** Stock status: colour + icon + label, never colour alone. */
export function StatusPill({ status }: { status: StockStatus }) {
  const c = useTheme();
  const s = STATUS[status];
  const color = s.tone === 'muted' ? c.textMuted : c[s.tone];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={{ color, fontWeight: '800', fontSize: 11 }}>{s.icon}</Text>
      <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>{s.label}</Text>
    </View>
  );
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'tint' | 'good' | 'critical' | 'warning' }) {
  const c = useTheme();
  const color = tone === 'neutral' ? c.textSecondary : tone === 'tint' ? c.tint : c[tone];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View style={{ padding: Spacing.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={c.tint} />
    </View>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | string; onRetry?: () => void }) {
  const c = useTheme();
  const message = typeof error === 'string' ? error : error.message;
  const needsUpgrade = typeof error !== 'string' && 'needsUpgrade' in error && error.needsUpgrade;
  return (
    <Card style={{ borderColor: c.critical, gap: Spacing.sm }}>
      <T>{message}</T>
      <Row>
        {needsUpgrade ? <Button title="See Pro" onPress={() => router.push('/paywall')} /> : null}
        {onRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} /> : null}
      </Row>
    </Card>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl }}>
      <T kind="heading">{title}</T>
      {body ? (
        <T kind="secondary" style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
      {action}
    </Card>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T kind="heading">{title}</T>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: Spacing.xs }}>
      {items.map((it, i) => (
        <Row key={i} style={{ alignItems: 'flex-start' }}>
          <T kind="secondary">•</T>
          <T style={{ flex: 1 }}>{it}</T>
        </Row>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, padding: Spacing.lg },
  button: {
    minHeight: 46,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
});

const textStyles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800' },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  secondary: { fontSize: 14, lineHeight: 20 },
  muted: { fontSize: 13 },
  label: { fontSize: 13, fontWeight: '600' },
  hero: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
