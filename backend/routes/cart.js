const express = require('express');
const { z } = require('zod');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validate } = require('../middleware/validation');
const svc = require('../services/orderService');

const router = express.Router();
router.use(requireAuth, requireRole('customer'));

const body = (p) => ({ restaurant: p.restaurant && { id: p.restaurant.id, name: p.restaurant.name, delivery_fee: p.restaurant.delivery_fee, is_open: p.restaurant.is_open },
  lines: p.lines, subtotal: p.subtotal });

router.get('/', async (req, res, next) => {
  try { res.json(body(await svc.priceItems(await svc.loadCartItems(req.user.id)))); } catch (e) { next(e); }
});

const item = z.object({ food_id: z.string().uuid(), qty: z.number().int().min(1).max(20),
  options: z.array(z.object({ group: z.string().max(30), label: z.string().max(40) })).max(12).optional(), note: z.string().trim().max(100).optional() });
const schema = z.object({ items: z.array(item).max(40) });

router.put('/', validate(schema), async (req, res, next) => {
  try {
    const merged = new Map(); // identical dish + options + note become one line
    req.body.items.forEach((i) => { const k = svc.lineKey(i), m = merged.get(k); m ? (m.qty = Math.min(20, m.qty + i.qty)) : merged.set(k, { ...i }); });
    const priced = await svc.priceItems([...merged.values()]);
    priced.lines = priced.lines.filter((l) => l.available); // unavailable dishes are dropped
    if (new Set(priced.lines.map((l) => l.restaurant_id)).size > 1) throw svc.fail('A cart can only hold dishes from one restaurant');
    priced.subtotal = svc.r2(priced.lines.reduce((s, l) => s + l.line_total, 0));
    const { error } = await supabase.from('carts').upsert({
      customer_id: req.user.id, restaurant_id: priced.lines[0]?.restaurant_id || null,
      items: priced.lines.map((l) => ({ food_id: l.food_id, qty: l.qty, options: l.selection, note: l.note })), updated_at: new Date().toISOString(),
    }, { onConflict: 'customer_id' });
    if (error) throw error;
    res.json(body(priced));
  } catch (e) { next(e); }
});

module.exports = router;
