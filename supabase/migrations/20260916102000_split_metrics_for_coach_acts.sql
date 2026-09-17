alter table public.coach_acts
  add column if not exists split_hours numeric,
  add column if not exists split_people numeric;

alter table public.coach_acts
  alter column split_hours set default 0,
  alter column split_people set default 0;

create unique index if not exists idx_tg_workout_messages_telegram_source_unique
  on public.tg_workout_messages (telegram_chat_id, telegram_message_id)
  where nullif(btrim(telegram_chat_id), '') is not null
    and nullif(btrim(telegram_message_id), '') is not null
    and created_at >= timestamptz '2026-09-16 00:00:00+00';

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
  v_split_rate numeric;
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

  select cpr.amount
  into v_split_rate
  from public.coach_payout_rules cpr
  join public.training_formats tf on tf.id = cpr.training_format_id
  where cpr.is_active = true
    and cpr.coach_role = 'main'
    and cpr.rate_type = 'fixed'
    and cpr.currency = 'RUB'
    and tf.slug = 'split'
    and (cpr.main_coach_handle = a.coach_handle or cpr.main_coach_handle is null)
  order by (cpr.main_coach_handle = a.coach_handle) desc
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
  v_split_rate := coalesce(v_split_rate, 2120);
  v_video_no_voice_rate := coalesce(v_video_no_voice_rate, 640);
  v_video_voice_rate := coalesce(v_video_voice_rate, 425);
  v_smm_rate := coalesce(v_smm_rate, 530);
  v_master_rate := coalesce(v_master_rate, 55);
  v_personal_rate := coalesce(v_personal_rate, 1600);

  total_hours :=
    coalesce(a.personal_hours, 0)
    + coalesce(a.group_hours, 0)
    + coalesce(a.split_hours, 0)
    + coalesce(a.video_hours, 0)
    + coalesce(a.video_hours_voice, 0)
    + coalesce(a.smm_hours, 0);

  total_people :=
    coalesce(a.personal_people, 0)
    + coalesce(a.group_people, 0)
    + coalesce(a.split_people, 0)
    + coalesce(a.master_people, 0);

  total_sum := round(
    coalesce(a.personal_people, 0) * v_personal_rate
    + coalesce(a.group_people, 0) * v_group_rate
    + coalesce(a.split_hours, 0) * v_split_rate
    + coalesce(a.video_hours, 0) * v_video_no_voice_rate
    + coalesce(a.video_hours_voice, 0) * v_video_voice_rate
    + coalesce(a.smm_hours, 0) * v_smm_rate
    + coalesce(a.master_people, 0) * v_master_rate,
    0
  );

  return next;
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
  v_split_hours numeric := 0;
  v_split_people numeric := 0;
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

  if a.split_hours is not null then
    with split_messages as (
      select distinct
        case
          when nullif(btrim(tgm.telegram_chat_id), '') is not null
            and nullif(btrim(tgm.telegram_message_id), '') is not null
          then btrim(tgm.telegram_chat_id) || ':' || btrim(tgm.telegram_message_id)
          else tgm.id::text
        end as source_key
      from public.tg_workout_messages tgm
      where tgm.status = 'processed'
        and lower(coalesce(tgm.parsed_payload->>'formatSlug', '')) = 'split'
        and tgm.parsed_payload->>'coachHandle' = a.coach_handle
        and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(tgm.result_payload->'results') = 'array'
              then tgm.result_payload->'results'
              else '[]'::jsonb
            end
          ) as result_item(result)
          where result_item.result->'result'->>'ok' = 'true'
        )
        and tgm.parsed_payload->>'workoutDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and (tgm.parsed_payload->>'workoutDate')::date between a.period_start and a.period_end
    )
    select count(*), count(*) * 2
    into v_split_hours, v_split_people
    from split_messages;
  end if;

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
    split_hours = case when a.split_hours is null then a.split_hours else v_split_hours end,
    split_people = case when a.split_hours is null then a.split_people else v_split_people end,
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
    'split_hours', case when a.split_hours is null then a.split_hours else v_split_hours end,
    'split_people', case when a.split_hours is null then a.split_people else v_split_people end,
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
    return jsonb_build_object('ok', false, 'error', 'previous_act_not_found');
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

  v_group_hours := public.count_act_group_days(v_new_start, v_new_end, s.group_days);
  v_group_people := v_group_hours * coalesce(s.group_people_multiplier, 0);

  if s.has_personal then v_personal := public.random_int_between(s.personal_min, s.personal_max); end if;
  if s.has_video then v_video := public.random_int_between(s.video_min, s.video_max); end if;
  if s.has_video_voice then v_video_voice := public.random_int_between(s.video_voice_min, s.video_voice_max); end if;
  if s.has_smm then v_smm := public.random_int_between(s.smm_min, s.smm_max); end if;
  if s.has_master then v_master := public.random_int_between(s.master_people_min, s.master_people_max); end if;

  insert into public.coach_acts (
    act_number, coach_handle, period_start, period_end, day_signed, status,
    personal_hours, personal_people, group_hours, group_people,
    split_hours, split_people,
    video_hours, video_hours_voice, smm_hours, master_people
  ) values (
    v_act_number, prev.coach_handle, v_new_start, v_new_end, v_day_signed, 'work',
    v_personal, v_personal, v_group_hours, v_group_people,
    0, 0,
    v_video, v_video_voice, v_smm, v_master
  ) returning id into v_new_id;

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
    'split_hours', 0,
    'split_people', 0,
    'total_hours', v_totals.total_hours,
    'total_people', v_totals.total_people,
    'total_sum', v_totals.total_sum
  );
end;
$function$;

create or replace function public.create_workout_accounting_only(
  p_scheduled_workout_id uuid,
  p_include_expenses boolean
)
returns jsonb
language plpgsql
as $function$
declare
  w scheduled_workouts%rowtype;
  c clients%rowtype;
  tf training_formats%rowtype;
  cp coach_profiles%rowtype;
  st studios%rowtype;

  v_client_price numeric := 0;
  v_fx_rate_to_rub numeric := 1;
  v_revenue_rub numeric := 0;

  v_people_count integer := 1;

  v_coach_handle text;
  v_extra_coach_handle text;

  v_place_snapshot text;
  v_format_snapshot text;
  v_client_currency text;

  v_main_rule coach_payout_rules%rowtype;
  v_extra_rule coach_payout_rules%rowtype;
  v_studio_rule studio_cost_rules%rowtype;

  v_main_coach_amount numeric := 0;
  v_extra_coach_amount numeric := 0;
  v_studio_amount numeric := 0;
  v_net_profit numeric := 0;

  v_extra_coach_id uuid;
begin
  select *
  into w
  from scheduled_workouts
  where id = p_scheduled_workout_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'scheduled_workout_not_found');
  end if;

  if exists (
    select 1
    from pnl_entries
    where scheduled_workout_id = w.id
  ) then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_accounted',
      'scheduled_workout_id', w.id
    );
  end if;

  v_people_count := greatest(coalesce(w.people_count, 1), 1);

  select *
  into c
  from clients
  where id = w.client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  select *
  into tf
  from training_formats
  where id = w.training_format_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'training_format_not_found');
  end if;

  if w.coach_id is not null then
    select *
    into cp
    from coach_profiles
    where id = w.coach_id;

    v_coach_handle := cp.coach_name;
  end if;

  if w.studio_id is not null then
    select *
    into st
    from studios
    where id = w.studio_id;

    v_place_snapshot := st.title;
  else
    v_place_snapshot := case
      when w.delivery_type = 'online' then 'Online'
      when w.delivery_type = 'park' then 'Парк'
      else null
    end;
  end if;

  v_format_snapshot := tf.title;
  v_client_currency := upper(coalesce(c.currency, 'RUB'));

  if tf.slug = 'group' then
    v_client_price := coalesce(c.gr_price, 0);
  elsif tf.slug = 'ds' then
    v_client_price := coalesce(c.ds_price, 0);
  elsif tf.slug = 'personal' then
    v_client_price := coalesce(c.pr_price, 0);
  elsif tf.slug = 'split' then
    v_client_price := coalesce(c.sp_price, 0);
  else
    return jsonb_build_object(
      'ok', false,
      'error', 'unknown_training_format',
      'training_format', tf.slug
    );
  end if;

  if v_client_price <= 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'client_price_not_configured',
      'training_format', tf.slug,
      'client_id', c.id
    );
  end if;

  select er.rate_to_rub
  into v_fx_rate_to_rub
  from exchange_rates er
  where er.currency = v_client_currency
    and er.rate_date <= coalesce(w.scheduled_at, now())::date - 1
  order by er.rate_date desc
  limit 1;

  if v_fx_rate_to_rub is null then
    if v_client_currency = 'RUB' then
      v_fx_rate_to_rub := 1;
    else
      return jsonb_build_object(
        'ok', false,
        'error', 'exchange_rate_not_found',
        'currency', v_client_currency
      );
    end if;
  end if;

  v_revenue_rub := round(v_client_price * v_fx_rate_to_rub, 2);

  if p_include_expenses then
    select *
    into v_main_rule
    from coach_payout_rules
    where training_format_id = tf.id
      and coach_role = 'main'
      and is_active = true
      and currency = 'RUB'
      and (main_coach_handle is null or main_coach_handle = v_coach_handle)
    order by case when main_coach_handle = v_coach_handle then 0 else 1 end
    limit 1;

    if v_main_rule.id is not null then
      v_main_coach_amount := case
        when v_main_rule.rate_type = 'per_person'
        then v_main_rule.amount * v_people_count
        else v_main_rule.amount
      end;

      if w.coach_id is not null and v_main_coach_amount > 0 then
        insert into coach_earnings (
          coach_id,
          scheduled_workout_id,
          training_format_id,
          people_count,
          status,
          rate_per_person,
          amount,
          notes,
          earned_at
        )
        values (
          w.coach_id,
          w.id,
          tf.id,
          v_people_count,
          'main',
          case when v_main_rule.rate_type = 'per_person' then v_main_rule.amount else null end,
          v_main_coach_amount,
          'Main coach payout accounting only',
          coalesce(w.scheduled_at, now())
        );
      end if;
    end if;

    select *
    into v_extra_rule
    from coach_payout_rules
    where training_format_id = tf.id
      and coach_role = 'extra'
      and is_active = true
      and currency = 'RUB'
      and main_coach_handle = v_coach_handle
    limit 1;

    if v_extra_rule.id is not null then
      v_extra_coach_handle := v_extra_rule.extra_coach_handle;

      select id
      into v_extra_coach_id
      from coach_profiles
      where coach_name = v_extra_coach_handle
      limit 1;

      v_extra_coach_amount := case
        when v_extra_rule.rate_type = 'per_person'
        then v_extra_rule.amount * v_people_count
        else v_extra_rule.amount
      end;

      if v_extra_coach_id is not null and v_extra_coach_amount > 0 then
        insert into coach_earnings (
          coach_id,
          scheduled_workout_id,
          training_format_id,
          people_count,
          status,
          rate_per_person,
          amount,
          notes,
          earned_at
        )
        values (
          v_extra_coach_id,
          w.id,
          tf.id,
          v_people_count,
          'extra',
          case when v_extra_rule.rate_type = 'per_person' then v_extra_rule.amount else null end,
          v_extra_coach_amount,
          'Extra coach payout accounting only',
          coalesce(w.scheduled_at, now())
        );
      end if;
    end if;

    if w.studio_id is not null then
      select *
      into v_studio_rule
      from studio_cost_rules
      where studio_id = w.studio_id
        and training_format_id = tf.id
        and is_active = true
        and currency = 'RUB'
      limit 1;

      if v_studio_rule.id is not null then
        v_studio_amount := case
          when v_studio_rule.rate_type = 'per_person'
          then v_studio_rule.amount * v_people_count
          else v_studio_rule.amount
        end;

        if v_studio_amount > 0 then
          insert into studio_costs (
            studio_id,
            scheduled_workout_id,
            training_format_id,
            people_count,
            rate_per_person,
            amount,
            notes,
            cost_at
          )
          values (
            w.studio_id,
            w.id,
            tf.id,
            v_people_count,
            case when v_studio_rule.rate_type = 'per_person' then v_studio_rule.amount else null end,
            v_studio_amount,
            'Studio cost accounting only',
            coalesce(w.scheduled_at, now())
          );
        end if;
      end if;
    end if;
  end if;

  v_net_profit :=
    v_revenue_rub
    - v_main_coach_amount
    - v_extra_coach_amount
    - v_studio_amount;

  insert into pnl_entries (
    client_transaction_id,
    scheduled_workout_id,
    client_id,
    coach_id,
    extra_coach_id,
    studio_id,
    training_format_id,
    workout_date,
    coach_handle_snapshot,
    extra_coach_handle_snapshot,
    training_format_snapshot,
    place_snapshot,
    currency,
    client_currency,
    client_price_amount,
    fx_rate_to_rub,
    revenue_amount,
    main_coach_expense_amount,
    extra_coach_expense_amount,
    studio_expense_amount,
    net_profit_amount,
    pnl_date,
    client_name_snapshot,
    notes
  )
  values (
    null,
    w.id,
    c.id,
    w.coach_id,
    v_extra_coach_id,
    w.studio_id,
    tf.id,
    coalesce(w.scheduled_at, now())::date,
    v_coach_handle,
    v_extra_coach_handle,
    v_format_snapshot,
    v_place_snapshot,
    'RUB',
    v_client_currency,
    v_client_price,
    v_fx_rate_to_rub,
    v_revenue_rub,
    v_main_coach_amount,
    v_extra_coach_amount,
    v_studio_amount,
    v_net_profit,
    coalesce(w.scheduled_at, now()),
    c.fio,
    'Accounting only from TG workout import'
  );

  update scheduled_workouts
  set
    charge_status = 'accounting_only',
    charged_at = now(),
    updated_at = now()
  where id = w.id;

  return jsonb_build_object(
    'ok', true,
    'scheduled_workout_id', w.id,
    'client_id', c.id,
    'training_format', tf.slug,
    'people_count', v_people_count,
    'client_price', v_client_price,
    'client_currency', v_client_currency,
    'fx_rate_to_rub', v_fx_rate_to_rub,
    'revenue_rub', v_revenue_rub,
    'main_coach_amount', v_main_coach_amount,
    'extra_coach_amount', v_extra_coach_amount,
    'studio_amount', v_studio_amount,
    'net_profit', v_net_profit,
    'include_expenses', p_include_expenses,
    'mode', 'accounting_only'
  );
end;
$function$;

create or replace function public.create_workout_accounting_only(
  p_scheduled_workout_id uuid
)
returns jsonb
language sql
as $function$
  select public.create_workout_accounting_only(p_scheduled_workout_id, true);
$function$;
