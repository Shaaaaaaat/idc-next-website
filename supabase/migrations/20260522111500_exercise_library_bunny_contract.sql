-- Align exercise_library with Bunny Stream production contract.
-- Safe to run repeatedly.

alter table if exists public.exercise_library
  add column if not exists video_provider text not null default 'bunny',
  add column if not exists video_asset_id text,
  add column if not exists thumbnail_url text,
  add column if not exists is_active boolean not null default true;

update public.exercise_library
set video_provider = 'bunny'
where video_provider is null or btrim(video_provider) = '';

update public.exercise_library
set video_url = ''
where video_url is null;

alter table if exists public.exercise_library
  alter column video_url set not null;

create index if not exists idx_exercise_library_active_title
  on public.exercise_library(is_active, title);

create index if not exists idx_exercise_library_tags
  on public.exercise_library using gin(tags);

create unique index if not exists idx_exercise_library_provider_asset
  on public.exercise_library(video_provider, video_asset_id)
  where video_asset_id is not null;

create index if not exists idx_client_program_exercises_exercise_id
  on public.client_program_exercises(exercise_id);
