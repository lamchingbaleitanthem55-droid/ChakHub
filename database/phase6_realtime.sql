-- Phase 6: real-time updates. Run once in Supabase -> SQL Editor.
-- Design: browsers only receive a "something changed" signal from order_status_history
-- (it holds no addresses, phone numbers or delivery codes). They then re-fetch the real data
-- through the secured API, so nobody can read orders directly with the public key.

create or replace function public.app_role() returns text language sql stable security definer set search_path = public as
$$ select role from public.users where id = auth.uid() $$;

create or replace function public.is_approved_partner() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.delivery_partners where user_id = auth.uid() and approval_status = 'approved') $$;

create or replace function public.owns_order(oid uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.orders where id = oid and customer_id = auth.uid()) $$;

create or replace function public.partner_has_order(oid uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.orders o join public.delivery_partners d on d.id = o.delivery_partner_id where o.id = oid and d.user_id = auth.uid()) $$;

drop policy if exists "customer sees own order events" on order_status_history;
drop policy if exists "partner sees own order events" on order_status_history;
drop policy if exists "rider sees ready order events" on order_status_history;
drop policy if exists "admin sees all order events" on order_status_history;
create policy "customer sees own order events" on order_status_history for select using (public.owns_order(order_id));
create policy "partner sees own order events" on order_status_history for select using (public.partner_has_order(order_id));
create policy "rider sees ready order events" on order_status_history for select using (status in ('ready', 'partner_assigned') and public.is_approved_partner());
create policy "admin sees all order events" on order_status_history for select using (public.app_role() = 'admin');

drop policy if exists "admin reads partners" on delivery_partners;
create policy "admin reads partners" on delivery_partners for select using (public.app_role() = 'admin');

do $$ declare t text; begin
  foreach t in array array['order_status_history', 'notifications', 'food_items', 'restaurants', 'delivery_partners'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
