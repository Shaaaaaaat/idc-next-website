alter table public.clients
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

create table if not exists public.coach_student_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  author_coach_id uuid not null references public.coach_profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coach_student_notes_body_not_blank
    check (length(btrim(body)) > 0),
  constraint coach_student_notes_body_length
    check (char_length(body) <= 4000)
);

create index if not exists idx_coach_student_notes_client_author_created_at
  on public.coach_student_notes(client_id, author_coach_id, created_at desc);

drop trigger if exists trg_coach_student_notes_updated_at on public.coach_student_notes;
create trigger trg_coach_student_notes_updated_at
before update on public.coach_student_notes
for each row execute function public.set_updated_at();

revoke all on table public.coach_student_notes from anon, authenticated;
grant all on table public.coach_student_notes to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'client-avatars',
  'client-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
