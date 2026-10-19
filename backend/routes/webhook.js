// Razorpay webhook: a second, server-to-server way to learn a payment succeeded
// (covers customers who close the tab right after paying). Needs RAZORPAY_WEBHOOK_SECRET.
const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { settle } = require('../services/settlement');

const router = express.Router();

router.post('/', express.raw({ type: '*/*', limit: '100kb' }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured' });
  const given = Buffer.from(String(req.headers['x-razorpay-signature'] || ''));
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(req.body).digest('hex'));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(400).json({ error: 'Bad signature' });

  try {
    const ev = JSON.parse(req.body.toString('utf8'));
    const p = ev.payload?.payment?.entity;
    if (['payment.captured', 'order.paid'].includes(ev.event) && p?.notes?.order_id) {
      const { data: order } = await supabase.from('orders').select('id,customer_id,total,order_status,payment_status').eq('id', p.notes.order_id).maybeSingle();
      const { data: row } = order ? await supabase.from('payments').select('gateway_order_id').eq('order_id', order.id).maybeSingle() : {};
      if (order && order.order_status === 'pending_payment' && row?.gateway_order_id === p.order_id) await settle(order, p.id, p.order_id);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook error', e.message);
    res.status(e.status && e.status < 500 ? 200 : 500).json({ ok: false }); // 500 makes Razorpay retry
  }
});

module.exports = router;
