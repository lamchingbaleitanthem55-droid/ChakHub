const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requireApprovedPartner } = require('../middleware/roles');
const { validate } = require('../middleware/validation');
const { r2, fail } = require('../services/orderService');

const router = express.Router();
router.use(requireAuth, requireRole('delivery'), requireApprovedPartner); // role AND admin approval, both from the database

const ACTIVE = ['partner_assigned', 'picked_up', 'out_for_delivery'];
const MIN_PAYOUT = 20; // a rider earns the order's delivery fee, at least ₹20
const payout = (o) => Math.max(MIN_PAYOUT, Number(o.delivery_fee));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const ok = (r) => { if (r.error) throw r.error; return r.data; };
const uuid = (req, res, next) => /^[0-9a-f-]{36}$/i.test(req.params.id) ? next() : res.status(404).json({ error: 'Not found' });
const ist = (d) => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const area = (a) => a.full_address.split(',').slice(-2).join(',').trim() || a.label; // customers' exact address stays hidden until you accept

const riderZoneIds = async (partnerId) => ok(await supabase.from('rider_zones').select('zone_id').eq('partner_id', partnerId)).map((r) => r.zone_id);

async function activeOrder(partnerId) {
  const data = ok(await supabase.from('orders').select('id,customer_id,order_status,items,address,delivery_instructions,total,delivery_fee,payment_method,payment_status,restaurants(name,address,phone,latitude,longitude),users(name,phone)')
    .eq('delivery_partner_id', partnerId).in('order_status', ACTIVE).limit(1));
  return data[0] || null;
}
const myStatus = async (id) => (await supabase.from('delivery_partners').select('availability').eq('id', id).single()).data?.availability;
const notify = (userId, title, message) => supabase.from('notifications').insert({ user_id: userId, title, message });
const history = (orderId, status, by) => supabase.from('order_status_history').insert({ order_id: orderId, status, changed_by: by });

async function earningsData(partnerId) {
  const rows = ok(await supabase.from('deliveries').select('earnings,delivery_time,order_id,orders(restaurants(name))').eq('delivery_partner_id', partnerId).eq('status', 'delivered').order('delivery_time', { ascending: false }).limit(1000));
  const within = (days) => rows.filter((r) => Date.now() - new Date(r.delivery_time) < days * 864e5);
  const sum = (a) => r2(a.reduce((s, r) => s + Number(r.earnings), 0));
  const today = ist(new Date());
  return { today: sum(rows.filter((r) => ist(r.delivery_time) === today)), week: sum(within(7)), month: sum(within(30)), total: sum(rows), count: rows.length,
    history: rows.slice(0, 50).map((r) => ({ order_id: r.order_id, restaurant: r.orders?.restaurants?.name, earnings: Number(r.earnings), delivery_time: r.delivery_time })) };
}

router.get('/dashboard', wrap(async (req, res) => {
  const [partner, user, e, act] = await Promise.all([
    supabase.from('delivery_partners').select('availability,vehicle_type,vehicle_number').eq('id', req.partner.id).single().then(ok),
    supabase.from('users').select('name,email,phone').eq('id', req.user.id).single().then(ok),
    earningsData(req.partner.id), activeOrder(req.partner.id),
  ]);
  let waiting = 0;
  const mine = await riderZoneIds(req.partner.id);
  if (partner.availability === 'online' && !act) waiting = ok(await supabase.from('orders').select('id,restaurants(zone_id)').eq('order_status', 'ready').is('delivery_partner_id', null).limit(200)).filter((o) => inZones(mine, o.restaurants?.zone_id)).length;
  const zrows = ok(await supabase.from('rider_zones').select('zones(name,latitude,longitude,radius_km)').eq('partner_id', req.partner.id)).map((r) => r.zones).filter(Boolean);
  const zones = zrows.map((z) => z.name);
  const zone_areas = zrows.filter((z) => z.latitude != null && z.longitude != null && z.radius_km != null).map((z) => ({ name: z.name, lat: z.latitude, lng: z.longitude, radius_km: Number(z.radius_km) }));
  res.json({ user, partner, stats: { today: e.today, total: e.total, completed: e.count }, has_active: !!act, waiting, zones, zone_areas });
}));

router.patch('/availability', validate(z.object({ availability: z.enum(['online', 'offline']) })), wrap(async (req, res) => {
  const { availability } = req.body;
  if (availability === 'offline' && await activeOrder(req.partner.id)) throw fail('Finish your current delivery before going offline', 409);
  const patch = availability === 'offline' ? { availability, current_latitude: null, current_longitude: null } : { availability };
  ok(await supabase.from('delivery_partners').update(patch).eq('id', req.partner.id));
  res.json({ availability });
}));

router.get('/requests', wrap(async (req, res) => {
  const online = (await myStatus(req.partner.id)) === 'online';
  if (!online || await activeOrder(req.partner.id)) return res.json({ requests: [], online });
  const rows = ok(await supabase.from('orders').select('id,delivery_fee,address,created_at,payment_method,total,restaurants(name,address,zone_id)')
    .eq('order_status', 'ready').is('delivery_partner_id', null).order('created_at').limit(50));
  const zones = await riderZoneIds(req.partner.id);
  res.json({ online, requests: rows.filter((o) => inZones(zones, o.restaurants?.zone_id)).map((o) => ({ id: o.id, restaurant: o.restaurants?.name, pickup: o.restaurants?.address, drop_area: area(o.address),
    payout: payout(o), cash: o.payment_method === 'cod' ? Number(o.total) : 0, ready_since: o.created_at })) });
}));

router.post('/requests/:id/accept', uuid, wrap(async (req, res) => {
  if ((await myStatus(req.partner.id)) !== 'online') throw fail('Go online to accept deliveries');
  if (await activeOrder(req.partner.id)) throw fail('Finish your current delivery first', 409);
  const target = ok(await supabase.from('orders').select('restaurants(zone_id)').eq('id', req.params.id).maybeSingle()); // enforced here too, not just in the list
  if (target && !inZones(await riderZoneIds(req.partner.id), target.restaurants?.zone_id)) throw fail('This order is outside your delivery zone', 403);
  // One atomic UPDATE: it only matches while the order is still "ready" and unclaimed, so exactly one rider can win.
  const won = ok(await supabase.from('orders').update({ delivery_partner_id: req.partner.id, order_status: 'partner_assigned' })
    .eq('id', req.params.id).eq('order_status', 'ready').is('delivery_partner_id', null).select('id,customer_id'));
  if (!won.length) throw fail('Another delivery partner already took this order', 409);
  const o = won[0];
  ok(await supabase.from('deliveries').upsert({ order_id: o.id, delivery_partner_id: req.partner.id, status: 'assigned', earnings: 0 }, { onConflict: 'order_id' }));
  await history(o.id, 'partner_assigned', req.user.id);
  await notify(o.customer_id, 'Delivery partner assigned', `${req.user.name} will deliver your order.`);
  res.json({ ok: true });
}));

router.get('/active', wrap(async (req, res) => {
  const o = await activeOrder(req.partner.id);
  if (!o) return res.json({ order: null });
  const d = ok(await supabase.from('deliveries').select('status').eq('order_id', o.id).maybeSingle());
  delete o.customer_id;
  res.json({ order: o, step: d?.status || 'assigned', payout: payout(o), cash: o.payment_method === 'cod' ? Number(o.total) : 0 });
}));

const { RIDER_STEPS: STEPS, inZones } = require('./../services/orderFlow');
const TEXT = { picked_up: ['Order picked up', 'Your food is with the delivery partner.'], out_for_delivery: ['Out for delivery', 'Your delivery partner is on the way.'], delivered: ['Order delivered', 'Enjoy your meal!'] };
const tries = new Map(); // orderId -> wrong-code counter (resets on server restart)

router.post('/active/step', validate(z.object({ step: z.enum(Object.keys(STEPS)), otp: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code').optional() })), wrap(async (req, res) => {
  const { step, otp } = req.body;
  const o = await activeOrder(req.partner.id);
  if (!o) throw fail('You have no active delivery', 404);
  const [needOrder, needDel, newOrder, newDel] = STEPS[step];
  const d = ok(await supabase.from('deliveries').select('status').eq('order_id', o.id).maybeSingle());
  if (o.order_status !== needOrder || d?.status !== needDel) throw fail('That step isn’t available yet', 409);

  if (step === 'complete') {
    const t = tries.get(o.id) || { n: 0, until: 0 };
    if (t.until > Date.now()) throw fail('Too many wrong codes. Try again in a few minutes.', 429);
    if (!otp) throw fail('Ask the customer for their 4-digit code');
    const real = ok(await supabase.from('orders').select('delivery_otp').eq('id', o.id).single()).delivery_otp || '';
    const good = real.length === 4 && crypto.timingSafeEqual(Buffer.from(real), Buffer.from(otp));
    if (!good) {
      t.n += 1; if (t.n >= 5) { t.until = Date.now() + 15 * 60e3; t.n = 0; } tries.set(o.id, t);
      throw fail('That code is wrong. Ask the customer to check their order page.');
    }
    tries.delete(o.id);
  }

  const now = new Date().toISOString();
  if (newOrder) {
    const patch = { order_status: newOrder };
    if (step === 'complete') { patch.delivered_at = now; if (o.payment_method === 'cod') patch.payment_status = 'paid'; } // cash collected
    const moved = ok(await supabase.from('orders').update(patch).eq('id', o.id).eq('delivery_partner_id', req.partner.id).eq('order_status', needOrder).select('id'));
    if (!moved.length) throw fail('This order was just changed. Refresh and try again.', 409);
    await history(o.id, newOrder, req.user.id);
    await notify(o.customer_id, ...TEXT[newOrder]);
  }
  const dp = { status: newDel };
  if (step === 'pickup') dp.pickup_time = now;
  if (step === 'complete') { dp.delivery_time = now; dp.earnings = payout(o); }
  ok(await supabase.from('deliveries').update(dp).eq('order_id', o.id).eq('status', needDel));
  if (step === 'complete') {
    if (o.payment_method === 'cod') await supabase.from('payments').update({ payment_status: 'paid' }).eq('order_id', o.id);
    await supabase.from('delivery_partners').update({ current_latitude: null, current_longitude: null }).eq('id', req.partner.id); // stop tracking
    return res.json({ ok: true, earned: payout(o) });
  }
  res.json({ ok: true });
}));

// Location is stored only while a delivery is active.
router.post('/location', validate(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })), wrap(async (req, res) => {
  if (!(await activeOrder(req.partner.id))) return res.json({ tracking: false });
  ok(await supabase.from('delivery_partners').update({ current_latitude: req.body.latitude, current_longitude: req.body.longitude, location_updated_at: new Date().toISOString() }).eq('id', req.partner.id));
  res.json({ tracking: true });
}));

router.get('/earnings', wrap(async (req, res) => res.json(await earningsData(req.partner.id))));

const profileSchema = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().regex(/^\+?[0-9]{10,13}$/, 'Enter a valid phone number'),
  vehicle_type: z.enum(['bike', 'scooter', 'bicycle']), vehicle_number: z.string().trim().max(20) }).partial().strict();
router.patch('/profile', validate(profileSchema), wrap(async (req, res) => {
  const { name, phone, vehicle_type, vehicle_number } = req.body;
  if (name || phone) ok(await supabase.from('users').update({ ...(name && { name }), ...(phone && { phone }) }).eq('id', req.user.id));
  if (vehicle_type || vehicle_number !== undefined) ok(await supabase.from('delivery_partners').update({ ...(vehicle_type && { vehicle_type }), ...(vehicle_number !== undefined && { vehicle_number }) }).eq('id', req.partner.id));
  res.json({ ok: true });
}));

module.exports = router;
