import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chips, ErrorBox, Input, Loading, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { Fulfilment } from '@/lib/types';

const EMPTY = {
  sku: '',
  name: '',
  category: '',
  cost_price: '',
  sell_price: '',
  stock_qty: '0',
  incoming_qty: '0',
  lead_time_days: '7',
  supplier: '',
  fulfilment: 'own_stock' as Fulfilment,
};

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = id !== undefined;
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!editing) return;
    api
      .product(Number(id))
      .then((p) =>
        setForm({
          sku: p.sku,
          name: p.name,
          category: p.category,
          cost_price: String(p.cost_price),
          sell_price: String(p.sell_price),
          stock_qty: String(p.stock_qty),
          incoming_qty: String(p.incoming_qty),
          lead_time_days: String(p.lead_time_days),
          supplier: p.supplier,
          fulfilment: p.fulfilment,
        }),
      )
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [editing, id]);

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      cost_price: Number(form.cost_price) || 0,
      sell_price: Number(form.sell_price) || 0,
      stock_qty: Math.round(Number(form.stock_qty) || 0),
      incoming_qty: Math.max(0, Math.round(Number(form.incoming_qty) || 0)),
      lead_time_days: Math.max(0, Math.round(Number(form.lead_time_days) || 0)),
      supplier: form.supplier.trim(),
      fulfilment: form.fulfilment,
      image_url: '',
    };
    try {
      if (editing) {
        const { sku: _sku, ...patch } = body;
        await api.updateProduct(Number(id), patch);
        router.back();
      } else {
        const p = await api.createProduct(body);
        router.replace(`/product/${p.id}`);
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <Screen edges={[]}>
      <T kind="title">{editing ? 'Edit product' : 'New product'}</T>
      <Card style={{ gap: Spacing.md }}>
        <Input label="Name" value={form.name} onChangeText={set('name')} placeholder="No-Pull Dog Harness" />
        <Input
          label="SKU"
          value={form.sku}
          onChangeText={set('sku')}
          editable={!editing}
          autoCapitalize="characters"
          placeholder="PET-002"
        />
        <Input label="Category" value={form.category} onChangeText={set('category')} />
        <View style={{ gap: Spacing.xs }}>
          <T kind="label">How do you fulfil it?</T>
          <Chips
            value={form.fulfilment}
            onChange={(v) => setForm((f) => ({ ...f, fulfilment: v }))}
            options={[
              { value: 'own_stock', label: 'I hold stock' },
              { value: 'dropship', label: 'Dropship (supplier ships)' },
            ]}
          />
        </View>
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="Unit cost (incl. shipping)" value={form.cost_price} onChangeText={set('cost_price')} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Selling price" value={form.sell_price} onChangeText={set('sell_price')} keyboardType="decimal-pad" />
          </View>
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Input
              label={form.fulfilment === 'dropship' ? 'Supplier stock' : 'In stock'}
              value={form.stock_qty}
              onChangeText={set('stock_qty')}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Incoming (ordered)" value={form.incoming_qty} onChangeText={set('incoming_qty')} keyboardType="number-pad" />
          </View>
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Input label="Supplier lead time (days)" value={form.lead_time_days} onChangeText={set('lead_time_days')} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Supplier" value={form.supplier} onChangeText={set('supplier')} />
          </View>
        </Row>
        {error ? <ErrorBox error={error} /> : null}
        <Button title={editing ? 'Save changes' : 'Add product'} onPress={save} loading={saving} disabled={!form.name || !form.sku} />
      </Card>
    </Screen>
  );
}
