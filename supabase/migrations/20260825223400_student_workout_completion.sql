alter table public.client_program_workouts
add column if not exists submitted_at timestamptz null;

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
  v_submitted_at timestamptz;
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
    v_submitted_at := coalesce(v_workout.submitted_at, v_now);

    update public.client_program_workouts
    set
      status = 'submitted',
      submitted_at = v_submitted_at,
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
