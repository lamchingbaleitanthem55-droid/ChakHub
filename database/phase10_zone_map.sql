-- Zone maps: each zone gets a centre point and a radius. Run once in Supabase -> SQL Editor.
alter table zones
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists radius_km numeric(5,2);
alter table zones drop constraint if exists zones_radius_check;
alter table zones add constraint zones_radius_check check (radius_km is null or (radius_km > 0 and radius_km <= 50));
