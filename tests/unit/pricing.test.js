const test = require('node:test');
const assert = require('node:assert/strict');
const { installFake } = require('../helpers/fakeSupabase');

const R = '11111111-1111-4111-8111-111111111111';
const PIZZA = '22222222-2222-4222-8222-222222222222';
const SOUP = '33333333-3333-4333-8333-333333333333';
installFake({
  restaurants: [{ id: R, name: 'Slice', delivery_fee: 30, status: 'active', opening_time: '00:00', closing_time: '23:59' }],
  food_items: [
    { id: PIZZA, restaurant_id: R, name: 'Pizza', price: 200, discount_percent: 10, availability: true, is_veg: true, image: null,
      customizations: [
        { name: 'Size', type: 'one', options: [{ label: 'Regular', price: 0 }, { label: 'Large', price: 60 }] },
        { name: 'Extras', type: 'many', options: [{ label: 'Cheese', price: 30 }, { label: 'Olives', price: 20 }] }] },
    { id: SOUP, restaurant_id: R, name: 'Soup', price: 99.5, discount_percent: 0, availability: false, is_veg: true, image: null, customizations: [] },
  ],
});
const svc = require('../../backend/services/orderService');
const sel = (...p) => p.map(([group, label]) => ({ group, label }));

test('discount applies to the dish, option prices are added on top', async () => {
  const p = await svc.priceItems([{ food_id: PIZZA, qty: 2, options: sel(['Size', 'Large'], ['Extras', 'Cheese']) }]);
  assert.equal(p.lines[0].price, 270);          // 180 (after 10%) + 60 + 30
  assert.equal(p.lines[0].line_total, 540);
  assert.equal(p.subtotal, 540);
  assert.equal(p.lines[0].available, true);
});

test('a required "choose one" group must be answered', async () => {
  const p = await svc.priceItems([{ food_id: PIZZA, qty: 1, options: [] }]);
  assert.equal(p.lines[0].available, false);
});

test('made-up options or groups are rejected, so prices cannot be forged', async () => {
  for (const options of [sel(['Size', 'Gigantic']), sel(['Size', 'Regular'], ['Secret', 'Free']), sel(['Size', 'Regular'], ['Size', 'Large'])]) {
    const p = await svc.priceItems([{ food_id: PIZZA, qty: 1, options }]);
    assert.equal(p.lines[0].available, false, JSON.stringify(options));
  }
});

test('the browser cannot set prices: only food_id, qty, options and note are read', async () => {
  const p = await svc.priceItems([{ food_id: PIZZA, qty: 1, price: 1, options: sel(['Size', 'Regular']) }]);
  assert.equal(p.lines[0].price, 180);
});

test('unavailable dishes are flagged; unknown dishes are dropped', async () => {
  const p = await svc.priceItems([{ food_id: SOUP, qty: 1 }, { food_id: '99999999-9999-4999-8999-999999999999', qty: 1 }]);
  assert.equal(p.lines.length, 1);
  assert.equal(p.lines[0].available, false);
});

test('line keys: same choices merge, different choices or notes stay separate', () => {
  assert.equal(svc.lineKey({ food_id: 'x' }), 'x');
  const a = svc.lineKey({ food_id: 'x', options: sel(['A', '1'], ['B', '2']) });
  const b = svc.lineKey({ food_id: 'x', options: sel(['B', '2'], ['A', '1']) });
  assert.equal(a, b);
  assert.notEqual(a, svc.lineKey({ food_id: 'x', options: sel(['A', '1'], ['B', '2']), note: 'less spicy' }));
});

test('restaurant open/closed handles overnight hours', () => {
  assert.equal(svc.isOpen('10:00', '22:00', '12:00'), true);
  assert.equal(svc.isOpen('10:00', '22:00', '23:00'), false);
  assert.equal(svc.isOpen('18:00', '02:00', '23:30'), true);
  assert.equal(svc.isOpen('18:00', '02:00', '01:00'), true);
  assert.equal(svc.isOpen('18:00', '02:00', '12:00'), false);
});

const coupon = { discount_type: 'percent', discount_value: 10, minimum_order: 299, usage_limit: 5, used_count: 0, expiry_date: null };
test('coupons: percent, fixed (never more than the bill), minimum order, expiry, usage limit', () => {
  assert.equal(svc.couponDiscount(coupon, 500), 50);
  assert.equal(svc.couponDiscount({ ...coupon, discount_type: 'fixed', discount_value: 50, minimum_order: 0 }, 30), 30);
  assert.throws(() => svc.couponDiscount(coupon, 200), /more to use this coupon/);
  assert.throws(() => svc.couponDiscount({ ...coupon, expiry_date: '2020-01-01' }, 500), /expired/);
  assert.throws(() => svc.couponDiscount({ ...coupon, used_count: 5 }, 500), /fully used/);
});

test('totals: tax on items, discount first, delivery fee on top, rounded to paise', () => {
  assert.deepEqual(svc.computeTotals({ subtotal: 448, fee: 25, taxPercent: 5, discount: 44.8 }), { subtotal: 448, delivery_fee: 25, taxes: 22.4, discount: 44.8, total: 450.6 });
  assert.equal(svc.computeTotals({ subtotal: 10, fee: 0, taxPercent: 5, discount: 50 }).total, 0.5); // can't go negative
});
