alter table public.exercise_library
  add column if not exists technique_video_provider text,
  add column if not exists technique_video_asset_id text,
  add column if not exists technique_video_url text,
  add column if not exists technique_thumbnail_url text;

create table if not exists public.exercise_video_upload_claims (
  id uuid primary key default gen_random_uuid(),
  video_asset_id text not null unique,
  coach_email text not null,
  purpose text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by_exercise_id uuid references public.exercise_library(id) on delete set null,
  constraint exercise_video_upload_claims_purpose_check
    check (purpose in ('exercise_demo', 'technique_breakdown'))
);

create index if not exists idx_exercise_video_upload_claims_coach_purpose
  on public.exercise_video_upload_claims (coach_email, purpose, consumed_at);

alter table public.exercise_video_upload_claims enable row level security;

revoke all on table public.exercise_video_upload_claims from anon;
revoke all on table public.exercise_video_upload_claims from authenticated;
revoke all on table public.exercise_video_upload_claims from public;
grant all on table public.exercise_video_upload_claims to service_role;

create or replace function public.set_exercise_technique_video(
  p_coach_email text,
  p_exercise_id uuid,
  p_video_asset_id text,
  p_video_url text,
  p_thumbnail_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lk_role text;
  v_coach_id uuid;
  v_coach_access_level text;
  v_exercise record;
  v_claim_id uuid;
  v_updated exercise_library%rowtype;
begin
  p_coach_email := lower(trim(coalesce(p_coach_email, '')));
  p_video_asset_id := trim(coalesce(p_video_asset_id, ''));
  p_video_url := trim(coalesce(p_video_url, ''));
  p_thumbnail_url := nullif(trim(coalesce(p_thumbnail_url, '')), '');

  if p_coach_email = '' or p_exercise_id is null or p_video_asset_id = '' or p_video_url = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select lower(lu.role)
    into v_lk_role
  from public.lk_users lu
  where lower(lu.email) = p_coach_email
    and lu.lk_enabled = true
  limit 1;

  select cp.id, cp.access_level
    into v_coach_id, v_coach_access_level
  from public.coach_profiles cp
  where lower(cp.email) = p_coach_email
    and cp.is_active = true
  limit 1;

  if coalesce(v_lk_role, '') <> 'admin' and v_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
    into v_exercise
  from public.exercise_library
  where id = p_exercise_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if coalesce(v_lk_role, '') <> 'admin'
     and coalesce(v_coach_access_level, '') <> 'head_coach'
     and (v_exercise.created_by_coach_id is null or v_exercise.created_by_coach_id <> v_coach_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select id
    into v_claim_id
  from public.exercise_video_upload_claims
  where video_asset_id = p_video_asset_id
    and lower(coach_email) = p_coach_email
    and purpose = 'technique_breakdown'
    and consumed_at is null
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'message', 'Video upload claim is missing or already consumed');
  end if;

  update public.exercise_library
  set technique_video_provider = 'cloudflare',
      technique_video_asset_id = p_video_asset_id,
      technique_video_url = p_video_url,
      technique_thumbnail_url = p_thumbnail_url
  where id = p_exercise_id
  returning * into v_updated;

  update public.exercise_video_upload_claims
  set consumed_at = now(),
      consumed_by_exercise_id = p_exercise_id
  where id = v_claim_id
    and consumed_at is null;

  if not found then
    raise exception 'Technique upload claim was not consumed';
  end if;

  return jsonb_build_object('ok', true, 'exercise', to_jsonb(v_updated));
end;
$$;

revoke all on function public.set_exercise_technique_video(text, uuid, text, text, text) from public;
revoke all on function public.set_exercise_technique_video(text, uuid, text, text, text) from anon;
revoke all on function public.set_exercise_technique_video(text, uuid, text, text, text) from authenticated;
grant execute on function public.set_exercise_technique_video(text, uuid, text, text, text) to service_role;
