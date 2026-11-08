drop index if exists public.idx_client_program_workouts_template_import_once;

create unique index idx_client_program_workouts_template_import_once
  on public.client_program_workouts (client_id, coach_id, workout_date, source_template_workout_id)
  where source_template_workout_id is not null
    and status in ('planned', 'in_progress');

create or replace function public.import_program_template_workouts_to_client_calendar(
  p_coach_email text,
  p_client_id uuid,
  p_program_template_id uuid,
  p_start_date date default null::date,
  p_template_workout_ids uuid[] default null::uuid[],
  p_workout_dates jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid;
  v_access_level text;
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

  select id, coalesce(access_level, 'coach')
    into v_coach_id, v_access_level
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

  if v_template.coach_id is null then
    null;
  elsif v_template.coach_id = v_coach_id then
    null;
  elsif coalesce(v_access_level, 'coach') = 'head_coach' then
    null;
  else
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('template-workout-import:' || v_coach_id::text || ':' || p_client_id::text || ':' || p_program_template_id::text)
  );

  perform pg_advisory_xact_lock(hashtext('active-client-program:' || v_coach_id::text || ':' || p_client_id::text));

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
      and status in ('planned', 'in_progress')
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
        and status in ('planned', 'in_progress')
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
        and status in ('planned', 'in_progress')
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

alter function public.import_program_template_workouts_to_client_calendar(text, uuid, uuid, date, uuid[], jsonb) owner to postgres;
grant all on function public.import_program_template_workouts_to_client_calendar(text, uuid, uuid, date, uuid[], jsonb) to service_role;

create or replace function public.submit_student_workout(
  p_client_id uuid,
  p_workout_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workout public.client_program_workouts%rowtype;
  v_now timestamptz := now();
  v_effective_submitted_at timestamptz;
  v_effective_workout_date date;
  v_client_name text;
  v_trainer_telegram_id text;
  v_exercise_result_count integer;
  v_video_count integer;
  v_notification_event_id uuid;
begin
  if p_client_id is null or p_workout_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Client id and workout id are required');
  end if;

  select *
    into v_workout
  from public.client_program_workouts
  where id = p_workout_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_workout.client_id is distinct from p_client_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_workout.status in ('planned', 'in_progress') then
    v_effective_submitted_at := coalesce(v_workout.submitted_at, v_now);
    v_effective_workout_date := (v_effective_submitted_at at time zone 'Europe/Moscow')::date;

    update public.client_program_workouts
    set
      status = 'submitted',
      submitted_at = v_effective_submitted_at,
      workout_date = v_effective_workout_date,
      updated_at = v_now
    where id = p_workout_id
    returning * into v_workout;

    begin
      select nullif(trim(coalesce(fio, '')), '')
        into v_client_name
      from public.clients
      where id = p_client_id;

      select nullif(trim(coalesce(telegram_id, '')), '')
        into v_trainer_telegram_id
      from public.coach_profiles
      where id = v_workout.coach_id;

      select
        count(distinct ser.id)::integer,
        count(serv.id)::integer
        into v_exercise_result_count, v_video_count
      from public.client_program_exercises cpe
      left join public.student_exercise_results ser
        on ser.client_program_exercise_id = cpe.id
      left join public.student_exercise_result_videos serv
        on serv.student_exercise_result_id = ser.id
      where cpe.client_program_workout_id = p_workout_id;
    exception when others then
      v_exercise_result_count := null;
      v_video_count := null;
    end;

    begin
      v_notification_event_id := public.enqueue_client_notification_event(
        p_client_id,
        'student_workout_submitted',
        'client_program_workouts',
        p_workout_id::text,
        'trainer',
        'telegram',
        jsonb_strip_nulls(jsonb_build_object(
          'workout_id', p_workout_id,
          'workout_title', v_workout.title,
          'workout_date', v_workout.workout_date,
          'client_name', v_client_name,
          'exercise_result_count', v_exercise_result_count,
          'video_count', v_video_count,
          'trainer_telegram_id', v_trainer_telegram_id
        ))
      );
    exception when others then
      raise warning 'student_workout_submitted_enqueue_failed workout %, client %: %',
        p_workout_id,
        p_client_id,
        sqlerrm;
    end;

    return jsonb_build_object(
      'ok', true,
      'workoutId', v_workout.id,
      'status', v_workout.status,
      'submittedAt', v_workout.submitted_at,
      'firstSubmitted', true,
      'notificationEventId', v_notification_event_id
    );
  end if;

  if v_workout.status in ('submitted', 'reviewed') then
    return jsonb_build_object(
      'ok', true,
      'workoutId', v_workout.id,
      'status', v_workout.status,
      'submittedAt', v_workout.submitted_at,
      'firstSubmitted', false
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', 'unsupported_status',
    'status', v_workout.status,
    'message', 'Workout cannot be submitted from its current status'
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', 'db_error', 'message', SQLERRM);
end;
$$;

revoke all on function public.submit_student_workout(uuid, uuid) from public, anon, authenticated;
grant all on function public.submit_student_workout(uuid, uuid) to service_role;
