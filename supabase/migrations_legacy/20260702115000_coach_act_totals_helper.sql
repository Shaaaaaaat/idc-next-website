-- Make coach act/application totals use a single source of truth.
-- Every row displayed in coach act/application PDFs is treated as payable.
-- Master-class rows are payable when displayed; for kapitanstar_coach the
-- existing close logic normalizes 110 RUB extra-coach rows into two displayed
-- people at the 55 RUB base displayed master-class rate.

create or replace function public.calculate_coach_act_totals(p_act_id uuid)
returns table (
  total_hours numeric,
  total_people numeric,
  total_sum numeric
)
language plpgsql
as $function$
declare
  a public.coach_acts%rowtype;

  v_group_rate numeric := 265;
  v_personal_rate numeric;
  v_video_no_voice_rate numeric;
  v_video_voice_rate numeric;
  v_smm_rate numeric;
  v_master_rate numeric;
begin
  select *
  into a
  from public.coach_acts
  where id = p_act_id;

  if not found then
    raise exception 'coach_act_not_found: %', p_act_id;
  end if;

  select cpr.amount
  into v_group_rate
  from public.coach_payout_rules cpr
  join public.training_formats tf on tf.id = cpr.training_format_id
  where cpr.is_active = true
    and cpr.coach_role = 'main'
    and cpr.rate_type = 'per_person'
    and tf.slug in ('group', 'ds')
    and (cpr.main_coach_handle = a.coach_handle or cpr.main_coach_handle is null)
  order by (cpr.main_coach_handle = a.coach_handle) desc, tf.slug = 'group' desc
  limit 1;

  v_group_rate := coalesce(v_group_rate, 265);

  select ranked.amount
  into v_video_no_voice_rate
  from (
    select amount, count(*) as rows
    from public.content_earnings
    where coach_handle = a.coach_handle
      and earning_type = 'video_no_voice'
    group by amount
  ) ranked
  order by ranked.rows desc, ranked.amount desc
  limit 1;

  select ranked.amount
  into v_video_voice_rate
  from (
    select amount, count(*) as rows
    from public.content_earnings
    where coach_handle = a.coach_handle
      and earning_type = 'video_voice_extra'
    group by amount
  ) ranked
  order by ranked.rows desc, ranked.amount desc
  limit 1;

  select ranked.amount
  into v_smm_rate
  from (
    select amount, count(*) as rows
    from public.content_earnings
    where coach_handle = a.coach_handle
      and earning_type in ('smm_base', 'smm_info_extra')
    group by amount
  ) ranked
  order by ranked.rows desc, ranked.amount desc
  limit 1;

  select min(cpr.amount)
  into v_master_rate
  from public.coach_payout_rules cpr
  join public.training_formats tf on tf.id = cpr.training_format_id
  where cpr.is_active = true
    and cpr.coach_role = 'extra'
    and cpr.rate_type = 'per_person'
    and cpr.extra_coach_handle = a.coach_handle
    and tf.slug = 'group';

  -- These content/document rates are not represented by a dedicated rate table.
  -- Keep fallback constants centralized here so create/close/PDF/n8n do not
  -- duplicate business logic.
  v_video_no_voice_rate := coalesce(v_video_no_voice_rate, 640);
  v_video_voice_rate := coalesce(v_video_voice_rate, 425);
  v_smm_rate := coalesce(v_smm_rate, 530);
  v_master_rate := coalesce(v_master_rate, 55);

  -- Prefer a historical document rate when it can be inferred from prior
  -- non-zero acts for the same coach. This preserves the PDF-facing rate where
  -- payout rules are absent or do not match already generated documents.
  select avg(
    (
      ca.total_sum
      - coalesce(ca.group_people, 0) * v_group_rate
      - coalesce(ca.video_hours, 0) * v_video_no_voice_rate
      - coalesce(ca.video_hours_voice, 0) * v_video_voice_rate
      - coalesce(ca.smm_hours, 0) * v_smm_rate
      - coalesce(ca.master_people, 0) * v_master_rate
    ) / nullif(ca.personal_people, 0)
  )
  into v_personal_rate
  from public.coach_acts ca
  where ca.coach_handle = a.coach_handle
    and coalesce(ca.personal_people, 0) > 0
    and coalesce(ca.total_sum, 0) > 0;

  if v_personal_rate is null then
    select ce.amount / nullif(ce.people_count, 0)
    into v_personal_rate
    from public.coach_earnings ce
    join public.training_formats tf on tf.id = ce.training_format_id
    join public.coach_profiles cp on cp.id = ce.coach_id
    where cp.coach_name = a.coach_handle
      and ce.status = 'main'
      and tf.slug = 'personal'
      and coalesce(ce.people_count, 0) <> 0
    order by ce.earned_at desc
    limit 1;
  end if;

  if v_personal_rate is null then
    select cpr.amount
    into v_personal_rate
    from public.coach_payout_rules cpr
    join public.training_formats tf on tf.id = cpr.training_format_id
    where cpr.is_active = true
      and cpr.coach_role = 'main'
      and cpr.rate_type = 'fixed'
      and tf.slug = 'personal'
      and (cpr.main_coach_handle = a.coach_handle or cpr.main_coach_handle is null)
    order by (cpr.main_coach_handle = a.coach_handle) desc
    limit 1;
  end if;

  v_personal_rate := coalesce(v_personal_rate, 1600);

  total_hours :=
    coalesce(a.personal_hours, 0)
    + coalesce(a.group_hours, 0)
    + coalesce(a.video_hours, 0)
    + coalesce(a.video_hours_voice, 0)
    + coalesce(a.smm_hours, 0);

  total_people :=
    coalesce(a.personal_people, 0)
    + coalesce(a.group_people, 0)
    + coalesce(a.master_people, 0);

  total_sum := round(
    coalesce(a.personal_people, 0) * v_personal_rate
    + coalesce(a.group_people, 0) * v_group_rate
    + coalesce(a.video_hours, 0) * v_video_no_voice_rate
    + coalesce(a.video_hours_voice, 0) * v_video_voice_rate
    + coalesce(a.smm_hours, 0) * v_smm_rate
    + coalesce(a.master_people, 0) * v_master_rate,
    0
  );

  return next;
end;
$function$;

create or replace function public.create_next_coach_act(p_previous_act_id uuid)
returns jsonb
language plpgsql
as $function$
declare
  prev public.coach_acts%rowtype;
  s public.coach_act_settings%rowtype;

  v_duration integer;
  v_new_start date;
  v_new_end date;
  v_day_signed date;

  v_act_number text;

  v_group_hours integer;
  v_group_people integer;

  v_personal integer := 0;
  v_video integer := 0;
  v_video_voice integer := 0;
  v_smm integer := 0;
  v_master integer := 0;

  v_new_id uuid;
  v_totals record;
begin
  select *
  into prev
  from public.coach_acts
  where id = p_previous_act_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'previous_act_not_found'
    );
  end if;

  select *
  into s
  from public.coach_act_settings
  where coach_handle = prev.coach_handle
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'coach_act_settings_not_found',
      'coach_handle', prev.coach_handle
    );
  end if;

  v_duration := public.random_int_between(18, 23);

  v_new_start := prev.period_end + interval '1 day';
  v_new_end := v_new_start + (v_duration || ' days')::interval;
  v_day_signed := v_new_end + interval '1 day';

  v_act_number := public.next_act_number(prev.act_number);

  v_group_hours := public.count_act_group_days(
    v_new_start,
    v_new_end,
    s.group_days
  );

  v_group_people := v_group_hours * coalesce(s.group_people_multiplier, 0);

  if s.has_personal then
    v_personal := public.random_int_between(s.personal_min, s.personal_max);
  end if;

  if s.has_video then
    v_video := public.random_int_between(s.video_min, s.video_max);
  end if;

  if s.has_video_voice then
    v_video_voice := public.random_int_between(s.video_voice_min, s.video_voice_max);
  end if;

  if s.has_smm then
    v_smm := public.random_int_between(s.smm_min, s.smm_max);
  end if;

  if s.has_master then
    v_master := public.random_int_between(s.master_people_min, s.master_people_max);
  end if;

  insert into public.coach_acts (
    act_number,
    coach_handle,
    period_start,
    period_end,
    day_signed,
    status,

    personal_hours,
    personal_people,

    group_hours,
    group_people,

    video_hours,
    video_hours_voice,
    smm_hours,
    master_people
  )
  values (
    v_act_number,
    prev.coach_handle,
    v_new_start,
    v_new_end,
    v_day_signed,
    'work',

    v_personal,
    v_personal,

    v_group_hours,
    v_group_people,

    v_video,
    v_video_voice,
    v_smm,
    v_master
  )
  returning id into v_new_id;

  select *
  into v_totals
  from public.calculate_coach_act_totals(v_new_id);

  update public.coach_acts
  set
    total_hours = v_totals.total_hours,
    total_people = v_totals.total_people,
    total_sum = v_totals.total_sum,
    updated_at = now()
  where id = v_new_id;

  return jsonb_build_object(
    'ok', true,
    'new_act_id', v_new_id,
    'act_number', v_act_number,
    'coach_handle', prev.coach_handle,
    'period_start', v_new_start,
    'period_end', v_new_end,
    'day_signed', v_day_signed,
    'total_hours', v_totals.total_hours,
    'total_people', v_totals.total_people,
    'total_sum', v_totals.total_sum
  );
end;
$function$;

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

  -- personal
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

  -- group + ds people, group hours only
  select
    coalesce(sum(case when tf.slug = 'group' then 1 else 0 end), 0),
    coalesce(sum(ce.people_count), 0)
  into
    v_group_hours,
    v_group_people
  from public.coach_earnings ce
  join public.training_formats tf on tf.id = ce.training_format_id
  where ce.status = 'main'
    and ce.earned_at::date between a.period_start and a.period_end
    and tf.slug in ('group', 'ds')
    and exists (
      select 1
      from public.coach_profiles cp
      where cp.id = ce.coach_id
        and cp.coach_name = a.coach_handle
    );

  -- content
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

  -- master_people for Dasha as extra coach
  if a.coach_handle = 'kapitanstar_coach' then
    select
      coalesce(sum(
        case
          when p.coach_handle_snapshot = 'dima_dubinin'
            then coalesce(ce.people_count, 1) * 2
          else coalesce(ce.people_count, 1)
        end
      ), 0)
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

with mismatches as (
  select
    ca.id,
    calc.total_hours,
    calc.total_people,
    calc.total_sum
  from public.coach_acts ca
  cross join lateral public.calculate_coach_act_totals(ca.id) calc
  where ca.total_hours is distinct from calc.total_hours
     or ca.total_people is distinct from calc.total_people
     or ca.total_sum is distinct from calc.total_sum
)
update public.coach_acts ca
set
  total_hours = mismatches.total_hours,
  total_people = mismatches.total_people,
  total_sum = mismatches.total_sum,
  updated_at = now()
from mismatches
where ca.id = mismatches.id;
