const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(requireAuth, requireRole('customer'));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const uuid = (req, res, next) => /^[0-9a-f-]{36}$/i.test(req.params.id) ? next() : res.status(404).json({ error: 'Not found' });

router.get('/', wrap(async (req, res) => {
  const { data, error } = await supabase.from('favorites').select('restaurant_id, restaurants(id,name,image,cuisine,rating)').eq('user_id', req.user.id);
  if (error) throw error;
  res.json({ ids: data.map((x) => x.restaurant_id), restaurants: data.map((x) => x.restaurants).filter(Boolean) });
}));

router.post('/:id', uuid, wrap(async (req, res) => {
  const { error } = await supabase.from('favorites').upsert({ user_id: req.user.id, restaurant_id: req.params.id }, { onConflict: 'user_id,restaurant_id' });
  if (error?.code === '23503') return res.status(404).json({ error: 'Restaurant not found' });
  if (error) throw error;
  res.json({ ok: true });
}));

router.delete('/:id', uuid, wrap(async (req, res) => {
  const { error } = await supabase.from('favorites').delete().eq('user_id', req.user.id).eq('restaurant_id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

module.exports = router;
