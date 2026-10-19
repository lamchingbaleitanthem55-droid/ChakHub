// Razorpay over its REST API (no SDK needed). Secrets never leave the server.
const crypto = require('crypto');
const supabase = require('../config/supabase');

const KEY = () => process.env.RAZORPAY_KEY_ID, SECRET = () => process.env.RAZORPAY_KEY_SECRET;
const configured = () => !!(KEY() && SECRET());

async function rz(method, path, body) {
  const res = await fetch('https://api.razorpay.com/v1' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Basic ' + Buffer.from(`${KEY()}:${SECRET()}`).toString('base64'), 'Content-Type': 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('Razorpay error', res.status, json.error); throw Object.assign(new Error(json.error?.description || 'The payment provider returned an error'), { status: 502 }); }
  return json;
}

const createOrder = (rupees, receipt) => rz('POST', '/orders', { amount: Math.round(rupees * 100), currency: 'INR', receipt, notes: { order_id: receipt } });
const getOrder = (id) => rz('GET', '/orders/' + encodeURIComponent(id));
const orderPayments = (id) => rz('GET', `/orders/${encodeURIComponent(id)}/payments`);
const fetchPayment = (id) => rz('GET', '/payments/' + encodeURIComponent(id));
const capture = (id, amount, currency) => rz('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency });
const refund = (paymentId, rupees) => rz('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: Math.round(rupees * 100) });

// Razorpay signs "order_id|payment_id" with your secret. Only the real checkout can produce this.
function verifySignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', SECRET()).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Refunds a paid online order. Returns a short result string for the admin panel.
async function refundOrder(orderId) {
  const { data: o } = await supabase.from('orders').select('id,total,payment_method,payment_status').eq('id', orderId).maybeSingle();
  if (!o || o.payment_method === 'cod' || o.payment_status !== 'paid') return null;
  const { data: p } = await supabase.from('payments').select('payment_gateway_reference').eq('order_id', orderId).maybeSingle();
  if (!p?.payment_gateway_reference) return 'failed: no payment reference found';
  try {
    await refund(p.payment_gateway_reference, Number(o.total));
    await supabase.from('orders').update({ payment_status: 'refunded' }).eq('id', orderId);
    await supabase.from('payments').update({ payment_status: 'refunded' }).eq('order_id', orderId);
    return 'refunded';
  } catch (e) { return 'failed: ' + e.message; }
}

module.exports = { configured, createOrder, getOrder, orderPayments, fetchPayment, capture, refund, verifySignature, refundOrder };
