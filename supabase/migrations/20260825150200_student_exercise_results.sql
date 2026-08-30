create table if not exists public.student_exercise_results (
  id uuid primary key default gen_random_uuid(),
  client_program_exercise_id uuid not null references public.client_program_exercises(id) on delete cascade,
  student_comment text,
  status text not null default 'submitted',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_exercise_results_exercise_unique
    unique (client_program_exercise_id)
);

create table if not exists public.student_exercise_result_videos (
  id uuid primary key default gen_random_uuid(),
  student_exercise_result_id uuid not null references public.student_exercise_results(id) on delete cascade,
  video_provider text not null default 'cloudflare',
  video_asset_id text not null,
  thumbnail_url text,
  sort_order integer not null,
  created_at timestamptz not null default now(),

  constraint student_exercise_result_videos_sort_unique
    unique (student_exercise_result_id, sort_order),
  constraint student_exercise_result_videos_asset_unique
    unique (student_exercise_result_id, video_asset_id),
  constraint student_exercise_result_videos_sort_order_check
    check (sort_order between 1 and 5)
);

create index if not exists idx_student_exercise_result_videos_result
on public.student_exercise_result_videos(student_exercise_result_id);

drop trigger if exists trg_student_exercise_results_updated_at on public.student_exercise_results;
create trigger trg_student_exercise_results_updated_at
before update on public.student_exercise_results
for each row execute function public.set_updated_at();

create or replace function public.upsert_student_exercise_result(
  p_client_program_exercise_id uuid,
  p_student_comment text default null,
  p_update_comment boolean default true,
  p_replace_videos boolean default false,
  p_videos jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result_id uuid;
  v_videos jsonb := coalesce(p_videos, '[]'::jsonb);
  v_video_count integer := 0;
  v_distinct_video_count integer := 0;
  v_now timestamptz := now();
begin
  if p_client_program_exercise_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise instance id is required');
  end if;

  if p_replace_videos then
    if jsonb_typeof(v_videos) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Videos must be an array');
    end if;

    select count(*)
      into v_video_count
    from jsonb_array_elements(v_videos);

    if v_video_count > 5 then
      return jsonb_build_object('ok', false, 'error', 'too_many_videos', 'message', 'A result can include at most 5 videos');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_videos) as video(value)
      where jsonb_typeof(video.value) <> 'object'
         or nullif(trim(coalesce(video.value->>'videoAssetId', video.value->>'video_asset_id', '')), '') is null
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Every video must include a video asset id');
    end if;

    select count(distinct nullif(trim(coalesce(video.value->>'videoAssetId', video.value->>'video_asset_id', '')), ''))
      into v_distinct_video_count
    from jsonb_array_elements(v_videos) as video(value);

    if v_distinct_video_count <> v_video_count then
      return jsonb_build_object('ok', false, 'error', 'duplicate_video', 'message', 'Video ids must be unique');
    end if;
  end if;

  insert into public.student_exercise_results (
    client_program_exercise_id,
    student_comment,
    status,
    submitted_at,
    updated_at
  )
  values (
    p_client_program_exercise_id,
    nullif(trim(coalesce(p_student_comment, '')), ''),
    'submitted',
    v_now,
    v_now
  )
  on conflict (client_program_exercise_id)
  do update set
    student_comment = case
      when p_update_comment then excluded.student_comment
      else student_exercise_results.student_comment
    end,
    status = 'submitted',
    submitted_at = v_now,
    updated_at = v_now
  returning id into v_result_id;

  if p_replace_videos then
    delete from public.student_exercise_result_videos
    where student_exercise_result_id = v_result_id;

    insert into public.student_exercise_result_videos (
      student_exercise_result_id,
      video_provider,
      video_asset_id,
      thumbnail_url,
      sort_order
    )
    select
      v_result_id,
      'cloudflare',
      nullif(trim(coalesce(video.value->>'videoAssetId', video.value->>'video_asset_id', '')), ''),
      nullif(trim(coalesce(video.value->>'thumbnailUrl', video.value->>'thumbnail_url', '')), ''),
      video.ordinality::integer
    from jsonb_array_elements(v_videos) with ordinality as video(value, ordinality);
  end if;

  return jsonb_build_object(
    'ok', true,
    'resultId', v_result_id,
    'videoCount', case when p_replace_videos then v_video_count else null end
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', 'db_error', 'message', SQLERRM);
end;
$$;

grant all on table public.student_exercise_results to service_role;
grant all on table public.student_exercise_result_videos to service_role;
revoke all on table public.student_exercise_results from anon, authenticated;
revoke all on table public.student_exercise_result_videos from anon, authenticated;

revoke all on function public.upsert_student_exercise_result(uuid, text, boolean, boolean, jsonb) from public, anon, authenticated;
grant all on function public.upsert_student_exercise_result(uuid, text, boolean, boolean, jsonb) to service_role;
