-- Coach program system for trainer LK.
-- Safe to run repeatedly: creates tables/indexes only if they do not exist.

create extension if not exists pgcrypto;

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  video_url text,
  category text,
  tags text[] not null default '{}',
  created_by_coach_id uuid references public.coach_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_programs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  coach_id uuid references public.coach_profiles(id) on delete set null,
  title text not null,
  status text not null default 'active',
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_program_workouts (
  id uuid primary key default gen_random_uuid(),
  client_program_id uuid not null references public.client_programs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  coach_id uuid references public.coach_profiles(id) on delete set null,
  workout_date date not null,
  title text not null,
  coach_comment text,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_program_exercises (
  id uuid primary key default gen_random_uuid(),
  client_program_workout_id uuid not null references public.client_program_workouts(id) on delete cascade,
  exercise_id uuid references public.exercise_library(id) on delete set null,
  exercise_title text not null,
  sets text,
  reps text,
  rest text,
  tempo text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_exercise_library_category
  on public.exercise_library(category);

create index if not exists idx_client_programs_client_status
  on public.client_programs(client_id, status);

create index if not exists idx_client_programs_coach_status
  on public.client_programs(coach_id, status);

create index if not exists idx_client_program_workouts_client_date
  on public.client_program_workouts(client_id, workout_date);

create index if not exists idx_client_program_workouts_program_date
  on public.client_program_workouts(client_program_id, workout_date);

create index if not exists idx_client_program_exercises_workout_order
  on public.client_program_exercises(client_program_workout_id, sort_order);
