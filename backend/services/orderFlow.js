// The allowed order status changes, kept in one place so they can be unit-tested.
const ADMIN_FLOW = { placed: ['accepted', 'rejected'], accepted: ['preparing'], preparing: ['ready'] };
const CANCELLABLE = ['placed', 'accepted', 'preparing', 'ready', 'partner_assigned'];
const adminCanMove = (from, to) => (to === 'cancelled' ? CANCELLABLE.includes(from) : (ADMIN_FLOW[from] || []).includes(to));

// Rider steps: [order status required, delivery status required, new order status, new delivery status]
const RIDER_STEPS = {
  arrived_restaurant: ['partner_assigned', 'assigned', null, 'at_restaurant'],
  pickup: ['partner_assigned', 'at_restaurant', 'picked_up', 'picked_up'],
  start_delivery: ['picked_up', 'picked_up', 'out_for_delivery', 'out_for_delivery'],
  arrived_customer: ['out_for_delivery', 'out_for_delivery', null, 'at_customer'],
  complete: ['out_for_delivery', 'at_customer', 'delivered', 'delivered'],
};
const riderCanDo = (step, orderStatus, deliveryStatus) => !!RIDER_STEPS[step] && RIDER_STEPS[step][0] === orderStatus && RIDER_STEPS[step][1] === deliveryStatus;

module.exports = { ADMIN_FLOW, CANCELLABLE, adminCanMove, RIDER_STEPS, riderCanDo };
