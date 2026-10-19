const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('notifications').select('id,title,message,read_status,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    res.json({ notifications: data, unread: data.filter((n) => !n.read_status).length });
  } catch (e) { next(e); }
});

router.post('/read', async (req, res, next) => {
  try {
    const { error } = await supabase.from('notifications').update({ read_status: true }).eq('user_id', req.user.id).eq('read_status', false);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
