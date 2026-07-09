-- Runtime client workout schema parity and transaction-safe diff save RPC.
-- This migration does not switch application code to the RPC; it only adds
-- the DB foundation for the next hardening phase.

create extension if not exists pgcrypto;

create table if not exists public.client_program_exercise_groups (
  id uuid primary key default gen_random_uuid(),
  client_program_workout_id uuid not null references public.client_program_workouts(id) on delete cascade,
  title text,
  sets text,
  rest text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_program_exercise_groups
  add column if not exists client_program_workout_id uuid,
  add column if not exists title text,
  add column if not exists sets text,
  add column if not exists rest text,
  add column if not exists notes text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.client_program_exercises
  add column if not exists exercise_group_id uuid,
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute child_col
      on child_col.attrelid = c.conrelid
      and child_col.attnum = any(c.conkey)
    join pg_attribute parent_col
      on parent_col.attrelid = c.confrelid
      and parent_col.attnum = any(c.confkey)
    where c.contype = 'f'
      and c.conrelid = 'public.client_program_exercise_groups'::regclass
      and c.confrelid = 'public.client_program_workouts'::regclass
      and child_col.attname = 'client_program_workout_id'
      and parent_col.attname = 'id'
  ) then
    alter table public.client_program_exercise_groups
      add constraint client_program_exercise_groups_client_program_workout_id_fkey
      foreign key (client_program_workout_id)
      references public.client_program_workouts(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute child_col
      on child_col.attrelid = c.conrelid
      and child_col.attnum = any(c.conkey)
    join pg_attribute parent_col
      on parent_col.attrelid = c.confrelid
      and parent_col.attnum = any(c.confkey)
    where c.contype = 'f'
      and c.conrelid = 'public.client_program_exercises'::regclass
      and c.confrelid = 'public.client_program_exercise_groups'::regclass
      and child_col.attname = 'exercise_group_id'
      and parent_col.attname = 'id'
  ) then
    alter table public.client_program_exercises
      add constraint client_program_exercises_exercise_group_id_fkey
      foreign key (exercise_group_id)
      references public.client_program_exercise_groups(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_client_program_exercise_groups_workout
  on public.client_program_exercise_groups(client_program_workout_id);

create index if not exists idx_exercise_groups_workout_order
  on public.client_program_exercise_groups(client_program_workout_id, sort_order);

create index if not exists idx_client_program_exercises_group
  on public.client_program_exercises(exercise_group_id);

create index if not exists idx_program_exercises_group_order
  on public.client_program_exercises(exercise_group_id, sort_order);

create or replace function public.save_client_workout_diff(
  p_workout_id uuid,
  p_coach_email text,
  p_client_id uuid,
  p_expected_updated_at timestamptz default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_coach_id uuid;
  v_workout record;
  v_now timestamptz := now();
  v_workout_date date;
  v_title text;
  v_coach_comment text;
  v_status text;
  v_groups jsonb := '[]'::jsonb;
  v_exercises jsonb := '[]'::jsonb;
  v_group jsonb;
  v_exercise jsonb;
  v_group_id uuid;
  v_group_payload_id uuid;
  v_exercise_id uuid;
  v_exercise_payload_id uuid;
  v_library_exercise_id uuid;
  v_group_ref text;
  v_group_fk uuid;
  v_group_ids jsonb := '{}'::jsonb;
  v_payload_group_refs text[] := array[]::text[];
  v_seen_group_ids uuid[] := array[]::uuid[];
  v_seen_exercise_ids uuid[] := array[]::uuid[];
  v_group_index integer := 0;
  v_exercise_index integer := 0;
  v_group_sort_order integer;
  v_exercise_sort_order integer;
  v_exercise_title text;
  v_has_child_payload boolean := false;
  v_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_int_pattern constant text := '^-?[0-9]+$';
begin
  if p_workout_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout id is required');
  end if;

  if p_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Client id is required');
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Payload must be an object');
  end if;

  select id
    into v_coach_id
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;

  if v_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform 1
  from public.coach_clients
  where coach_id = v_coach_id
    and client_id = p_client_id
    and is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workout_id::text));

  select *
    into v_workout
  from public.client_program_workouts
  where id = p_workout_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_workout.client_id <> p_client_id
    or v_workout.coach_id is null
    or v_workout.coach_id <> v_coach_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_expected_updated_at is not null
    and v_workout.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;

  v_workout_date := v_workout.workout_date;
  if v_payload ? 'workoutDate' then
    if nullif(v_payload->>'workoutDate', '') is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout date is required');
    end if;

    begin
      v_workout_date := (v_payload->>'workoutDate')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout date must be a valid date');
    end;
  end if;

  v_title := v_workout.title;
  if v_payload ? 'title' then
    v_title := nullif(trim(coalesce(v_payload->>'title', '')), '');
    if v_title is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout title is required');
    end if;
  end if;

  v_coach_comment := v_workout.coach_comment;
  if v_payload ? 'coachComment' then
    v_coach_comment := nullif(trim(coalesce(v_payload->>'coachComment', '')), '');
  end if;

  v_status := v_workout.status;
  if v_payload ? 'status' then
    v_status := nullif(trim(coalesce(v_payload->>'status', '')), '');
    if v_status is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout status is required');
    end if;
  end if;

  v_has_child_payload := (v_payload ? 'groups') or (v_payload ? 'exercises');
  if v_has_child_payload then
    if coalesce(jsonb_typeof(v_payload->'groups'), '') <> 'array'
      or coalesce(jsonb_typeof(v_payload->'exercises'), '') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout payload must include groups and exercises arrays');
    end if;

    v_groups := v_payload->'groups';
    v_exercises := v_payload->'exercises';

    for v_group in select value from jsonb_array_elements(v_groups)
    loop
      if jsonb_typeof(v_group) <> 'object' then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Group payload item must be an object');
      end if;

      if nullif(v_group->>'id', '') is not null and not ((v_group->>'id') ~ v_uuid_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group id must be a valid UUID');
      end if;

      if nullif(v_group->>'sortOrder', '') is not null and not ((v_group->>'sortOrder') ~ v_int_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group sortOrder must be an integer');
      end if;

      v_group_payload_id := nullif(v_group->>'id', '')::uuid;
      v_group_ref := nullif(coalesce(v_group->>'draftId', v_group->>'id', ''), '');
      if v_group_ref is null then
        v_group_ref := coalesce(v_group_payload_id::text, 'group-' || v_group_index);
      end if;

      if v_group_ref = any(v_payload_group_refs) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group references must be unique');
      end if;
      v_payload_group_refs := array_append(v_payload_group_refs, v_group_ref);

      if v_group_payload_id is not null then
        perform 1
        from public.client_program_exercise_groups
        where id = v_group_payload_id
          and client_program_workout_id = p_workout_id;
        if not found then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group does not belong to workout');
        end if;
      end if;

      v_group_index := v_group_index + 1;
    end loop;

    for v_exercise in select value from jsonb_array_elements(v_exercises)
    loop
      if jsonb_typeof(v_exercise) <> 'object' then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise payload item must be an object');
      end if;

      if nullif(v_exercise->>'id', '') is not null and not ((v_exercise->>'id') ~ v_uuid_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise id must be a valid UUID');
      end if;

      if nullif(v_exercise->>'exerciseId', '') is not null and not ((v_exercise->>'exerciseId') ~ v_uuid_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Library exercise id must be a valid UUID');
      end if;

      if nullif(v_exercise->>'sortOrder', '') is not null and not ((v_exercise->>'sortOrder') ~ v_int_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise sortOrder must be an integer');
      end if;

      v_exercise_title := nullif(trim(coalesce(v_exercise->>'exerciseTitle', v_exercise->>'title', '')), '');
      if v_exercise_title is null then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise title is required');
      end if;

      v_exercise_payload_id := nullif(v_exercise->>'id', '')::uuid;
      if v_exercise_payload_id is not null then
        perform 1
        from public.client_program_exercises
        where id = v_exercise_payload_id
          and client_program_workout_id = p_workout_id;
        if not found then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise does not belong to workout');
        end if;
      end if;

      v_group_ref := nullif(coalesce(v_exercise->>'groupDraftId', v_exercise->>'groupId', ''), '');
      if v_group_ref is not null and not (v_group_ref = any(v_payload_group_refs)) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group does not belong to this workout payload');
      end if;
    end loop;
  end if;

  update public.client_program_workouts
  set
    workout_date = v_workout_date,
    title = v_title,
    coach_comment = v_coach_comment,
    status = v_status,
    updated_at = v_now
  where id = p_workout_id;

  if v_has_child_payload then
    v_group_index := 0;
    for v_group in select value from jsonb_array_elements(v_groups)
    loop
      v_group_payload_id := nullif(v_group->>'id', '')::uuid;
      v_group_ref := nullif(coalesce(v_group->>'draftId', v_group->>'id', ''), '');
      if v_group_ref is null then
        v_group_ref := coalesce(v_group_payload_id::text, 'group-' || v_group_index);
      end if;
      v_group_sort_order := coalesce(nullif(v_group->>'sortOrder', '')::integer, v_group_index);
      v_group_id := null;

      if v_group_payload_id is null then
        insert into public.client_program_exercise_groups (
          client_program_workout_id,
          title,
          sets,
          rest,
          notes,
          sort_order
        )
        values (
          p_workout_id,
          coalesce(nullif(trim(coalesce(v_group->>'title', '')), ''), 'Комбо ' || (v_group_index + 1)),
          nullif(trim(coalesce(v_group->>'sets', '')), ''),
          nullif(trim(coalesce(v_group->>'rest', '')), ''),
          nullif(trim(coalesce(v_group->>'notes', '')), ''),
          v_group_sort_order
        )
        returning id into v_group_id;
      else
        update public.client_program_exercise_groups
        set
          title = coalesce(nullif(trim(coalesce(v_group->>'title', '')), ''), 'Комбо ' || (v_group_index + 1)),
          sets = nullif(trim(coalesce(v_group->>'sets', '')), ''),
          rest = nullif(trim(coalesce(v_group->>'rest', '')), ''),
          notes = nullif(trim(coalesce(v_group->>'notes', '')), ''),
          sort_order = v_group_sort_order,
          updated_at = v_now
        where id = v_group_payload_id
          and client_program_workout_id = p_workout_id
        returning id into v_group_id;
      end if;

      if v_group_id is null then
        return jsonb_build_object('ok', false, 'error', 'db_error', 'message', 'Exercise group was not saved');
      end if;

      v_seen_group_ids := array_append(v_seen_group_ids, v_group_id);
      v_group_ids := v_group_ids || jsonb_build_object(v_group_id::text, v_group_id::text);
      v_group_ids := v_group_ids || jsonb_build_object(v_group_ref, v_group_id::text);
      v_group_index := v_group_index + 1;
    end loop;

    v_exercise_index := 0;
    for v_exercise in select value from jsonb_array_elements(v_exercises)
    loop
      v_exercise_payload_id := nullif(v_exercise->>'id', '')::uuid;
      v_library_exercise_id := nullif(v_exercise->>'exerciseId', '')::uuid;
      v_exercise_title := nullif(trim(coalesce(v_exercise->>'exerciseTitle', v_exercise->>'title', '')), '');
      v_exercise_sort_order := coalesce(nullif(v_exercise->>'sortOrder', '')::integer, v_exercise_index);
      v_group_ref := nullif(coalesce(v_exercise->>'groupDraftId', v_exercise->>'groupId', ''), '');
      v_group_fk := null;
      v_exercise_id := null;

      if v_group_ref is not null then
        v_group_fk := (v_group_ids->>v_group_ref)::uuid;
      end if;

      if v_exercise_payload_id is null then
        insert into public.client_program_exercises (
          client_program_workout_id,
          exercise_group_id,
          exercise_id,
          exercise_title,
          sets,
          reps,
          rest,
          tempo,
          notes,
          sort_order
        )
        values (
          p_workout_id,
          v_group_fk,
          v_library_exercise_id,
          v_exercise_title,
          case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end,
          nullif(trim(coalesce(v_exercise->>'reps', '')), ''),
          case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end,
          nullif(trim(coalesce(v_exercise->>'tempo', '')), ''),
          nullif(trim(coalesce(v_exercise->>'notes', '')), ''),
          v_exercise_sort_order
        )
        returning id into v_exercise_id;
      else
        update public.client_program_exercises
        set
          exercise_group_id = v_group_fk,
          exercise_id = v_library_exercise_id,
          exercise_title = v_exercise_title,
          sets = case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end,
          reps = nullif(trim(coalesce(v_exercise->>'reps', '')), ''),
          rest = case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end,
          tempo = nullif(trim(coalesce(v_exercise->>'tempo', '')), ''),
          notes = nullif(trim(coalesce(v_exercise->>'notes', '')), ''),
          sort_order = v_exercise_sort_order,
          updated_at = v_now
        where id = v_exercise_payload_id
          and client_program_workout_id = p_workout_id
        returning id into v_exercise_id;
      end if;

      if v_exercise_id is null then
        return jsonb_build_object('ok', false, 'error', 'db_error', 'message', 'Exercise was not saved');
      end if;

      v_seen_exercise_ids := array_append(v_seen_exercise_ids, v_exercise_id);
      v_exercise_index := v_exercise_index + 1;
    end loop;

    delete from public.client_program_exercises
    where client_program_workout_id = p_workout_id
      and (
        array_length(v_seen_exercise_ids, 1) is null
        or not (id = any(v_seen_exercise_ids))
      );

    delete from public.client_program_exercise_groups
    where client_program_workout_id = p_workout_id
      and (
        array_length(v_seen_group_ids, 1) is null
        or not (id = any(v_seen_group_ids))
      );
  end if;

  return jsonb_build_object('ok', true, 'workoutId', p_workout_id, 'updatedAt', v_now);
exception when others then
  return jsonb_build_object('ok', false, 'error', 'db_error', 'message', SQLERRM);
end;
$$;

grant execute on function public.save_client_workout_diff(uuid, text, uuid, timestamptz, jsonb) to service_role;

create or replace function public.create_client_workout_diff(
  p_coach_email text,
  p_client_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_coach_id uuid;
  v_program_id uuid;
  v_workout_id uuid;
  v_now timestamptz := now();
  v_workout_date date;
  v_title text;
  v_coach_comment text;
  v_status text := 'planned';
  v_groups jsonb := '[]'::jsonb;
  v_exercises jsonb := '[]'::jsonb;
  v_group jsonb;
  v_exercise jsonb;
  v_group_id uuid;
  v_exercise_id uuid;
  v_library_exercise_id uuid;
  v_group_ref text;
  v_group_fk uuid;
  v_group_ids jsonb := '{}'::jsonb;
  v_payload_group_refs text[] := array[]::text[];
  v_group_index integer := 0;
  v_exercise_index integer := 0;
  v_group_sort_order integer;
  v_exercise_sort_order integer;
  v_exercise_title text;
  v_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_int_pattern constant text := '^-?[0-9]+$';
begin
  if p_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Client id is required');
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Payload must be an object');
  end if;

  select id
    into v_coach_id
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;

  if v_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform 1
  from public.coach_clients
  where coach_id = v_coach_id
    and client_id = p_client_id
    and is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if nullif(v_payload->>'workoutDate', '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout date is required');
  end if;

  begin
    v_workout_date := (v_payload->>'workoutDate')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout date must be a valid date');
  end;

  v_title := nullif(trim(coalesce(v_payload->>'title', '')), '');
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout title is required');
  end if;

  v_coach_comment := nullif(trim(coalesce(v_payload->>'coachComment', '')), '');

  if v_payload ? 'status' then
    v_status := nullif(trim(coalesce(v_payload->>'status', '')), '');
    if v_status is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout status is required');
    end if;
  end if;

  if coalesce(jsonb_typeof(v_payload->'groups'), '') <> 'array'
    or coalesce(jsonb_typeof(v_payload->'exercises'), '') <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout payload must include groups and exercises arrays');
  end if;

  v_groups := v_payload->'groups';
  v_exercises := v_payload->'exercises';

  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    if jsonb_typeof(v_group) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Group payload item must be an object');
    end if;

    if nullif(v_group->>'id', '') is not null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Existing group id is not allowed when creating a workout');
    end if;

    if nullif(v_group->>'sortOrder', '') is not null and not ((v_group->>'sortOrder') ~ v_int_pattern) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group sortOrder must be an integer');
    end if;

    v_group_ref := nullif(coalesce(v_group->>'draftId', ''), '');
    if v_group_ref is null then
      v_group_ref := 'group-' || v_group_index;
    end if;

    if v_group_ref = any(v_payload_group_refs) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group references must be unique');
    end if;

    v_payload_group_refs := array_append(v_payload_group_refs, v_group_ref);
    v_group_index := v_group_index + 1;
  end loop;

  for v_exercise in select value from jsonb_array_elements(v_exercises)
  loop
    if jsonb_typeof(v_exercise) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise payload item must be an object');
    end if;

    if nullif(v_exercise->>'id', '') is not null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Existing exercise id is not allowed when creating a workout');
    end if;

    if nullif(v_exercise->>'exerciseId', '') is not null and not ((v_exercise->>'exerciseId') ~ v_uuid_pattern) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Library exercise id must be a valid UUID');
    end if;

    if nullif(v_exercise->>'sortOrder', '') is not null and not ((v_exercise->>'sortOrder') ~ v_int_pattern) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise sortOrder must be an integer');
    end if;

    v_exercise_title := nullif(trim(coalesce(v_exercise->>'exerciseTitle', v_exercise->>'title', '')), '');
    if v_exercise_title is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise title is required');
    end if;

    v_group_ref := nullif(coalesce(v_exercise->>'groupDraftId', v_exercise->>'groupId', ''), '');
    if v_group_ref is not null and not (v_group_ref = any(v_payload_group_refs)) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group does not belong to this workout payload');
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('active-client-program:' || v_coach_id::text || ':' || p_client_id::text));

  select id
    into v_program_id
  from public.client_programs
  where client_id = p_client_id
    and coach_id = v_coach_id
    and status = 'active'
  order by created_at desc
  limit 1
  for update;

  if v_program_id is null then
    insert into public.client_programs (
      client_id,
      coach_id,
      title,
      status,
      start_date
    )
    values (
      p_client_id,
      v_coach_id,
      'Индивидуальная программа',
      'active',
      v_workout_date
    )
    returning id into v_program_id;
  end if;

  insert into public.client_program_workouts (
    client_program_id,
    client_id,
    coach_id,
    workout_date,
    title,
    coach_comment,
    status,
    updated_at
  )
  values (
    v_program_id,
    p_client_id,
    v_coach_id,
    v_workout_date,
    v_title,
    v_coach_comment,
    v_status,
    v_now
  )
  returning id into v_workout_id;

  v_group_index := 0;
  for v_group in select value from jsonb_array_elements(v_groups)
  loop
    v_group_ref := nullif(coalesce(v_group->>'draftId', ''), '');
    if v_group_ref is null then
      v_group_ref := 'group-' || v_group_index;
    end if;
    v_group_sort_order := coalesce(nullif(v_group->>'sortOrder', '')::integer, v_group_index);
    v_group_id := null;

    insert into public.client_program_exercise_groups (
      client_program_workout_id,
      title,
      sets,
      rest,
      notes,
      sort_order
    )
    values (
      v_workout_id,
      coalesce(nullif(trim(coalesce(v_group->>'title', '')), ''), 'Комбо ' || (v_group_index + 1)),
      nullif(trim(coalesce(v_group->>'sets', '')), ''),
      nullif(trim(coalesce(v_group->>'rest', '')), ''),
      nullif(trim(coalesce(v_group->>'notes', '')), ''),
      v_group_sort_order
    )
    returning id into v_group_id;

    v_group_ids := v_group_ids || jsonb_build_object(v_group_ref, v_group_id::text);
    v_group_index := v_group_index + 1;
  end loop;

  v_exercise_index := 0;
  for v_exercise in select value from jsonb_array_elements(v_exercises)
  loop
    v_library_exercise_id := nullif(v_exercise->>'exerciseId', '')::uuid;
    v_exercise_title := nullif(trim(coalesce(v_exercise->>'exerciseTitle', v_exercise->>'title', '')), '');
    v_exercise_sort_order := coalesce(nullif(v_exercise->>'sortOrder', '')::integer, v_exercise_index);
    v_group_ref := nullif(coalesce(v_exercise->>'groupDraftId', v_exercise->>'groupId', ''), '');
    v_group_fk := null;
    v_exercise_id := null;

    if v_group_ref is not null then
      v_group_fk := (v_group_ids->>v_group_ref)::uuid;
    end if;

    insert into public.client_program_exercises (
      client_program_workout_id,
      exercise_group_id,
      exercise_id,
      exercise_title,
      sets,
      reps,
      rest,
      tempo,
      notes,
      sort_order
    )
    values (
      v_workout_id,
      v_group_fk,
      v_library_exercise_id,
      v_exercise_title,
      case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end,
      nullif(trim(coalesce(v_exercise->>'reps', '')), ''),
      case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end,
      nullif(trim(coalesce(v_exercise->>'tempo', '')), ''),
      nullif(trim(coalesce(v_exercise->>'notes', '')), ''),
      v_exercise_sort_order
    )
    returning id into v_exercise_id;

    v_exercise_index := v_exercise_index + 1;
  end loop;

  return jsonb_build_object('ok', true, 'workoutId', v_workout_id, 'updatedAt', v_now);
exception when others then
  return jsonb_build_object('ok', false, 'error', 'db_error', 'message', SQLERRM);
end;
$$;

grant execute on function public.create_client_workout_diff(text, uuid, jsonb) to service_role;
