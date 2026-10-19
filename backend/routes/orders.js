const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validate } = require('../middleware/validation');
const svc = require('../services/orderService');
const pay = require('../services/paymentService');

const router = express.Router();
router.use(requireAuth, requireRole('customer'));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const ok = (r) => { if (r.error) throw r.error; return r.data; };
const uuid = (req, res, next) => /^[0-9a-f-]{36}$/i.test(req.params.id) ? next() : res.status(404).json({ error: 'Order not found' });
const payInfo = (gatewayOrderId, total, name) => ({ key: process.env.RAZORPAY_KEY_ID, razorpay_order_id: gatewayOrderId, amount: Math.round(total * 100), currency: 'INR', name: name || 'ChakHub' });

// Validates the saved cart and works out every amount on the server.
async function prepare(userId, couponCode) {
  const settings = await svc.getSettings();
  if (!settings.service_available) throw svc.fail('Ordering is paused right now. Please try again later.');
  const priced = await svc.priceItems(await svc.loadCartItems(userId));
  if (!priced.lines.length) throw svc.fail('Your cart is empty');
  if (priced.lines.some((l) => !l.available)) throw svc.fail('Some dishes in your cart are no longer available. Update your cart.');
  if (!priced.restaurant || !priced.restaurant.is_open) throw svc.fail('This restaurant is closed right now');
  if (priced.subtotal < Number(settings.min_order)) throw svc.fail(`Minimum order is ₹${settings.min_order}`);
  let coupon = null, discount = 0;
  if (couponCode) { coupon = await svc.findCoupon(couponCode); discount = svc.couponDiscount(coupon, priced.subtotal); }
  const totals = svc.computeTotals({ subtotal: priced.subtotal, fee: priced.restaurant.delivery_fee, taxPercent: Number(settings.tax_percent), discount });
  return { settings, priced, coupon, totals };
}

router.post('/quote', validate(z.object({ coupon: z.string().trim().max(30).optional() })), async (req, res, next) => {
  try { const { totals, coupon } = await prepare(req.user.id, req.body.coupon); res.json({ ...totals, coupon: coupon?.code || null }); } catch (e) { next(e); }
});

const placeSchema = z.object({
  address_id: z.string().uuid(), instructions: z.string().trim().max(300).optional(), coupon: z.string().trim().max(30).optional(),
  payment_method: z.enum(['cod', 'upi', 'razorpay']),
});

router.post('/', validate(placeSchema), async (req, res, next) => {
  let claimed = null;
  try {
    const { address_id, instructions, coupon: code, payment_method: method } = req.body;
    const online = method === 'razorpay';
    const manualUpi = method === 'upi';
    if (online && !pay.configured()) throw svc.fail('Razorpay payments aren’t available right now. Please choose UPI or cash on delivery.');
    const { data: addr } = await supabase.from('addresses').select('label,full_address,latitude,longitude').eq('id', address_id).eq('user_id', req.user.id).maybeSingle();
    if (!addr) throw svc.fail('Choose a delivery address');
    const { settings, priced, coupon, totals } = await prepare(req.user.id, code);

    if (coupon) {
      const { data, error } = await supabase.from('coupons').update({ used_count: coupon.used_count + 1 }).eq('id', coupon.id).eq('used_count', coupon.used_count).select('id');
      if (error) throw error;
      if (!data.length) throw svc.fail('This coupon was just used up. Remove it and try again.');
      claimed = coupon;
    }

    const orderId = crypto.randomUUID();
    const rzOrder = online ? await pay.createOrder(totals.total, orderId) : null; // amount comes from OUR totals

    ok(await supabase.from('orders').insert({
      id: orderId, customer_id: req.user.id, restaurant_id: priced.restaurant.id,
      items: priced.lines.map(({ food_id, name, price, qty, line_total, is_veg, options, selection, note }) => ({ food_id, name, price, qty, line_total, is_veg, options, selection, note })),
      ...totals, coupon_id: coupon?.id || null, address: addr, delivery_instructions: instructions || null,
      payment_method: method, payment_status: 'pending', order_status: (online || manualUpi) ? 'pending_payment' : 'placed',
      delivery_otp: String(crypto.randomInt(1000, 10000)),
      platform_commission: svc.r2(priced.subtotal * Number(settings.platform_commission_percent) / 100),
    }));
    await supabase.from('payments').insert({ order_id: orderId, amount: totals.total, payment_method: method, payment_status: 'pending', gateway_order_id: rzOrder?.id || null });
    if (method === 'cod') await supabase.from('order_status_history').insert({ order_id: orderId, status: 'placed', changed_by: req.user.id });
    await supabase.from('carts').update({ items: [], restaurant_id: null, updated_at: new Date().toISOString() }).eq('customer_id', req.user.id);
    res.status(201).json({ order_id: orderId, pay: online ? payInfo(rzOrder.id, totals.total, settings.name) : undefined });
  } catch (e) {
    if (claimed) await supabase.from('coupons').update({ used_count: claimed.used_count }).eq('id', claimed.id);
    next(e);
  }
});

const { settle } = require('../services/settlement');
const loadMine = async (req) => {
  const o = ok(await supabase.from('orders').select('id,customer_id,total,order_status,payment_method,payment_status').eq('id', req.params.id).eq('customer_id', req.user.id).maybeSingle());
  if (!o) throw svc.fail('Order not found', 404);
  return o;
};

router.post('/:id/verify', uuid, validate(z.object({ razorpay_order_id: z.string().max(60), razorpay_payment_id: z.string().max(60), razorpay_signature: z.string().max(200) })), wrap(async (req, res) => {
  const o = await loadMine(req);
  if (o.payment_method === 'cod') throw svc.fail('This is a cash on delivery order');
  if (o.payment_method === 'upi') throw svc.fail('Direct UPI payments must be verified by the store, not through Razorpay verification.');
  if (o.payment_status === 'paid') return res.json({ ok: true });
  const p = ok(await supabase.from('payments').select('gateway_order_id').eq('order_id', o.id).maybeSingle());
  const { razorpay_order_id: gid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
  if (!p || p.gateway_order_id !== gid || !pay.verifySignature(gid, pid, sig)) throw svc.fail('We couldn’t verify this payment');
  await settle(o, pid, gid);
  res.json({ ok: true });
}));

// Retry payment on an unpaid order (also recovers a payment made just before the tab closed).
router.post('/:id/pay', uuid, wrap(async (req, res) => {
  if (!pay.configured()) throw svc.fail('Online payments aren’t available right now');
  const o = await loadMine(req);
  if (o.payment_method === 'cod') throw svc.fail('This is a cash on delivery order');
  if (o.payment_method === 'upi') throw svc.fail('Direct UPI payments are verified manually by the store. Use the UPI details on your order page.');
  if (o.payment_status === 'paid') return res.json({ paid: true });
  if (o.order_status !== 'pending_payment') throw svc.fail('This order isn’t waiting for payment');
  const p = ok(await supabase.from('payments').select('gateway_order_id').eq('order_id', o.id).maybeSingle());
  let gid = p?.gateway_order_id;
  if (gid) {
    const rzo = await pay.getOrder(gid);
    if (rzo.status === 'paid') {
      const hit = (await pay.orderPayments(gid)).items.find((x) => ['captured', 'authorized'].includes(x.status));
      if (hit) { await settle(o, hit.id, gid); return res.json({ paid: true }); }
    }
  } else {
    gid = (await pay.createOrder(Number(o.total), o.id)).id;
    await supabase.from('payments').update({ gateway_order_id: gid }).eq('order_id', o.id);
  }
  res.json({ pay: payInfo(gid, Number(o.total), (await svc.getSettings()).name) });
}));

router.post('/:id/cancel', uuid, wrap(async (req, res) => {
  const o = await loadMine(req);
  const allowed = o.order_status === 'pending_payment' || (o.order_status === 'placed' && o.payment_method === 'cod');
  if (!allowed) throw svc.fail('This order can’t be cancelled here any more. Please contact support.');
  const moved = ok(await supabase.from('orders').update({ order_status: 'cancelled', cancel_reason: 'Cancelled by customer' }).eq('id', o.id).eq('order_status', o.order_status).select('id'));
  if (!moved.length) throw svc.fail('The restaurant just accepted this order, so it can’t be cancelled now.', 409);
  await supabase.from('order_status_history').insert({ order_id: o.id, status: 'cancelled', changed_by: req.user.id });
  res.json({ ok: true });
}));

const km = (a, b, c, d) => { const r = (x) => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
router.get('/:id/tracking', uuid, wrap(async (req, res) => {
  const o = ok(await supabase.from('orders').select('order_status,address,delivery_partner_id,restaurants(name,latitude,longitude)').eq('id', req.params.id).eq('customer_id', req.user.id).maybeSingle());
  if (!o) throw svc.fail('Order not found', 404);
  if (!['partner_assigned', 'picked_up', 'out_for_delivery'].includes(o.order_status) || !o.delivery_partner_id) return res.json({ active: false });
  const p = ok(await supabase.from('delivery_partners').select('current_latitude,current_longitude,location_updated_at').eq('id', o.delivery_partner_id).maybeSingle());
  const restaurant = { name: o.restaurants?.name, lat: o.restaurants?.latitude ?? null, lng: o.restaurants?.longitude ?? null };
  const drop = { lat: o.address.latitude ?? null, lng: o.address.longitude ?? null };
  const rider = p?.current_latitude != null ? { lat: p.current_latitude, lng: p.current_longitude, updated_at: p.location_updated_at } : null;
  const toYou = o.order_status !== 'partner_assigned', t = toYou ? drop : restaurant;
  let distance = null, eta = null;
  if (rider && t.lat != null) { distance = Math.round(km(rider.lat, rider.lng, t.lat, t.lng) * 10) / 10; eta = Math.max(1, Math.ceil(distance / 20 * 60)); } // assumes ~20 km/h
  res.json({ active: true, rider, restaurant, drop, distance_km: distance, eta_min: eta, heading_to: toYou ? 'you' : 'restaurant' });
}));

router.get('/', wrap(async (req, res) => {
  res.json({ orders: ok(await supabase.from('orders').select('id,total,order_status,created_at,items,restaurants(name)').eq('customer_id', req.user.id).order('created_at', { ascending: false }).limit(50)) });
}));

router.post('/:id/review', uuid, validate(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(300).optional() })), wrap(async (req, res) => {
  const o = ok(await supabase.from('orders').select('id,restaurant_id,order_status').eq('id', req.params.id).eq('customer_id', req.user.id).maybeSingle());
  if (!o) throw svc.fail('Order not found', 404);
  if (o.order_status !== 'delivered') throw svc.fail('You can rate an order after it’s delivered');
  const ins = await supabase.from('reviews').insert({ customer_id: req.user.id, restaurant_id: o.restaurant_id, order_id: o.id, rating: req.body.rating, comment: req.body.comment || null });
  if (ins.error?.code === '23505') throw svc.fail('You’ve already rated this order', 409);
  if (ins.error) throw ins.error;
  const all = ok(await supabase.from('reviews').select('rating').eq('restaurant_id', o.restaurant_id));
  const avg = all.reduce((sum, r) => sum + r.rating, 0) / all.length;
  await supabase.from('restaurants').update({ rating: Math.round(avg * 10) / 10 }).eq('id', o.restaurant_id);
  res.status(201).json({ ok: true });
}));

router.post('/:id/complaint', uuid, validate(z.object({ message: z.string().trim().min(5).max(500) })), wrap(async (req, res) => {
  const o = await loadMine(req);
  ok(await supabase.from('complaints').insert({ customer_id: req.user.id, order_id: o.id, message: req.body.message }));
  res.status(201).json({ ok: true });
}));

router.get('/:id', uuid, wrap(async (req, res) => {
  const data = ok(await supabase.from('orders').select('*, restaurants(name,address,phone), delivery_partners(vehicle_type, users(name,phone))').eq('id', req.params.id).eq('customer_id', req.user.id).maybeSingle());
  if (!data) throw svc.fail('Order not found', 404);
  const review = (await supabase.from('reviews').select('rating,comment').eq('order_id', data.id).maybeSingle()).data || null;
  res.json({ order: data, review });
}));

module.exports = router;
