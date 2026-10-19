const test = require('node:test');
const assert = require('node:assert/strict');
const { adminCanMove, riderCanDo, RIDER_STEPS } = require('../../backend/services/orderFlow');

test('admin can only move an order forward one legal step at a time', () => {
  assert.ok(adminCanMove('placed', 'accepted'));
  assert.ok(adminCanMove('placed', 'rejected'));
  assert.ok(adminCanMove('accepted', 'preparing'));
  assert.ok(adminCanMove('preparing', 'ready'));
  for (const [from, to] of [['placed', 'ready'], ['placed', 'preparing'], ['accepted', 'ready'], ['ready', 'accepted'], ['delivered', 'cancelled'], ['pending_payment', 'accepted']])
    assert.equal(adminCanMove(from, to), false, `${from} -> ${to}`);
});

test('cancelling is allowed only before pickup', () => {
  for (const s of ['placed', 'accepted', 'preparing', 'ready', 'partner_assigned']) assert.ok(adminCanMove(s, 'cancelled'), s);
  for (const s of ['picked_up', 'out_for_delivery', 'delivered', 'cancelled', 'rejected', 'pending_payment']) assert.equal(adminCanMove(s, 'cancelled'), false, s);
});

test('a rider must do the delivery steps in order', () => {
  assert.ok(riderCanDo('arrived_restaurant', 'partner_assigned', 'assigned'));
  assert.ok(riderCanDo('pickup', 'partner_assigned', 'at_restaurant'));
  assert.ok(riderCanDo('start_delivery', 'picked_up', 'picked_up'));
  assert.ok(riderCanDo('arrived_customer', 'out_for_delivery', 'out_for_delivery'));
  assert.ok(riderCanDo('complete', 'out_for_delivery', 'at_customer'));
});

test('a rider cannot skip steps (e.g. complete without arriving, or pick up without being at the restaurant)', () => {
  assert.equal(riderCanDo('complete', 'out_for_delivery', 'out_for_delivery'), false);
  assert.equal(riderCanDo('complete', 'partner_assigned', 'assigned'), false);
  assert.equal(riderCanDo('pickup', 'partner_assigned', 'assigned'), false);
  assert.equal(riderCanDo('start_delivery', 'partner_assigned', 'at_restaurant'), false);
  assert.equal(riderCanDo('nonsense', 'placed', 'assigned'), false);
  assert.deepEqual(Object.keys(RIDER_STEPS), ['arrived_restaurant', 'pickup', 'start_delivery', 'arrived_customer', 'complete']);
});
