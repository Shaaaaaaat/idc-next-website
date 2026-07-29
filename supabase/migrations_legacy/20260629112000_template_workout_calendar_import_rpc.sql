-- Idempotent import of selected program template workouts into a client calendar.
-- This is the backend primitive for "copy selected template workout(s) to dates";
-- legacy full-program assignment can call the same RPC in all-workouts mode.

create extension if not exists pgcrypto;

alter table public.client_program_workouts
  add column if not exists source_program_template_id uuid,
  add column if not exists source_template_workout_id uuid;

alter table public.client_program_exercise_groups
  add column if not exists source_template_group_id uuid;

alter table public.client_program_exercises
  add column if not exists source_template_exercise_id uuid;

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
      and c.conrelid = 'public.client_program_workouts'::regclass
      and c.confrelid = 'public.program_templates'::regclass
      and child_col.attname = 'source_program_template_id'
      and parent_col.attname = 'id'
  ) then
    alter table public.client_program_workouts
      add constraint client_program_workouts_source_program_template_id_fkey
      foreign key (source_program_template_id)
      references public.program_templates(id)
      on delete set null;
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
      and c.conrelid = 'public.client_program_workouts'::regclass
      and c.confrelid = 'public.program_template_workouts'::regclass
      and child_col.attname = 'source_template_workout_id'
      and parent_col.attname = 'id'
  ) then
    alter table public.client_program_workouts
      add constraint client_program_workouts_source_template_workout_id_fkey
      foreign key (source_template_workout_id)
      references public.program_template_workouts(id)
      on delete set null;
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
      and c.conrelid = 'public.client_program_exercise_groups'::regclass
      and c.confrelid = 'public.program_template_exercise_groups'::regclass
      and child_col.attname = 'source_template_group_id'
      and parent_col.attname = 'id'
  ) then
    alter table public.client_program_exercise_groups
      add constraint client_program_exercise_groups_source_template_group_id_fkey
      foreign key (source_template_group_id)
      references public.program_template_exercise_groups(id)
      on delete set null;
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
      and c.confrelid = 'public.program_template_exercises'::regclass
      and child_col.attname = 'source_template_exercise_id'
      and parent_col.attname = 'id'
  ) then
    alter table public.client_program_exercises
      add constraint client_program_exercises_source_template_exercise_id_fkey
      foreign key (source_template_exercise_id)
      references public.program_template_exercises(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists idx_client_program_workouts_template_import_once
  on public.client_program_workouts(client_id, coach_id, workout_date, source_template_workout_id)
  where source_template_workout_id is not null;

create index if not exists idx_client_program_workouts_source_template
  on public.client_program_workouts(source_program_template_id, source_template_workout_id);

create index if not exists idx_client_program_exercise_groups_source_template
  on public.client_program_exercise_groups(source_template_group_id);

create index if not exists idx_client_program_exercises_source_template
  on public.client_program_exercises(source_template_exercise_id);

create or replace function public.import_program_template_workouts_to_client_calendar(
  p_coach_email text,
  p_client_id uuid,
  p_program_template_id uuid,
  p_start_date date default null,
  p_template_workout_ids uuid[] default null,
  p_workout_dates jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid;
  v_template record;
  v_program_id uuid;
  v_now timestamptz := now();
  v_selected_count integer := 0;
  v_matching_count integer := 0;
  v_base_day_number integer := 1;
  v_workout record;
  v_workout_date date;
  v_date_raw text;
  v_client_workout_id uuid;
  v_group record;
  v_exercise record;
  v_group_id uuid;
  v_group_id_by_template_id jsonb;
  v_created_workouts integer := 0;
  v_reused_workouts integer := 0;
  v_imported_workouts jsonb := '[]'::jsonb;
begin
  if p_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Client id is required');
  end if;

  if p_program_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Program template id is required');
  end if;

  if p_start_date is null and (p_workout_dates is null or jsonb_typeof(p_workout_dates) <> 'object') then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Start date or workout date map is required');
  end if;

  if p_workout_dates is not null and jsonb_typeof(p_workout_dates) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout dates must be an object');
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

  select *
    into v_template
  from public.program_templates
  where id = p_program_template_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_template.coach_id is not null and v_template.coach_id <> v_coach_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('template-workout-import:' || v_coach_id::text || ':' || p_client_id::text || ':' || p_program_template_id::text)
  );

  if array_length(p_template_workout_ids, 1) is not null then
    select count(distinct workout_id)
      into v_selected_count
    from unnest(p_template_workout_ids) as selected(workout_id);

    select count(*)
      into v_matching_count
    from public.program_template_workouts
    where program_template_id = p_program_template_id
      and id = any(p_template_workout_ids);

    if v_selected_count <> v_matching_count then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Selected workout does not belong to program template');
    end if;
  end if;

  select coalesce(min(day_number), 1)
    into v_base_day_number
  from public.program_template_workouts
  where program_template_id = p_program_template_id
    and (
      array_length(p_template_workout_ids, 1) is null
      or id = any(p_template_workout_ids)
    );

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
      coalesce(nullif(trim(v_template.title), ''), 'Индивидуальная программа'),
      'active',
      coalesce(p_start_date, current_date)
    )
    returning id into v_program_id;
  end if;

  for v_workout in
    select *
    from public.program_template_workouts
    where program_template_id = p_program_template_id
      and (
        array_length(p_template_workout_ids, 1) is null
        or id = any(p_template_workout_ids)
      )
    order by sort_order, day_number, title
  loop
    v_date_raw := null;
    if p_workout_dates is not null then
      v_date_raw := nullif(p_workout_dates->>v_workout.id::text, '');
    end if;

    begin
      v_workout_date := coalesce(
        v_date_raw::date,
        p_start_date + greatest(coalesce(v_workout.day_number, v_base_day_number) - v_base_day_number, 0)
      );
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout date must be a valid date');
    end;

    if v_workout_date is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout date is required');
    end if;

    select id
      into v_client_workout_id
    from public.client_program_workouts
    where client_id = p_client_id
      and coach_id = v_coach_id
      and workout_date = v_workout_date
      and source_template_workout_id = v_workout.id
    limit 1
    for update;

    if v_client_workout_id is not null then
      v_reused_workouts := v_reused_workouts + 1;
      v_imported_workouts := v_imported_workouts || jsonb_build_array(
        jsonb_build_object(
          'workoutDate', v_workout_date,
          'sourceTemplateWorkoutId', v_workout.id,
          'clientWorkoutId', v_client_workout_id,
          'status', 'reused'
        )
      );
      continue;
    end if;

    v_client_workout_id := null;
    insert into public.client_program_workouts (
      client_program_id,
      client_id,
      coach_id,
      workout_date,
      title,
      coach_comment,
      status,
      source_program_template_id,
      source_template_workout_id,
      updated_at
    )
    values (
      v_program_id,
      p_client_id,
      v_coach_id,
      v_workout_date,
      coalesce(nullif(trim(v_workout.title), ''), 'Тренировка'),
      nullif(trim(coalesce(v_workout.summary, '')), ''),
      'planned',
      p_program_template_id,
      v_workout.id,
      v_now
    )
    on conflict (client_id, coach_id, workout_date, source_template_workout_id)
      where source_template_workout_id is not null
      do nothing
    returning id into v_client_workout_id;

    if v_client_workout_id is null then
      select id
        into v_client_workout_id
      from public.client_program_workouts
      where client_id = p_client_id
        and coach_id = v_coach_id
        and workout_date = v_workout_date
        and source_template_workout_id = v_workout.id
      limit 1;

      if v_client_workout_id is null then
        return jsonb_build_object('ok', false, 'error', 'db_error', 'message', 'Imported workout was not created');
      end if;

      v_reused_workouts := v_reused_workouts + 1;
      v_imported_workouts := v_imported_workouts || jsonb_build_array(
        jsonb_build_object(
          'workoutDate', v_workout_date,
          'sourceTemplateWorkoutId', v_workout.id,
          'clientWorkoutId', v_client_workout_id,
          'status', 'reused'
        )
      );
      continue;
    end if;

    v_group_id_by_template_id := '{}'::jsonb;
    for v_group in
      select *
      from public.program_template_exercise_groups
      where program_template_workout_id = v_workout.id
      order by sort_order, title
    loop
      insert into public.client_program_exercise_groups (
        client_program_workout_id,
        title,
        sets,
        rest,
        notes,
        sort_order,
        source_template_group_id
      )
      values (
        v_client_workout_id,
        coalesce(nullif(trim(v_group.title), ''), 'Комбо'),
        nullif(trim(coalesce(v_group.sets, '')), ''),
        nullif(trim(coalesce(v_group.rest, '')), ''),
        nullif(trim(coalesce(v_group.notes, '')), ''),
        coalesce(v_group.sort_order, 0),
        v_group.id
      )
      returning id into v_group_id;

      v_group_id_by_template_id := v_group_id_by_template_id || jsonb_build_object(v_group.id::text, v_group_id::text);
    end loop;

    for v_exercise in
      select *
      from public.program_template_exercises
      where program_template_workout_id = v_workout.id
      order by sort_order, exercise_title
    loop
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
        sort_order,
        source_template_exercise_id
      )
      values (
        v_client_workout_id,
        case
          when v_exercise.exercise_group_id is not null
            then (v_group_id_by_template_id->>v_exercise.exercise_group_id::text)::uuid
          else null
        end,
        v_exercise.exercise_id,
        coalesce(nullif(trim(v_exercise.exercise_title), ''), 'Упражнение'),
        case when v_exercise.exercise_group_id is null then nullif(trim(coalesce(v_exercise.sets, '')), '') else null end,
        nullif(trim(coalesce(v_exercise.reps, '')), ''),
        case when v_exercise.exercise_group_id is null then nullif(trim(coalesce(v_exercise.rest, '')), '') else null end,
        nullif(trim(coalesce(v_exercise.tempo, '')), ''),
        nullif(trim(coalesce(v_exercise.notes, '')), ''),
        coalesce(v_exercise.sort_order, 0),
        v_exercise.id
      );
    end loop;

    v_created_workouts := v_created_workouts + 1;
    v_imported_workouts := v_imported_workouts || jsonb_build_array(
      jsonb_build_object(
        'workoutDate', v_workout_date,
        'sourceTemplateWorkoutId', v_workout.id,
        'clientWorkoutId', v_client_workout_id,
        'status', 'created'
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'clientProgramId', v_program_id,
    'createdWorkouts', v_created_workouts,
    'reusedWorkouts', v_reused_workouts,
    'importedWorkouts', v_imported_workouts
  );
end;
$$;

grant execute on function public.import_program_template_workouts_to_client_calendar(text, uuid, uuid, date, uuid[], jsonb) to service_role;
