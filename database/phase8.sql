-- Phase 8: image storage + a few indexes. Run once in Supabase -> SQL Editor.
insert into storage.buckets (id, name, public) values ('images', 'images', true) on conflict (id) do nothing;
create index if not exists reviews_restaurant_idx on reviews (restaurant_id);
create index if not exists complaints_status_idx on complaints (status, created_at desc);
