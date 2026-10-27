import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chips, Input, Row, Screen, StatTile, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { profitCalc } from '@/lib/profit';

/** What one sale really earns after product cost, shipping and platform fees, and how much ads it can carry. */
export default function Calculator() {
  const c = useTheme();
  const { user } = useAuth();
  const cur = user?.currency ?? 'USD';
  const params = useLocalSearchParams<{ name?: string; price?: string }>();
  const fees = useApi(api.fees);
  const [price, setPrice] = useState(params.price ?? '');
  const [cost, setCost] = useState('');
  const [ship, setShip] = useState('');
  const [ads, setAds] = useState('');
  const [channel, setChannel] = useState('ebay');

  const n = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const fee = fees.data?.fees[channel] ?? { label: '', pct: 0, fixed: 0 };
  const r = profitCalc(n(price), n(cost), n(ship), fee.pct, fee.fixed, n(ads));
  const color = r.profit < 0 ? c.critical : r.marginPct < 15 ? c.warning : c.good;

  return (
    <Screen edges={[]}>
      {params.name ? <T kind="heading">{params.name}</T> : null}
      <T kind="secondary">What one sale really leaves you after the product, shipping and the platform&apos;s cut, and how much advertising it can carry.</T>
      <Card style={{ gap: Spacing.md }}>
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="You sell it for" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="24.99" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="You pay per item" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="6.50" />
          </View>
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="Shipping you pay" value={ship} onChangeText={setShip} keyboardType="decimal-pad" placeholder="3.20" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Ad cost per sale" value={ads} onChangeText={setAds} keyboardType="decimal-pad" placeholder="0" />
          </View>
        </Row>
        <T kind="label">Where you sell it</T>
        {fees.data ? (
          <Chips
            value={channel}
            onChange={setChannel}
            options={Object.entries(fees.data.fees).map(([k, f]) => ({ value: k, label: `${f.label} ${f.pct}%` }))}
          />
        ) : null}
      </Card>

      {n(price) ? (
        <>
          <Card style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: color }}>
            <T kind="label">Profit per sale</T>
            <T kind="title" style={{ color: r.profit < 0 ? c.critical : c.text }}>
              {money(r.profit, cur)}
            </T>
            <T kind="secondary">
              {r.marginPct.toFixed(1)}% of the price · platform fees {money(r.fees, cur)}
              {n(cost) ? '' : ' · add what you pay per item for a real answer'}
            </T>
          </Card>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Most you can pay for ads per sale" value={money(r.maxAdCost, cur)} />
            <StatTile label="Break-even ROAS" value={r.breakEvenRoas === null ? 'never' : `${r.breakEvenRoas.toFixed(2)}×`} />
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            <StatTile label="Price for a 30% margin" value={r.priceFor30 === null ? '–' : money(r.priceFor30, cur)} />
            <StatTile label="Profit on 100 sales" value={money(r.profit * 100, cur)} />
          </Row>
          <T kind="muted">
            {r.breakEvenRoas === null
              ? 'At this price you lose money before any ads.'
              : `Break-even ROAS ${r.breakEvenRoas.toFixed(2)}× means every ${money(1, cur)} spent on ads must bring ${money(r.breakEvenRoas, cur)} in sales, or that sale loses money.`}
          </T>
        </>
      ) : (
        <Card>
          <T kind="secondary">Type a selling price to see your profit.</T>
        </Card>
      )}
      {params.name ? (
        <Button
          title="Ask AI: should I sell this?"
          kind="secondary"
          onPress={() => router.push({ pathname: '/ai/product-check', params: { idea: params.name } })}
        />
      ) : null}
    </Screen>
  );
}
