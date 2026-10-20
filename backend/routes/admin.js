const express = require('express');
const { z } = require('zod');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validate } = require('../middleware/validation');
const { r2, fail } = require('../services/orderService');
const pay = require('../services/paymentService');
const crypto = require('crypto');
const { sniffImage } = require('../services/imageCheck');
const { adminCanMove } = require('../services/orderFlow');

const router = express.Router();
router.use(requireAuth, requireRole('admin')); // every admin API call is checked against the database role

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const ok = (r) => { if (r.error) throw r.error; return r.data; };
const uuid = (req, res, next) => /^[0-9a-f-]{36}$/i.test(req.params.id) ? next() : res.status(404).json({ error: 'Not found' });
const nonEmpty = (req, res, next) => Object.keys(req.body).length ? next() : res.status(400).json({ error: 'Nothing to update' });
const ist = (d) => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const sum = (a, f) => r2(a.reduce((s, x) => s + Number(f(x) || 0), 0));

// ---------- Dashboard ----------
router.get('/stats', wrap(async (req, res) => {
  const [orders, rests, deliveries, partners, recent] = await Promise.all([
    supabase.from('orders').select('restaurant_id,total,order_status,created_at,platform_commission').neq('order_status', 'pending_payment').limit(10000).then(ok),
    supabase.from('restaurants').select('id,name,status').then(ok),
    supabase.from('deliveries').select('earnings').then(ok),
    supabase.from('delivery_partners').select('availability,approval_status').then(ok),
    supabase.from('orders').select('id,total,order_status,created_at,users(name),restaurants(name)').order('created_at', { ascending: false }).limit(8).then(ok),
  ]);
  const customers = (await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer')).count || 0;
  const by = (...s) => orders.filter((o) => s.includes(o.order_status));
  const done = by('delivered'), today = ist(new Date());
  const chart = [...Array(7)].map((_, i) => { const d = ist(Date.now() - (6 - i) * 864e5); return { day: d, revenue: sum(done.filter((o) => ist(o.created_at) === d), (o) => o.total) }; });
  const perf = rests.map((r) => { const o = done.filter((x) => x.restaurant_id === r.id); return { name: r.name, orders: o.length, revenue: sum(o, (x) => x.total) }; })
    .sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  res.json({
    customers, restaurants: rests.filter((r) => r.status === 'active').length,
    partners: { online: partners.filter((p) => p.availability === 'online').length, total: partners.filter((p) => p.approval_status === 'approved').length },
    counts: { total: orders.length, pending: by('placed').length, preparing: by('accepted', 'preparing', 'ready').length,
      out: by('partner_assigned', 'picked_up', 'out_for_delivery').length, completed: done.length, cancelled: by('cancelled', 'rejected').length },
    revenue: { total: sum(done, (o) => o.total), today: sum(done.filter((o) => ist(o.created_at) === today), (o) => o.total),
      commission: sum(done, (o) => o.platform_commission), delivery_earnings: sum(deliveries, (d) => d.earnings) },
    chart, performance: perf, recent,
  });
}));

router.get('/finance', wrap(async (req, res) => {
  const [orders, deliveries, payments] = await Promise.all([
    supabase.from('orders').select('total,subtotal,platform_commission,order_status,payment_status').neq('order_status', 'pending_payment').limit(10000).then(ok),
    supabase.from('deliveries').select('earnings').then(ok),
    supabase.from('payments').select('id,order_id,amount,payment_method,payment_status,created_at').order('created_at', { ascending: false }).limit(50).then(ok),
  ]);
  const done = orders.filter((o) => o.order_status === 'delivered');
  res.json({ total_sales: sum(done, (o) => o.total), platform_earnings: sum(done, (o) => o.platform_commission),
    restaurant_payouts: sum(done, (o) => Number(o.subtotal) - Number(o.platform_commission)), delivery_payouts: sum(deliveries, (d) => d.earnings),
    refunds: sum(orders.filter((o) => o.payment_status === 'refunded'), (o) => o.total), payments });
}));

// ---------- Restaurants ----------
const httpsImg = z.string().trim().max(500).refine((v) => v === '' || /^https:\/\//i.test(v), 'Image must be an https:// link');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 09:30');
const restSchema = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().max(400).optional(), address: z.string().trim().min(3).max(300),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  phone: z.string().trim().max(20).optional(), image: httpsImg.optional(), cuisine: z.array(z.string().trim().min(1).max(30)).max(8),
  zone_id: z.string().uuid().nullable().optional(), opening_time: hhmm, closing_time: hhmm, delivery_fee: z.number().min(0).max(500), is_veg: z.boolean().optional(), status: z.enum(['active', 'inactive']).optional(),
});

router.get('/restaurants', wrap(async (req, res) => res.json({ restaurants: ok(await supabase.from('restaurants').select('*').order('created_at', { ascending: false })) })));
router.post('/restaurants', validate(restSchema), wrap(async (req, res) => res.status(201).json({ restaurant: ok(await supabase.from('restaurants').insert(req.body).select().single()) })));
router.patch('/restaurants/:id', uuid, validate(restSchema.partial()), nonEmpty, wrap(async (req, res) =>
  res.json({ restaurant: ok(await supabase.from('restaurants').update(req.body).eq('id', req.params.id).select().single()) })));
router.delete('/restaurants/:id', uuid, wrap(async (req, res) => {
  const { error } = await supabase.from('restaurants').delete().eq('id', req.params.id);
  if (error?.code === '23503') throw fail('This restaurant has orders, so it can’t be deleted. Deactivate it instead.', 409);
  if (error) throw error;
  res.json({ ok: true });
}));

// ---------- Food ----------
const custSchema = z.array(z.object({ name: z.string().trim().min(1).max(30), type: z.enum(['one', 'many']),
  options: z.array(z.object({ label: z.string().trim().min(1).max(40), price: z.number().min(0).max(5000) })).min(1).max(12) })).max(6);
const foodSchema = z.object({
  restaurant_id: z.string().uuid(), name: z.string().trim().min(2).max(100), description: z.string().trim().max(400).optional(),
  price: z.number().min(0).max(100000), category: z.string().trim().min(2).max(40), image: httpsImg.optional(),
  is_veg: z.boolean(), availability: z.boolean(), discount_percent: z.number().min(0).max(100), customizations: custSchema.optional(),
});
router.get('/foods', wrap(async (req, res) => {
  let q = supabase.from('food_items').select('*').order('category').order('name');
  if (/^[0-9a-f-]{36}$/i.test(req.query.restaurant_id || '')) q = q.eq('restaurant_id', req.query.restaurant_id);
  res.json({ foods: ok(await q) });
}));
router.post('/foods', validate(foodSchema), wrap(async (req, res) => res.status(201).json({ food: ok(await supabase.from('food_items').insert(req.body).select().single()) })));
router.patch('/foods/:id', uuid, validate(foodSchema.partial()), nonEmpty, wrap(async (req, res) =>
  res.json({ food: ok(await supabase.from('food_items').update(req.body).eq('id', req.params.id).select().single()) })));
router.delete('/foods/:id', uuid, wrap(async (req, res) => { ok(await supabase.from('food_items').delete().eq('id', req.params.id)); res.json({ ok: true }); }));

// ---------- Orders ----------
const ALL_STATUSES = ['pending_payment', 'placed', 'accepted', 'preparing', 'ready', 'partner_assigned', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'];
const ORDER_SELECT = '*, users(name,phone,email), restaurants(name,phone), delivery_partners(vehicle_type, users(name,phone))';
router.get('/orders', wrap(async (req, res) => {
  let q = supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false }).limit(100);
  const wanted = String(req.query.status || 'all');
  if (wanted !== 'all') q = q.in('order_status', wanted.split(',').filter((s) => ALL_STATUSES.includes(s))); // one status or a comma-separated group
  const orders = ok(await q);
  orders.forEach((o) => delete o.delivery_otp); // the OTP belongs to the customer, not the admin
  res.json({ orders });
}));

const MSG = { accepted: ['Order accepted', 'The restaurant accepted your order.'], rejected: ['Order rejected', 'Sorry, the restaurant couldn’t take your order.'],
  preparing: ['Preparing your food', 'The kitchen is preparing your order.'], ready: ['Food is ready', 'Your food is ready for pickup.'], cancelled: ['Order cancelled', 'Your order was cancelled.'] };

router.patch('/orders/:id/status', uuid, validate(z.object({ status: z.enum(['accepted', 'rejected', 'preparing', 'ready', 'cancelled']), reason: z.string().trim().max(200).optional() })),
  wrap(async (req, res) => {
    const { status, reason } = req.body;
    if (['rejected', 'cancelled'].includes(status) && !reason) throw fail('Please give a reason');
    const o = ok(await supabase.from('orders').select('id,customer_id,order_status').eq('id', req.params.id).maybeSingle());
    if (!o) throw fail('Order not found', 404);
    const allowed = adminCanMove(o.order_status, status);
    if (!allowed) throw fail(`An order that is "${o.order_status}" can’t be changed to "${status}"`, 409);
    const upd = ok(await supabase.from('orders').update({ order_status: status, cancel_reason: reason || null })
      .eq('id', o.id).eq('order_status', o.order_status).select('id')); // only succeeds if nobody changed it meanwhile
    if (!upd.length) throw fail('This order was just updated by someone else. Refresh and try again.', 409);
    await supabase.from('order_status_history').insert({ order_id: o.id, status, changed_by: req.user.id });
    await supabase.from('notifications').insert({ user_id: o.customer_id, title: MSG[status][0], message: reason ? `${MSG[status][1]} Reason: ${reason}` : MSG[status][1] });
    const refund = ['rejected', 'cancelled'].includes(status) ? await pay.refundOrder(o.id) : null; // paid online orders are refunded automatically
    res.json({ ok: true, refund });
  }));

router.post('/orders/:id/refund', uuid, wrap(async (req, res) => {
  const o = ok(await supabase.from('orders').select('order_status').eq('id', req.params.id).maybeSingle());
  if (!o || !['cancelled', 'rejected'].includes(o.order_status)) throw fail('Only cancelled or rejected orders can be refunded', 409);
  const refund = await pay.refundOrder(req.params.id);
  if (!refund) throw fail('Nothing to refund for this order', 409);
  res.json({ refund });
}));

// Image upload: checked by content (magic bytes), size-limited, stored under a random name.
router.post('/upload', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), wrap(async (req, res) => {
  const type = sniffImage(req.body);
  if (!type) throw fail('Choose a JPG, PNG or WebP image under 2 MB');
  const name = `${crypto.randomUUID()}.${type.ext}`;
  const up = await supabase.storage.from('images').upload(name, req.body, { contentType: type.mime, cacheControl: '31536000' });
  if (up.error) throw up.error;
  res.json({ url: supabase.storage.from('images').getPublicUrl(name).data.publicUrl });
}));

// ---------- Complaints ----------
router.get('/complaints', wrap(async (req, res) => res.json({ complaints: ok(await supabase.from('complaints').select('id,order_id,message,status,created_at,users(name,phone)').order('status', { ascending: false }).order('created_at', { ascending: false }).limit(100)) })));
router.patch('/complaints/:id', uuid, validate(z.object({ status: z.enum(['open', 'resolved']) })), wrap(async (req, res) => {
  ok(await supabase.from('complaints').update({ status: req.body.status }).eq('id', req.params.id));
  res.json({ ok: true });
}));

// ---------- Customers ----------
router.get('/customers', wrap(async (req, res) => {
  let q = supabase.from('users').select('id,name,email,phone,status,created_at').eq('role', 'customer').order('created_at', { ascending: false }).limit(200);
  const term = String(req.query.q || '').trim().replace(/[%,()]/g, '').slice(0, 40);
  if (term) q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  res.json({ customers: ok(await q) });
}));
router.patch('/customers/:id', uuid, validate(z.object({ status: z.enum(['active', 'suspended']) })), wrap(async (req, res) => {
  ok(await supabase.from('users').update({ status: req.body.status }).eq('id', req.params.id).eq('role', 'customer'));
  res.json({ ok: true });
}));
router.get('/customers/:id/orders', uuid, wrap(async (req, res) =>
  res.json({ orders: ok(await supabase.from('orders').select('id,total,order_status,created_at,restaurants(name)').eq('customer_id', req.params.id).order('created_at', { ascending: false }).limit(50)) })));

// ---------- Delivery partners ----------
router.get('/partners', wrap(async (req, res) =>
  res.json({ partners: ok(await supabase.from('delivery_partners').select('id,vehicle_type,vehicle_number,approval_status,availability,current_latitude,current_longitude,rider_zones(zone_id),users(name,email,phone,status)').order('approval_status')) })));
router.patch('/partners/:id', uuid, validate(z.object({ approval_status: z.enum(['approved', 'rejected', 'suspended', 'pending']) })), wrap(async (req, res) => {
  const patch = { approval_status: req.body.approval_status };
  if (patch.approval_status !== 'approved') patch.availability = 'offline'; // can’t stay online once not approved
  ok(await supabase.from('delivery_partners').update(patch).eq('id', req.params.id));
  res.json({ ok: true });
}));

// ---------- Delivery zones ----------
router.get('/zones', wrap(async (req, res) => {
  const [zs, rs, rz] = await Promise.all([
    supabase.from('zones').select('id,name,latitude,longitude,radius_km,created_at').order('name').then(ok),
    supabase.from('restaurants').select('zone_id').not('zone_id', 'is', null).then(ok),
    supabase.from('rider_zones').select('zone_id').then(ok),
  ]);
  const n = (rows, id) => rows.filter((x) => x.zone_id === id).length;
  res.json({ zones: zs.map((x) => ({ ...x, restaurants: n(rs, x.id), riders: n(rz, x.id) })) });
}));
const zoneBase = z.object({ name: z.string().trim().min(2).max(40), latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(), radius_km: z.number().min(0.1).max(50).nullable().optional() });
const centreOk = (v) => (v.latitude == null) === (v.longitude == null); // a centre needs both numbers
const zoneSchema = zoneBase.refine(centreOk, 'Pick the zone centre on the map');
const zonePatch = zoneBase.partial().refine(centreOk, 'Pick the zone centre on the map');
router.post('/zones', validate(zoneSchema), wrap(async (req, res) => {
  const r = await supabase.from('zones').insert(req.body).select().single();
  if (r.error?.code === '23505') throw fail('A zone with this name already exists', 409);
  if (r.error) throw r.error;
  res.status(201).json({ zone: r.data });
}));
router.patch('/zones/:id', uuid, validate(zonePatch), wrap(async (req, res) => {
  const r = await supabase.from('zones').update(req.body).eq('id', req.params.id);
  if (r.error?.code === '23505') throw fail('A zone with this name already exists', 409);
  if (r.error) throw r.error;
  res.json({ ok: true });
}));
router.delete('/zones/:id', uuid, wrap(async (req, res) => { // restaurants in it become "no zone"; riders lose it
  ok(await supabase.from('zones').delete().eq('id', req.params.id));
  res.json({ ok: true });
}));
router.patch('/partners/:id/zones', uuid, validate(z.object({ zone_ids: z.array(z.string().uuid()).max(50) })), wrap(async (req, res) => {
  ok(await supabase.from('rider_zones').delete().eq('partner_id', req.params.id));
  if (req.body.zone_ids.length) {
    const r = await supabase.from('rider_zones').insert(req.body.zone_ids.map((zone_id) => ({ partner_id: req.params.id, zone_id })));
    if (r.error?.code === '23503') throw fail('One of those zones no longer exists');
    if (r.error) throw r.error;
  }
  res.json({ ok: true });
}));

// ---------- Coupons ----------
const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Code must be 3–20 letters or numbers'),
  discount_type: z.enum(['percent', 'fixed']), discount_value: z.number().positive().max(100000), minimum_order: z.number().min(0),
  usage_limit: z.number().int().positive().nullable().optional(), expiry_date: z.string().nullable().optional(),
}).refine((c) => c.discount_type !== 'percent' || c.discount_value <= 100, 'A percentage can’t be above 100');
router.get('/coupons', wrap(async (req, res) => res.json({ coupons: ok(await supabase.from('coupons').select('*').order('code')) })));
router.post('/coupons', validate(couponSchema), wrap(async (req, res) => {
  const { error, data } = await supabase.from('coupons').insert(req.body).select().single();
  if (error?.code === '23505') throw fail('A coupon with this code already exists', 409);
  if (error) throw error;
  res.status(201).json({ coupon: data });
}));
router.patch('/coupons/:id', uuid, validate(z.object({ active: z.boolean() })), wrap(async (req, res) => {
  ok(await supabase.from('coupons').update({ active: req.body.active }).eq('id', req.params.id));
  res.json({ ok: true });
}));

// ---------- Settings ----------
const settingsSchema = z.object({
  name: z.string().trim().min(1).max(40), currency: z.string().trim().min(1).max(5), tax_percent: z.number().min(0).max(40),
  min_order: z.number().min(0), platform_commission_percent: z.number().min(0).max(60), base_delivery_fee: z.number().min(0),
  support_phone: z.string().trim().max(20), service_available: z.boolean(), logo_url: httpsImg.optional(),
});
router.get('/settings', wrap(async (req, res) => res.json({ settings: ok(await supabase.from('settings').select('value').eq('key', 'app').maybeSingle())?.value || {} })));
router.put('/settings', validate(settingsSchema), wrap(async (req, res) => {
  ok(await supabase.from('settings').upsert({ key: 'app', value: req.body }));
  res.json({ settings: req.body });
}));

module.exports = router;
