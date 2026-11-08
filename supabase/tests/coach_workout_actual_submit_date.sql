\set ON_ERROR_STOP on

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(18);

do $setup$
begin
  delete from public.client_program_workouts
  where id in (
    '10000000-0000-0000-0000-00000000cd36'::uuid,
    '10000000-0000-0000-0000-00000000cd37'::uuid,
    '10000000-0000-0000-0000-00000000cd38'::uuid,
    '10000000-0000-0000-0000-00000000cd39'::uuid,
    '10000000-0000-0000-0000-00000000cd40'::uuid
  );
  delete from public.program_template_workouts
  where id in (
    '10000000-0000-0000-0000-00000000cd35'::uuid,
    '10000000-0000-0000-0000-00000000cd45'::uuid
  );
  delete from public.program_templates where id = '10000000-0000-0000-0000-00000000cd34'::uuid;
  delete from public.client_programs where id = '10000000-0000-0000-0000-00000000cd33'::uuid;
  delete from public.coach_clients
  where coach_id = '10000000-0000-0000-0000-00000000cd31'::uuid
    and client_id = '10000000-0000-0000-0000-00000000cd32'::uuid;
  delete from public.clients where id = '10000000-0000-0000-0000-00000000cd32'::uuid;
  delete from public.coach_profiles where id = '10000000-0000-0000-0000-00000000cd31'::uuid;

  insert into public.coach_profiles (id, email, coach_name, display_name, is_active, access_level)
  values (
    '10000000-0000-0000-0000-00000000cd31'::uuid,
    'calendar-actual-date-coach@example.com',
    'calendar_actual_date_coach',
    'Calendar Actual Date Coach',
    true,
    'coach'
  );

  insert into public.clients (id, fio, email, coach, start_day, final_day, balance, ds_price, currency, lk_enabled, status, is_active, first_fact)
  values (
    '10000000-0000-0000-0000-00000000cd32'::uuid,
    'Calendar Actual Date Client',
    'calendar-actual-date-client@example.com',
    'calendar_actual_date_coach',
    current_date,
    current_date,
    0,
    0,
    'RUB',
    true,
    'pass',
    false,
    0
  );

  insert into public.coach_clients (coach_id, client_id, is_active)
  values (
    '10000000-0000-0000-0000-00000000cd31'::uuid,
    '10000000-0000-0000-0000-00000000cd32'::uuid,
    true
  )
  on conflict (coach_id, client_id) do update
  set is_active = true;

  insert into public.client_programs (id, client_id, coach_id, title, status, start_date)
  values (
    '10000000-0000-0000-0000-00000000cd33'::uuid,
    '10000000-0000-0000-0000-00000000cd32'::uuid,
    '10000000-0000-0000-0000-00000000cd31'::uuid,
    'Calendar Actual Date Program',
    'active',
    '2026-11-05'
  );

  insert into public.program_templates (id, coach_id, title, is_active)
  values (
    '10000000-0000-0000-0000-00000000cd34'::uuid,
    '10000000-0000-0000-0000-00000000cd31'::uuid,
    'Calendar Actual Date Template',
    true
  );

  insert into public.program_template_workouts (id, program_template_id, title, day_number, sort_order)
  values
    (
      '10000000-0000-0000-0000-00000000cd35'::uuid,
      '10000000-0000-0000-0000-00000000cd34'::uuid,
      'Template Workout',
      1,
      0
    ),
    (
      '10000000-0000-0000-0000-00000000cd45'::uuid,
      '10000000-0000-0000-0000-00000000cd34'::uuid,
      'Late Template Workout',
      2,
      1
    );

  insert into public.client_program_workouts (
    id,
    client_program_id,
    client_id,
    coach_id,
    workout_date,
    title,
    status,
    submitted_at,
    source_program_template_id,
    source_template_workout_id
  )
  values
    (
      '10000000-0000-0000-0000-00000000cd36'::uuid,
      '10000000-0000-0000-0000-00000000cd33'::uuid,
      '10000000-0000-0000-0000-00000000cd32'::uuid,
      '10000000-0000-0000-0000-00000000cd31'::uuid,
      '2026-11-05',
      'Template Workout 5',
      'planned',
      null,
      '10000000-0000-0000-0000-00000000cd34'::uuid,
      '10000000-0000-0000-0000-00000000cd35'::uuid
    ),
    (
      '10000000-0000-0000-0000-00000000cd37'::uuid,
      '10000000-0000-0000-0000-00000000cd33'::uuid,
      '10000000-0000-0000-0000-00000000cd32'::uuid,
      '10000000-0000-0000-0000-00000000cd31'::uuid,
      '2026-11-10',
      'Template Workout 10',
      'planned',
      '2026-11-05 10:15:00+03'::timestamptz,
      '10000000-0000-0000-0000-00000000cd34'::uuid,
      '10000000-0000-0000-0000-00000000cd35'::uuid
    ),
    (
      '10000000-0000-0000-0000-00000000cd38'::uuid,
      '10000000-0000-0000-0000-00000000cd33'::uuid,
      '10000000-0000-0000-0000-00000000cd32'::uuid,
      '10000000-0000-0000-0000-00000000cd31'::uuid,
      '2026-11-05',
      'Late Workout',
      'planned',
      '2026-11-10 23:30:00+03'::timestamptz,
      '10000000-0000-0000-0000-00000000cd34'::uuid,
      '10000000-0000-0000-0000-00000000cd45'::uuid
    );
end
$setup$;

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_client_program_workouts_template_import_once'
      and indexdef like '%status%planned%'
      and indexdef like '%in_progress%'
  ),
  'template import uniqueness is limited to active assigned workouts'
);

create temp table actual_date_results as
select public.submit_student_workout(
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  '10000000-0000-0000-0000-00000000cd37'::uuid
) as early_submit;

select ok((early_submit->>'ok')::boolean, 'early submit succeeds despite same template on actual day')
from actual_date_results;

select is(
  (select workout_date::text from public.client_program_workouts where id = '10000000-0000-0000-0000-00000000cd37'::uuid),
  '2026-11-05',
  'early submit moves workout_date to Moscow date of submitted_at'
);

select is(
  (select count(*)::integer from public.client_program_workouts where client_id = '10000000-0000-0000-0000-00000000cd32'::uuid and workout_date = '2026-11-10' and id in ('10000000-0000-0000-0000-00000000cd36'::uuid, '10000000-0000-0000-0000-00000000cd37'::uuid)),
  0,
  'original scheduled day is freed after early submit'
);

select is(
  (select count(*)::integer from public.client_program_workouts where client_id = '10000000-0000-0000-0000-00000000cd32'::uuid and workout_date = '2026-11-05' and id in ('10000000-0000-0000-0000-00000000cd36'::uuid, '10000000-0000-0000-0000-00000000cd37'::uuid)),
  2,
  'both existing cards are visible on the actual day after submit'
);

select is(
  (select status from public.client_program_workouts where id = '10000000-0000-0000-0000-00000000cd36'::uuid),
  'planned',
  'existing workout on actual day remains in place'
);

select is(
  (select source_template_workout_id::text from public.client_program_workouts where id = '10000000-0000-0000-0000-00000000cd37'::uuid),
  '10000000-0000-0000-0000-00000000cd35',
  'submitted workout keeps source_template_workout_id'
);

create temp table import_active_day_results as
select public.import_program_template_workouts_to_client_calendar(
  'calendar-actual-date-coach@example.com',
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  '10000000-0000-0000-0000-00000000cd34'::uuid,
  p_template_workout_ids := array['10000000-0000-0000-0000-00000000cd35'::uuid],
  p_workout_dates := jsonb_build_object('10000000-0000-0000-0000-00000000cd35', '2026-11-05')
) as result;

select is(
  (result->>'createdWorkouts')::integer,
  0,
  'repeat import of same template on active assigned day does not create duplicate'
)
from import_active_day_results;

select is(
  (result->>'reusedWorkouts')::integer,
  1,
  'repeat import of same template on active assigned day reuses existing active workout'
)
from import_active_day_results;

create temp table import_freed_day_results as
select public.import_program_template_workouts_to_client_calendar(
  'calendar-actual-date-coach@example.com',
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  '10000000-0000-0000-0000-00000000cd34'::uuid,
  p_template_workout_ids := array['10000000-0000-0000-0000-00000000cd35'::uuid],
  p_workout_dates := jsonb_build_object('10000000-0000-0000-0000-00000000cd35', '2026-11-10')
) as result;

select is(
  (result->>'createdWorkouts')::integer,
  1,
  'same template can be imported again on freed original day'
)
from import_freed_day_results;

select is(
  (select count(*)::integer from public.client_program_workouts where client_id = '10000000-0000-0000-0000-00000000cd32'::uuid and workout_date = '2026-11-10' and status = 'planned'),
  1,
  'calendar has an active planned card on the freed day after import'
);

create temp table manual_create_results as
select public.create_client_workout_diff(
  'calendar-actual-date-coach@example.com',
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  jsonb_build_object(
    'workoutDate', '2026-11-10',
    'title', 'Manual workout on freed day',
    'coachComment', '',
    'groups', '[]'::jsonb,
    'exercises', jsonb_build_array(jsonb_build_object('exerciseTitle', 'Manual exercise'))
  )
) as result;

select ok((result->>'ok')::boolean, 'manual workout creation is available on freed day')
from manual_create_results;

create temp table late_submit_results as
select public.submit_student_workout(
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  '10000000-0000-0000-0000-00000000cd38'::uuid
) as late_submit;

select ok((late_submit->>'ok')::boolean, 'late submit succeeds')
from late_submit_results;

select is(
  (select workout_date::text from public.client_program_workouts where id = '10000000-0000-0000-0000-00000000cd38'::uuid),
  '2026-11-10',
  'late submit moves workout_date forward to Moscow date of submitted_at'
);

create temp table repeat_submit_results as
select public.submit_student_workout(
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  '10000000-0000-0000-0000-00000000cd38'::uuid
) as repeat_submit;

select is(
  (repeat_submit->>'firstSubmitted')::boolean,
  false,
  'repeat submit is not first submit'
)
from repeat_submit_results;

select is(
  (select workout_date::text from public.client_program_workouts where id = '10000000-0000-0000-0000-00000000cd38'::uuid),
  '2026-11-10',
  'repeat submit keeps workout_date unchanged'
);

update public.client_program_workouts
set status = 'reviewed', submitted_at = '2026-11-10 23:30:00+03'::timestamptz
where id = '10000000-0000-0000-0000-00000000cd38'::uuid;

create temp table reviewed_submit_results as
select public.submit_student_workout(
  '10000000-0000-0000-0000-00000000cd32'::uuid,
  '10000000-0000-0000-0000-00000000cd38'::uuid
) as reviewed_submit;

select is(
  (reviewed_submit->>'firstSubmitted')::boolean,
  false,
  'reviewed submit is not first submit'
)
from reviewed_submit_results;

select is(
  (select workout_date::text from public.client_program_workouts where id = '10000000-0000-0000-0000-00000000cd38'::uuid),
  '2026-11-10',
  'reviewed submit keeps workout_date unchanged'
);

select * from finish();
