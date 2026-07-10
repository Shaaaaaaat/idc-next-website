alter table public.coach_profiles
  add column if not exists telegram_id text;
