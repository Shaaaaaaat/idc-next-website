alter table public.client_program_workouts
  add column if not exists coach_viewed_at timestamptz null;

create index if not exists idx_client_program_workouts_submitted_unviewed_client
  on public.client_program_workouts (client_id, submitted_at)
  where status = 'submitted'
    and coach_viewed_at is null;
