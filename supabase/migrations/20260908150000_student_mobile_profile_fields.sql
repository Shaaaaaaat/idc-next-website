alter table public.clients
  add column if not exists city text,
  add column if not exists birth_date date,
  add column if not exists weight_kg numeric,
  add column if not exists height_cm numeric;
