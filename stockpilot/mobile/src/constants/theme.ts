/**
 * App colors for light and dark mode. Chart colors follow one series hue (blue) with
 * a lighter step of the same hue for forecast ranges; status colors are reserved for
 * stock status and always appear with a label.
 */

export const Colors = {
  light: {
    text: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#7a7975',
    background: '#f6f6f4',
    surface: '#fcfcfb',
    surfaceAlt: '#efeeea',
    border: '#e2e1dc',
    grid: '#e8e7e2',
    tint: '#2a78d6',
    tintText: '#ffffff',
    series: '#2a78d6',
    seriesSoft: '#b7d3f6',
    positive: '#006300',
    negative: '#b42323',
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
  },
  dark: {
    text: '#f0efec',
    textSecondary: '#c3c2b7',
    textMuted: '#93928a',
    background: '#111110',
    surface: '#1a1a19',
    surfaceAlt: '#262624',
    border: '#33332f',
    grid: '#2c2c29',
    tint: '#3987e5',
    tintText: '#ffffff',
    series: '#3987e5',
    seriesSoft: '#184f95',
    positive: '#5cc95c',
    negative: '#f07b7b',
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
