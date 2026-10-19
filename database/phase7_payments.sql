-- Phase 7: online payments. Run once in Supabase -> SQL Editor.
alter table payments add column if not exists gateway_order_id text;
create index if not exists payments_order_idx on payments (order_id);

-- Online orders wait in "pending_payment" until the payment is verified.
alter table orders drop constraint if exists orders_order_status_check;
alter table orders add constraint orders_order_status_check check (order_status in
  ('pending_payment','placed','accepted','preparing','ready','partner_assigned','picked_up','out_for_delivery','delivered','cancelled','rejected'));
