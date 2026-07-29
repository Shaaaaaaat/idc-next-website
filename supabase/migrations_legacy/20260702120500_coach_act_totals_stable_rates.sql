-- Keep calculate_coach_act_totals idempotent after backfills.
-- Do not infer rates from mutable coach_acts.total_sum; read rates from
-- earnings/rules, with document fallback constants centralized in this helper.

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

  -- Document-rate fallbacks live here only. The kapitanstar_coach personal
  -- rate is 2130 in existing PDF rows/historical acts; coach_payout_rules has
  -- no matching 2130 row at the time of this migration.
  if v_personal_rate is null and a.coach_handle = 'kapitanstar_coach' then
    v_personal_rate := 2130;
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

  v_group_rate := coalesce(v_group_rate, 265);
  v_video_no_voice_rate := coalesce(v_video_no_voice_rate, 640);
  v_video_voice_rate := coalesce(v_video_voice_rate, 425);
  v_smm_rate := coalesce(v_smm_rate, 530);
  v_master_rate := coalesce(v_master_rate, 55);
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
