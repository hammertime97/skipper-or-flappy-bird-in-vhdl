/**
 * Small SVG charts. One series hue; forecasts use a lighter step of the same hue
 * and are named in a legend, so meaning never rests on colour alone. Touch and drag
 * across a chart to read exact values (the mobile stand-in for hover tooltips).
 */
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const AXIS_W = 44;
const TOP = 8;
const BOTTOM = 18;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(v)}`;
}

/** Bar path with 4px rounded data-end and a square baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function useTouchIndex(count: number, plotLeft: number, plotWidth: number) {
  const [index, setIndex] = useState<number | null>(null);
  const pick = (e: GestureResponderEvent) => {
    if (count === 0 || plotWidth <= 0) return;
    const x = e.nativeEvent.locationX - plotLeft;
    setIndex(Math.max(0, Math.min(count - 1, Math.floor((x / plotWidth) * count))));
  };
  const handlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: pick,
    onResponderMove: pick,
    onResponderTerminationRequest: () => true,
  };
  return { index, setIndex, handlers };
}

function Gridlines({ width, height }: { width: number; height: number }) {
  const c = useTheme();
  const plotH = height - TOP - BOTTOM;
  return (
    <>
      {[0, 0.5, 1].map((f) => {
        const y = TOP + plotH * (1 - f);
        return <Line key={f} x1={AXIS_W} x2={width} y1={y} y2={y} stroke={c.grid} strokeWidth={1} />;
      })}
    </>
  );
}

// Axis labels are RN Text laid over the SVG (crisper than SVG text on Android).
function AxisOverlay({ height, max, format }: { height: number; max: number; format: (v: number) => string }) {
  const c = useTheme();
  const plotH = height - TOP - BOTTOM;
  return (
    <>
      {[0, 0.5, 1].map((f) => (
        <Text
          key={f}
          style={[styles.axis, { color: c.textMuted, top: TOP + plotH * (1 - f) - 8 }]}
          numberOfLines={1}>
          {format(max * f)}
        </Text>
      ))}
    </>
  );
}

export function LegendItem({ color, label, kind = 'box' }: { color: string; label: string; kind?: 'box' | 'line' | 'band' }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={
          kind === 'line'
            ? { width: 14, height: 2, backgroundColor: color, borderRadius: 1 }
            : { width: 10, height: 10, borderRadius: 2, backgroundColor: color, opacity: kind === 'band' ? 0.6 : 1 }
        }
      />
      <Text style={{ color: c.textSecondary, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Readout({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={{ color: c.text, fontSize: 13, fontWeight: '600', minHeight: 18 }}>{children}</Text>;
}

export interface BarDatum {
  label: string;
  value: number;
  forecast?: boolean;
}

/**
 * Vertical bars from one baseline. Bars flagged `forecast` use the soft step and are
 * named in the legend.
 */
export function BarChart({
  data,
  height = 160,
  format = compact,
  readout,
  hint = 'Touch the chart to see each value',
}: {
  data: BarDatum[];
  height?: number;
  format?: (v: number) => string;
  readout: (d: BarDatum) => string;
  hint?: string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const plotW = Math.max(0, width - AXIS_W);
  const { index, handlers } = useTouchIndex(data.length, AXIS_W, plotW);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotH = height - TOP - BOTTOM;
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2)); // 2px surface gap between bars, 24px cap
  const hasForecast = data.some((d) => d.forecast);

  return (
    <View style={{ gap: Spacing.xs }}>
      <Readout>{index !== null && data[index] ? readout(data[index]) : hint}</Readout>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height }} {...handlers}>
        {width > 0 ? (
          <>
            <Svg width={width} height={height}>
              <Gridlines width={width} height={height} />
              {data.map((d, i) => {
                const h = (d.value / max) * plotH;
                const x = AXIS_W + i * slot + (slot - barW) / 2;
                const selected = index === i;
                return (
                  <Path
                    key={i}
                    d={barPath(x, TOP + plotH - h, barW, h)}
                    fill={d.forecast ? c.seriesSoft : c.series}
                    opacity={index === null || selected ? 1 : 0.55}
                  />
                );
              })}
            </Svg>
            <AxisOverlay height={height} max={max} format={format} />
            <Text style={[styles.xLabel, { left: AXIS_W, color: c.textMuted }]}>{data[0]?.label}</Text>
            <Text style={[styles.xLabel, { right: 0, color: c.textMuted }]}>{data[data.length - 1]?.label}</Text>
          </>
        ) : null}
      </View>
      {hasForecast ? (
        <View style={styles.legend}>
          <LegendItem color={c.series} label="Actual" />
          <LegendItem color={c.seriesSoft} label="Forecast" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * History as a solid line, forecast continuing from the last actual point, and the
 * 80% forecast range as a soft band behind it.
 */
export function ForecastLineChart({
  history,
  forecast,
  lower,
  upper,
  height = 180,
  format = compact,
  readout,
}: {
  history: number[];
  forecast: number[];
  lower?: number[];
  upper?: number[];
  height?: number;
  format?: (v: number) => string;
  readout: (i: number, value: number, isForecast: boolean) => string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const n = history.length + forecast.length;
  const plotW = Math.max(0, width - AXIS_W - 8);
  const { index, handlers } = useTouchIndex(n, AXIS_W, plotW);
  const max = niceMax(Math.max(0, ...history, ...forecast, ...(upper ?? [])));
  const plotH = height - TOP - BOTTOM;
  const xAt = (i: number) => AXIS_W + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => TOP + plotH - (Math.max(0, v) / max) * plotH;

  const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const hist = history.map((v, i) => [xAt(i), yAt(v)] as [number, number]);
  const last = history.length - 1;
  const fcPts: [number, number][] = [
    ...(last >= 0 ? [[xAt(last), yAt(history[last])] as [number, number]] : []),
    ...forecast.map((v, k) => [xAt(history.length + k), yAt(v)] as [number, number]),
  ];
  let band = '';
  if (lower && upper && forecast.length) {
    const top = upper.map((v, k) => [xAt(history.length + k), yAt(v)] as [number, number]);
    const bottom = lower.map((v, k) => [xAt(history.length + k), yAt(v)] as [number, number]).reverse();
    const start: [number, number][] = last >= 0 ? [[xAt(last), yAt(history[last])]] : [];
    band = `${line([...start, ...top, ...bottom])} Z`;
  }

  const sel = index;
  const selValue = sel === null ? null : sel < history.length ? history[sel] : forecast[sel - history.length];

  return (
    <View style={{ gap: Spacing.xs }}>
      <Readout>
        {sel !== null && selValue !== null && selValue !== undefined
          ? readout(sel, selValue, sel >= history.length)
          : 'Touch the chart to see each week'}
      </Readout>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height }} {...handlers}>
        {width > 0 ? (
          <>
            <Svg width={width} height={height}>
              <Gridlines width={width} height={height} />
              {band ? <Path d={band} fill={c.seriesSoft} opacity={0.6} /> : null}
              {hist.length > 1 ? <Path d={line(hist)} stroke={c.series} strokeWidth={2} fill="none" strokeLinejoin="round" /> : null}
              {fcPts.length > 1 ? (
                <Path d={line(fcPts)} stroke={c.series} strokeWidth={2} strokeDasharray="5 4" fill="none" strokeLinejoin="round" />
              ) : null}
              {sel !== null && selValue !== null && selValue !== undefined ? (
                <>
                  <Line x1={xAt(sel)} x2={xAt(sel)} y1={TOP} y2={TOP + plotH} stroke={c.textMuted} strokeWidth={1} />
                  <Circle cx={xAt(sel)} cy={yAt(selValue)} r={5} fill={c.series} stroke={c.surface} strokeWidth={2} />
                </>
              ) : null}
            </Svg>
            <AxisOverlay height={height} max={max} format={format} />
            <Text style={[styles.xLabel, { left: AXIS_W, color: c.textMuted }]}>{history.length} wks ago</Text>
            <Text style={[styles.xLabel, { right: 0, color: c.textMuted }]}>+{forecast.length} wks</Text>
          </>
        ) : null}
      </View>
      <View style={styles.legend}>
        <LegendItem color={c.series} label="Actual" kind="line" />
        <LegendItem color={c.series} label="Forecast (dashed)" kind="line" />
        {band ? <LegendItem color={c.seriesSoft} label="Likely range" kind="band" /> : null}
      </View>
    </View>
  );
}

/** Horizontal meter for a 1-10 score. */
export function ScoreBar({ label, score, invert = false }: { label: string; score: number; invert?: boolean }) {
  const c = useTheme();
  const s = Math.max(1, Math.min(10, score));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          {label}
          {invert ? ' (lower is better)' : ''}
        </Text>
        <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>{s}/10</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${s * 10}%`, height: 8, borderRadius: 4, backgroundColor: c.series }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { position: 'absolute', left: 0, width: AXIS_W - 6, textAlign: 'right', fontSize: 11 },
  xLabel: { position: 'absolute', bottom: 0, fontSize: 11 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
});
