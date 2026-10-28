import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Chips, ErrorBox, Input, Loading, Row, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api, SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { answerQuestion, HELP, STARTERS, type StoreData } from '@/lib/offline-tools';
import type { ChatTurn } from '@/lib/types';

export default function Assistant() {
  const c = useTheme();
  const { user, local } = useAuth();
  const aiAvailable = SERVER_ENABLED && !local;
  // The seller's own numbers, so most questions are answered instantly on the phone.
  const store = useApi(async (): Promise<StoreData> => {
    const [fc, dash, ins, products] = await Promise.all([api.forecasts(), api.dashboard(), api.insights(), api.products()]);
    return { fc, dash, ins, products, cur: user?.currency ?? 'USD' };
  });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState('');
  const { run, running, error } = useAiRun(api.ask);
  const list = useRef<FlatList<ChatTurn>>(null);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || running) return;
    const history = turns;
    setTurns([...history, { role: 'user', content: question }]);
    setText('');
    const instant = store.data ? answerQuestion(question, store.data) : null;
    if (instant || !aiAvailable) {
      const reply = instant ?? (store.data ? HELP : 'Still loading your numbers. Ask again in a second.');
      setTurns((t) => [...t, { role: 'assistant', content: reply }]);
      return;
    }
    const res = await run(question, history);
    if (res) setTurns((t) => [...t, { role: 'assistant', content: res.answer }]);
    else setTurns(history); // put the question back on failure
    if (!res) setText(question);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={turns}
        keyExtractor={(_, i) => String(i)}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md }}
        ListHeaderComponent={
          turns.length === 0 ? (
            <View style={{ gap: Spacing.md }}>
              <T kind="secondary">
                Ask about your store. Answers come straight from your sales, stock and forecasts, instantly{aiAvailable ? ', with AI for anything else' : ''}.
              </T>
              {STARTERS.map((s) => (
                <Button key={s} title={s} kind="secondary" onPress={() => send(s)} />
              ))}
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              backgroundColor: item.role === 'user' ? c.tint : c.surface,
              borderColor: c.border,
              borderWidth: item.role === 'user' ? 0 : 1,
              borderRadius: Radius.md,
              padding: Spacing.md,
            }}>
            <T style={{ color: item.role === 'user' ? c.tintText : c.text }}>{item.content}</T>
          </View>
        )}
        ListFooterComponent={
          <View style={{ gap: Spacing.sm }}>
            {running ? <Loading /> : null}
            {error ? <ErrorBox error={error} /> : null}
          </View>
        }
      />
      <View style={{ padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, gap: Spacing.sm }}>
        {turns.length > 0 ? (
          <Chips value={'' as string} onChange={(v) => send(v)} options={STARTERS.map((s) => ({ value: s, label: s }))} />
        ) : null}
        <Row>
          <View style={{ flex: 1 }}>
            <Input value={text} onChangeText={setText} placeholder="Ask about your store…" onSubmitEditing={() => send(text)} returnKeyType="send" />
          </View>
          <Button title="Send" onPress={() => send(text)} disabled={!text.trim() || running} />
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}
