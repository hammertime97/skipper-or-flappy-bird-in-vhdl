import { router } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Row, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Alert, Severity } from '@/lib/types';

const LABEL: Record<Severity, string> = { urgent: 'Urgent', warning: 'Needs a look', good: 'Good news', info: 'Good to know' };
const TONE = { urgent: 'critical', warning: 'warning', good: 'good', info: 'neutral' } as const;

/** One alert, coloured by how urgent it is; tapping it opens where it can be fixed. */
export function AlertCard({ a, compact = false }: { a: Alert; compact?: boolean }) {
  const c = useTheme();
  const color = a.severity === 'urgent' ? c.critical : a.severity === 'warning' ? c.warning : a.severity === 'good' ? c.good : c.border;
  return (
    <Card style={{ gap: Spacing.xs, borderLeftWidth: 4, borderLeftColor: color }} onPress={a.action ? () => router.push(a.action!.href as never) : undefined}>
      {compact ? null : (
        <Row>
          <Badge text={LABEL[a.severity]} tone={TONE[a.severity]} />
        </Row>
      )}
      <T style={{ fontWeight: '700' }}>{a.title}</T>
      <T kind="secondary" numberOfLines={compact ? 2 : undefined}>
        {a.body}
      </T>
      {a.action && !compact ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <T style={{ fontWeight: '700', color: c.tint }}>{a.action.label} →</T>
        </View>
      ) : null}
    </Card>
  );
}
