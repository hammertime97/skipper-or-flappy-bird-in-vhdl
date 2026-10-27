import { Tabs } from 'expo-router/js-tabs';

import { Icon, type IconName } from '@/components/icons';
import { useTheme } from '@/hooks/use-theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Dashboard', icon: 'home' },
  { name: 'inventory', title: 'Inventory', icon: 'box' },
  { name: 'forecast', title: 'Forecast', icon: 'chart' },
  { name: 'ai', title: 'AI', icon: 'spark' },
  { name: 'settings', title: 'Settings', icon: 'gear' },
];

export default function TabLayout() {
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tint,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarIcon: ({ color }) => <Icon name={t.icon} color={String(color)} /> }}
        />
      ))}
    </Tabs>
  );
}
