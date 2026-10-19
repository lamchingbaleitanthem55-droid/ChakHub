const express = require('express');
const { z } = require('zod');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

const router = express.Router();
const rollback = (id) => supabase.auth.admin.deleteUser(id);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  phone: z.string().trim().regex(/^\+?[0-9]{10,13}$/, 'Enter a valid phone number'),
  // Only these two can self-register. Admin accounts are created by the seed script.
  accountType: z.enum(['customer', 'delivery']).default('customer'),
  vehicleType: z.enum(['bike', 'scooter', 'bicycle']).optional(),
});

router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, phone, accountType, vehicleType } = req.body;
    if (accountType === 'delivery' && !vehicleType)
      return res.status(400).json({ error: 'vehicleType is required for delivery partners' });

    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (error) {
      const taken = /already|registered/i.test(error.message);
      return res.status(taken ? 409 : 400).json({ error: taken ? 'An account with this email already exists' : error.message });
    }

    const id = data.user.id;
    const { error: pErr } = await supabase.from('users').insert({ id, name, email, phone, role: accountType });
    if (pErr) { await rollback(id); return next(pErr); }
    if (accountType === 'delivery') {
      const r = await supabase.from('delivery_partners').insert({ user_id: id, vehicle_type: vehicleType });
      if (r.error) { await rollback(id); return next(r.error); }
    }

    res.status(201).json({
      message: accountType === 'delivery'
        ? 'Registered. An admin must approve your account before you can go online.'
        : 'Account created. You can log in now.',
    });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = req.user;
    let partner = null;
    if (u.role === 'delivery') {
      const { data } = await supabase.from('delivery_partners')
        .select('approval_status, availability, vehicle_type').eq('user_id', u.id).maybeSingle();
      partner = data;
    }
    res.json({ user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, avatar_url: u.avatar_url }, partner });
  } catch (e) { next(e); }
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().regex(/^\+?[0-9]{10,13}$/).optional(),
}).strict(); // role/status can never be changed here

router.patch('/me', requireAuth, validate(profileSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('users').update(req.body).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json({ user: data });
  } catch (e) { next(e); }
});

module.exports = router;
