import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Card, ErrorBox, Input, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password, mode);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ gap: Spacing.sm, marginTop: Spacing.xxl }}>
          <T kind="title">StockPilot</T>
          <T kind="secondary">
            Know what you&apos;ll sell next week, what to reorder, and what&apos;s trending in your niche.
          </T>
        </View>
        <Card style={{ gap: Spacing.md }}>
          <T kind="heading">{mode === 'register' ? 'Create your account' : 'Welcome back'}</T>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@store.com"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder="At least 8 characters"
          />
          {error ? <ErrorBox error={error} /> : null}
          <Button
            title={mode === 'register' ? 'Create account' : 'Sign in'}
            onPress={submit}
            loading={busy}
            disabled={!email || password.length < 8}
          />
          <Button
            kind="secondary"
            title={mode === 'register' ? 'I already have an account' : 'Create a new account'}
            onPress={() => setMode(mode === 'register' ? 'login' : 'register')}
          />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
