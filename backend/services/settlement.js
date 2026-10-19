// Confirms an online payment with Razorpay itself, then releases the order to the restaurant.
// Used by the checkout "verify" step, the "pay again" recovery and the webhook, so all three behave identically.
const supabase = require('../config/supabase');
const svc = require('./orderService');
const pay = require('./paymentService');

const ok = (r) => { if (r.error) throw r.error; return r.data; };

async function settle(order, paymentId, gatewayOrderId) {
  let rp = await pay.fetchPayment(paymentId);
  if (rp.order_id !== gatewayOrderId || rp.amount !== Math.round(Number(order.total) * 100)) throw svc.fail('Payment details don’t match this order');
  if (rp.status === 'authorized') rp = await pay.capture(paymentId, rp.amount, rp.currency);
  if (rp.status !== 'captured') throw svc.fail('The payment hasn’t been completed');
  const u = await supabase.from('payments').update({ payment_status: 'paid', payment_gateway_reference: paymentId }).eq('order_id', order.id);
  if (u.error?.code === '23505') throw svc.fail('This payment was already used for another order', 409);
  if (u.error) throw u.error;
  const moved = ok(await supabase.from('orders').update({ payment_status: 'paid', order_status: 'placed' }).eq('id', order.id).eq('order_status', 'pending_payment').select('id'));
  if (moved.length) {
    await supabase.from('order_status_history').insert({ order_id: order.id, status: 'placed', changed_by: order.customer_id });
    await supabase.from('notifications').insert({ user_id: order.customer_id, title: 'Payment received', message: 'Your order has been sent to the restaurant.' });
  }
}

module.exports = { settle };
