const express = require('express');
const { z } = require('zod');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { validate } = require('../middleware/validation');

const router = express.Router();
router.use(requireAuth, requireRole('customer'));

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('addresses').select('id,label,full_address').eq('user_id', req.user.id).order('created_at');
    if (error) throw error;
    res.json({ addresses: data });
  } catch (e) { next(e); }
});

const schema = z.object({ label: z.string().trim().min(1).max(30), full_address: z.string().trim().min(8).max(300),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional() });
router.post('/', validate(schema), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('addresses').insert({ ...req.body, user_id: req.user.id }).select('id,label,full_address').single();
    if (error) throw error;
    res.status(201).json({ address: data });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Address not found' });
    const { error } = await supabase.from('addresses').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
