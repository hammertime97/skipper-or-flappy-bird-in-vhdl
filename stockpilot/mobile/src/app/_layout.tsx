import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { listenForTaps } from '@/lib/notify';

void SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { ready, user } = useAuth();
  const scheme = useColorScheme();
  const c = Colors[scheme === 'dark' ? 'dark' : 'light'];

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  // A tapped notification (Monday digest, order reminder) opens its screen.
  useEffect(() => (ready && user ? listenForTaps() : undefined), [ready, user]);

  if (!ready) {
    // The phone shows the splash screen; the web demo shows this while it loads the sample store.
    return Platform.OS === 'web' ? (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: c.background }}>
        <ActivityIndicator color={c.tint} size="large" />
        <Text style={{ color: c.textSecondary, fontSize: 16 }}>Opening StockPilot…</Text>
      </View>
    ) : null;
  }

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.tint, background: c.background, card: c.surface, text: c.text, border: c.border },
  };

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerTintColor: c.tint, headerStyle: { backgroundColor: c.surface }, headerTitleStyle: { color: c.text } }}>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="product/[id]" options={{ title: 'Product' }} />
          <Stack.Screen name="product/edit" options={{ title: 'Product', presentation: 'modal' }} />
          <Stack.Screen name="ai/weekly-plan" options={{ title: 'Weekly Plan' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="fees" options={{ title: 'Selling fees' }} />
          <Stack.Screen name="stock-counts" options={{ title: 'Stock & costs' }} />
          <Stack.Screen name="ai/product-check" options={{ title: 'Product Check' }} />
          <Stack.Screen name="calculator" options={{ title: 'Profit & ads calculator' }} />
          <Stack.Screen name="orders" options={{ title: 'Supplier orders' }} />
          <Stack.Screen name="ai/assistant" options={{ title: 'Ask StockPilot' }} />
          <Stack.Screen name="ai/listing" options={{ title: 'Listing Writer' }} />
          <Stack.Screen name="import" options={{ title: 'Import your sales' }} />
          <Stack.Screen name="paywall" options={{ title: 'StockPilot Pro', presentation: 'modal' }} />
          <Stack.Screen name="leaks" options={{ title: 'Profit leaks' }} />
          <Stack.Screen name="alerts" options={{ title: 'Alerts' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootStack />
    </AuthProvider>
  );
}
