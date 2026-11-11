import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { Button, ErrorBox, Input, Loading, Row, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useAiRun } from '@/hooks/use-ai';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api, SERVER_ENABLED } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { answerQuestion, HELP, type StoreData } from '@/lib/offline-tools';
import type { AskContext, ChatTurn } from '@/lib/types';

const STARTERS = [
  'What needs my attention?',
  'How is my store doing?',
  'Where am I losing money?',
  'What should I reorder?',
  'Why did sales change this week?',
  'Top 5 products by profit this month',
  'What will I sell next month?',
];

interface Turn extends ChatTurn {
  how?: string;
  suggestions?: string[];
  links?: { label: string; href: string }[];
}

export default function Assistant() {
  const { local } = useAuth();
  return local ? <LocalAssistant /> : <ServerAssistant />;
}

/** On the phone: the on-device brain understands the question and answers from the seller's numbers. */
function LocalAssistant() {
  const params = useLocalSearchParams<{ q?: string }>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const ctx = useRef<AskContext | null>(null);
  const asked = useRef(false);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setTurns((t) => [...t, { role: 'user', content: question }]);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const a = await api.askBrain(question, ctx.current);
      ctx.current = a.ctx;
      setTurns((t) => [...t, { role: 'assistant', content: a.text, how: a.how, suggestions: a.suggestions, links: a.links }]);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.q && !asked.current) {
      asked.current = true;
      void send(String(params.q));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  return (
    <Chat
      turns={turns}
      busy={busy}
      error={error}
      text={text}
      setText={setText}
      send={send}
      intro="Ask anything about your store: sales, profit, stock, prices, any product, category or period. I work it out from your own numbers, right on your phone, and show how."
    />
  );
}

/** With a server account: instant answers first, the server's AI for anything else. */
function ServerAssistant() {
  const { user } = useAuth();
  const store = useApi(async (): Promise<StoreData> => {
    const [fc, dash, ins, products] = await Promise.all([api.forecasts(), api.dashboard(), api.insights(), api.products()]);
    return { fc, dash, ins, products, cur: user?.currency ?? 'USD', pro: user?.billing.plan === 'pro' };
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const { run, running, error } = useAiRun(api.ask);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || running) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: 'user', content: question }]);
    setText('');
    const instant = store.data ? answerQuestion(question, store.data) : null;
    if (instant || !SERVER_ENABLED) {
      setTurns((t) => [...t, { role: 'assistant', content: instant ?? HELP }]);
      return;
    }
    const res = await run(question, history);
    if (res) setTurns((t) => [...t, { role: 'assistant', content: res.answer }]);
    else {
      setTurns(turns);
      setText(question);
    }
  };
  return <Chat turns={turns} busy={running} error={error} text={text} setText={setText} send={send} intro="Ask about your store. Answers come from your sales, stock and forecasts, with AI for anything else." />;
}

function Chat({
  turns, busy, error, text, setText, send, intro,
}: {
  turns: Turn[];
  busy: boolean;
  error: Error | null;
  text: string;
  setText: (v: string) => void;
  send: (q: string) => void;
  intro: string;
}) {
  const c = useTheme();
  const list = useRef<FlatList<Turn>>(null);
  const last = [...turns].reverse().find((t) => t.role === 'assistant');
  const chips = turns.length ? (last?.suggestions?.length ? last.suggestions : STARTERS.slice(0, 3)) : [];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={turns}
        keyExtractor={(_, i) => String(i)}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          turns.length === 0 ? (
            <View style={{ gap: Spacing.md }}>
              <T kind="secondary">{intro}</T>
              {STARTERS.map((s) => (
                <Button key={s} title={s} kind="secondary" onPress={() => send(s)} />
              ))}
            </View>
          ) : undefined
        }
        renderItem={({ item }) => <Bubble turn={item} />}
        ListFooterComponent={
          <View style={{ gap: Spacing.sm }}>
            {busy ? <Loading /> : null}
            {error ? <ErrorBox error={error} /> : null}
          </View>
        }
      />
      <View style={{ padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, gap: Spacing.sm }}>
        {chips.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
            {chips.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                onPress={() => send(s)}
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' }}>
                <T numberOfLines={1} style={{ color: c.tint, fontSize: 13 }}>
                  {s}
                </T>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Row>
          <View style={{ flex: 1 }}>
            <Input value={text} onChangeText={setText} placeholder="Ask about your store…" onSubmitEditing={() => send(text)} returnKeyType="send" />
          </View>
          <Button title="Send" onPress={() => send(text)} disabled={!text.trim() || busy} />
        </Row>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const c = useTheme();
  const [how, setHow] = useState(false);
  const mine = turn.role === 'user';
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '92%',
        backgroundColor: mine ? c.tint : c.surface,
        borderColor: c.border,
        borderWidth: mine ? 0 : 1,
        borderRadius: Radius.md,
        padding: Spacing.md,
        gap: Spacing.sm,
      }}>
      <T style={{ color: mine ? c.tintText : c.text }}>{turn.content}</T>
      {turn.links?.length ? (
        <Row style={{ flexWrap: 'wrap' }}>
          {turn.links.map((l) => (
            <Button key={l.href} title={l.label} kind="secondary" onPress={() => router.push(l.href as never)} style={{ minHeight: 34 }} />
          ))}
        </Row>
      ) : null}
      {turn.how ? (
        <T kind="muted" onPress={() => setHow((v) => !v)}>
          {how ? turn.how : 'How I worked this out ›'}
        </T>
      ) : null}
    </View>
  );
}
