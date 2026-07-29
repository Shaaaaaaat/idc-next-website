create or replace function public.close_coach_act(p_act_id uuid)
returns jsonb
language plpgsql
as $function$
declare
  a public.coach_acts%rowtype;
  v_personal_hours numeric := 0;
  v_personal_people numeric := 0;
  v_group_hours numeric := 0;
  v_group_people numeric := 0;
  v_video_hours numeric := 0;
  v_video_hours_voice numeric := 0;
  v_smm_hours numeric := 0;
  v_master_people numeric := 0;
  v_totals record;
begin
  select *
  into a
  from public.coach_acts
  where id = p_act_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'act_not_found');
  end if;

  select
    count(*),
    coalesce(sum(ce.people_count), 0)
  into
    v_personal_hours,
    v_personal_people
  from public.coach_earnings ce
  join public.training_formats tf on tf.id = ce.training_format_id
  where ce.status = 'main'
    and ce.earned_at::date between a.period_start and a.period_end
    and tf.slug = 'personal'
    and exists (
      select 1
      from public.coach_profiles cp
      where cp.id = ce.coach_id
        and cp.coach_name = a.coach_handle
    );

  select
    coalesce(
      count(distinct (
        coalesce(sw.scheduled_at::date, ce.earned_at::date),
        coalesce(nullif(sw.title, ''), ce.scheduled_workout_id::text, ce.id::text)
      )) filter (where tf.slug = 'group'),
      0
    ),
    coalesce(sum(ce.people_count), 0)
  into
    v_group_hours,
    v_group_people
  from public.coach_earnings ce
  join public.training_formats tf on tf.id = ce.training_format_id
  left join public.scheduled_workouts sw on sw.id = ce.scheduled_workout_id
  where ce.status = 'main'
    and ce.earned_at::date between a.period_start and a.period_end
    and tf.slug in ('group', 'ds')
    and exists (
      select 1
      from public.coach_profiles cp
      where cp.id = ce.coach_id
        and cp.coach_name = a.coach_handle
    );

  select
    coalesce(sum(case when earning_type = 'video_no_voice' then 1 else 0 end), 0),
    coalesce(sum(case when earning_type = 'video_voice_extra' then 1 else 0 end), 0),
    coalesce(sum(case when earning_type in ('smm_base', 'smm_info_extra') then 1 else 0 end), 0)
  into
    v_video_hours,
    v_video_hours_voice,
    v_smm_hours
  from public.content_earnings
  where coach_handle = a.coach_handle
    and earning_date between a.period_start and a.period_end;

  if a.coach_handle = 'kapitanstar_coach' then
    select coalesce(
      sum(
        case
          when p.coach_handle_snapshot = 'dima_dubinin'
            then coalesce(ce.people_count, 1) * 2
          else coalesce(ce.people_count, 1)
        end
      ),
      0
    )
    into v_master_people
    from public.coach_earnings ce
    left join public.pnl_entries p on p.scheduled_workout_id = ce.scheduled_workout_id
    where ce.status = 'extra'
      and ce.earned_at::date between a.period_start and a.period_end
      and exists (
        select 1
        from public.coach_profiles cp
        where cp.id = ce.coach_id
          and cp.coach_name = 'kapitanstar_coach'
      );
  end if;

  update public.coach_acts
  set
    personal_hours = v_personal_hours,
    personal_people = v_personal_people,
    group_hours = v_group_hours,
    group_people = v_group_people,
    video_hours = v_video_hours,
    video_hours_voice = v_video_hours_voice,
    smm_hours = v_smm_hours,
    master_people = v_master_people,
    updated_at = now()
  where id = a.id;

  select *
  into v_totals
  from public.calculate_coach_act_totals(a.id);

  update public.coach_acts
  set
    total_hours = v_totals.total_hours,
    total_people = v_totals.total_people,
    total_sum = v_totals.total_sum,
    status = 'doc_act_created',
    updated_at = now()
  where id = a.id;

  return jsonb_build_object(
    'ok', true,
    'act_id', a.id,
    'act_number', a.act_number,
    'coach_handle', a.coach_handle,
    'personal_hours', v_personal_hours,
    'personal_people', v_personal_people,
    'group_hours', v_group_hours,
    'group_people', v_group_people,
    'video_hours', v_video_hours,
    'video_hours_voice', v_video_hours_voice,
    'smm_hours', v_smm_hours,
    'master_people', v_master_people,
    'total_hours', v_totals.total_hours,
    'total_people', v_totals.total_people,
    'total_sum', v_totals.total_sum
  );
end;
$function$;

do $$
declare
  a public.coach_acts%rowtype;
  v_group_hours numeric := 0;
  v_group_people numeric := 0;
  v_totals record;
begin
  select *
  into a
  from public.coach_acts
  where act_number = 'SPB-FI-12';

  if not found then
    raise notice 'coach_act SPB-FI-12 not found, skipping targeted backfill';
    return;
  end if;

  select
    coalesce(
      count(distinct (
        coalesce(sw.scheduled_at::date, ce.earned_at::date),
        coalesce(nullif(sw.title, ''), ce.scheduled_workout_id::text, ce.id::text)
      )) filter (where tf.slug = 'group'),
      0
    ),
    coalesce(sum(ce.people_count), 0)
  into
    v_group_hours,
    v_group_people
  from public.coach_earnings ce
  join public.training_formats tf on tf.id = ce.training_format_id
  left join public.scheduled_workouts sw on sw.id = ce.scheduled_workout_id
  where ce.status = 'main'
    and ce.earned_at::date between a.period_start and a.period_end
    and tf.slug in ('group', 'ds')
    and exists (
      select 1
      from public.coach_profiles cp
      where cp.id = ce.coach_id
        and cp.coach_name = a.coach_handle
    );

  update public.coach_acts
  set
    group_hours = v_group_hours,
    group_people = v_group_people,
    updated_at = now()
  where id = a.id;

  select *
  into v_totals
  from public.calculate_coach_act_totals(a.id);

  update public.coach_acts
  set
    total_hours = v_totals.total_hours,
    total_people = v_totals.total_people,
    total_sum = v_totals.total_sum,
    updated_at = now()
  where id = a.id;
end $$;
