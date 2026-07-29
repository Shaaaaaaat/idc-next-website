-- Transaction-safe diff save for coach program templates.
-- The function preserves stable child row ids, rejects stale edits, and avoids
-- delete-all + insert-all rebuilds from the application layer.

create or replace function public.save_program_template_diff(
  p_program_id uuid,
  p_coach_email text,
  p_expected_updated_at timestamptz default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid;
  v_template record;
  v_now timestamptz := now();
  v_title text;
  v_description text;
  v_duration_days integer;
  v_weeks_count integer;
  v_level text;
  v_goal text;
  v_tags text[];
  v_workouts jsonb;
  v_groups jsonb;
  v_exercises jsonb;
  v_workout jsonb;
  v_group jsonb;
  v_exercise jsonb;
  v_workout_id uuid;
  v_workout_payload_id uuid;
  v_group_id uuid;
  v_group_payload_id uuid;
  v_exercise_id uuid;
  v_exercise_payload_id uuid;
  v_group_ref text;
  v_group_fk uuid;
  v_group_ids jsonb;
  v_seen_workout_ids uuid[] := array[]::uuid[];
  v_seen_group_ids uuid[] := array[]::uuid[];
  v_seen_exercise_ids uuid[] := array[]::uuid[];
  v_workout_index integer := 0;
  v_group_index integer;
  v_exercise_index integer;
  v_day_number integer;
  v_week_number integer;
  v_sort_order integer;
  v_estimated_minutes integer;
  v_exercise_title text;
  v_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_int_pattern constant text := '^-?[0-9]+$';
begin
  if p_program_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Program id is required');
  end if;

  select id
    into v_coach_id
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;

  if v_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_program_id::text));

  select *
    into v_template
  from public.program_templates
  where id = p_program_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_template.coach_id is not null and v_template.coach_id <> v_coach_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_expected_updated_at is not null and v_template.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;

  v_title := v_template.title;
  if p_payload ? 'title' then
    v_title := nullif(trim(coalesce(p_payload->>'title', '')), '');
    if v_title is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Program title is required');
    end if;
  end if;

  v_description := v_template.description;
  if p_payload ? 'description' then
    v_description := nullif(trim(coalesce(p_payload->>'description', '')), '');
  end if;

  if p_payload ? 'durationDays'
    and nullif(p_payload->>'durationDays', '') is not null
    and not ((p_payload->>'durationDays') ~ v_int_pattern) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Duration days must be an integer');
  end if;

  v_duration_days := coalesce(v_template.duration_days, 1);
  if p_payload ? 'durationDays' then
    v_duration_days := greatest(1, coalesce(nullif(p_payload->>'durationDays', '')::integer, 1));
  end if;

  if p_payload ? 'weeksCount'
    and nullif(p_payload->>'weeksCount', '') is not null
    and not ((p_payload->>'weeksCount') ~ v_int_pattern) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Weeks count must be an integer');
  end if;

  v_weeks_count := coalesce(v_template.weeks_count, 1);
  if p_payload ? 'weeksCount' then
    v_weeks_count := greatest(1, coalesce(nullif(p_payload->>'weeksCount', '')::integer, 1));
  end if;

  v_level := v_template.level;
  if p_payload ? 'level' then
    v_level := nullif(trim(coalesce(p_payload->>'level', '')), '');
  end if;

  v_goal := v_template.goal;
  if p_payload ? 'goal' then
    v_goal := nullif(trim(coalesce(p_payload->>'goal', '')), '');
  end if;

  v_tags := coalesce(v_template.tags, '{}'::text[]);
  if p_payload ? 'tags' then
    if jsonb_typeof(p_payload->'tags') = 'array' then
      select coalesce(array_agg(trim(tag.value)) filter (where trim(tag.value) <> ''), '{}'::text[])
        into v_tags
      from jsonb_array_elements_text(p_payload->'tags') as tag(value);
    else
      select coalesce(array_agg(trim(tag.value)) filter (where trim(tag.value) <> ''), '{}'::text[])
        into v_tags
      from regexp_split_to_table(coalesce(p_payload->>'tags', ''), '[,\n]') as tag(value);
    end if;
  end if;

  if p_payload ? 'workouts' then
    if jsonb_typeof(p_payload->'workouts') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workouts payload must be an array');
    end if;

    for v_workout in select value from jsonb_array_elements(p_payload->'workouts')
    loop
      if coalesce(jsonb_typeof(v_workout->'groups'), '') <> 'array'
        or coalesce(jsonb_typeof(v_workout->'exercises'), '') <> 'array' then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout payload must include groups and exercises arrays');
      end if;

      if nullif(v_workout->>'id', '') is not null and not ((v_workout->>'id') ~ v_uuid_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout id must be a valid UUID');
      end if;
      if nullif(v_workout->>'dayNumber', '') is not null and not ((v_workout->>'dayNumber') ~ v_int_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout dayNumber must be an integer');
      end if;
      if nullif(v_workout->>'weekNumber', '') is not null and not ((v_workout->>'weekNumber') ~ v_int_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout weekNumber must be an integer');
      end if;
      if nullif(v_workout->>'sortOrder', '') is not null and not ((v_workout->>'sortOrder') ~ v_int_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout sortOrder must be an integer');
      end if;
      if nullif(v_workout->>'estimatedMinutes', '') is not null and not ((v_workout->>'estimatedMinutes') ~ v_int_pattern) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout estimatedMinutes must be an integer');
      end if;

      v_workout_payload_id := nullif(v_workout->>'id', '')::uuid;
      v_group_ids := '{}'::jsonb;

      if v_workout_payload_id is not null then
        perform 1
        from public.program_template_workouts
        where id = v_workout_payload_id
          and program_template_id = p_program_id;
        if not found then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout does not belong to program');
        end if;
      end if;

      v_groups := case
        when jsonb_typeof(v_workout->'groups') = 'array' then v_workout->'groups'
        else '[]'::jsonb
      end;

      for v_group in select value from jsonb_array_elements(v_groups)
      loop
        if nullif(v_group->>'id', '') is not null and not ((v_group->>'id') ~ v_uuid_pattern) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group id must be a valid UUID');
        end if;
        if nullif(v_group->>'sortOrder', '') is not null and not ((v_group->>'sortOrder') ~ v_int_pattern) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group sortOrder must be an integer');
        end if;

        v_group_payload_id := nullif(v_group->>'id', '')::uuid;
        v_group_ref := nullif(coalesce(v_group->>'draftId', v_group->>'id', ''), '');

        if v_group_payload_id is not null then
          if v_workout_payload_id is null then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Existing group cannot belong to a new workout');
          end if;

          perform 1
          from public.program_template_exercise_groups
          where id = v_group_payload_id
            and program_template_workout_id = v_workout_payload_id;
          if not found then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group does not belong to workout');
          end if;

          v_group_ids := v_group_ids || jsonb_build_object(v_group_payload_id::text, v_group_payload_id::text);
        end if;

        if v_group_ref is not null then
          v_group_ids := v_group_ids || jsonb_build_object(v_group_ref, coalesce(v_group_payload_id::text, v_group_ref));
        end if;
      end loop;

      v_exercises := case
        when jsonb_typeof(v_workout->'exercises') = 'array' then v_workout->'exercises'
        else '[]'::jsonb
      end;

      for v_exercise in select value from jsonb_array_elements(v_exercises)
      loop
        if nullif(v_exercise->>'id', '') is not null and not ((v_exercise->>'id') ~ v_uuid_pattern) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise id must be a valid UUID');
        end if;
        if nullif(v_exercise->>'exerciseId', '') is not null and not ((v_exercise->>'exerciseId') ~ v_uuid_pattern) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise exerciseId must be a valid UUID');
        end if;
        if nullif(v_exercise->>'sortOrder', '') is not null and not ((v_exercise->>'sortOrder') ~ v_int_pattern) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise sortOrder must be an integer');
        end if;

        v_exercise_title := nullif(trim(coalesce(v_exercise->>'exerciseTitle', '')), '');
        if v_exercise_title is null then
          continue;
        end if;

        v_exercise_payload_id := nullif(v_exercise->>'id', '')::uuid;
        if v_exercise_payload_id is not null then
          if v_workout_payload_id is null then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Existing exercise cannot belong to a new workout');
          end if;

          perform 1
          from public.program_template_exercises
          where id = v_exercise_payload_id
            and program_template_workout_id = v_workout_payload_id;
          if not found then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise does not belong to workout');
          end if;
        end if;

        v_group_ref := nullif(coalesce(v_exercise->>'groupDraftId', v_exercise->>'groupId', ''), '');
        if v_group_ref is not null and not (v_group_ids ? v_group_ref) then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group does not belong to workout');
        end if;
      end loop;
    end loop;
  end if;

  update public.program_templates
  set
    title = v_title,
    description = v_description,
    duration_days = v_duration_days,
    weeks_count = v_weeks_count,
    level = v_level,
    goal = v_goal,
    tags = v_tags,
    updated_at = v_now
  where id = p_program_id;

  if p_payload ? 'workouts' then
    v_workouts := p_payload->'workouts';

    for v_workout in select value from jsonb_array_elements(v_workouts)
    loop
      v_workout_payload_id := nullif(v_workout->>'id', '')::uuid;
      v_day_number := greatest(1, coalesce(nullif(v_workout->>'dayNumber', '')::integer, v_workout_index + 1));
      v_week_number := greatest(1, coalesce(nullif(v_workout->>'weekNumber', '')::integer, ceil(v_day_number::numeric / 7)::integer));
      v_sort_order := coalesce(nullif(v_workout->>'sortOrder', '')::integer, v_workout_index);
      v_estimated_minutes := nullif(v_workout->>'estimatedMinutes', '')::integer;

      if v_workout_payload_id is null then
        insert into public.program_template_workouts (
          program_template_id,
          day_number,
          week_number,
          title,
          summary,
          estimated_minutes,
          workout_type,
          sort_order
        )
        values (
          p_program_id,
          v_day_number,
          v_week_number,
          coalesce(nullif(trim(coalesce(v_workout->>'title', '')), ''), 'Day ' || v_day_number),
          nullif(trim(coalesce(v_workout->>'summary', '')), ''),
          v_estimated_minutes,
          nullif(trim(coalesce(v_workout->>'workoutType', '')), ''),
          v_sort_order
        )
        returning id into v_workout_id;
      else
        update public.program_template_workouts
        set
          day_number = v_day_number,
          week_number = v_week_number,
          title = coalesce(nullif(trim(coalesce(v_workout->>'title', '')), ''), 'Day ' || v_day_number),
          summary = nullif(trim(coalesce(v_workout->>'summary', '')), ''),
          estimated_minutes = v_estimated_minutes,
          workout_type = nullif(trim(coalesce(v_workout->>'workoutType', '')), ''),
          sort_order = v_sort_order,
          updated_at = v_now
        where id = v_workout_payload_id
          and program_template_id = p_program_id
        returning id into v_workout_id;

        if v_workout_id is null then
          raise exception 'Workout does not belong to program';
        end if;
      end if;

      v_seen_workout_ids := array_append(v_seen_workout_ids, v_workout_id);
      v_group_ids := '{}'::jsonb;
      v_seen_group_ids := array[]::uuid[];
      v_seen_exercise_ids := array[]::uuid[];

      v_groups := case
        when jsonb_typeof(v_workout->'groups') = 'array' then v_workout->'groups'
        else '[]'::jsonb
      end;
      v_group_index := 0;

      for v_group in select value from jsonb_array_elements(v_groups)
      loop
        v_group_payload_id := nullif(v_group->>'id', '')::uuid;
        v_group_ref := nullif(coalesce(v_group->>'draftId', v_group->>'id', ''), '');

        if v_group_payload_id is null then
          insert into public.program_template_exercise_groups (
            program_template_workout_id,
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
            coalesce(nullif(v_group->>'sortOrder', '')::integer, v_group_index)
          )
          returning id into v_group_id;
        else
          update public.program_template_exercise_groups
          set
            title = coalesce(nullif(trim(coalesce(v_group->>'title', '')), ''), 'Комбо ' || (v_group_index + 1)),
            sets = nullif(trim(coalesce(v_group->>'sets', '')), ''),
            rest = nullif(trim(coalesce(v_group->>'rest', '')), ''),
            notes = nullif(trim(coalesce(v_group->>'notes', '')), ''),
            sort_order = coalesce(nullif(v_group->>'sortOrder', '')::integer, v_group_index),
            updated_at = v_now
          where id = v_group_payload_id
            and program_template_workout_id = v_workout_id
          returning id into v_group_id;

          if v_group_id is null then
            raise exception 'Exercise group does not belong to workout';
          end if;
        end if;

        v_seen_group_ids := array_append(v_seen_group_ids, v_group_id);
        v_group_ids := v_group_ids || jsonb_build_object(v_group_id::text, v_group_id::text);
        if v_group_ref is not null then
          v_group_ids := v_group_ids || jsonb_build_object(v_group_ref, v_group_id::text);
        end if;
        v_group_index := v_group_index + 1;
      end loop;

      v_exercises := case
        when jsonb_typeof(v_workout->'exercises') = 'array' then v_workout->'exercises'
        else '[]'::jsonb
      end;
      v_exercise_index := 0;

      for v_exercise in select value from jsonb_array_elements(v_exercises)
      loop
        v_exercise_title := nullif(trim(coalesce(v_exercise->>'exerciseTitle', '')), '');
        if v_exercise_title is null then
          continue;
        end if;

        v_exercise_payload_id := nullif(v_exercise->>'id', '')::uuid;
        v_group_ref := nullif(coalesce(v_exercise->>'groupDraftId', v_exercise->>'groupId', ''), '');
        v_group_fk := null;
        if v_group_ref is not null then
          if not (v_group_ids ? v_group_ref) then
            raise exception 'Exercise group does not belong to workout';
          end if;
          v_group_fk := (v_group_ids->>v_group_ref)::uuid;
        end if;

        if v_exercise_payload_id is null then
          insert into public.program_template_exercises (
            program_template_workout_id,
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
            nullif(v_exercise->>'exerciseId', '')::uuid,
            v_exercise_title,
            case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end,
            nullif(trim(coalesce(v_exercise->>'reps', '')), ''),
            case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end,
            nullif(trim(coalesce(v_exercise->>'tempo', '')), ''),
            nullif(trim(coalesce(v_exercise->>'notes', '')), ''),
            coalesce(nullif(v_exercise->>'sortOrder', '')::integer, v_exercise_index)
          )
          returning id into v_exercise_id;
        else
          update public.program_template_exercises
          set
            exercise_group_id = v_group_fk,
            exercise_id = nullif(v_exercise->>'exerciseId', '')::uuid,
            exercise_title = v_exercise_title,
            sets = case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end,
            reps = nullif(trim(coalesce(v_exercise->>'reps', '')), ''),
            rest = case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end,
            tempo = nullif(trim(coalesce(v_exercise->>'tempo', '')), ''),
            notes = nullif(trim(coalesce(v_exercise->>'notes', '')), ''),
            sort_order = coalesce(nullif(v_exercise->>'sortOrder', '')::integer, v_exercise_index),
            updated_at = v_now
          where id = v_exercise_payload_id
            and program_template_workout_id = v_workout_id
          returning id into v_exercise_id;

          if v_exercise_id is null then
            raise exception 'Exercise does not belong to workout';
          end if;
        end if;

        v_seen_exercise_ids := array_append(v_seen_exercise_ids, v_exercise_id);
        v_exercise_index := v_exercise_index + 1;
      end loop;

      delete from public.program_template_exercises
      where program_template_workout_id = v_workout_id
        and (
          array_length(v_seen_exercise_ids, 1) is null
          or not (id = any(v_seen_exercise_ids))
        );

      delete from public.program_template_exercise_groups
      where program_template_workout_id = v_workout_id
        and (
          array_length(v_seen_group_ids, 1) is null
          or not (id = any(v_seen_group_ids))
        );

      v_workout_index := v_workout_index + 1;
    end loop;

    delete from public.program_template_workouts
    where program_template_id = p_program_id
      and (
        array_length(v_seen_workout_ids, 1) is null
        or not (id = any(v_seen_workout_ids))
      );
  end if;

  return jsonb_build_object('ok', true, 'programId', p_program_id, 'updatedAt', v_now);
end;
$$;

grant execute on function public.save_program_template_diff(uuid, text, timestamptz, jsonb) to service_role;
