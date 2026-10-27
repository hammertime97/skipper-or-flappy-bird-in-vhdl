import { Linking, Pressable, View } from 'react-native';

import { Card, Loading, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Source } from '@/lib/types';

export function Working({ text }: { text: string }) {
  return (
    <Card style={{ alignItems: 'center', gap: Spacing.sm }}>
      <Loading />
      <T kind="secondary" style={{ textAlign: 'center' }}>
        {text}
      </T>
    </Card>
  );
}

export function Sources({ sources }: { sources: Source[] }) {
  const c = useTheme();
  if (!sources.length) return null;
  return (
    <Card style={{ gap: Spacing.xs }}>
      <T kind="label">Sources the AI read</T>
      {sources.slice(0, 12).map((s) => (
        <Pressable key={s.url} onPress={() => Linking.openURL(s.url)}>
          <T numberOfLines={1} style={{ color: c.tint, textDecorationLine: 'underline' }}>
            {s.title || s.url}
          </T>
        </Pressable>
      ))}
    </Card>
  );
}

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ gap: 2 }}>
      <T kind="label">{k}</T>
      <T>{v}</T>
    </View>
  );
}
