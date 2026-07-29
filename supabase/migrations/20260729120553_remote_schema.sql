


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."calculate_coach_act_totals"("p_act_id" "uuid") RETURNS TABLE("total_hours" numeric, "total_people" numeric, "total_sum" numeric)
    LANGUAGE "plpgsql"
    AS $$
declare
  a public.coach_acts%rowtype;
  v_group_rate numeric := 265;
  v_personal_rate numeric;
  v_video_no_voice_rate numeric;
  v_video_voice_rate numeric;
  v_smm_rate numeric;
  v_master_rate numeric;
begin
  select * into a from public.coach_acts where id = p_act_id;
  if not found then
    raise exception 'coach_act_not_found: %', p_act_id;
  end if;

  select cpr.amount into v_group_rate
  from public.coach_payout_rules cpr
  join public.training_formats tf on tf.id = cpr.training_format_id
  where cpr.is_active = true
    and cpr.coach_role = 'main'
    and cpr.rate_type = 'per_person'
    and tf.slug in ('group', 'ds')
    and (cpr.main_coach_handle = a.coach_handle or cpr.main_coach_handle is null)
  order by (cpr.main_coach_handle = a.coach_handle) desc, tf.slug = 'group' desc
  limit 1;

  select ranked.amount into v_video_no_voice_rate
  from (
    select amount, count(*) as rows
    from public.content_earnings
    where coach_handle = a.coach_handle and earning_type = 'video_no_voice'
    group by amount
  ) ranked
  order by ranked.rows desc, ranked.amount desc
  limit 1;

  select ranked.amount into v_video_voice_rate
  from (
    select amount, count(*) as rows
    from public.content_earnings
    where coach_handle = a.coach_handle and earning_type = 'video_voice_extra'
    group by amount
  ) ranked
  order by ranked.rows desc, ranked.amount desc
  limit 1;

  select ranked.amount into v_smm_rate
  from (
    select amount, count(*) as rows
    from public.content_earnings
    where coach_handle = a.coach_handle and earning_type in ('smm_base', 'smm_info_extra')
    group by amount
  ) ranked
  order by ranked.rows desc, ranked.amount desc
  limit 1;

  select min(cpr.amount) into v_master_rate
  from public.coach_payout_rules cpr
  join public.training_formats tf on tf.id = cpr.training_format_id
  where cpr.is_active = true
    and cpr.coach_role = 'extra'
    and cpr.rate_type = 'per_person'
    and cpr.extra_coach_handle = a.coach_handle
    and tf.slug = 'group';

  select ce.amount / nullif(ce.people_count, 0) into v_personal_rate
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
    select cpr.amount into v_personal_rate
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

  total_hours := coalesce(a.personal_hours, 0) + coalesce(a.group_hours, 0) + coalesce(a.video_hours, 0) + coalesce(a.video_hours_voice, 0) + coalesce(a.smm_hours, 0);
  total_people := coalesce(a.personal_people, 0) + coalesce(a.group_people, 0) + coalesce(a.master_people, 0);
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
$$;


ALTER FUNCTION "public"."calculate_coach_act_totals"("p_act_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."charge_scheduled_workout"("p_scheduled_workout_id" "uuid", "p_include_expenses" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$declare
  w scheduled_workouts%rowtype;
  c clients%rowtype;
  tf training_formats%rowtype;
  cp coach_profiles%rowtype;
  st studios%rowtype;

  v_client_price numeric := 0;
  v_fx_rate_to_rub numeric := 1;
  v_revenue_rub numeric := 0;

  v_balance_before numeric := 0;
  v_balance_after numeric := 0;

  v_transaction_id uuid;

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

  v_first_fact_after integer;
  v_training_date date;
  v_low_balance_threshold numeric;
  v_balance_threshold text;
  v_trainer_telegram_id text;
begin
  select *
  into w
  from scheduled_workouts
  where id = p_scheduled_workout_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'scheduled_workout_not_found');
  end if;

  v_people_count := coalesce(w.people_count, 1);

  if v_people_count < 1 then
    v_people_count := 1;
  end if;

  if w.charge_status = 'charged' then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_charged',
      'scheduled_workout_id', w.id
    );
  end if;

  if exists (
    select 1
    from client_transactions
    where source_type = 'scheduled_workout'
      and source_id = w.id
  ) then
    update scheduled_workouts
    set
      charge_status = 'charged',
      charged_at = coalesce(charged_at, now()),
      updated_at = now()
    where id = w.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'already_charged_by_transaction',
      'scheduled_workout_id', w.id
    );
  end if;

  select *
  into c
  from clients
  where id = w.client_id
  for update;

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

    v_trainer_telegram_id := coalesce(
      to_jsonb(cp)->>'telegram_id',
      to_jsonb(cp)->>'telegramId',
      to_jsonb(cp)->>'tg_id',
      to_jsonb(cp)->>'tgId',
      to_jsonb(cp)->>'tgid',
      to_jsonb(cp)->>'chat_id',
      to_jsonb(cp)->>'telegram_chat_id',
      to_jsonb(cp)->>'tg_chat_id'
    );
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
      when w.delivery_type = 'open' then 'Open'
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
    and er.rate_date <= current_date - 1
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

  v_balance_before := coalesce(c.balance, 0);
  v_balance_after := v_balance_before - v_client_price;
  v_first_fact_after := coalesce(c.first_fact, 0) + 1;
  v_training_date := coalesce(w.scheduled_at, now())::date;

  insert into client_transactions (
    client_id,
    transaction_type,
    service_type,
    amount,
    balance_delta,
    unit_price,
    quantity,
    currency,
    source_type,
    source_id,
    description,
    occurred_at
  )
  values (
    c.id,
    'workout_charge',
    tf.slug,
    v_client_price,
    -v_client_price,
    v_client_price,
    1,
    v_client_currency,
    'scheduled_workout',
    w.id,
    'Workout charge: ' || tf.slug,
    coalesce(w.scheduled_at, now())
  )
  returning id into v_transaction_id;

  update clients
  set
    balance = v_balance_after,
    last_fact = v_training_date,
    first_fact = coalesce(first_fact, 0) + 1,
    final_day = case
      when lower(coalesce(c.tag, '')) = 'gift_certificate'
        and coalesce(c.first_fact, 0) = 0
        and c.final_day is null
      then
        v_training_date + get_deposit_like_duration_days(c.currency, c.payed) * interval '1 day'
      else clients.final_day
    end,

    gr_gym_f = coalesce(gr_gym_f, 0) + case
      when tf.slug = 'group' and w.delivery_type = 'gym' then 1 else 0 end,

    gr_park_f = coalesce(gr_park_f, 0) + case
      when tf.slug = 'group' and w.delivery_type in ('park', 'open') then 1 else 0 end,

    ds_f = coalesce(ds_f, 0) + case
      when tf.slug = 'ds' then 1 else 0 end,

    pr_gym_f = coalesce(pr_gym_f, 0) + case
      when tf.slug = 'personal' and w.delivery_type = 'gym' then 1 else 0 end,

    pr_park_f = coalesce(pr_park_f, 0) + case
      when tf.slug = 'personal' and w.delivery_type in ('park', 'open') then 1 else 0 end,

    sp_gym_f = coalesce(sp_gym_f, 0) + case
      when tf.slug = 'split' and w.delivery_type = 'gym' then 1 else 0 end,

    sp_park_f = coalesce(sp_park_f, 0) + case
      when tf.slug = 'split' and w.delivery_type in ('park', 'open') then 1 else 0 end,

    updated_at = now()
  where id = c.id;

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
          'Main coach payout',
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
          'Extra coach payout for main coach ' || coalesce(v_coach_handle, ''),
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
            'Studio cost',
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
    v_transaction_id,
    w.id,
    c.id,
    w.coach_id,
    v_extra_coach_id,
    w.studio_id,
    tf.id,
    v_training_date,
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
    case
      when p_include_expenses then 'Auto P&L from scheduled workout'
      else 'Auto P&L from scheduled workout, expenses skipped'
    end
  );

  update scheduled_workouts
  set
    charge_status = 'charged',
    charged_at = now(),
    updated_at = now()
  where id = w.id;

  perform sync_sales_funnel_after_workout_charge(c.id);

  if v_first_fact_after = 1 then
    perform public.enqueue_client_notification_event(
      c.id,
      'first_lesson_followup',
      'client_transactions',
      v_transaction_id::text,
      'client',
      'telegram',
      jsonb_build_object(
        'transaction_id', v_transaction_id,
        'scheduled_workout_id', w.id,
        'training_format', tf.slug,
        'training_date', v_training_date,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'currency', v_client_currency,
        'client_name', c.fio,
        'trainer_name', v_coach_handle
      )
    );
  else
    perform public.enqueue_client_notification_event(
      c.id,
      'attendance_balance_client',
      'client_transactions',
      v_transaction_id::text,
      'client',
      'telegram',
      jsonb_build_object(
        'transaction_id', v_transaction_id,
        'scheduled_workout_id', w.id,
        'training_format', tf.slug,
        'training_date', v_training_date,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'currency', v_client_currency,
        'client_name', c.fio,
        'trainer_name', v_coach_handle
      )
    );

    if v_balance_after = 0 and (c.final_day is null or c.final_day >= current_date) then
      perform public.enqueue_client_notification_event(
        c.id,
        'balance_zero_client',
        'client_transactions',
        v_transaction_id::text,
        'client',
        'telegram',
        jsonb_build_object(
          'transaction_id', v_transaction_id,
          'scheduled_workout_id', w.id,
          'training_format', tf.slug,
          'training_date', v_training_date,
          'balance_before', v_balance_before,
          'balance_after', v_balance_after,
          'currency', v_client_currency,
          'client_name', c.fio,
          'trainer_name', v_coach_handle
        )
      );
    end if;

    if v_balance_before >= 0 and v_balance_after < 0 then
      perform public.enqueue_client_notification_event(
        c.id,
        'balance_negative_client',
        'client_transactions',
        v_transaction_id::text,
        'client',
        'telegram',
        jsonb_build_object(
          'transaction_id', v_transaction_id,
          'scheduled_workout_id', w.id,
          'training_format', tf.slug,
          'training_date', v_training_date,
          'balance_before', v_balance_before,
          'balance_after', v_balance_after,
          'currency', v_client_currency,
          'client_name', c.fio,
          'trainer_name', v_coach_handle
        )
      );
    end if;
  end if;

  v_low_balance_threshold := case
    when v_client_currency = 'RUB' then 1100
    when v_client_currency in ('EUR', 'USD') then 11
    else 11
  end;

  if v_balance_after < -1 then
    v_balance_threshold := 'negative';
  elsif v_balance_after = 0 then
    v_balance_threshold := 'zero';
  elsif v_balance_after < v_low_balance_threshold then
    v_balance_threshold := 'low';
  else
    v_balance_threshold := null;
  end if;

  if v_balance_threshold is not null then
    perform public.enqueue_client_notification_event(
      c.id,
      'balance_threshold_admin',
      'client_transactions',
      v_transaction_id::text,
      'admin',
      'admin_telegram',
      jsonb_build_object(
        'transaction_id', v_transaction_id,
        'scheduled_workout_id', w.id,
        'threshold', v_balance_threshold,
        'training_format', tf.slug,
        'training_date', v_training_date,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'currency', v_client_currency,
        'client_name', c.fio,
        'trainer_name', v_coach_handle
      )
    );

    if tf.slug = 'ds' then
      perform public.enqueue_client_notification_event(
        c.id,
        'balance_threshold_trainer',
        'client_transactions',
        v_transaction_id::text,
        'trainer',
        'telegram',
        jsonb_build_object(
          'transaction_id', v_transaction_id,
          'scheduled_workout_id', w.id,
          'threshold', v_balance_threshold,
          'training_format', tf.slug,
          'training_date', v_training_date,
          'balance_before', v_balance_before,
          'balance_after', v_balance_after,
          'currency', v_client_currency,
          'client_name', c.fio,
          'trainer_name', v_coach_handle,
          'trainer_telegram_id', v_trainer_telegram_id
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'scheduled_workout_id', w.id,
    'client_id', c.id,
    'transaction_id', v_transaction_id,
    'training_format', tf.slug,
    'people_count', v_people_count,
    'include_expenses', p_include_expenses,
    'client_price', v_client_price,
    'client_currency', v_client_currency,
    'fx_rate_to_rub', v_fx_rate_to_rub,
    'revenue_rub', v_revenue_rub,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'first_fact_after', v_first_fact_after,
    'main_coach_amount', v_main_coach_amount,
    'extra_coach_amount', v_extra_coach_amount,
    'studio_amount', v_studio_amount,
    'net_profit', v_net_profit
  );
end;$$;


ALTER FUNCTION "public"."charge_scheduled_workout"("p_scheduled_workout_id" "uuid", "p_include_expenses" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_coach_act"("p_act_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."close_coach_act"("p_act_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."copy_business_expenses_to_month"("p_target_month" "date" DEFAULT ("date_trunc"('month'::"text", (CURRENT_DATE)::timestamp with time zone))::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$declare
  v_source_month date;
  v_inserted_count integer;
begin
  v_source_month := (p_target_month - interval '1 month')::date;

  insert into business_expenses (
    expense_month,
    category,
    title,
    amount,
    currency,
    fx_rate_to_rub,
    amount_rub,
    source,
    notes
  )
  select
    p_target_month,
    be.category,
    be.title,

    case
      when lower(be.title) = 'video_editor'
      then (
        date_part(
          'day',
          date_trunc('month', p_target_month)::date
          + interval '1 month'
          - interval '1 day'
        )::numeric * 1000
      )
      else be.amount
    end as amount,

    be.currency,

    case
      when upper(coalesce(be.currency, 'RUB')) = 'RUB'
      then 1
      else coalesce(er.rate_to_rub, be.fx_rate_to_rub)
    end as fx_rate_to_rub,

    round(
      (
        case
          when lower(be.title) = 'video_editor'
          then (
            date_part(
              'day',
              date_trunc('month', p_target_month)::date
              + interval '1 month'
              - interval '1 day'
            )::numeric * 1000
          )
          else be.amount
        end
      )
      *
      case
        when upper(coalesce(be.currency, 'RUB')) = 'RUB'
        then 1
        else coalesce(er.rate_to_rub, be.fx_rate_to_rub)
      end,
      2
    ) as amount_rub,

    coalesce(be.source, 'monthly_copy'),
    be.notes

  from business_expenses be

  left join lateral (
    select rate_to_rub
    from exchange_rates er
    where er.currency = upper(coalesce(be.currency, 'RUB'))
      and er.rate_date <= p_target_month - 1
    order by er.rate_date desc
    limit 1
  ) er on true

  where be.expense_month::date = v_source_month
    and not exists (
      select 1
      from business_expenses existing
      where existing.expense_month::date = p_target_month
        and existing.category = be.category
        and existing.title = be.title
    );

  get diagnostics v_inserted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'source_month', v_source_month,
    'target_month', p_target_month,
    'inserted_count', v_inserted_count
  );
end;$$;


ALTER FUNCTION "public"."copy_business_expenses_to_month"("p_target_month" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_act_group_days"("p_start" "date", "p_end" "date", "p_group_days" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  d date;
  v_count integer := 0;
  v_dow integer;
begin
  d := p_start;

  while d <= p_end loop
    v_dow := extract(dow from d);

    if p_group_days = 'mon_to_sat' then
      if v_dow between 1 and 6 then
        v_count := v_count + 1;
      end if;
    elsif p_group_days = 'mon_wed_sat' then
      if v_dow in (1, 3, 6) then
        v_count := v_count + 1;
      end if;
    end if;

    d := d + interval '1 day';
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."count_act_group_days"("p_start" "date", "p_end" "date", "p_group_days" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_client_workout_diff"("p_coach_email" "text", "p_client_id" "uuid", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."create_client_workout_diff"("p_coach_email" "text", "p_client_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_client_write_off"("p_client_id" "uuid", "p_amount" numeric DEFAULT NULL::numeric, "p_write_off_date" "date" DEFAULT CURRENT_DATE, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  c clients%rowtype;

  v_amount_client_currency numeric;
  v_balance_before numeric;
  v_balance_after numeric;

  v_currency text;
  v_fx_rate_to_rub numeric := 1;
  v_amount_rub numeric;

  v_transaction_id uuid;
  v_source_id uuid := gen_random_uuid();
begin
  select *
  into c
  from clients
  where id = p_client_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  v_currency := upper(coalesce(c.currency, 'RUB'));
  v_balance_before := coalesce(c.balance, 0);

  v_amount_client_currency := coalesce(p_amount, v_balance_before);

  if v_amount_client_currency <= 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'nothing_to_write_off',
      'balance', v_balance_before
    );
  end if;

  select er.rate_to_rub
  into v_fx_rate_to_rub
  from exchange_rates er
  where er.currency = v_currency
    and er.rate_date <= p_write_off_date - 1
  order by er.rate_date desc
  limit 1;

  if v_fx_rate_to_rub is null then
    if v_currency = 'RUB' then
      v_fx_rate_to_rub := 1;
    else
      return jsonb_build_object(
        'ok', false,
        'error', 'exchange_rate_not_found',
        'currency', v_currency
      );
    end if;
  end if;

  v_amount_rub := round(v_amount_client_currency * v_fx_rate_to_rub, 2);
  v_balance_after := v_balance_before - v_amount_client_currency;

  insert into client_transactions (
    client_id,
    transaction_type,
    service_type,
    amount,
    balance_delta,
    unit_price,
    quantity,
    currency,
    source_type,
    source_id,
    description,
    occurred_at
  )
  values (
    c.id,
    'write_off',
    'write_off',
    v_amount_client_currency,
    -v_amount_client_currency,
    v_amount_client_currency,
    1,
    v_currency,
    'write_off',
    v_source_id,
    coalesce(p_notes, 'Expired balance write-off'),
    p_write_off_date::timestamptz
  )
  returning id into v_transaction_id;

  update clients
  set
    balance = v_balance_after,
    status = 'pass',
    is_active = false,
    updated_at = now()
  where id = c.id;

  insert into pnl_entries (
    entry_type,
    client_transaction_id,
    client_id,
    workout_date,
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
    'write_off',
    v_transaction_id,
    c.id,
    p_write_off_date,
    'RUB',
    v_currency,
    v_amount_client_currency,
    v_fx_rate_to_rub,
    v_amount_rub,
    0,
    0,
    0,
    v_amount_rub,
    p_write_off_date::timestamptz,
    c.fio,
    coalesce(p_notes, 'Expired balance write-off')
  );

  perform sync_sales_funnel_after_write_off(c.id);

  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_client',
    'client_transactions',
    v_transaction_id::text,
    'client',
    'telegram',
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'source_id', v_source_id,
      'write_off_date', p_write_off_date,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'amount_client_currency', v_amount_client_currency,
      'currency', v_currency
    )
  );

  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_admin',
    'client_transactions',
    v_transaction_id::text,
    'admin',
    'admin_telegram',
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'source_id', v_source_id,
      'write_off_date', p_write_off_date,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'amount_client_currency', v_amount_client_currency,
      'currency', v_currency
    )
  );

  return jsonb_build_object(
    'ok', true,
    'client_id', c.id,
    'transaction_id', v_transaction_id,
    'source_id', v_source_id,
    'amount_client_currency', v_amount_client_currency,
    'currency', v_currency,
    'fx_rate_to_rub', v_fx_rate_to_rub,
    'amount_rub', v_amount_rub,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after
  );
end;
$$;


ALTER FUNCTION "public"."create_client_write_off"("p_client_id" "uuid", "p_amount" numeric, "p_write_off_date" "date", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_next_coach_act"("p_previous_act_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
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
  select * into prev from public.coach_acts where id = p_previous_act_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'previous_act_not_found');
  end if;

  select * into s
  from public.coach_act_settings
  where coach_handle = prev.coach_handle and is_active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'coach_act_settings_not_found', 'coach_handle', prev.coach_handle);
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
    video_hours, video_hours_voice, smm_hours, master_people
  ) values (
    v_act_number, prev.coach_handle, v_new_start, v_new_end, v_day_signed, 'work',
    v_personal, v_personal, v_group_hours, v_group_people,
    v_video, v_video_voice, v_smm, v_master
  ) returning id into v_new_id;

  select * into v_totals from public.calculate_coach_act_totals(v_new_id);

  update public.coach_acts
  set total_hours = v_totals.total_hours,
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
$$;


ALTER FUNCTION "public"."create_next_coach_act"("p_previous_act_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_scheduled_workout"("p_client_id" "uuid", "p_coach_handle" "text", "p_workout_date" "date", "p_training_format_slug" "text", "p_delivery_type" "text", "p_studio_slug" "text" DEFAULT NULL::"text", "p_title" "text" DEFAULT NULL::"text", "p_people_count" integer DEFAULT 1, "p_auto_charge" boolean DEFAULT true, "p_include_expenses" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_coach_id uuid;
  v_format_id uuid;
  v_studio_id uuid;
  v_workout_id uuid;
  v_charge_result jsonb;
begin
  select id
  into v_coach_id
  from coach_profiles
  where coach_name = p_coach_handle
  limit 1;

  if v_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'coach_not_found', 'coach', p_coach_handle);
  end if;

  select id
  into v_format_id
  from training_formats
  where slug = lower(p_training_format_slug)
  limit 1;

  if v_format_id is null then
    return jsonb_build_object('ok', false, 'error', 'training_format_not_found', 'format', p_training_format_slug);
  end if;

  if lower(p_delivery_type) = 'gym' then
    select id
    into v_studio_id
    from studios
    where slug = p_studio_slug
    limit 1;

    if v_studio_id is null then
      return jsonb_build_object('ok', false, 'error', 'studio_not_found', 'studio_slug', p_studio_slug);
    end if;
  end if;

  insert into scheduled_workouts (
    client_id,
    coach_id,
    studio_id,
    scheduled_at,
    delivery_type,
    training_format_id,
    title,
    status,
    charge_status,
    people_count
  )
  values (
    p_client_id,
    v_coach_id,
    v_studio_id,
    p_workout_date::timestamptz,
    lower(p_delivery_type),
    v_format_id,
    p_title,
    'completed',
    'pending',
    greatest(coalesce(p_people_count, 1), 1)
  )
  returning id into v_workout_id;

  if p_auto_charge then
    select charge_scheduled_workout(v_workout_id, p_include_expenses)
    into v_charge_result;
  else
    v_charge_result := jsonb_build_object('ok', true, 'status', 'not_charged');
  end if;

  return jsonb_build_object(
    'ok', true,
    'scheduled_workout_id', v_workout_id,
    'charge_result', v_charge_result
  );
end;
$$;


ALTER FUNCTION "public"."create_scheduled_workout"("p_client_id" "uuid", "p_coach_handle" "text", "p_workout_date" "date", "p_training_format_slug" "text", "p_delivery_type" "text", "p_studio_slug" "text", "p_title" "text", "p_people_count" integer, "p_auto_charge" boolean, "p_include_expenses" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_workout_accounting_only"("p_scheduled_workout_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
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
    'mode', 'accounting_only'
  );
end;
$$;


ALTER FUNCTION "public"."create_workout_accounting_only"("p_scheduled_workout_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_client_notification_event"("p_client_id" "uuid", "p_event_type" "text", "p_source_table" "text" DEFAULT NULL::"text", "p_source_id" "text" DEFAULT NULL::"text", "p_recipient_type" "text" DEFAULT 'client'::"text", "p_channel" "text" DEFAULT 'telegram'::"text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'net', 'vault'
    AS $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload_hash text;
  v_event_id uuid;
  v_event_status text;
  v_request_id bigint;
  v_function_url text;
  v_secret text;
begin
  v_payload_hash := encode(
    digest(
      coalesce(p_event_type, '') || '|' ||
      coalesce(p_source_table, '') || '|' ||
      coalesce(p_source_id, '') || '|' ||
      coalesce(p_recipient_type, '') || '|' ||
      coalesce(p_channel, '') || '|' ||
      v_payload::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.client_notification_events (
    client_id,
    event_type,
    source_table,
    source_id,
    recipient_type,
    channel,
    status,
    payload_hash,
    payload,
    attempt_count,
    next_attempt_at
  )
  values (
    p_client_id,
    p_event_type,
    p_source_table,
    p_source_id,
    p_recipient_type,
    p_channel,
    'pending',
    v_payload_hash,
    v_payload,
    0,
    now()
  )
  on conflict (
    event_type,
    coalesce(source_table, ''),
    coalesce(source_id, ''),
    recipient_type,
    channel,
    payload_hash
  )
  do update
  set
    updated_at = now(),
    next_attempt_at = case
      when client_notification_events.status in ('sent', 'skipped', 'failed')
        then client_notification_events.next_attempt_at
      else now()
    end
  returning id, status into v_event_id, v_event_status;

  if v_event_status in ('sent', 'skipped', 'failed') then
    return v_event_id;
  end if;

  begin
    select decrypted_secret
    into v_function_url
    from vault.decrypted_secrets
    where name = 'CLIENT_NOTIFICATIONS_ENGINE_URL'
    limit 1;

    select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
    where name = 'NOTIFICATIONS_INTERNAL_SECRET'
    limit 1;

    if v_function_url is null or v_secret is null then
      update public.client_notification_events
      set
        status = 'failed',
        error_code = 'notification_config_missing',
        error_message = 'CLIENT_NOTIFICATIONS_ENGINE_URL or NOTIFICATIONS_INTERNAL_SECRET is missing',
        updated_at = now()
      where id = v_event_id
        and status not in ('sent', 'skipped', 'failed');

      raise warning 'notification Edge Function config missing in Vault for event %', v_event_id;
      return v_event_id;
    end if;

    select net.http_post(
      url := v_function_url,
      body := jsonb_build_object('eventId', v_event_id),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-notifications-secret', v_secret
      ),
      timeout_milliseconds := 20000
    )
    into v_request_id;

  exception
    when others then
      update public.client_notification_events
      set
        status = 'failed',
        error_code = 'notification_edge_invoke_failed',
        error_message = left(sqlerrm, 500),
        updated_at = now()
      where id = v_event_id
        and status not in ('sent', 'skipped', 'failed');

      raise warning 'notification edge invoke failed for event %, error: %', v_event_id, sqlerrm;
  end;

  return v_event_id;

exception
  when others then
    raise warning 'enqueue_client_notification_event failed: %', sqlerrm;
    return null;
end;
$$;


ALTER FUNCTION "public"."enqueue_client_notification_event"("p_client_id" "uuid", "p_event_type" "text", "p_source_table" "text", "p_source_id" "text", "p_recipient_type" "text", "p_channel" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_client_notification_event"("p_client_id" "uuid", "p_event_type" "text", "p_source_table" "text", "p_source_id" "text", "p_recipient_type" "text", "p_channel" "text", "p_payload" "jsonb") IS 'Creates an idempotent client notification outbox event. Must not break business operations if enqueue fails.';



CREATE OR REPLACE FUNCTION "public"."find_sales_funnel_by_client_or_contacts"("p_client_id" "uuid" DEFAULT NULL::"uuid", "p_email" "text" DEFAULT NULL::"text", "p_tgid" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_id uuid;
begin
  if p_client_id is not null then
    select id into v_id
    from sales_funnel
    where client_id = p_client_id
    limit 1;
  end if;

  if v_id is null and nullif(trim(coalesce(p_email, '')), '') is not null then
    select id into v_id
    from sales_funnel
    where lower(email) = lower(trim(p_email))
    limit 1;
  end if;

  if v_id is null and nullif(trim(coalesce(p_tgid, '')), '') is not null then
    select id into v_id
    from sales_funnel
    where tgid = trim(p_tgid)
    limit 1;
  end if;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."find_sales_funnel_by_client_or_contacts"("p_client_id" "uuid", "p_email" "text", "p_tgid" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fio_soft_match"("p_left" "text", "p_right" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  with
  left_tokens as (
    select lower(trim(x)) as token
    from regexp_split_to_table(coalesce(p_left, ''), '\s+') x
    where trim(x) <> ''
  ),
  right_tokens as (
    select lower(trim(x)) as token
    from regexp_split_to_table(coalesce(p_right, ''), '\s+') x
    where trim(x) <> ''
  ),
  counts as (
    select
      (select count(*) from left_tokens) as left_count,
      (select count(*) from right_tokens) as right_count
  )
  select
    lower(trim(coalesce(p_left, ''))) = lower(trim(coalesce(p_right, '')))
    or (
      (select left_count from counts) >= 2
      and (select right_count from counts) >= 2
      and not exists (
        select 1
        from left_tokens lt
        where length(lt.token) < 2
           or not exists (
             select 1
             from right_tokens rt
             where rt.token like lt.token || '%'
                or lt.token like rt.token || '%'
           )
      )
    );
$$;


ALTER FUNCTION "public"."fio_soft_match"("p_left" "text", "p_right" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_student_metrics_report"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with base as (
    select
      tag,
      coalesce(first_fact, 0) as first_fact,
      last_fact
    from public.clients
    where is_active is true
  ),
  active_students as (
    select *
    from base
    where last_fact >= current_date - 21
      and first_fact >= 2
  ),
  passed_trial as (
    select *
    from base
    where last_fact >= current_date - 21
      and first_fact = 1
  ),
  bought_trial as (
    select *
    from base
    where first_fact = 0
  )
  select jsonb_build_object(
    'active_total', (select count(*) from active_students),
    'active_online', (
      select count(*)
      from active_students
      where coalesce(tag, '') ilike '%ds%'
    ),
    'active_offline', (
      select count(*)
      from active_students
      where coalesce(tag, '') not ilike '%ds%'
    ),
    'classic', (
      select count(*)
      from active_students
      where coalesce(tag, '') ilike '%ds%'
        and coalesce(tag, '') ilike '%classic%'
    ),
    'light', (
      select count(*)
      from active_students
      where coalesce(tag, '') ilike '%ds%'
        and coalesce(tag, '') ilike '%light%'
    ),
    'pullups', (
      select count(*)
      from active_students
      where coalesce(tag, '') ilike '%ds%'
        and coalesce(tag, '') ilike '%pullups%'
    ),
    'handstand', (
      select count(*)
      from active_students
      where coalesce(tag, '') ilike '%ds%'
        and coalesce(tag, '') ilike '%handstand%'
    ),
    'trial_passed', (select count(*) from passed_trial),
    'trial_bought', (select count(*) from bought_trial),
    'trial_bought_online', (
      select count(*)
      from bought_trial
      where coalesce(tag, '') ilike '%ds%'
    ),
    'trial_bought_offline', (
      select count(*)
      from bought_trial
      where coalesce(tag, '') not ilike '%ds%'
    )
  );
$$;


ALTER FUNCTION "public"."get_daily_student_metrics_report"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_deposit_like_duration_days"("p_currency" "text", "p_amount" numeric) RETURNS integer
    LANGUAGE "sql"
    AS $$
  select case
    when upper(coalesce(p_currency, 'RUB')) = 'EUR'
      then case when coalesce(p_amount, 0) < 110 then 33 else 61 end
    when upper(coalesce(p_currency, 'RUB')) = 'USD'
      then case when coalesce(p_amount, 0) < 135 then 33 else 61 end
    else
      case when coalesce(p_amount, 0) < 10000 then 33 else 61 end
  end;
$$;


ALTER FUNCTION "public"."get_deposit_like_duration_days"("p_currency" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_program_template_workouts_to_client_calendar"("p_coach_email" "text", "p_client_id" "uuid", "p_program_template_id" "uuid", "p_start_date" "date" DEFAULT NULL::"date", "p_template_workout_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_workout_dates" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."import_program_template_workouts_to_client_calendar"("p_coach_email" "text", "p_client_id" "uuid", "p_program_template_id" "uuid", "p_start_date" "date", "p_template_workout_ids" "uuid"[], "p_workout_dates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_purchase_by_tg_token"("p_token" "text", "p_tgid" "text", "p_username" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  p purchases%rowtype;
begin
  select *
  into p
  from purchases
  where tg_link_token = trim(p_token)
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'purchase_not_found'
    );
  end if;

  update purchases
  set
    tgid = trim(p_tgid),
    telegram_username = p_username,
    tg_matched_at = now(),

    status = case
      when lower(status) = 'paid' then 'matched'
      else status
    end,

    updated_at = now()
  where id = p.id;

  update clients
  set
    tgid = trim(p_tgid),
    updated_at = now()
  where (
    lower(coalesce(email, '')) = lower(coalesce(p.email, ''))
    or (
      p.email is null
      and lower(coalesce(fio, '')) = lower(coalesce(p.fi, ''))
    )
  )
  and (
    tgid is null
    or trim(tgid) = ''
  );

  return jsonb_build_object(
    'ok', true,
    'purchase_id', p.id,
    'status', 'matched'
  );
end;
$$;


ALTER FUNCTION "public"."match_purchase_by_tg_token"("p_token" "text", "p_tgid" "text", "p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_act_number"("p_act_number" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $_$
declare
  v_base text;
  v_num integer;
begin
  v_base := regexp_replace(p_act_number, '-[0-9]+$', '');
  v_num := coalesce((regexp_match(p_act_number, '-([0-9]+)$'))[1]::integer, 0);

  return v_base || '-' || (v_num + 1)::text;
end;
$_$;


ALTER FUNCTION "public"."next_act_number"("p_act_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_expired_clients_daily"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  r record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_processed integer := 0;
begin
  for r in
    select
      id,
      fio,
      final_day,
      balance
    from clients
    where final_day < current_date
      and balance > 0
      and is_active = true
    order by final_day
  loop
    v_result := create_client_write_off(
      r.id,
      null,
      current_date,
      'Auto write-off expired subscription'
    );

    v_results := v_results || jsonb_build_object(
      'client_id', r.id,
      'fio', r.fio,
      'final_day', r.final_day,
      'balance_before', r.balance,
      'result', v_result
    );

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'results', v_results
  );
end;
$$;


ALTER FUNCTION "public"."process_expired_clients_daily"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_instagram_post"("p_post_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  p instagram_posts%rowtype;

  v_text text;
  v_earning_date date;

  v_created integer := 0;
begin
  select *
  into p
  from instagram_posts
  where id = p_post_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'post_not_found'
    );
  end if;

  if p.processed = true then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_processed'
    );
  end if;

  v_text := lower(coalesce(p.post_text, ''));
  v_earning_date := p.created_at::date;

  -- =====================================
  -- ДАША / kapitanstar_coach
  -- #taranishina = видео без голоса
  -- #voice = надбавка за голос
  -- =====================================

  if v_text like '%#taranishina%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'kapitanstar_coach',
      'video_no_voice',
      640,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  if v_text like '%#voice%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'kapitanstar_coach',
      'video_voice_extra',
      425,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  -- =====================================
  -- КАТЯ / e_katrin_al
  -- каждый ролик = 530
  -- #info = +530
  -- #alekseeva = снялась в видео +640
  -- =====================================

  insert into content_earnings (
    instagram_post_id,
    coach_handle,
    earning_type,
    amount,
    earning_date
  )
  values (
    p.id,
    'e_katrin_al',
    'smm_base',
    530,
    v_earning_date
  );

  v_created := v_created + 1;

  if v_text like '%#info%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'e_katrin_al',
      'smm_info_extra',
      530,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  if v_text like '%#alekseeva%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'e_katrin_al',
      'video_no_voice',
      640,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  -- =====================================
  -- ДИМА / dima_dubinin
  -- =====================================

  if v_text like '%#dubinin%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'dima_dubinin',
      'video_no_voice',
      640,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  -- =====================================
  -- ИВАН / fitfrol
  -- =====================================

  if v_text like '%#frolov%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'fitfrol',
      'video_no_voice',
      640,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  -- =====================================
  -- ГЕОРГИЙ / Gshakhnazarov
  -- =====================================

  if v_text like '%#gshakhnazarov%' or v_text like '%#shakhnazarov%' then
    insert into content_earnings (
      instagram_post_id,
      coach_handle,
      earning_type,
      amount,
      earning_date
    )
    values (
      p.id,
      'Gshakhnazarov',
      'video_no_voice',
      640,
      v_earning_date
    );

    v_created := v_created + 1;
  end if;

  update instagram_posts
  set processed = true
  where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'post_id', p.id,
    'earnings_created', v_created
  );
end;
$$;


ALTER FUNCTION "public"."process_instagram_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_lead_raw"("p_raw_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  r leads_raw%rowtype;
  v_lead_id uuid;
begin
  select *
  into r
  from leads_raw
  where id = p_raw_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'raw_lead_not_found');
  end if;

  -- Ищем существующий чистый lead: email → tgid → phone
  if nullif(trim(coalesce(r.email, '')), '') is not null then
    select id into v_lead_id
    from leads
    where lower(email) = lower(trim(r.email))
    limit 1;
  end if;

  if v_lead_id is null and nullif(trim(coalesce(r.tgid, '')), '') is not null then
    select id into v_lead_id
    from leads
    where tgid = trim(r.tgid)
    limit 1;
  end if;

  if v_lead_id is null and nullif(trim(coalesce(r.phone, '')), '') is not null then
    select id into v_lead_id
    from leads
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g')
        = regexp_replace(coalesce(r.phone, ''), '\D', '', 'g')
    limit 1;
  end if;

  if v_lead_id is null then
    insert into leads (
      fio,
      created_time,
      tgid,
      phone,
      email,
      city,
      studio,
      product,
      source,
      first_seen_at,
      last_seen_at,
      first_source,
      last_source,
      submissions_count,
      last_raw_lead_id,
      status
    )
    values (
      nullif(trim(coalesce(r.fio, '')), ''),
      coalesce(r.created_time, now()),
      nullif(trim(coalesce(r.tgid, '')), ''),
      nullif(trim(coalesce(r.phone, '')), ''),
      lower(nullif(trim(coalesce(r.email, '')), '')),
      nullif(trim(coalesce(r.city, '')), ''),
      nullif(trim(coalesce(r.studio, '')), ''),
      nullif(trim(coalesce(r.product, '')), ''),
      nullif(trim(coalesce(r.source, '')), ''),
      coalesce(r.created_time, now()),
      coalesce(r.created_time, now()),
      nullif(trim(coalesce(r.source, '')), ''),
      nullif(trim(coalesce(r.source, '')), ''),
      1,
      r.id,
      'new'
    )
    returning id into v_lead_id;
  else
    update leads
    set
      fio = coalesce(nullif(trim(coalesce(r.fio, '')), ''), leads.fio),
      tgid = coalesce(nullif(trim(coalesce(r.tgid, '')), ''), leads.tgid),
      phone = coalesce(nullif(trim(coalesce(r.phone, '')), ''), leads.phone),
      email = coalesce(lower(nullif(trim(coalesce(r.email, '')), '')), leads.email),
      city = coalesce(nullif(trim(coalesce(r.city, '')), ''), leads.city),
      studio = coalesce(nullif(trim(coalesce(r.studio, '')), ''), leads.studio),
      product = coalesce(nullif(trim(coalesce(r.product, '')), ''), leads.product),
      last_source = coalesce(nullif(trim(coalesce(r.source, '')), ''), leads.last_source),
      last_seen_at = coalesce(r.created_time, now()),
      submissions_count = coalesce(leads.submissions_count, 0) + 1,
      last_raw_lead_id = r.id,
      updated_at = now()
    where id = v_lead_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'lead_id', v_lead_id,
    'raw_lead_id', r.id
  );
end;
$$;


ALTER FUNCTION "public"."process_lead_raw"("p_raw_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_paid_purchase"("p_purchase_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$declare
  p purchases%rowtype;

  v_client_id uuid;
  v_existing_client clients%rowtype;

  v_email text;
  v_tgid text;
  v_fio text;
  v_fio_exists integer;

  v_currency text;
  v_format text;
  v_course text;
  v_course_key text;
  v_plan_tag text;

  v_sum numeric;
  v_lessons numeric;
  v_price numeric;

  v_start_day date;
  v_final_day date;
  v_future_plan date;

  v_is_gift boolean;
  v_is_deposit boolean;
  v_is_gift_certificate boolean;
  v_is_balance_only boolean;

  v_coach text;
  v_old_tag text;
  v_client_tag text;
  v_suffix text;

  v_base_ds numeric;
  v_base_gr numeric := 1500;
  v_base_pr numeric := 4900;
  v_base_sp numeric := 6600;

  v_service_type text;
  v_coach_id uuid;
begin
  select *
  into p
  from purchases
  where id = p_purchase_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if lower(coalesce(p.status, '')) not in ('paid', 'matched') then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_paid');
  end if;

  if exists (
    select 1
    from client_transactions
    where source_type = 'purchase'
      and source_id = p_purchase_id
  ) then
    return jsonb_build_object('ok', true, 'status', 'already_processed');
  end if;

  v_email := lower(nullif(trim(coalesce(p.email, '')), ''));
  v_tgid := nullif(trim(coalesce(p.tgid, '')), '');
  v_currency := upper(coalesce(nullif(trim(p.currency), ''), 'RUB'));
  v_format := lower(coalesce(nullif(trim(p.format), ''), ''));
  v_course := coalesce(nullif(trim(p.course_name), ''), '');
  v_course_key := lower(v_course);
  v_plan_tag := lower(coalesce(nullif(trim(p.tag), ''), ''));

  v_sum := coalesce(p.sum, 0);
  v_lessons := coalesce(p.lessons, 0);

  if v_lessons > 0 then
    v_price := round(v_sum / v_lessons, 2);
  else
    v_price := coalesce(p.price_per_lesson, 0);
  end if;

  v_is_gift := nullif(trim(coalesce(p.gift_recipient, '')), '') is not null;
  v_is_deposit := v_plan_tag = 'deposit';
  v_is_gift_certificate := v_plan_tag = 'gift_certificate';
  v_is_balance_only := v_is_deposit or v_is_gift_certificate;

  if v_is_gift then
    v_fio := nullif(trim(p.gift_recipient), '');
  else
    v_fio := nullif(trim(coalesce(p.fi, '')), '');
  end if;

  if v_fio is null then
    v_fio := coalesce(v_email, v_tgid, 'Без имени');
  end if;

  if v_currency = 'EUR' then
    v_base_ds := 11;
  elsif v_currency = 'USD' then
    v_base_ds := 12;
  else
    v_base_ds := 1100;
  end if;

  if v_course_key like '%spi%' or v_course_key like '%hkc%' then
    v_base_gr := 1400;
  else
    v_base_gr := 1500;
  end if;

  v_start_day := coalesce(p.created_time, now())::date;

  if v_plan_tag in ('short1', 'short12') then
    v_final_day := v_start_day + interval '33 days';

  elsif v_plan_tag = 'long12' then
    v_final_day := v_start_day + interval '61 days';

  elsif v_plan_tag = 'long36' then
    v_final_day := v_start_day + interval '131 days';

  elsif v_is_deposit then
    v_final_day :=
      v_start_day
      + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day';

  elsif v_is_gift_certificate then
    v_final_day := null;

  else
    v_final_day := null;
  end if;

  if p.slot_start_at is not null then
    v_future_plan := p.slot_start_at::date;
  elsif v_format = 'ds' then
    v_future_plan := v_start_day + interval '7 days';
  else
    v_future_plan := null;
  end if;

if v_tgid is not null then
  select *
  into v_existing_client
  from clients
  where tgid = v_tgid
  limit 1;
end if;

if v_existing_client.id is null and v_email is not null then
  select *
  into v_existing_client
  from clients
  where lower(email) = v_email
  limit 1;
end if;


  v_client_id := v_existing_client.id;
  if v_existing_client.id is not null
   and nullif(trim(coalesce(v_existing_client.fio, '')), '') is not null then
  v_fio := v_existing_client.fio;
end if;

  if v_client_id is null then
    select count(*)
    into v_fio_exists
    from clients
    where lower(trim(fio)) = lower(trim(v_fio));

    if v_fio_exists > 0 and v_email is not null then
      v_fio := v_fio || ' ' || v_email;
    end if;
  end if;

  v_old_tag := lower(coalesce(v_existing_client.tag, ''));

  if v_existing_client.id is not null and v_old_tag <> '' then
    if v_old_tag like '%alekseeva%' then v_coach := 'e_katrin_al';
    elsif v_old_tag like '%taranishina%' then v_coach := 'kapitanstar_coach';
    elsif v_old_tag like '%frolov%' then v_coach := 'fitfrol';
    elsif v_old_tag like '%gubanov%' then v_coach := 'Lokatororator';
    elsif v_old_tag like '%dubinin%' then v_coach := 'dima_dubinin';
    elsif v_old_tag like '%shakhnazarov%' then v_coach := 'Gshakhnazarov';
    elsif v_old_tag like '%spi%' then v_coach := 'fitfrol';
    elsif v_old_tag like '%hkc%' then v_coach := 'dima_dubinin';
    elsif v_old_tag like '%ycg%' then v_coach := 'Lokatororator';
    elsif v_old_tag like '%elf%' then v_coach := 'Lokatororator';
    elsif v_old_tag like '%gfg%' then v_coach := 'Gshakhnazarov';
    end if;
  end if;

  if v_coach is null then
    if v_course_key like '%spi%' then v_coach := 'fitfrol';
    elsif v_course_key like '%hkc%' then v_coach := 'dima_dubinin';
    elsif v_course_key like '%ycg%' then v_coach := 'Lokatororator';
    elsif v_course_key like '%elf%' then v_coach := 'Lokatororator';
    elsif v_course_key like '%gfg%' then v_coach := 'Gshakhnazarov';
    elsif v_format = 'ds' and v_course_key like '%pullups%' then v_coach := 'e_katrin_al';
    elsif v_format = 'ds' and v_course_key like '%classic%' then v_coach := 'e_katrin_al';
    elsif v_format = 'ds' and v_course_key like '%crossfit%' then v_coach := 'kapitanstar_coach';
    elsif v_format = 'ds' and v_course_key like '%light%' then v_coach := 'e_katrin_al';
    elsif v_format = 'ds' and v_course_key like '%handstand%' then v_coach := 'dima_dubinin';
    end if;
  end if;

  if v_is_gift_certificate then
    v_client_tag := 'gift_certificate';
  elsif v_is_deposit then
    v_client_tag := coalesce(nullif(trim(coalesce(v_existing_client.tag, '')), ''), 'deposit');
  else
    v_client_tag := v_course;

    if v_format = 'ds' and v_coach is not null then
      if v_coach = 'kapitanstar_coach' then v_suffix := 'taranishina';
      elsif v_coach = 'e_katrin_al' then v_suffix := 'alekseeva';
      elsif v_coach = 'dima_dubinin' then v_suffix := 'dubinin';
      elsif v_coach = 'Lokatororator' then v_suffix := 'gubanov';
      elsif v_coach = 'fitfrol' then v_suffix := 'frolov';
      elsif v_coach = 'Gshakhnazarov' then v_suffix := 'gshakhnazarov';
      end if;

      if v_suffix is not null and lower(v_client_tag) not like '%' || lower(v_suffix) then
        v_client_tag := v_client_tag || '_' || v_suffix;
      end if;
    end if;
  end if;

  if v_is_gift_certificate then
    v_service_type := 'gift_certificate';
  elsif v_is_deposit then
    v_service_type := 'deposit';
  elsif v_format = 'ds' then
    v_service_type := 'ds';
  elsif v_format = 'gym' and v_course_key like '%group%' then
    v_service_type := 'group';
  elsif v_format = 'gym' and v_course_key like '%personal%' then
    v_service_type := 'personal';
  elsif v_format = 'gym' and v_course_key like '%split%' then
    v_service_type := 'split';
  else
    v_service_type := v_format;
  end if;

  if v_client_id is null then
    insert into clients (
      fio, coach, freeze_option, future_plan, start_day, final_day,
      payed, balance, ds_price, gr_price, pr_price, sp_price,
      email, tgid, currency, tag, first_fact, old_prices, gender, lk_enabled, status, is_active
    )
    values (
      v_fio, v_coach, v_plan_tag in ('short1', 'short12'), v_future_plan,
      v_start_day, v_final_day, v_sum, v_sum,
      case when v_service_type = 'ds' and not v_is_balance_only then v_price else v_base_ds end,
      case when v_service_type = 'group' and not v_is_balance_only then v_price else v_base_gr end,
      case when v_service_type = 'personal' and not v_is_balance_only then v_price else v_base_pr end,
      case when v_service_type = 'split' and not v_is_balance_only then v_price else v_base_sp end,
      v_email, v_tgid, v_currency, v_client_tag, 0, false, null, true, 'active', true
    )
    returning id into v_client_id;
  else
    update clients
    set
      fio = coalesce(clients.fio, v_fio),
      coach = clients.coach,
      freeze_option = v_plan_tag in ('short1', 'short12'),
      future_plan = coalesce(v_future_plan, clients.future_plan),
      start_day = v_start_day,
      final_day = case
  when v_is_deposit then
    coalesce(clients.final_day, v_start_day)
    + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day'

  when v_is_gift_certificate then
    clients.final_day

  else
    coalesce(v_final_day, clients.final_day)
end,
      payed = coalesce(clients.payed, 0) + v_sum,
      balance = coalesce(clients.balance, 0) + v_sum,
      ds_price = case
        when v_service_type = 'ds' and not v_is_balance_only then v_price
        when coalesce(clients.ds_price, 0) = 0 then v_base_ds
        else clients.ds_price
      end,
      gr_price = case
        when v_service_type = 'group' and not v_is_balance_only then v_price
        when coalesce(clients.gr_price, 0) = 0 then v_base_gr
        else clients.gr_price
      end,
      pr_price = case
        when v_service_type = 'personal' and not v_is_balance_only then v_price
        when coalesce(clients.pr_price, 0) = 0 then v_base_pr
        else clients.pr_price
      end,
      sp_price = case
        when v_service_type = 'split' and not v_is_balance_only then v_price
        when coalesce(clients.sp_price, 0) = 0 then v_base_sp
        else clients.sp_price
      end,
      email = coalesce(v_email, clients.email),
      tgid = coalesce(v_tgid, clients.tgid),
      currency = v_currency,
      tag = v_client_tag,
      lk_enabled = true,
      status = 'active',
      is_active = true,
      updated_at = now()
    where id = v_client_id;
  end if;

  perform public.sync_client_coach_link(v_client_id);

  insert into client_transactions (
    client_id, transaction_type, service_type, amount, balance_delta,
    unit_price, quantity, currency, source_type, source_id, description, occurred_at
  )
  values (
    v_client_id, 'purchase', v_service_type, v_sum, v_sum,
    case when v_lessons > 0 then v_price else null end,
    case when v_lessons > 0 then v_lessons else 1 end,
    v_currency, 'purchase', p_purchase_id,
    'Purchase: ' || coalesce(v_course, v_service_type),
    coalesce(p.created_time, now())
  );

  if v_existing_client.id is null and v_coach is not null then
    select id
    into v_coach_id
    from coach_profiles
    where coach_name = v_coach
    limit 1;

    if v_coach_id is not null then
      insert into coach_clients (coach_id, client_id, is_active)
      values (v_coach_id, v_client_id, true)
      on conflict (coach_id, client_id)
      do update set
        is_active = true,
        updated_at = now();
    end if;
  end if;

  perform sync_sales_funnel_after_purchase(v_client_id, v_sum);

  update purchases
  set
    price_per_lesson = case when v_lessons > 0 then v_price else price_per_lesson end,
    processed_at = now(),
    processed_client_id = v_client_id,
    updated_at = now()
  where id = p_purchase_id;

  return jsonb_build_object(
    'ok', true,
    'client_id', v_client_id,
    'coach', v_coach,
    'service_type', v_service_type,
    'balance_delta', v_sum,
    'final_day', v_final_day,
    'tag', v_client_tag
  );
end;$$;


ALTER FUNCTION "public"."process_paid_purchase"("p_purchase_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_workout_message_accounting_only"("p_raw_text" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$declare
  v_normalized text;
  v_left text;
  v_clients_text text;
  v_parts text[];

  v_coach_handle text;
  v_date_raw text;
  v_workout_date date;
  v_format_slug text;
  v_place_code text;

  v_delivery_type text;
  v_studio_slug text;

  v_client_raw text;
  v_client_name text;
  v_count integer;

  v_client_id uuid;
  v_client_matches integer;

  v_result jsonb;
  v_workout_id uuid;
  v_accounting_result jsonb;

  v_results jsonb := '[]'::jsonb;
  v_unmatched jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  v_normalized := regexp_replace(trim(p_raw_text), '\s+', ' ', 'g');

  if position('//' in v_normalized) > 0 then
    v_left := trim(split_part(v_normalized, '//', 1));
    v_clients_text := trim(split_part(v_normalized, '//', 2));

    v_parts := regexp_split_to_array(v_left, '\s*/\s*');

    if array_length(v_parts, 1) < 3 then
      return jsonb_build_object('ok', false, 'error', 'invalid_message_format');
    end if;

    v_coach_handle := trim(v_parts[1]);
    v_date_raw := trim(v_parts[2]);
    v_format_slug := lower(trim(v_parts[3]));
    v_place_code := null;
  else
    v_parts := regexp_split_to_array(v_normalized, '\s*/\s*');

    if array_length(v_parts, 1) < 5 then
      return jsonb_build_object('ok', false, 'error', 'invalid_message_format');
    end if;

    v_coach_handle := trim(v_parts[1]);
    v_date_raw := trim(v_parts[2]);
    v_format_slug := lower(trim(v_parts[3]));
    v_place_code := lower(trim(v_parts[4]));
    v_clients_text := trim(v_parts[5]);
  end if;

  v_workout_date := to_date(extract(year from current_date)::text || '.' || v_date_raw, 'YYYY.DD.MM');

  if v_format_slug = 'ds' then
    v_delivery_type := 'online';
    v_studio_slug := null;
  elsif v_place_code in ('open', 'опен', 'park', 'парк') then
  v_delivery_type := 'open';
  v_studio_slug := null;
  else
    v_delivery_type := 'gym';

    v_studio_slug := case v_place_code
      when 'elfit' then 'msk-oktyabrskaya'
      when 'october' then 'msk-oktyabrskaya'
      when 'ycg' then 'msk-ulitsa-1905-goda'
      when 'youcan' then 'msk-ulitsa-1905-goda'
      when 'spi' then 'spb-moskovskie-vorota'
      when 'spirit' then 'spb-moskovskie-vorota'
      when 'hkc' then 'spb-vyborgskaya'
      when 'hellskitchen' then 'spb-vyborgskaya'
      else null
    end;

    if v_studio_slug is null then
      return jsonb_build_object(
        'ok', false,
        'error', 'unknown_studio',
        'place_code', v_place_code
      );
    end if;
  end if;

  for v_client_raw in
    select trim(x)
    from regexp_split_to_table(v_clients_text, ',') x
    where trim(x) <> ''
  loop
    begin
      v_count := 1;
      v_client_name := v_client_raw;

      if v_client_raw ~* '^\d+x\s+' then
        v_count := split_part(v_client_raw, 'x', 1)::integer;
        v_client_name := trim(regexp_replace(v_client_raw, '^\d+x\s+', '', 'i'));
      end if;

      for i in 1..greatest(v_count, 1) loop
        select count(*)
        into v_client_matches
        from clients
        where fio ilike v_client_name;

        if v_client_matches = 1 then
          select id
          into v_client_id
          from clients
          where fio ilike v_client_name
          limit 1;
        else
          select count(*)
          into v_client_matches
          from clients
          where fio ilike '%' || v_client_name || '%';

          if v_client_matches = 1 then
            select id
            into v_client_id
            from clients
            where fio ilike '%' || v_client_name || '%'
            limit 1;
          else
            v_unmatched := v_unmatched || jsonb_build_array(
              jsonb_build_object(
                'fio', v_client_name,
                'error', case
                  when v_client_matches = 0 then 'client_not_found'
                  else 'multiple_clients_found'
                end
              )
            );
            continue;
          end if;
        end if;

        select create_scheduled_workout(
          p_client_id := v_client_id,
          p_coach_handle := v_coach_handle,
          p_workout_date := v_workout_date,
          p_training_format_slug := v_format_slug,
          p_delivery_type := v_delivery_type,
          p_studio_slug := v_studio_slug,
          p_title := 'Accounting only import: ' || left(p_raw_text, 80),
          p_people_count := 1,
          p_auto_charge := false
        )
        into v_result;

        if coalesce((v_result->>'ok')::boolean, false) = false then
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object(
              'fio', v_client_name,
              'error', v_result
            )
          );
          continue;
        end if;

        v_workout_id := (v_result->>'scheduled_workout_id')::uuid;

        select create_workout_accounting_only(v_workout_id)
        into v_accounting_result;

        if coalesce((v_accounting_result->>'ok')::boolean, false) = false then
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object(
              'fio', v_client_name,
              'error', v_accounting_result
            )
          );
          continue;
        end if;

        v_results := v_results || jsonb_build_array(
          jsonb_build_object(
            'fio', v_client_name,
            'client_id', v_client_id,
            'scheduled_workout_id', v_workout_id,
            'accounting_result', v_accounting_result
          )
        );
      end loop;

    exception when others then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'fio', v_client_raw,
          'error', sqlerrm
        )
      );
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mode', 'accounting_only',
    'coach', v_coach_handle,
    'date', v_workout_date,
    'format', v_format_slug,
    'results', v_results,
    'unmatched', v_unmatched,
    'errors', v_errors
  );
end;$$;


ALTER FUNCTION "public"."process_workout_message_accounting_only"("p_raw_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."random_int_between"("p_min" integer, "p_max" integer) RETURNS integer
    LANGUAGE "sql"
    AS $$
  select case
    when p_max <= p_min then p_min
    else floor(random() * (p_max - p_min + 1) + p_min)::integer
  end;
$$;


ALTER FUNCTION "public"."random_int_between"("p_min" integer, "p_max" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reliability_monitor_cron_job_status"() RETURNS TABLE("jobname" "text", "schedule" "text", "active" boolean, "job_exists" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'cron'
    AS $$
  with expected(jobname) as (
    values
      ('process-coach-acts-daily'::text),
      ('process-expired-clients-daily'::text),
      ('update_exchange_rates_daily'::text)
  )
  select
    expected.jobname,
    cron.job.schedule,
    cron.job.active,
    cron.job.jobid is not null as job_exists
  from expected
  left join cron.job
    on cron.job.jobname = expected.jobname
  order by expected.jobname;
$$;


ALTER FUNCTION "public"."reliability_monitor_cron_job_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reliability_monitor_pg_net_failure_summary"("p_since" timestamp with time zone, "p_limit" integer DEFAULT 10) RETURNS TABLE("failure_count" bigint, "sample_ids" bigint[], "sample_status_codes" integer[], "sample_errors" "text"[])
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
    AS $$
  with failures as (
    select
      id,
      status_code,
      timed_out,
      left(coalesce(error_msg, ''), 300) as safe_error_msg,
      created
    from net._http_response
    where created >= p_since
      and (
        coalesce(status_code, 0) >= 400
        or timed_out is true
        or error_msg is not null
      )
    order by created desc
  ),
  limited as (
    select *
    from failures
    limit greatest(least(coalesce(p_limit, 10), 50), 0)
  )
  select
    (select count(*) from failures) as failure_count,
    coalesce(array_agg(id order by created desc), '{}'::bigint[]) as sample_ids,
    coalesce(array_agg(status_code order by created desc), '{}'::integer[]) as sample_status_codes,
    coalesce(array_agg(
      nullif(
        concat_ws(
          ' ',
          case when timed_out then 'timed_out' else null end,
          safe_error_msg
        ),
        ''
      )
      order by created desc
    ), '{}'::text[]) as sample_errors
  from limited;
$$;


ALTER FUNCTION "public"."reliability_monitor_pg_net_failure_summary"("p_since" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_client_write_off"("p_client_id" "uuid", "p_new_final_day" "date", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  c clients%rowtype;

  v_write_off_tx client_transactions%rowtype;
  v_write_off_pnl pnl_entries%rowtype;

  v_reversal_tx_id uuid;
  v_reversal_pnl_id uuid;

  v_amount numeric;
  v_currency text;
  v_fx_rate numeric;
  v_amount_rub numeric;

  v_balance_before numeric;
  v_balance_after numeric;
begin
  select *
  into c
  from clients
  where id = p_client_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'client_not_found'
    );
  end if;

  select *
  into v_write_off_tx
  from client_transactions
  where client_id = p_client_id
    and transaction_type = 'write_off'
    and reversed_at is null
  order by occurred_at desc, created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'active_write_off_not_found'
    );
  end if;

  select *
  into v_write_off_pnl
  from pnl_entries
  where client_transaction_id = v_write_off_tx.id
    and entry_type = 'write_off'
    and reversed_at is null
  order by pnl_date desc, created_at desc
  limit 1;

  v_amount := coalesce(v_write_off_tx.amount, 0);
  v_currency := upper(coalesce(v_write_off_tx.currency, c.currency, 'RUB'));
  v_fx_rate := coalesce(v_write_off_pnl.fx_rate_to_rub, 1);
  v_amount_rub := round(v_amount * v_fx_rate, 2);

  if v_amount <= 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'invalid_write_off_amount',
      'transaction_id', v_write_off_tx.id
    );
  end if;

  v_balance_before := coalesce(c.balance, 0);
  v_balance_after := v_balance_before + v_amount;

  -- Помечаем исходный write_off как reversed
  update client_transactions
  set
    reversed_at = now(),
    reversal_reason = coalesce(p_notes, 'Write-off reversed')
  where id = v_write_off_tx.id;

  if v_write_off_pnl.id is not null then
    update pnl_entries
    set reversed_at = now()
    where id = v_write_off_pnl.id;
  end if;

  -- Создаём reversal transaction
  insert into client_transactions (
    client_id,
    transaction_type,
    service_type,
    amount,
    balance_delta,
    unit_price,
    quantity,
    currency,
    source_type,
    source_id,
    description,
    occurred_at,
    reversal_of_transaction_id,
    reversal_reason
  )
  values (
    c.id,
    'write_off_reversal',
    'write_off_reversal',
    v_amount,
    v_amount,
    v_amount,
    1,
    v_currency,
    'write_off_reversal',
    v_write_off_tx.id,
    coalesce(p_notes, 'Write-off reversal'),
    now(),
    v_write_off_tx.id,
    coalesce(p_notes, 'Write-off reversal')
  )
  returning id into v_reversal_tx_id;

  -- Возвращаем клиента в active
  update clients
  set
    balance = v_balance_after,
    final_day = p_new_final_day,
    status = 'active',
    is_active = true,
    updated_at = now()
  where id = c.id;

  -- Создаём отрицательную P&L строку, чтобы monthly_pnl пересчитался
  insert into pnl_entries (
    entry_type,
    client_transaction_id,
    client_id,
    workout_date,
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
    notes,
    reversal_of_pnl_entry_id
  )
  values (
    'write_off_reversal',
    v_reversal_tx_id,
    c.id,
    current_date,
    'RUB',
    v_currency,
    -v_amount,
    v_fx_rate,
    -v_amount_rub,
    0,
    0,
    0,
    -v_amount_rub,
    now(),
    coalesce(p_notes, 'Write-off reversal'),
    v_write_off_pnl.id
  )
  returning id into v_reversal_pnl_id;

  return jsonb_build_object(
    'ok', true,
    'client_id', c.id,
    'write_off_transaction_id', v_write_off_tx.id,
    'reversal_transaction_id', v_reversal_tx_id,
    'reversal_pnl_id', v_reversal_pnl_id,
    'amount_restored', v_amount,
    'currency', v_currency,
    'amount_rub_reversed', v_amount_rub,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'new_final_day', p_new_final_day
  );
end;
$$;


ALTER FUNCTION "public"."reverse_client_write_off"("p_client_id" "uuid", "p_new_final_day" "date", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_client_workout_diff"("p_workout_id" "uuid", "p_coach_email" "text", "p_client_id" "uuid", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."save_client_workout_diff"("p_workout_id" "uuid", "p_coach_email" "text", "p_client_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_program_template_diff"("p_program_id" "uuid", "p_coach_email" "text", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_coach_id uuid;
  v_access_level text;
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

  select id, coalesce(access_level, 'coach')
    into v_coach_id, v_access_level
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;

  if v_coach_id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_program_id::text));

  select * into v_template
  from public.program_templates
  where id = p_program_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_template.coach_id = v_coach_id then
    null;
  elsif coalesce(v_access_level, 'coach') = 'head_coach' then
    null;
  elsif v_template.coach_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'forbidden',
      'message', 'Only head coach can edit global program templates'
    );
  else
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

  if p_payload ? 'durationDays' and nullif(p_payload->>'durationDays', '') is not null and not ((p_payload->>'durationDays') ~ v_int_pattern) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Duration days must be an integer');
  end if;

  v_duration_days := coalesce(v_template.duration_days, 1);
  if p_payload ? 'durationDays' then
    v_duration_days := greatest(1, coalesce(nullif(p_payload->>'durationDays', '')::integer, 1));
  end if;

  if p_payload ? 'weeksCount' and nullif(p_payload->>'weeksCount', '') is not null and not ((p_payload->>'weeksCount') ~ v_int_pattern) then
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
      if coalesce(jsonb_typeof(v_workout->'groups'), '') <> 'array' or coalesce(jsonb_typeof(v_workout->'exercises'), '') <> 'array' then
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
        perform 1 from public.program_template_workouts
        where id = v_workout_payload_id and program_template_id = p_program_id;
        if not found then
          return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Workout does not belong to program');
        end if;
      end if;

      v_groups := case when jsonb_typeof(v_workout->'groups') = 'array' then v_workout->'groups' else '[]'::jsonb end;

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

          perform 1 from public.program_template_exercise_groups
          where id = v_group_payload_id and program_template_workout_id = v_workout_payload_id;
          if not found then
            return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Exercise group does not belong to workout');
          end if;

          v_group_ids := v_group_ids || jsonb_build_object(v_group_payload_id::text, v_group_payload_id::text);
        end if;

        if v_group_ref is not null then
          v_group_ids := v_group_ids || jsonb_build_object(v_group_ref, coalesce(v_group_payload_id::text, v_group_ref));
        end if;
      end loop;

      v_exercises := case when jsonb_typeof(v_workout->'exercises') = 'array' then v_workout->'exercises' else '[]'::jsonb end;

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

          perform 1 from public.program_template_exercises
          where id = v_exercise_payload_id and program_template_workout_id = v_workout_payload_id;
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
  set title = v_title,
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
        insert into public.program_template_workouts (program_template_id, day_number, week_number, title, summary, estimated_minutes, workout_type, sort_order)
        values (p_program_id, v_day_number, v_week_number, coalesce(nullif(trim(coalesce(v_workout->>'title', '')), ''), 'Day ' || v_day_number), nullif(trim(coalesce(v_workout->>'summary', '')), ''), v_estimated_minutes, nullif(trim(coalesce(v_workout->>'workoutType', '')), ''), v_sort_order)
        returning id into v_workout_id;
      else
        update public.program_template_workouts
        set day_number = v_day_number,
            week_number = v_week_number,
            title = coalesce(nullif(trim(coalesce(v_workout->>'title', '')), ''), 'Day ' || v_day_number),
            summary = nullif(trim(coalesce(v_workout->>'summary', '')), ''),
            estimated_minutes = v_estimated_minutes,
            workout_type = nullif(trim(coalesce(v_workout->>'workoutType', '')), ''),
            sort_order = v_sort_order,
            updated_at = v_now
        where id = v_workout_payload_id and program_template_id = p_program_id
        returning id into v_workout_id;

        if v_workout_id is null then
          raise exception 'Workout does not belong to program';
        end if;
      end if;

      v_seen_workout_ids := array_append(v_seen_workout_ids, v_workout_id);
      v_group_ids := '{}'::jsonb;
      v_seen_group_ids := array[]::uuid[];
      v_seen_exercise_ids := array[]::uuid[];

      v_groups := case when jsonb_typeof(v_workout->'groups') = 'array' then v_workout->'groups' else '[]'::jsonb end;
      v_group_index := 0;

      for v_group in select value from jsonb_array_elements(v_groups)
      loop
        v_group_payload_id := nullif(v_group->>'id', '')::uuid;
        v_group_ref := nullif(coalesce(v_group->>'draftId', v_group->>'id', ''), '');

        if v_group_payload_id is null then
          insert into public.program_template_exercise_groups (program_template_workout_id, title, sets, rest, notes, sort_order)
          values (v_workout_id, coalesce(nullif(trim(coalesce(v_group->>'title', '')), ''), 'Комбо ' || (v_group_index + 1)), nullif(trim(coalesce(v_group->>'sets', '')), ''), nullif(trim(coalesce(v_group->>'rest', '')), ''), nullif(trim(coalesce(v_group->>'notes', '')), ''), coalesce(nullif(v_group->>'sortOrder', '')::integer, v_group_index))
          returning id into v_group_id;
        else
          update public.program_template_exercise_groups
          set title = coalesce(nullif(trim(coalesce(v_group->>'title', '')), ''), 'Комбо ' || (v_group_index + 1)),
              sets = nullif(trim(coalesce(v_group->>'sets', '')), ''),
              rest = nullif(trim(coalesce(v_group->>'rest', '')), ''),
              notes = nullif(trim(coalesce(v_group->>'notes', '')), ''),
              sort_order = coalesce(nullif(v_group->>'sortOrder', '')::integer, v_group_index),
              updated_at = v_now
          where id = v_group_payload_id and program_template_workout_id = v_workout_id
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

      v_exercises := case when jsonb_typeof(v_workout->'exercises') = 'array' then v_workout->'exercises' else '[]'::jsonb end;
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
          insert into public.program_template_exercises (program_template_workout_id, exercise_group_id, exercise_id, exercise_title, sets, reps, rest, tempo, notes, sort_order)
          values (v_workout_id, v_group_fk, nullif(v_exercise->>'exerciseId', '')::uuid, v_exercise_title, case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end, nullif(trim(coalesce(v_exercise->>'reps', '')), ''), case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end, nullif(trim(coalesce(v_exercise->>'tempo', '')), ''), nullif(trim(coalesce(v_exercise->>'notes', '')), ''), coalesce(nullif(v_exercise->>'sortOrder', '')::integer, v_exercise_index))
          returning id into v_exercise_id;
        else
          update public.program_template_exercises
          set exercise_group_id = v_group_fk,
              exercise_id = nullif(v_exercise->>'exerciseId', '')::uuid,
              exercise_title = v_exercise_title,
              sets = case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'sets', '')), '') else null end,
              reps = nullif(trim(coalesce(v_exercise->>'reps', '')), ''),
              rest = case when v_group_fk is null then nullif(trim(coalesce(v_exercise->>'rest', '')), '') else null end,
              tempo = nullif(trim(coalesce(v_exercise->>'tempo', '')), ''),
              notes = nullif(trim(coalesce(v_exercise->>'notes', '')), ''),
              sort_order = coalesce(nullif(v_exercise->>'sortOrder', '')::integer, v_exercise_index),
              updated_at = v_now
          where id = v_exercise_payload_id and program_template_workout_id = v_workout_id
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
        and (array_length(v_seen_exercise_ids, 1) is null or not (id = any(v_seen_exercise_ids)));

      delete from public.program_template_exercise_groups
      where program_template_workout_id = v_workout_id
        and (array_length(v_seen_group_ids, 1) is null or not (id = any(v_seen_group_ids)));

      v_workout_index := v_workout_index + 1;
    end loop;

    delete from public.program_template_workouts
    where program_template_id = p_program_id
      and (array_length(v_seen_workout_ids, 1) is null or not (id = any(v_seen_workout_ids)));
  end if;

  return jsonb_build_object('ok', true, 'programId', p_program_id, 'updatedAt', v_now);
end;
$_$;


ALTER FUNCTION "public"."save_program_template_diff"("p_program_id" "uuid", "p_coach_email" "text", "p_expected_updated_at" timestamp with time zone, "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_client_coach_link"("p_client_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_client public.clients%rowtype;
  v_coach_handle text;
  v_coach_id uuid;
  v_deactivated_count integer := 0;
begin
  select *
    into v_client
  from public.clients
  where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  v_coach_handle := nullif(trim(coalesce(v_client.coach, '')), '');

  if v_coach_handle is null or v_coach_handle ilike '%wr_off%' then
    update public.coach_clients
    set
      is_active = false,
      updated_at = now()
    where client_id = p_client_id
      and is_active = true;

    get diagnostics v_deactivated_count = row_count;

    return jsonb_build_object(
      'ok', true,
      'action', 'deactivated',
      'reason', case when v_coach_handle is null then 'empty_coach' else 'wr_off' end,
      'deactivated_count', v_deactivated_count
    );
  end if;

  select id
    into v_coach_id
  from public.coach_profiles
  where lower(coach_name) = lower(v_coach_handle)
    and is_active = true
  order by created_at
  limit 1;

  if v_coach_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'coach_profile_not_found',
      'coach', v_coach_handle
    );
  end if;

  update public.coach_clients
  set
    is_active = false,
    updated_at = now()
  where client_id = p_client_id
    and coach_id <> v_coach_id
    and is_active = true;

  get diagnostics v_deactivated_count = row_count;

  insert into public.coach_clients (
    coach_id,
    client_id,
    is_active,
    created_at,
    updated_at
  )
  values (
    v_coach_id,
    p_client_id,
    true,
    now(),
    now()
  )
  on conflict (coach_id, client_id)
  do update
  set
    is_active = true,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'action', 'linked',
    'coach_id', v_coach_id,
    'coach', v_coach_handle,
    'deactivated_count', v_deactivated_count
  );
end;
$$;


ALTER FUNCTION "public"."sync_client_coach_link"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_client_coach_link_on_clients_coach_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  if tg_op = 'INSERT' or old.coach is distinct from new.coach then
    v_result := public.sync_client_coach_link(new.id);

    if coalesce(v_result->>'ok', 'false') <> 'true' then
      raise notice 'sync_client_coach_link skipped for client %, result: %', new.id, v_result;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_client_coach_link_on_clients_coach_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_sales_funnel_after_purchase"("p_client_id" "uuid", "p_amount" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  c clients%rowtype;
  v_sales_id uuid;
  sf sales_funnel%rowtype;

  v_old_status text;
  v_new_status text;
begin
  select *
  into c
  from clients
  where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  v_sales_id := find_sales_funnel_by_client_or_contacts(
    p_client_id,
    c.email,
    c.tgid
  );

  if v_sales_id is null then
    insert into sales_funnel (
      client_id,
      fio,
      email,
      tgid,
      coach_handle,
      product,
      first_try_status,
      funnel_status,
      first_payment_at,
      last_payment_at,
      payments_count,
      total_revenue,
      source
    )
    values (
      c.id,
      c.fio,
      lower(c.email),
      c.tgid,
      c.coach,
      c.tag,
      'Waiting 1',
      'Waiting 1',
      now(),
      now(),
      1,
      coalesce(p_amount, 0),
      'purchase'
    )
    returning id into v_sales_id;

    insert into sales_funnel_events (
      sales_funnel_id,
      client_id,
      event_type,
      new_first_try_status,
      new_funnel_status,
      amount,
      source,
      notes
    )
    values (
      v_sales_id,
      c.id,
      'purchase_created_funnel',
      'Waiting 1',
      'Waiting 1',
      coalesce(p_amount, 0),
      'purchase',
      'Created sales funnel after first purchase'
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'created',
      'sales_funnel_id', v_sales_id
    );
  end if;

  select *
  into sf
  from sales_funnel
  where id = v_sales_id
  for update;

  v_old_status := sf.funnel_status;

  v_new_status := case
    when coalesce(sf.funnel_status, '') = 'Pass' then 'Active'
    else sf.funnel_status
  end;

  update sales_funnel
  set
    client_id = coalesce(sales_funnel.client_id, c.id),
    fio = coalesce(sales_funnel.fio, c.fio),
    email = coalesce(sales_funnel.email, lower(c.email)),
    tgid = coalesce(sales_funnel.tgid, c.tgid),
    coach_handle = coalesce(c.coach, sales_funnel.coach_handle),
    product = coalesce(c.tag, sales_funnel.product),
    funnel_status = v_new_status,
    last_payment_at = now(),
    payments_count = coalesce(payments_count, 0) + 1,
    total_revenue = coalesce(total_revenue, 0) + coalesce(p_amount, 0),
    updated_at = now(),
    last_status_changed_at = case
      when v_new_status is distinct from v_old_status then now()
      else last_status_changed_at
    end
  where id = v_sales_id;

  insert into sales_funnel_events (
    sales_funnel_id,
    client_id,
    event_type,
    old_funnel_status,
    new_funnel_status,
    amount,
    source,
    notes
  )
  values (
    v_sales_id,
    c.id,
    'purchase',
    v_old_status,
    v_new_status,
    coalesce(p_amount, 0),
    'purchase',
    'Synced sales funnel after purchase'
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'updated',
    'sales_funnel_id', v_sales_id,
    'old_status', v_old_status,
    'new_status', v_new_status
  );
end;
$$;


ALTER FUNCTION "public"."sync_sales_funnel_after_purchase"("p_client_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_sales_funnel_after_workout_charge"("p_client_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  c clients%rowtype;
  v_sales_id uuid;
  sf sales_funnel%rowtype;
begin
  select *
  into c
  from clients
  where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  v_sales_id := find_sales_funnel_by_client_or_contacts(
    p_client_id,
    c.email,
    c.tgid
  );

  if v_sales_id is null then
    return jsonb_build_object('ok', false, 'status', 'sales_funnel_not_found');
  end if;

  select *
  into sf
  from sales_funnel
  where id = v_sales_id
  for update;

  if coalesce(sf.first_try_status, '') = 'Waiting 1' then
    update sales_funnel
    set
      client_id = coalesce(client_id, c.id),
      first_try_status = 'Done',
      funnel_status = case
        when funnel_status = 'Waiting 1' then 'Waiting 2'
        else funnel_status
      end,
      first_try_done_at = now(),
      last_workout_at = now(),
      workouts_count = coalesce(workouts_count, 0) + 1,
      updated_at = now(),
      last_status_changed_at = now()
    where id = v_sales_id;

    insert into sales_funnel_events (
      sales_funnel_id,
      client_id,
      event_type,
      old_first_try_status,
      new_first_try_status,
      old_funnel_status,
      new_funnel_status,
      source,
      notes
    )
    values (
      v_sales_id,
      c.id,
      'first_try_done',
      sf.first_try_status,
      'Done',
      sf.funnel_status,
      case
        when sf.funnel_status = 'Waiting 1' then 'Waiting 2'
        else sf.funnel_status
      end,
      'workout_charge',
      'Auto synced after first successful workout charge'
    );

    return jsonb_build_object('ok', true, 'status', 'first_try_done');
  end if;

  update sales_funnel
  set
    client_id = coalesce(client_id, c.id),
    last_workout_at = now(),
    workouts_count = coalesce(workouts_count, 0) + 1,
    updated_at = now()
  where id = v_sales_id;

  return jsonb_build_object('ok', true, 'status', 'workout_count_updated');
end;
$$;


ALTER FUNCTION "public"."sync_sales_funnel_after_workout_charge"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_sales_funnel_after_write_off"("p_client_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  c clients%rowtype;
  v_sales_id uuid;
  sf sales_funnel%rowtype;
begin
  select *
  into c
  from clients
  where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  v_sales_id := find_sales_funnel_by_client_or_contacts(
    p_client_id,
    c.email,
    c.tgid
  );

  if v_sales_id is null then
    return jsonb_build_object('ok', false, 'status', 'sales_funnel_not_found');
  end if;

  select *
  into sf
  from sales_funnel
  where id = v_sales_id
  for update;

  update sales_funnel
  set
    client_id = coalesce(client_id, c.id),
    funnel_status = 'Pass',
    updated_at = now(),
    last_status_changed_at = now()
  where id = v_sales_id;

  insert into sales_funnel_events (
    sales_funnel_id,
    client_id,
    event_type,
    old_funnel_status,
    new_funnel_status,
    source,
    notes
  )
  values (
    v_sales_id,
    c.id,
    'write_off',
    sf.funnel_status,
    'Pass',
    'write_off',
    'Synced sales funnel after write-off'
  );

  return jsonb_build_object('ok', true, 'status', 'pass');
end;
$$;


ALTER FUNCTION "public"."sync_sales_funnel_after_write_off"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_client_notification_events_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_client_notification_events_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_process_instagram_post"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  perform process_instagram_post(new.id);

  return new;
end;
$$;


ALTER FUNCTION "public"."trigger_process_instagram_post"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_process_lead_raw"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  perform process_lead_raw(new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."trigger_process_lead_raw"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."airtable_clients" (
    "FIO3" "text",
    "Coach" "text",
    "freeze_option" "text",
    "Future_plan" "text",
    "Last_Fact" "text",
    "Start_day" "text",
    "Final_day" "text",
    "Wr_off_day" "text",
    "Planed_day" "text",
    "Payed" "text",
    "Balance" "text",
    "Gr_park_f" "text",
    "Gr_gym_f" "text",
    "GR_price" "text",
    "DS_f" "text",
    "DS_price" "text",
    "Pr_park_f" "text",
    "Pr_gym_f" "text",
    "PR_price" "text",
    "Sp_park_f" "text",
    "Sp_gym_f" "text",
    "SP_price" "text",
    "RECORD_ID3" "text",
    "email" "text",
    "ID" "text",
    "tgId" "text",
    "Currency" "text",
    "Tag" "text",
    "Calculation" "text",
    "First_fact" "text",
    "Тригер по времени" "text",
    "Время МСК" "text",
    "Время МСК 2" "text",
    "old_prices" "text",
    "Sales_funnel" "text",
    "gender" "text",
    "lk_enabled" "text"
);


ALTER TABLE "public"."airtable_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_month" "date" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'RUB'::"text" NOT NULL,
    "fx_rate_to_rub" numeric DEFAULT 1,
    "amount_rub" numeric DEFAULT 0 NOT NULL,
    "source" "text" DEFAULT 'manual'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."business_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_notification_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "event_type" "text" NOT NULL,
    "source_table" "text",
    "source_id" "text",
    "recipient_type" "text" DEFAULT 'client'::"text" NOT NULL,
    "channel" "text" DEFAULT 'telegram'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_code" "text",
    "error_message" "text",
    "payload_hash" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone,
    "last_alerted_at" timestamp with time zone,
    CONSTRAINT "client_notification_events_channel_check" CHECK (("channel" = ANY (ARRAY['telegram'::"text", 'email'::"text", 'admin_telegram'::"text"]))),
    CONSTRAINT "client_notification_events_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['client'::"text", 'trainer'::"text", 'admin'::"text"]))),
    CONSTRAINT "client_notification_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'skipped'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."client_notification_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_notification_events" IS 'Internal notification outbox/log for client, trainer and admin notifications. Used by Supabase functions and Edge Functions.';



COMMENT ON COLUMN "public"."client_notification_events"."payload" IS 'Safe structured event payload. Do not store bot tokens or raw Telegram API responses here.';



CREATE TABLE IF NOT EXISTS "public"."client_program_exercise_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_program_workout_id" "uuid" NOT NULL,
    "title" "text",
    "sets" "text",
    "rest" "text",
    "notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_template_group_id" "uuid"
);


ALTER TABLE "public"."client_program_exercise_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_program_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_program_workout_id" "uuid" NOT NULL,
    "exercise_id" "uuid",
    "exercise_title" "text" NOT NULL,
    "sets" "text",
    "reps" "text",
    "rest" "text",
    "tempo" "text",
    "notes" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "exercise_group_id" "uuid",
    "source_template_exercise_id" "uuid"
);


ALTER TABLE "public"."client_program_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_program_workouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_program_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "workout_date" "date" NOT NULL,
    "title" "text" DEFAULT 'Тренировка'::"text" NOT NULL,
    "coach_comment" "text",
    "sort_order" integer DEFAULT 0,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source_program_template_id" "uuid",
    "source_template_workout_id" "uuid"
);


ALTER TABLE "public"."client_program_workouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."client_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "transaction_type" "text" NOT NULL,
    "service_type" "text",
    "amount" numeric DEFAULT 0,
    "balance_delta" numeric DEFAULT 0 NOT NULL,
    "unit_price" numeric,
    "quantity" numeric DEFAULT 1,
    "currency" "text" DEFAULT 'RUB'::"text",
    "source_type" "text",
    "source_id" "uuid",
    "description" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reversed_at" timestamp with time zone,
    "reversal_of_transaction_id" "uuid",
    "reversal_reason" "text"
);


ALTER TABLE "public"."client_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fio" "text",
    "coach" "text",
    "freeze_option" boolean DEFAULT false,
    "future_plan" "date",
    "last_fact" "date",
    "start_day" "date",
    "final_day" "date",
    "payed" numeric DEFAULT 0,
    "balance" numeric DEFAULT 0,
    "gr_price" numeric,
    "gr_gym_f" integer DEFAULT 0,
    "gr_park_f" integer DEFAULT 0,
    "ds_price" numeric,
    "ds_f" integer DEFAULT 0,
    "pr_price" numeric,
    "pr_gym_f" integer DEFAULT 0,
    "pr_park_f" integer DEFAULT 0,
    "sp_price" numeric,
    "sp_gym_f" integer DEFAULT 0,
    "sp_park_f" integer DEFAULT 0,
    "email" "text",
    "tgid" "text",
    "currency" "text",
    "tag" "text",
    "first_fact" integer,
    "old_prices" boolean DEFAULT false,
    "gender" "text",
    "lk_enabled" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'active'::"text",
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_act_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_handle" "text" NOT NULL,
    "group_days" "text" DEFAULT 'mon_wed_sat'::"text" NOT NULL,
    "group_people_multiplier" integer DEFAULT 7,
    "personal_min" integer DEFAULT 0,
    "personal_max" integer DEFAULT 0,
    "video_min" integer DEFAULT 0,
    "video_max" integer DEFAULT 0,
    "video_voice_min" integer DEFAULT 0,
    "video_voice_max" integer DEFAULT 0,
    "smm_min" integer DEFAULT 0,
    "smm_max" integer DEFAULT 0,
    "master_people_min" integer DEFAULT 0,
    "master_people_max" integer DEFAULT 0,
    "has_personal" boolean DEFAULT true,
    "has_group" boolean DEFAULT true,
    "has_video" boolean DEFAULT false,
    "has_video_voice" boolean DEFAULT false,
    "has_smm" boolean DEFAULT false,
    "has_master" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coach_act_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_acts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "act_number" "text" NOT NULL,
    "coach_handle" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "day_signed" "date" NOT NULL,
    "status" "text" DEFAULT 'work'::"text" NOT NULL,
    "personal_hours" numeric DEFAULT 0,
    "personal_people" numeric DEFAULT 0,
    "group_hours" numeric DEFAULT 0,
    "group_people" numeric DEFAULT 0,
    "smm_hours" numeric DEFAULT 0,
    "video_hours" numeric DEFAULT 0,
    "video_hours_voice" numeric DEFAULT 0,
    "master_people" numeric DEFAULT 0,
    "total_hours" numeric DEFAULT 0,
    "total_people" numeric DEFAULT 0,
    "total_sum" numeric DEFAULT 0,
    "n8n_open_sent_at" timestamp with time zone,
    "n8n_close_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coach_acts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_program_template_id" "uuid"
);


ALTER TABLE "public"."coach_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_earnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "scheduled_workout_id" "uuid",
    "people_count" integer DEFAULT 1,
    "status" "text" DEFAULT 'main'::"text",
    "rate_per_person" numeric DEFAULT 0,
    "amount" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "earned_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "training_format_id" "uuid"
);


ALTER TABLE "public"."coach_earnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_payout_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "training_format_id" "uuid" NOT NULL,
    "coach_role" "text" DEFAULT 'main'::"text" NOT NULL,
    "main_coach_handle" "text",
    "extra_coach_handle" "text",
    "rate_type" "text" DEFAULT 'per_person'::"text" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'RUB'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coach_payout_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_formats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."training_formats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."coach_payout_rules_view" AS
 SELECT "cpr"."id",
    "tf"."slug" AS "training_format_slug",
    "tf"."title" AS "training_format_title",
    "cpr"."coach_role",
    "cpr"."main_coach_handle",
    "cpr"."extra_coach_handle",
    "cpr"."rate_type",
    "cpr"."amount",
    "cpr"."currency",
    "cpr"."is_active",
    "cpr"."created_at",
    "cpr"."updated_at"
   FROM ("public"."coach_payout_rules" "cpr"
     JOIN "public"."training_formats" "tf" ON (("tf"."id" = "cpr"."training_format_id")))
  ORDER BY "tf"."slug", "cpr"."coach_role", "cpr"."main_coach_handle";


ALTER VIEW "public"."coach_payout_rules_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "coach_name" "text" NOT NULL,
    "display_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "access_level" "text" DEFAULT 'coach'::"text" NOT NULL,
    "telegram_id" "text",
    CONSTRAINT "coach_profiles_access_level_check" CHECK (("access_level" = ANY (ARRAY['coach'::"text", 'head_coach'::"text"])))
);


ALTER TABLE "public"."coach_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_earnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "instagram_post_id" "uuid" NOT NULL,
    "coach_handle" "text" NOT NULL,
    "earning_type" "text" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "earning_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."content_earnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exchange_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "currency" "text" NOT NULL,
    "rate_to_rub" numeric NOT NULL,
    "rate_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source" "text" DEFAULT 'manual'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."exchange_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_library" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "video_url" "text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_by_coach_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "video_provider" "text" DEFAULT 'bunny'::"text",
    "video_asset_id" "text",
    "thumbnail_url" "text"
);


ALTER TABLE "public"."exercise_library" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scheduled_workout_item_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "coach_id" "uuid",
    "student_video_url" "text",
    "student_comment" "text",
    "coach_comment" "text",
    "status" "text" DEFAULT 'submitted'::"text",
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."exercise_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instagram_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_text" "text" NOT NULL,
    "processed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."instagram_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fio" "text",
    "created_time" timestamp with time zone DEFAULT "now"(),
    "tgid" "text",
    "phone" "text",
    "email" "text",
    "city" "text",
    "studio" "text",
    "product" "text",
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "first_seen_at" timestamp with time zone DEFAULT "now"(),
    "last_seen_at" timestamp with time zone DEFAULT "now"(),
    "submissions_count" integer DEFAULT 1,
    "first_source" "text",
    "last_source" "text",
    "last_raw_lead_id" "uuid",
    "status" "text" DEFAULT 'new'::"text"
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads_raw" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fio" "text",
    "tgid" "text",
    "phone" "text",
    "email" "text",
    "city" "text",
    "studio" "text",
    "product" "text",
    "source" "text",
    "raw_payload" "jsonb",
    "created_time" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leads_raw" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lk_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "lk_enabled" boolean DEFAULT true NOT NULL,
    "coach_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lk_users_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'coach'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."lk_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pnl_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_transaction_id" "uuid",
    "scheduled_workout_id" "uuid",
    "client_id" "uuid",
    "coach_id" "uuid",
    "extra_coach_id" "uuid",
    "studio_id" "uuid",
    "training_format_id" "uuid",
    "workout_date" "date" NOT NULL,
    "coach_handle_snapshot" "text",
    "extra_coach_handle_snapshot" "text",
    "training_format_snapshot" "text",
    "place_snapshot" "text",
    "currency" "text" DEFAULT 'RUB'::"text",
    "revenue_amount" numeric DEFAULT 0,
    "main_coach_expense_amount" numeric DEFAULT 0,
    "extra_coach_expense_amount" numeric DEFAULT 0,
    "studio_expense_amount" numeric DEFAULT 0,
    "net_profit_amount" numeric DEFAULT 0,
    "pnl_date" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "client_currency" "text",
    "client_price_amount" numeric DEFAULT 0,
    "fx_rate_to_rub" numeric DEFAULT 1,
    "entry_type" "text" DEFAULT 'workout'::"text",
    "reversed_at" timestamp with time zone,
    "reversal_of_pnl_entry_id" "uuid",
    "client_name_snapshot" "text"
);


ALTER TABLE "public"."pnl_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_channel" "text" NOT NULL,
    "email" "text",
    "fi" "text",
    "tgid" "text",
    "gift_recipient" "text",
    "tg_link_token" "text",
    "created_time" timestamp with time zone DEFAULT "now"(),
    "sum" numeric DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'RUB'::"text",
    "lessons" numeric,
    "price_per_lesson" numeric,
    "id_payment" "text",
    "status" "text" DEFAULT 'Created'::"text",
    "course_name" "text",
    "tag" "text",
    "nickname" "text",
    "phone" "text",
    "locale" "text",
    "tariff_label" "text",
    "studio_slug" "text",
    "slot_start_at" timestamp with time zone,
    "format" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone,
    "processed_client_id" "uuid",
    "telegram_username" "text",
    "tg_matched_at" timestamp with time zone
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."monthly_pnl_view" AS
 WITH "months" AS (
         SELECT DISTINCT ("date_trunc"('month'::"text", "pnl_entries"."pnl_date"))::"date" AS "month"
           FROM "public"."pnl_entries"
          WHERE ("pnl_entries"."reversed_at" IS NULL)
        UNION
         SELECT DISTINCT ("date_trunc"('month'::"text", ("business_expenses"."expense_month")::timestamp with time zone))::"date" AS "month"
           FROM "public"."business_expenses"
        UNION
         SELECT DISTINCT ("date_trunc"('month'::"text", "purchases"."created_time"))::"date" AS "month"
           FROM "public"."purchases"
          WHERE ("lower"(COALESCE("purchases"."status", ''::"text")) = ANY (ARRAY['paid'::"text", 'matched'::"text"]))
        UNION
         SELECT DISTINCT ("date_trunc"('month'::"text", ("content_earnings"."earning_date")::timestamp with time zone))::"date" AS "month"
           FROM "public"."content_earnings"
        ), "pnl" AS (
         SELECT ("date_trunc"('month'::"text", "pnl_entries"."pnl_date"))::"date" AS "month",
            "sum"(COALESCE("pnl_entries"."revenue_amount", (0)::numeric)) AS "total_revenue",
            "sum"(
                CASE
                    WHEN (COALESCE("pnl_entries"."entry_type", 'workout'::"text") = 'workout'::"text") THEN COALESCE("pnl_entries"."revenue_amount", (0)::numeric)
                    ELSE (0)::numeric
                END) AS "workout_revenue",
            "sum"(
                CASE
                    WHEN ("pnl_entries"."entry_type" = 'write_off'::"text") THEN COALESCE("pnl_entries"."revenue_amount", (0)::numeric)
                    ELSE (0)::numeric
                END) AS "write_off_revenue",
            "sum"(COALESCE("pnl_entries"."main_coach_expense_amount", (0)::numeric)) AS "main_coach_expenses",
            "sum"(COALESCE("pnl_entries"."extra_coach_expense_amount", (0)::numeric)) AS "extra_coach_expenses",
            "sum"(COALESCE("pnl_entries"."studio_expense_amount", (0)::numeric)) AS "studio_expenses"
           FROM "public"."pnl_entries"
          WHERE ("pnl_entries"."reversed_at" IS NULL)
          GROUP BY (("date_trunc"('month'::"text", "pnl_entries"."pnl_date"))::"date")
        ), "expenses" AS (
         SELECT ("date_trunc"('month'::"text", ("business_expenses"."expense_month")::timestamp with time zone))::"date" AS "month",
            "sum"(COALESCE("business_expenses"."amount_rub", (0)::numeric)) AS "business_expenses"
           FROM "public"."business_expenses"
          GROUP BY (("date_trunc"('month'::"text", ("business_expenses"."expense_month")::timestamp with time zone))::"date")
        ), "content" AS (
         SELECT ("date_trunc"('month'::"text", ("content_earnings"."earning_date")::timestamp with time zone))::"date" AS "month",
            "sum"(COALESCE("content_earnings"."amount", (0)::numeric)) AS "content_expenses"
           FROM "public"."content_earnings"
          GROUP BY (("date_trunc"('month'::"text", ("content_earnings"."earning_date")::timestamp with time zone))::"date")
        ), "acquiring" AS (
         SELECT ("date_trunc"('month'::"text", "pnl_entries"."pnl_date"))::"date" AS "month",
            "sum"("round"((COALESCE("pnl_entries"."revenue_amount", (0)::numeric) *
                CASE
                    WHEN ("upper"(COALESCE("pnl_entries"."client_currency", 'RUB'::"text")) = 'RUB'::"text") THEN 0.031
                    ELSE 0.025
                END), 2)) AS "acquiring_fees"
           FROM "public"."pnl_entries"
          WHERE ("pnl_entries"."reversed_at" IS NULL)
          GROUP BY (("date_trunc"('month'::"text", "pnl_entries"."pnl_date"))::"date")
        )
 SELECT "m"."month",
    COALESCE("p"."total_revenue", (0)::numeric) AS "total_revenue",
    COALESCE("p"."workout_revenue", (0)::numeric) AS "workout_revenue",
    COALESCE("p"."write_off_revenue", (0)::numeric) AS "write_off_revenue",
    COALESCE("a"."acquiring_fees", (0)::numeric) AS "acquiring_fees",
    COALESCE("p"."main_coach_expenses", (0)::numeric) AS "main_coach_expenses",
    COALESCE("p"."extra_coach_expenses", (0)::numeric) AS "extra_coach_expenses",
    (COALESCE("p"."main_coach_expenses", (0)::numeric) + COALESCE("p"."extra_coach_expenses", (0)::numeric)) AS "total_coach_expenses",
    COALESCE("p"."studio_expenses", (0)::numeric) AS "studio_expenses",
    COALESCE("e"."business_expenses", (0)::numeric) AS "business_expenses",
    ((((((COALESCE("p"."total_revenue", (0)::numeric) - COALESCE("a"."acquiring_fees", (0)::numeric)) - COALESCE("p"."main_coach_expenses", (0)::numeric)) - COALESCE("p"."extra_coach_expenses", (0)::numeric)) - COALESCE("p"."studio_expenses", (0)::numeric)) - COALESCE("e"."business_expenses", (0)::numeric)) - COALESCE("c"."content_expenses", (0)::numeric)) AS "net_profit",
    (COALESCE("p"."total_revenue", (0)::numeric) - COALESCE("a"."acquiring_fees", (0)::numeric)) AS "revenue_after_acquiring",
    ((COALESCE("p"."main_coach_expenses", (0)::numeric) + COALESCE("p"."extra_coach_expenses", (0)::numeric)) + COALESCE("p"."studio_expenses", (0)::numeric)) AS "coach_and_studio_expenses",
    COALESCE("c"."content_expenses", (0)::numeric) AS "content_expenses"
   FROM (((("months" "m"
     LEFT JOIN "pnl" "p" ON (("p"."month" = "m"."month")))
     LEFT JOIN "acquiring" "a" ON (("a"."month" = "m"."month")))
     LEFT JOIN "expenses" "e" ON (("e"."month" = "m"."month")))
     LEFT JOIN "content" "c" ON (("c"."month" = "m"."month")))
  ORDER BY "m"."month" DESC;


ALTER VIEW "public"."monthly_pnl_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."n8n_webhook_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_act_id" "uuid",
    "webhook_type" "text" NOT NULL,
    "webhook_url" "text" NOT NULL,
    "payload" "jsonb",
    "response_status" integer,
    "response_body" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "delivery_status" "text",
    "error_code" "text"
);


ALTER TABLE "public"."n8n_webhook_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_template_exercise_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_template_workout_id" "uuid" NOT NULL,
    "title" "text",
    "sets" "text",
    "rest" "text",
    "notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."program_template_exercise_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_template_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_template_workout_id" "uuid" NOT NULL,
    "exercise_group_id" "uuid",
    "exercise_id" "uuid",
    "exercise_title" "text" NOT NULL,
    "sets" "text",
    "reps" "text",
    "rest" "text",
    "tempo" "text",
    "notes" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."program_template_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_template_workouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_template_id" "uuid" NOT NULL,
    "day_number" integer NOT NULL,
    "week_number" integer,
    "title" "text" NOT NULL,
    "summary" "text",
    "estimated_minutes" integer,
    "workout_type" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."program_template_workouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "duration_days" integer,
    "weeks_count" integer,
    "level" "text",
    "goal" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."program_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_match_warnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_id" "uuid",
    "warning_type" "text" NOT NULL,
    "purchase_fio" "text",
    "purchase_email" "text",
    "purchase_tgid" "text",
    "matched_client_id" "uuid",
    "matched_client_fio" "text",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."purchase_match_warnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_funnel" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "lead_id" "uuid",
    "fio" "text",
    "phone" "text",
    "email" "text",
    "tgid" "text",
    "coach_handle" "text",
    "product" "text",
    "studio" "text",
    "city" "text",
    "source" "text",
    "first_try_status" "text" DEFAULT 'Waiting 1'::"text" NOT NULL,
    "funnel_status" "text" DEFAULT 'Waiting 1'::"text" NOT NULL,
    "first_try_done_at" timestamp with time zone,
    "first_payment_at" timestamp with time zone,
    "last_payment_at" timestamp with time zone,
    "last_workout_at" timestamp with time zone,
    "payments_count" integer DEFAULT 0,
    "workouts_count" integer DEFAULT 0,
    "total_revenue" numeric(12,2) DEFAULT 0,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_status_changed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_funnel" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_funnel_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sales_funnel_id" "uuid",
    "client_id" "uuid",
    "event_type" "text" NOT NULL,
    "old_first_try_status" "text",
    "new_first_try_status" "text",
    "old_funnel_status" "text",
    "new_funnel_status" "text",
    "amount" numeric(12,2),
    "source" "text" DEFAULT 'system'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_funnel_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_workouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "template_id" "uuid",
    "studio_id" "uuid",
    "scheduled_at" timestamp with time zone NOT NULL,
    "delivery_type" "text" NOT NULL,
    "title" "text",
    "warmup_text" "text",
    "status" "text" DEFAULT 'planned'::"text",
    "charge_status" "text" DEFAULT 'pending'::"text",
    "charged_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "training_format_id" "uuid",
    "people_count" integer DEFAULT 1
);


ALTER TABLE "public"."scheduled_workouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_cost_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "training_format_id" "uuid" NOT NULL,
    "rate_type" "text" DEFAULT 'per_person'::"text" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'RUB'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."studio_cost_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "city" "text",
    "address" "text",
    "is_online" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "schedule_text" "text"
);


ALTER TABLE "public"."studios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."studio_cost_rules_view" AS
 SELECT "scr"."id",
    "s"."slug" AS "studio_slug",
    "s"."title" AS "studio_title",
    "s"."city" AS "studio_city",
    "tf"."slug" AS "training_format_slug",
    "tf"."title" AS "training_format_title",
    "scr"."rate_type",
    "scr"."amount",
    "scr"."currency",
    "scr"."is_active",
    "scr"."created_at",
    "scr"."updated_at"
   FROM (("public"."studio_cost_rules" "scr"
     JOIN "public"."studios" "s" ON (("s"."id" = "scr"."studio_id")))
     JOIN "public"."training_formats" "tf" ON (("tf"."id" = "scr"."training_format_id")))
  ORDER BY "s"."city", "s"."title", "tf"."slug";


ALTER VIEW "public"."studio_cost_rules_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studio_costs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "studio_id" "uuid" NOT NULL,
    "scheduled_workout_id" "uuid",
    "training_format_id" "uuid",
    "people_count" integer DEFAULT 1,
    "rate_per_person" numeric DEFAULT 0,
    "amount" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "cost_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."studio_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tg_workout_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "raw_text" "text" NOT NULL,
    "telegram_message_id" "text",
    "telegram_chat_id" "text",
    "telegram_user_id" "text",
    "telegram_username" "text",
    "status" "text" DEFAULT 'new'::"text",
    "parsed_payload" "jsonb",
    "result_payload" "jsonb",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone
);


ALTER TABLE "public"."tg_workout_messages" OWNER TO "postgres";


ALTER TABLE ONLY "public"."business_expenses"
    ADD CONSTRAINT "business_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_notification_events"
    ADD CONSTRAINT "client_notification_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_program_exercise_groups"
    ADD CONSTRAINT "client_program_exercise_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_program_exercises"
    ADD CONSTRAINT "client_program_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_program_workouts"
    ADD CONSTRAINT "client_program_workouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_transactions"
    ADD CONSTRAINT "client_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_act_settings"
    ADD CONSTRAINT "coach_act_settings_coach_handle_key" UNIQUE ("coach_handle");



ALTER TABLE ONLY "public"."coach_act_settings"
    ADD CONSTRAINT "coach_act_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_acts"
    ADD CONSTRAINT "coach_acts_act_number_key" UNIQUE ("act_number");



ALTER TABLE ONLY "public"."coach_acts"
    ADD CONSTRAINT "coach_acts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_clients"
    ADD CONSTRAINT "coach_clients_coach_id_client_id_key" UNIQUE ("coach_id", "client_id");



ALTER TABLE ONLY "public"."coach_clients"
    ADD CONSTRAINT "coach_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_earnings"
    ADD CONSTRAINT "coach_earnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_payout_rules"
    ADD CONSTRAINT "coach_payout_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_profiles"
    ADD CONSTRAINT "coach_profiles_coach_name_key" UNIQUE ("coach_name");



ALTER TABLE ONLY "public"."coach_profiles"
    ADD CONSTRAINT "coach_profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."coach_profiles"
    ADD CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_earnings"
    ADD CONSTRAINT "content_earnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exchange_rates"
    ADD CONSTRAINT "exchange_rates_currency_rate_date_key" UNIQUE ("currency", "rate_date");



ALTER TABLE ONLY "public"."exchange_rates"
    ADD CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_library"
    ADD CONSTRAINT "exercise_library_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_submissions"
    ADD CONSTRAINT "exercise_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instagram_posts"
    ADD CONSTRAINT "instagram_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads_raw"
    ADD CONSTRAINT "leads_raw_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lk_users"
    ADD CONSTRAINT "lk_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."lk_users"
    ADD CONSTRAINT "lk_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."n8n_webhook_logs"
    ADD CONSTRAINT "n8n_webhook_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_template_exercise_groups"
    ADD CONSTRAINT "program_template_exercise_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_template_exercises"
    ADD CONSTRAINT "program_template_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_template_workouts"
    ADD CONSTRAINT "program_template_workouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_templates"
    ADD CONSTRAINT "program_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_match_warnings"
    ADD CONSTRAINT "purchase_match_warnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_id_payment_key" UNIQUE ("id_payment");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_funnel_events"
    ADD CONSTRAINT "sales_funnel_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_funnel"
    ADD CONSTRAINT "sales_funnel_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_workouts"
    ADD CONSTRAINT "scheduled_workouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_cost_rules"
    ADD CONSTRAINT "studio_cost_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studio_cost_rules"
    ADD CONSTRAINT "studio_cost_rules_studio_id_training_format_id_key" UNIQUE ("studio_id", "training_format_id");



ALTER TABLE ONLY "public"."studio_costs"
    ADD CONSTRAINT "studio_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studios"
    ADD CONSTRAINT "studios_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."tg_workout_messages"
    ADD CONSTRAINT "tg_workout_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_formats"
    ADD CONSTRAINT "training_formats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_formats"
    ADD CONSTRAINT "training_formats_slug_key" UNIQUE ("slug");



CREATE INDEX "idx_business_expenses_category" ON "public"."business_expenses" USING "btree" ("category");



CREATE INDEX "idx_business_expenses_month" ON "public"."business_expenses" USING "btree" ("expense_month");



CREATE INDEX "idx_client_notification_events_client_id" ON "public"."client_notification_events" USING "btree" ("client_id");



CREATE INDEX "idx_client_notification_events_event_type" ON "public"."client_notification_events" USING "btree" ("event_type");



CREATE INDEX "idx_client_notification_events_status_created_at" ON "public"."client_notification_events" USING "btree" ("status", "created_at");



CREATE INDEX "idx_client_program_exercise_groups_source_template" ON "public"."client_program_exercise_groups" USING "btree" ("source_template_group_id");



CREATE INDEX "idx_client_program_exercise_groups_workout" ON "public"."client_program_exercise_groups" USING "btree" ("client_program_workout_id");



CREATE INDEX "idx_client_program_exercises_exercise" ON "public"."client_program_exercises" USING "btree" ("exercise_id");



CREATE INDEX "idx_client_program_exercises_group" ON "public"."client_program_exercises" USING "btree" ("exercise_group_id");



CREATE INDEX "idx_client_program_exercises_source_template" ON "public"."client_program_exercises" USING "btree" ("source_template_exercise_id");



CREATE INDEX "idx_client_program_exercises_workout" ON "public"."client_program_exercises" USING "btree" ("client_program_workout_id");



CREATE INDEX "idx_client_program_workouts_client_date" ON "public"."client_program_workouts" USING "btree" ("client_id", "workout_date");



CREATE INDEX "idx_client_program_workouts_coach" ON "public"."client_program_workouts" USING "btree" ("coach_id");



CREATE INDEX "idx_client_program_workouts_program_date" ON "public"."client_program_workouts" USING "btree" ("client_program_id", "workout_date");



CREATE INDEX "idx_client_program_workouts_source_template" ON "public"."client_program_workouts" USING "btree" ("source_program_template_id", "source_template_workout_id");



CREATE UNIQUE INDEX "idx_client_program_workouts_template_import_once" ON "public"."client_program_workouts" USING "btree" ("client_id", "coach_id", "workout_date", "source_template_workout_id") WHERE ("source_template_workout_id" IS NOT NULL);



CREATE INDEX "idx_client_programs_client" ON "public"."client_programs" USING "btree" ("client_id");



CREATE INDEX "idx_client_programs_coach" ON "public"."client_programs" USING "btree" ("coach_id");



CREATE UNIQUE INDEX "idx_client_programs_one_active_per_coach_client" ON "public"."client_programs" USING "btree" ("client_id", "coach_id") WHERE (("status" = 'active'::"text") AND ("coach_id" IS NOT NULL));



CREATE INDEX "idx_client_programs_status" ON "public"."client_programs" USING "btree" ("status");



CREATE INDEX "idx_client_transactions_client_id" ON "public"."client_transactions" USING "btree" ("client_id");



CREATE INDEX "idx_client_transactions_occurred_at" ON "public"."client_transactions" USING "btree" ("occurred_at" DESC);



CREATE INDEX "idx_client_transactions_source" ON "public"."client_transactions" USING "btree" ("source_type", "source_id");



CREATE INDEX "idx_client_transactions_type" ON "public"."client_transactions" USING "btree" ("transaction_type");



CREATE INDEX "idx_clients_coach" ON "public"."clients" USING "btree" ("coach");



CREATE INDEX "idx_clients_email" ON "public"."clients" USING "btree" ("email");



CREATE INDEX "idx_clients_lk_enabled" ON "public"."clients" USING "btree" ("lk_enabled");



CREATE INDEX "idx_coach_acts_coach" ON "public"."coach_acts" USING "btree" ("coach_handle");



CREATE INDEX "idx_coach_acts_period" ON "public"."coach_acts" USING "btree" ("period_start", "period_end");



CREATE INDEX "idx_coach_acts_status" ON "public"."coach_acts" USING "btree" ("status");



CREATE INDEX "idx_coach_clients_active" ON "public"."coach_clients" USING "btree" ("is_active");



CREATE INDEX "idx_coach_clients_client" ON "public"."coach_clients" USING "btree" ("client_id");



CREATE INDEX "idx_coach_clients_coach" ON "public"."coach_clients" USING "btree" ("coach_id");



CREATE INDEX "idx_coach_clients_last_program_template_id" ON "public"."coach_clients" USING "btree" ("last_program_template_id") WHERE ("last_program_template_id" IS NOT NULL);



CREATE INDEX "idx_coach_earnings_coach" ON "public"."coach_earnings" USING "btree" ("coach_id", "earned_at" DESC);



CREATE INDEX "idx_coach_earnings_status" ON "public"."coach_earnings" USING "btree" ("status");



CREATE INDEX "idx_coach_earnings_workout" ON "public"."coach_earnings" USING "btree" ("scheduled_workout_id");



CREATE INDEX "idx_coach_payout_rules_format" ON "public"."coach_payout_rules" USING "btree" ("training_format_id");



CREATE INDEX "idx_coach_payout_rules_main_coach" ON "public"."coach_payout_rules" USING "btree" ("main_coach_handle");



CREATE INDEX "idx_coach_payout_rules_role" ON "public"."coach_payout_rules" USING "btree" ("coach_role");



CREATE INDEX "idx_coach_profiles_active" ON "public"."coach_profiles" USING "btree" ("is_active");



CREATE INDEX "idx_coach_profiles_email" ON "public"."coach_profiles" USING "btree" ("email");



CREATE INDEX "idx_content_earnings_coach" ON "public"."content_earnings" USING "btree" ("coach_handle");



CREATE INDEX "idx_content_earnings_date" ON "public"."content_earnings" USING "btree" ("earning_date");



CREATE INDEX "idx_content_earnings_post" ON "public"."content_earnings" USING "btree" ("instagram_post_id");



CREATE INDEX "idx_exchange_rates_currency_date" ON "public"."exchange_rates" USING "btree" ("currency", "rate_date" DESC);



CREATE INDEX "idx_exercise_groups_workout_order" ON "public"."client_program_exercise_groups" USING "btree" ("client_program_workout_id", "sort_order");



CREATE INDEX "idx_exercise_library_tags" ON "public"."exercise_library" USING "gin" ("tags");



CREATE INDEX "idx_exercise_library_title" ON "public"."exercise_library" USING "gin" ("to_tsvector"('"simple"'::"regconfig", COALESCE("title", ''::"text")));



CREATE INDEX "idx_exercise_submissions_client" ON "public"."exercise_submissions" USING "btree" ("client_id");



CREATE INDEX "idx_exercise_submissions_coach" ON "public"."exercise_submissions" USING "btree" ("coach_id");



CREATE INDEX "idx_exercise_submissions_item" ON "public"."exercise_submissions" USING "btree" ("scheduled_workout_item_id");



CREATE INDEX "idx_exercise_submissions_status" ON "public"."exercise_submissions" USING "btree" ("status");



CREATE INDEX "idx_instagram_posts_created_at" ON "public"."instagram_posts" USING "btree" ("created_at");



CREATE INDEX "idx_leads_email" ON "public"."leads" USING "btree" ("email");



CREATE INDEX "idx_leads_phone" ON "public"."leads" USING "btree" ("phone");



CREATE INDEX "idx_leads_raw_created_at" ON "public"."leads_raw" USING "btree" ("created_at");



CREATE INDEX "idx_leads_raw_email" ON "public"."leads_raw" USING "btree" ("lower"("email"));



CREATE INDEX "idx_leads_raw_phone" ON "public"."leads_raw" USING "btree" ("phone");



CREATE INDEX "idx_leads_raw_tgid" ON "public"."leads_raw" USING "btree" ("tgid");



CREATE INDEX "idx_lk_users_email_enabled" ON "public"."lk_users" USING "btree" ("lower"("email"), "lk_enabled");



CREATE INDEX "idx_pnl_entries_client" ON "public"."pnl_entries" USING "btree" ("client_id");



CREATE INDEX "idx_pnl_entries_coach" ON "public"."pnl_entries" USING "btree" ("coach_id");



CREATE INDEX "idx_pnl_entries_currency" ON "public"."pnl_entries" USING "btree" ("currency");



CREATE INDEX "idx_pnl_entries_date" ON "public"."pnl_entries" USING "btree" ("pnl_date" DESC);



CREATE INDEX "idx_pnl_entries_extra_coach" ON "public"."pnl_entries" USING "btree" ("extra_coach_id");



CREATE INDEX "idx_pnl_entries_studio" ON "public"."pnl_entries" USING "btree" ("studio_id");



CREATE INDEX "idx_pnl_entries_workout" ON "public"."pnl_entries" USING "btree" ("scheduled_workout_id");



CREATE INDEX "idx_pnl_entries_workout_date" ON "public"."pnl_entries" USING "btree" ("workout_date" DESC);



CREATE INDEX "idx_program_exercises_group_order" ON "public"."client_program_exercises" USING "btree" ("exercise_group_id", "sort_order");



CREATE INDEX "idx_purchases_created_time" ON "public"."purchases" USING "btree" ("created_time" DESC);



CREATE INDEX "idx_purchases_email" ON "public"."purchases" USING "btree" ("email");



CREATE INDEX "idx_purchases_id_payment" ON "public"."purchases" USING "btree" ("id_payment");



CREATE INDEX "idx_purchases_source_channel" ON "public"."purchases" USING "btree" ("source_channel");



CREATE INDEX "idx_purchases_status" ON "public"."purchases" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_purchases_tg_link_token" ON "public"."purchases" USING "btree" ("tg_link_token") WHERE ("tg_link_token" IS NOT NULL);



CREATE INDEX "idx_purchases_tgid" ON "public"."purchases" USING "btree" ("tgid");



CREATE INDEX "idx_sales_funnel_client" ON "public"."sales_funnel" USING "btree" ("client_id");



CREATE INDEX "idx_sales_funnel_created" ON "public"."sales_funnel" USING "btree" ("created_at");



CREATE INDEX "idx_sales_funnel_events_client" ON "public"."sales_funnel_events" USING "btree" ("client_id");



CREATE INDEX "idx_sales_funnel_events_created" ON "public"."sales_funnel_events" USING "btree" ("created_at");



CREATE INDEX "idx_sales_funnel_first_try" ON "public"."sales_funnel" USING "btree" ("first_try_status");



CREATE INDEX "idx_sales_funnel_status" ON "public"."sales_funnel" USING "btree" ("funnel_status");



CREATE INDEX "idx_scheduled_workouts_charge_status" ON "public"."scheduled_workouts" USING "btree" ("charge_status");



CREATE INDEX "idx_scheduled_workouts_client" ON "public"."scheduled_workouts" USING "btree" ("client_id", "scheduled_at" DESC);



CREATE INDEX "idx_scheduled_workouts_coach" ON "public"."scheduled_workouts" USING "btree" ("coach_id", "scheduled_at" DESC);



CREATE INDEX "idx_scheduled_workouts_date" ON "public"."scheduled_workouts" USING "btree" ("scheduled_at" DESC);



CREATE INDEX "idx_scheduled_workouts_status" ON "public"."scheduled_workouts" USING "btree" ("status");



CREATE INDEX "idx_studio_cost_rules_format" ON "public"."studio_cost_rules" USING "btree" ("training_format_id");



CREATE INDEX "idx_studio_cost_rules_studio" ON "public"."studio_cost_rules" USING "btree" ("studio_id");



CREATE INDEX "idx_studio_costs_studio" ON "public"."studio_costs" USING "btree" ("studio_id", "cost_at" DESC);



CREATE INDEX "idx_studio_costs_training_format" ON "public"."studio_costs" USING "btree" ("training_format_id");



CREATE INDEX "idx_studio_costs_workout" ON "public"."studio_costs" USING "btree" ("scheduled_workout_id");



CREATE INDEX "idx_studios_city" ON "public"."studios" USING "btree" ("city");



CREATE INDEX "idx_studios_slug" ON "public"."studios" USING "btree" ("slug");



CREATE INDEX "idx_tg_workout_messages_status" ON "public"."tg_workout_messages" USING "btree" ("status", "created_at");



CREATE INDEX "idx_training_formats_slug" ON "public"."training_formats" USING "btree" ("slug");



CREATE UNIQUE INDEX "uniq_business_expenses_month_title" ON "public"."business_expenses" USING "btree" ("expense_month", "category", "title");



CREATE UNIQUE INDEX "uniq_client_transactions_source" ON "public"."client_transactions" USING "btree" ("source_type", "source_id") WHERE (("source_type" IS NOT NULL) AND ("source_id" IS NOT NULL));



CREATE UNIQUE INDEX "ux_client_notification_events_idempotency" ON "public"."client_notification_events" USING "btree" ("event_type", COALESCE("source_table", ''::"text"), COALESCE("source_id", ''::"text"), "recipient_type", "channel", "payload_hash");



CREATE OR REPLACE TRIGGER "clients_coach_sync_trigger" AFTER INSERT OR UPDATE OF "coach" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."sync_client_coach_link_on_clients_coach_change"();



CREATE OR REPLACE TRIGGER "trg_client_notification_events_updated_at" BEFORE UPDATE ON "public"."client_notification_events" FOR EACH ROW EXECUTE FUNCTION "public"."touch_client_notification_events_updated_at"();



CREATE OR REPLACE TRIGGER "trg_exercise_groups_updated_at" BEFORE UPDATE ON "public"."client_program_exercise_groups" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_process_instagram_post" AFTER INSERT ON "public"."instagram_posts" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_process_instagram_post"();



CREATE OR REPLACE TRIGGER "trg_process_lead_raw" AFTER INSERT ON "public"."leads_raw" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_process_lead_raw"();



ALTER TABLE ONLY "public"."client_program_exercise_groups"
    ADD CONSTRAINT "client_program_exercise_groups_client_program_workout_id_fkey" FOREIGN KEY ("client_program_workout_id") REFERENCES "public"."client_program_workouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_exercise_groups"
    ADD CONSTRAINT "client_program_exercise_groups_source_template_group_id_fkey" FOREIGN KEY ("source_template_group_id") REFERENCES "public"."program_template_exercise_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_exercises"
    ADD CONSTRAINT "client_program_exercises_client_program_workout_id_fkey" FOREIGN KEY ("client_program_workout_id") REFERENCES "public"."client_program_workouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_exercises"
    ADD CONSTRAINT "client_program_exercises_exercise_group_id_fkey" FOREIGN KEY ("exercise_group_id") REFERENCES "public"."client_program_exercise_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_exercises"
    ADD CONSTRAINT "client_program_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise_library"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_exercises"
    ADD CONSTRAINT "client_program_exercises_source_template_exercise_id_fkey" FOREIGN KEY ("source_template_exercise_id") REFERENCES "public"."program_template_exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_workouts"
    ADD CONSTRAINT "client_program_workouts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_workouts"
    ADD CONSTRAINT "client_program_workouts_client_program_id_fkey" FOREIGN KEY ("client_program_id") REFERENCES "public"."client_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_workouts"
    ADD CONSTRAINT "client_program_workouts_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_workouts"
    ADD CONSTRAINT "client_program_workouts_source_program_template_id_fkey" FOREIGN KEY ("source_program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_workouts"
    ADD CONSTRAINT "client_program_workouts_source_template_workout_id_fkey" FOREIGN KEY ("source_template_workout_id") REFERENCES "public"."program_template_workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_transactions"
    ADD CONSTRAINT "client_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_transactions"
    ADD CONSTRAINT "client_transactions_reversal_of_transaction_id_fkey" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."client_transactions"("id");



ALTER TABLE ONLY "public"."coach_clients"
    ADD CONSTRAINT "coach_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_clients"
    ADD CONSTRAINT "coach_clients_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_clients"
    ADD CONSTRAINT "coach_clients_last_program_template_id_fkey" FOREIGN KEY ("last_program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_earnings"
    ADD CONSTRAINT "coach_earnings_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_earnings"
    ADD CONSTRAINT "coach_earnings_scheduled_workout_id_fkey" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_earnings"
    ADD CONSTRAINT "coach_earnings_training_format_id_fkey" FOREIGN KEY ("training_format_id") REFERENCES "public"."training_formats"("id");



ALTER TABLE ONLY "public"."coach_payout_rules"
    ADD CONSTRAINT "coach_payout_rules_training_format_id_fkey" FOREIGN KEY ("training_format_id") REFERENCES "public"."training_formats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_earnings"
    ADD CONSTRAINT "content_earnings_instagram_post_id_fkey" FOREIGN KEY ("instagram_post_id") REFERENCES "public"."instagram_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_library"
    ADD CONSTRAINT "exercise_library_created_by_coach_id_fkey" FOREIGN KEY ("created_by_coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_submissions"
    ADD CONSTRAINT "exercise_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_submissions"
    ADD CONSTRAINT "exercise_submissions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_last_raw_lead_id_fkey" FOREIGN KEY ("last_raw_lead_id") REFERENCES "public"."leads_raw"("id");



ALTER TABLE ONLY "public"."n8n_webhook_logs"
    ADD CONSTRAINT "n8n_webhook_logs_coach_act_id_fkey" FOREIGN KEY ("coach_act_id") REFERENCES "public"."coach_acts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_client_transaction_id_fkey" FOREIGN KEY ("client_transaction_id") REFERENCES "public"."client_transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_extra_coach_id_fkey" FOREIGN KEY ("extra_coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_reversal_of_pnl_entry_id_fkey" FOREIGN KEY ("reversal_of_pnl_entry_id") REFERENCES "public"."pnl_entries"("id");



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_scheduled_workout_id_fkey" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_training_format_id_fkey" FOREIGN KEY ("training_format_id") REFERENCES "public"."training_formats"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."program_template_exercise_groups"
    ADD CONSTRAINT "program_template_exercise_grou_program_template_workout_id_fkey" FOREIGN KEY ("program_template_workout_id") REFERENCES "public"."program_template_workouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_template_exercises"
    ADD CONSTRAINT "program_template_exercises_exercise_group_id_fkey" FOREIGN KEY ("exercise_group_id") REFERENCES "public"."program_template_exercise_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."program_template_exercises"
    ADD CONSTRAINT "program_template_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise_library"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."program_template_exercises"
    ADD CONSTRAINT "program_template_exercises_program_template_workout_id_fkey" FOREIGN KEY ("program_template_workout_id") REFERENCES "public"."program_template_workouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_template_workouts"
    ADD CONSTRAINT "program_template_workouts_program_template_id_fkey" FOREIGN KEY ("program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_templates"
    ADD CONSTRAINT "program_templates_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_match_warnings"
    ADD CONSTRAINT "purchase_match_warnings_matched_client_id_fkey" FOREIGN KEY ("matched_client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_match_warnings"
    ADD CONSTRAINT "purchase_match_warnings_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_processed_client_id_fkey" FOREIGN KEY ("processed_client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_funnel"
    ADD CONSTRAINT "sales_funnel_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_funnel_events"
    ADD CONSTRAINT "sales_funnel_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_funnel_events"
    ADD CONSTRAINT "sales_funnel_events_sales_funnel_id_fkey" FOREIGN KEY ("sales_funnel_id") REFERENCES "public"."sales_funnel"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_funnel"
    ADD CONSTRAINT "sales_funnel_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_workouts"
    ADD CONSTRAINT "scheduled_workouts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_workouts"
    ADD CONSTRAINT "scheduled_workouts_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coach_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_workouts"
    ADD CONSTRAINT "scheduled_workouts_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_workouts"
    ADD CONSTRAINT "scheduled_workouts_training_format_id_fkey" FOREIGN KEY ("training_format_id") REFERENCES "public"."training_formats"("id");



ALTER TABLE ONLY "public"."studio_cost_rules"
    ADD CONSTRAINT "studio_cost_rules_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_cost_rules"
    ADD CONSTRAINT "studio_cost_rules_training_format_id_fkey" FOREIGN KEY ("training_format_id") REFERENCES "public"."training_formats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_costs"
    ADD CONSTRAINT "studio_costs_scheduled_workout_id_fkey" FOREIGN KEY ("scheduled_workout_id") REFERENCES "public"."scheduled_workouts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."studio_costs"
    ADD CONSTRAINT "studio_costs_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studio_costs"
    ADD CONSTRAINT "studio_costs_training_format_id_fkey" FOREIGN KEY ("training_format_id") REFERENCES "public"."training_formats"("id") ON DELETE SET NULL;



ALTER TABLE "public"."airtable_clients" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."close_coach_act"("p_act_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."count_act_group_days"("p_start" "date", "p_end" "date", "p_group_days" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_client_workout_diff"("p_coach_email" "text", "p_client_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_client_write_off"("p_client_id" "uuid", "p_amount" numeric, "p_write_off_date" "date", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_next_coach_act"("p_previous_act_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_client_notification_event"("p_client_id" "uuid", "p_event_type" "text", "p_source_table" "text", "p_source_id" "text", "p_recipient_type" "text", "p_channel" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_sales_funnel_by_client_or_contacts"("p_client_id" "uuid", "p_email" "text", "p_tgid" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_daily_student_metrics_report"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_daily_student_metrics_report"() TO "service_role";



GRANT ALL ON FUNCTION "public"."import_program_template_workouts_to_client_calendar"("p_coach_email" "text", "p_client_id" "uuid", "p_program_template_id" "uuid", "p_start_date" "date", "p_template_workout_ids" "uuid"[], "p_workout_dates" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_purchase_by_tg_token"("p_token" "text", "p_tgid" "text", "p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."next_act_number"("p_act_number" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_instagram_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_lead_raw"("p_raw_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_paid_purchase"("p_purchase_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."random_int_between"("p_min" integer, "p_max" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."reliability_monitor_cron_job_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reliability_monitor_pg_net_failure_summary"("p_since" timestamp with time zone, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."reverse_client_write_off"("p_client_id" "uuid", "p_new_final_day" "date", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_client_workout_diff"("p_workout_id" "uuid", "p_coach_email" "text", "p_client_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_program_template_diff"("p_program_id" "uuid", "p_coach_email" "text", "p_expected_updated_at" timestamp with time zone, "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sales_funnel_after_purchase"("p_client_id" "uuid", "p_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sales_funnel_after_workout_charge"("p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sales_funnel_after_write_off"("p_client_id" "uuid") TO "service_role";
























GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."airtable_clients" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."airtable_clients" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."airtable_clients" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_expenses" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."business_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."business_expenses" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_notification_events" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_notification_events" TO "authenticated";
GRANT ALL ON TABLE "public"."client_notification_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_program_exercise_groups" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_program_exercise_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."client_program_exercise_groups" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_program_exercises" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_program_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."client_program_exercises" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_program_workouts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_program_workouts" TO "authenticated";
GRANT ALL ON TABLE "public"."client_program_workouts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_programs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_programs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_transactions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."client_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."client_transactions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clients" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_act_settings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_act_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_act_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_acts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_acts" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_acts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_clients" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_clients" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_earnings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_earnings" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_earnings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_payout_rules" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_payout_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_payout_rules" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."training_formats" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."training_formats" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."training_formats" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_payout_rules_view" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_payout_rules_view" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_payout_rules_view" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_profiles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_profiles" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coach_profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."content_earnings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."content_earnings" TO "authenticated";
GRANT ALL ON TABLE "public"."content_earnings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."exchange_rates" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."exchange_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."exchange_rates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."exercise_library" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."exercise_library" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_library" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."exercise_submissions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."exercise_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_submissions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."instagram_posts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."instagram_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."instagram_posts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leads" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leads_raw" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leads_raw" TO "authenticated";
GRANT ALL ON TABLE "public"."leads_raw" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."lk_users" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."lk_users" TO "authenticated";
GRANT ALL ON TABLE "public"."lk_users" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pnl_entries" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pnl_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."pnl_entries" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchases" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monthly_pnl_view" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monthly_pnl_view" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."monthly_pnl_view" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."n8n_webhook_logs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."n8n_webhook_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."n8n_webhook_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_template_exercise_groups" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_template_exercise_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."program_template_exercise_groups" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_template_exercises" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_template_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."program_template_exercises" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_template_workouts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_template_workouts" TO "authenticated";
GRANT ALL ON TABLE "public"."program_template_workouts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_templates" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."program_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."program_templates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_match_warnings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_match_warnings" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_match_warnings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_funnel" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_funnel" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_funnel" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_funnel_events" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_funnel_events" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_funnel_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduled_workouts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduled_workouts" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_workouts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_cost_rules" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_cost_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_cost_rules" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studios" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studios" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studios" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_cost_rules_view" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_cost_rules_view" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_cost_rules_view" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_costs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."studio_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."studio_costs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tg_workout_messages" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."tg_workout_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."tg_workout_messages" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";































revoke delete on table "public"."airtable_clients" from "anon";

revoke insert on table "public"."airtable_clients" from "anon";

revoke select on table "public"."airtable_clients" from "anon";

revoke update on table "public"."airtable_clients" from "anon";

revoke delete on table "public"."airtable_clients" from "authenticated";

revoke insert on table "public"."airtable_clients" from "authenticated";

revoke select on table "public"."airtable_clients" from "authenticated";

revoke update on table "public"."airtable_clients" from "authenticated";

revoke delete on table "public"."airtable_clients" from "service_role";

revoke insert on table "public"."airtable_clients" from "service_role";

revoke select on table "public"."airtable_clients" from "service_role";

revoke update on table "public"."airtable_clients" from "service_role";

revoke delete on table "public"."business_expenses" from "anon";

revoke insert on table "public"."business_expenses" from "anon";

revoke select on table "public"."business_expenses" from "anon";

revoke update on table "public"."business_expenses" from "anon";

revoke delete on table "public"."business_expenses" from "authenticated";

revoke insert on table "public"."business_expenses" from "authenticated";

revoke select on table "public"."business_expenses" from "authenticated";

revoke update on table "public"."business_expenses" from "authenticated";

revoke delete on table "public"."client_notification_events" from "anon";

revoke insert on table "public"."client_notification_events" from "anon";

revoke select on table "public"."client_notification_events" from "anon";

revoke update on table "public"."client_notification_events" from "anon";

revoke delete on table "public"."client_notification_events" from "authenticated";

revoke insert on table "public"."client_notification_events" from "authenticated";

revoke select on table "public"."client_notification_events" from "authenticated";

revoke update on table "public"."client_notification_events" from "authenticated";

revoke delete on table "public"."client_program_exercise_groups" from "anon";

revoke insert on table "public"."client_program_exercise_groups" from "anon";

revoke select on table "public"."client_program_exercise_groups" from "anon";

revoke update on table "public"."client_program_exercise_groups" from "anon";

revoke delete on table "public"."client_program_exercise_groups" from "authenticated";

revoke insert on table "public"."client_program_exercise_groups" from "authenticated";

revoke select on table "public"."client_program_exercise_groups" from "authenticated";

revoke update on table "public"."client_program_exercise_groups" from "authenticated";

revoke delete on table "public"."client_program_exercises" from "anon";

revoke insert on table "public"."client_program_exercises" from "anon";

revoke select on table "public"."client_program_exercises" from "anon";

revoke update on table "public"."client_program_exercises" from "anon";

revoke delete on table "public"."client_program_exercises" from "authenticated";

revoke insert on table "public"."client_program_exercises" from "authenticated";

revoke select on table "public"."client_program_exercises" from "authenticated";

revoke update on table "public"."client_program_exercises" from "authenticated";

revoke delete on table "public"."client_program_workouts" from "anon";

revoke insert on table "public"."client_program_workouts" from "anon";

revoke select on table "public"."client_program_workouts" from "anon";

revoke update on table "public"."client_program_workouts" from "anon";

revoke delete on table "public"."client_program_workouts" from "authenticated";

revoke insert on table "public"."client_program_workouts" from "authenticated";

revoke select on table "public"."client_program_workouts" from "authenticated";

revoke update on table "public"."client_program_workouts" from "authenticated";

revoke delete on table "public"."client_programs" from "anon";

revoke insert on table "public"."client_programs" from "anon";

revoke select on table "public"."client_programs" from "anon";

revoke update on table "public"."client_programs" from "anon";

revoke delete on table "public"."client_programs" from "authenticated";

revoke insert on table "public"."client_programs" from "authenticated";

revoke select on table "public"."client_programs" from "authenticated";

revoke update on table "public"."client_programs" from "authenticated";

revoke delete on table "public"."client_transactions" from "anon";

revoke insert on table "public"."client_transactions" from "anon";

revoke select on table "public"."client_transactions" from "anon";

revoke update on table "public"."client_transactions" from "anon";

revoke delete on table "public"."client_transactions" from "authenticated";

revoke insert on table "public"."client_transactions" from "authenticated";

revoke select on table "public"."client_transactions" from "authenticated";

revoke update on table "public"."client_transactions" from "authenticated";

revoke delete on table "public"."clients" from "anon";

revoke insert on table "public"."clients" from "anon";

revoke select on table "public"."clients" from "anon";

revoke update on table "public"."clients" from "anon";

revoke delete on table "public"."clients" from "authenticated";

revoke insert on table "public"."clients" from "authenticated";

revoke select on table "public"."clients" from "authenticated";

revoke update on table "public"."clients" from "authenticated";

revoke delete on table "public"."coach_act_settings" from "anon";

revoke insert on table "public"."coach_act_settings" from "anon";

revoke select on table "public"."coach_act_settings" from "anon";

revoke update on table "public"."coach_act_settings" from "anon";

revoke delete on table "public"."coach_act_settings" from "authenticated";

revoke insert on table "public"."coach_act_settings" from "authenticated";

revoke select on table "public"."coach_act_settings" from "authenticated";

revoke update on table "public"."coach_act_settings" from "authenticated";

revoke delete on table "public"."coach_acts" from "anon";

revoke insert on table "public"."coach_acts" from "anon";

revoke select on table "public"."coach_acts" from "anon";

revoke update on table "public"."coach_acts" from "anon";

revoke delete on table "public"."coach_acts" from "authenticated";

revoke insert on table "public"."coach_acts" from "authenticated";

revoke select on table "public"."coach_acts" from "authenticated";

revoke update on table "public"."coach_acts" from "authenticated";

revoke delete on table "public"."coach_clients" from "anon";

revoke insert on table "public"."coach_clients" from "anon";

revoke select on table "public"."coach_clients" from "anon";

revoke update on table "public"."coach_clients" from "anon";

revoke delete on table "public"."coach_clients" from "authenticated";

revoke insert on table "public"."coach_clients" from "authenticated";

revoke select on table "public"."coach_clients" from "authenticated";

revoke update on table "public"."coach_clients" from "authenticated";

revoke delete on table "public"."coach_earnings" from "anon";

revoke insert on table "public"."coach_earnings" from "anon";

revoke select on table "public"."coach_earnings" from "anon";

revoke update on table "public"."coach_earnings" from "anon";

revoke delete on table "public"."coach_earnings" from "authenticated";

revoke insert on table "public"."coach_earnings" from "authenticated";

revoke select on table "public"."coach_earnings" from "authenticated";

revoke update on table "public"."coach_earnings" from "authenticated";

revoke delete on table "public"."coach_payout_rules" from "anon";

revoke insert on table "public"."coach_payout_rules" from "anon";

revoke select on table "public"."coach_payout_rules" from "anon";

revoke update on table "public"."coach_payout_rules" from "anon";

revoke delete on table "public"."coach_payout_rules" from "authenticated";

revoke insert on table "public"."coach_payout_rules" from "authenticated";

revoke select on table "public"."coach_payout_rules" from "authenticated";

revoke update on table "public"."coach_payout_rules" from "authenticated";

revoke delete on table "public"."coach_profiles" from "anon";

revoke insert on table "public"."coach_profiles" from "anon";

revoke select on table "public"."coach_profiles" from "anon";

revoke update on table "public"."coach_profiles" from "anon";

revoke delete on table "public"."coach_profiles" from "authenticated";

revoke insert on table "public"."coach_profiles" from "authenticated";

revoke select on table "public"."coach_profiles" from "authenticated";

revoke update on table "public"."coach_profiles" from "authenticated";

revoke delete on table "public"."coach_profiles" from "service_role";

revoke insert on table "public"."coach_profiles" from "service_role";

revoke update on table "public"."coach_profiles" from "service_role";

revoke delete on table "public"."content_earnings" from "anon";

revoke insert on table "public"."content_earnings" from "anon";

revoke select on table "public"."content_earnings" from "anon";

revoke update on table "public"."content_earnings" from "anon";

revoke delete on table "public"."content_earnings" from "authenticated";

revoke insert on table "public"."content_earnings" from "authenticated";

revoke select on table "public"."content_earnings" from "authenticated";

revoke update on table "public"."content_earnings" from "authenticated";

revoke delete on table "public"."exchange_rates" from "anon";

revoke insert on table "public"."exchange_rates" from "anon";

revoke select on table "public"."exchange_rates" from "anon";

revoke update on table "public"."exchange_rates" from "anon";

revoke delete on table "public"."exchange_rates" from "authenticated";

revoke insert on table "public"."exchange_rates" from "authenticated";

revoke select on table "public"."exchange_rates" from "authenticated";

revoke update on table "public"."exchange_rates" from "authenticated";

revoke delete on table "public"."exercise_library" from "anon";

revoke insert on table "public"."exercise_library" from "anon";

revoke select on table "public"."exercise_library" from "anon";

revoke update on table "public"."exercise_library" from "anon";

revoke delete on table "public"."exercise_library" from "authenticated";

revoke insert on table "public"."exercise_library" from "authenticated";

revoke select on table "public"."exercise_library" from "authenticated";

revoke update on table "public"."exercise_library" from "authenticated";

revoke delete on table "public"."exercise_submissions" from "anon";

revoke insert on table "public"."exercise_submissions" from "anon";

revoke select on table "public"."exercise_submissions" from "anon";

revoke update on table "public"."exercise_submissions" from "anon";

revoke delete on table "public"."exercise_submissions" from "authenticated";

revoke insert on table "public"."exercise_submissions" from "authenticated";

revoke select on table "public"."exercise_submissions" from "authenticated";

revoke update on table "public"."exercise_submissions" from "authenticated";

revoke delete on table "public"."instagram_posts" from "anon";

revoke insert on table "public"."instagram_posts" from "anon";

revoke select on table "public"."instagram_posts" from "anon";

revoke update on table "public"."instagram_posts" from "anon";

revoke delete on table "public"."instagram_posts" from "authenticated";

revoke insert on table "public"."instagram_posts" from "authenticated";

revoke select on table "public"."instagram_posts" from "authenticated";

revoke update on table "public"."instagram_posts" from "authenticated";

revoke delete on table "public"."leads" from "anon";

revoke insert on table "public"."leads" from "anon";

revoke select on table "public"."leads" from "anon";

revoke update on table "public"."leads" from "anon";

revoke delete on table "public"."leads" from "authenticated";

revoke insert on table "public"."leads" from "authenticated";

revoke select on table "public"."leads" from "authenticated";

revoke update on table "public"."leads" from "authenticated";

revoke delete on table "public"."leads_raw" from "anon";

revoke insert on table "public"."leads_raw" from "anon";

revoke select on table "public"."leads_raw" from "anon";

revoke update on table "public"."leads_raw" from "anon";

revoke delete on table "public"."leads_raw" from "authenticated";

revoke insert on table "public"."leads_raw" from "authenticated";

revoke select on table "public"."leads_raw" from "authenticated";

revoke update on table "public"."leads_raw" from "authenticated";

revoke delete on table "public"."lk_users" from "anon";

revoke insert on table "public"."lk_users" from "anon";

revoke select on table "public"."lk_users" from "anon";

revoke update on table "public"."lk_users" from "anon";

revoke delete on table "public"."lk_users" from "authenticated";

revoke insert on table "public"."lk_users" from "authenticated";

revoke select on table "public"."lk_users" from "authenticated";

revoke update on table "public"."lk_users" from "authenticated";

revoke delete on table "public"."n8n_webhook_logs" from "anon";

revoke insert on table "public"."n8n_webhook_logs" from "anon";

revoke select on table "public"."n8n_webhook_logs" from "anon";

revoke update on table "public"."n8n_webhook_logs" from "anon";

revoke delete on table "public"."n8n_webhook_logs" from "authenticated";

revoke insert on table "public"."n8n_webhook_logs" from "authenticated";

revoke select on table "public"."n8n_webhook_logs" from "authenticated";

revoke update on table "public"."n8n_webhook_logs" from "authenticated";

revoke delete on table "public"."pnl_entries" from "anon";

revoke insert on table "public"."pnl_entries" from "anon";

revoke select on table "public"."pnl_entries" from "anon";

revoke update on table "public"."pnl_entries" from "anon";

revoke delete on table "public"."pnl_entries" from "authenticated";

revoke insert on table "public"."pnl_entries" from "authenticated";

revoke select on table "public"."pnl_entries" from "authenticated";

revoke update on table "public"."pnl_entries" from "authenticated";

revoke delete on table "public"."program_template_exercise_groups" from "anon";

revoke insert on table "public"."program_template_exercise_groups" from "anon";

revoke select on table "public"."program_template_exercise_groups" from "anon";

revoke update on table "public"."program_template_exercise_groups" from "anon";

revoke delete on table "public"."program_template_exercise_groups" from "authenticated";

revoke insert on table "public"."program_template_exercise_groups" from "authenticated";

revoke select on table "public"."program_template_exercise_groups" from "authenticated";

revoke update on table "public"."program_template_exercise_groups" from "authenticated";

revoke delete on table "public"."program_template_exercises" from "anon";

revoke insert on table "public"."program_template_exercises" from "anon";

revoke select on table "public"."program_template_exercises" from "anon";

revoke update on table "public"."program_template_exercises" from "anon";

revoke delete on table "public"."program_template_exercises" from "authenticated";

revoke insert on table "public"."program_template_exercises" from "authenticated";

revoke select on table "public"."program_template_exercises" from "authenticated";

revoke update on table "public"."program_template_exercises" from "authenticated";

revoke delete on table "public"."program_template_workouts" from "anon";

revoke insert on table "public"."program_template_workouts" from "anon";

revoke select on table "public"."program_template_workouts" from "anon";

revoke update on table "public"."program_template_workouts" from "anon";

revoke delete on table "public"."program_template_workouts" from "authenticated";

revoke insert on table "public"."program_template_workouts" from "authenticated";

revoke select on table "public"."program_template_workouts" from "authenticated";

revoke update on table "public"."program_template_workouts" from "authenticated";

revoke delete on table "public"."program_templates" from "anon";

revoke insert on table "public"."program_templates" from "anon";

revoke select on table "public"."program_templates" from "anon";

revoke update on table "public"."program_templates" from "anon";

revoke delete on table "public"."program_templates" from "authenticated";

revoke insert on table "public"."program_templates" from "authenticated";

revoke select on table "public"."program_templates" from "authenticated";

revoke update on table "public"."program_templates" from "authenticated";

revoke delete on table "public"."purchase_match_warnings" from "anon";

revoke insert on table "public"."purchase_match_warnings" from "anon";

revoke select on table "public"."purchase_match_warnings" from "anon";

revoke update on table "public"."purchase_match_warnings" from "anon";

revoke delete on table "public"."purchase_match_warnings" from "authenticated";

revoke insert on table "public"."purchase_match_warnings" from "authenticated";

revoke select on table "public"."purchase_match_warnings" from "authenticated";

revoke update on table "public"."purchase_match_warnings" from "authenticated";

revoke delete on table "public"."purchase_match_warnings" from "service_role";

revoke insert on table "public"."purchase_match_warnings" from "service_role";

revoke select on table "public"."purchase_match_warnings" from "service_role";

revoke update on table "public"."purchase_match_warnings" from "service_role";

revoke delete on table "public"."purchases" from "anon";

revoke insert on table "public"."purchases" from "anon";

revoke select on table "public"."purchases" from "anon";

revoke update on table "public"."purchases" from "anon";

revoke delete on table "public"."purchases" from "authenticated";

revoke insert on table "public"."purchases" from "authenticated";

revoke select on table "public"."purchases" from "authenticated";

revoke update on table "public"."purchases" from "authenticated";

revoke delete on table "public"."sales_funnel" from "anon";

revoke insert on table "public"."sales_funnel" from "anon";

revoke select on table "public"."sales_funnel" from "anon";

revoke update on table "public"."sales_funnel" from "anon";

revoke delete on table "public"."sales_funnel" from "authenticated";

revoke insert on table "public"."sales_funnel" from "authenticated";

revoke select on table "public"."sales_funnel" from "authenticated";

revoke update on table "public"."sales_funnel" from "authenticated";

revoke delete on table "public"."sales_funnel_events" from "anon";

revoke insert on table "public"."sales_funnel_events" from "anon";

revoke select on table "public"."sales_funnel_events" from "anon";

revoke update on table "public"."sales_funnel_events" from "anon";

revoke delete on table "public"."sales_funnel_events" from "authenticated";

revoke insert on table "public"."sales_funnel_events" from "authenticated";

revoke select on table "public"."sales_funnel_events" from "authenticated";

revoke update on table "public"."sales_funnel_events" from "authenticated";

revoke delete on table "public"."scheduled_workouts" from "anon";

revoke insert on table "public"."scheduled_workouts" from "anon";

revoke select on table "public"."scheduled_workouts" from "anon";

revoke update on table "public"."scheduled_workouts" from "anon";

revoke delete on table "public"."scheduled_workouts" from "authenticated";

revoke insert on table "public"."scheduled_workouts" from "authenticated";

revoke select on table "public"."scheduled_workouts" from "authenticated";

revoke update on table "public"."scheduled_workouts" from "authenticated";

revoke delete on table "public"."studio_cost_rules" from "anon";

revoke insert on table "public"."studio_cost_rules" from "anon";

revoke select on table "public"."studio_cost_rules" from "anon";

revoke update on table "public"."studio_cost_rules" from "anon";

revoke delete on table "public"."studio_cost_rules" from "authenticated";

revoke insert on table "public"."studio_cost_rules" from "authenticated";

revoke select on table "public"."studio_cost_rules" from "authenticated";

revoke update on table "public"."studio_cost_rules" from "authenticated";

revoke delete on table "public"."studio_costs" from "anon";

revoke insert on table "public"."studio_costs" from "anon";

revoke select on table "public"."studio_costs" from "anon";

revoke update on table "public"."studio_costs" from "anon";

revoke delete on table "public"."studio_costs" from "authenticated";

revoke insert on table "public"."studio_costs" from "authenticated";

revoke select on table "public"."studio_costs" from "authenticated";

revoke update on table "public"."studio_costs" from "authenticated";

revoke delete on table "public"."studios" from "anon";

revoke insert on table "public"."studios" from "anon";

revoke select on table "public"."studios" from "anon";

revoke update on table "public"."studios" from "anon";

revoke delete on table "public"."studios" from "authenticated";

revoke insert on table "public"."studios" from "authenticated";

revoke select on table "public"."studios" from "authenticated";

revoke update on table "public"."studios" from "authenticated";

revoke delete on table "public"."studios" from "service_role";

revoke insert on table "public"."studios" from "service_role";

revoke update on table "public"."studios" from "service_role";

revoke delete on table "public"."tg_workout_messages" from "anon";

revoke insert on table "public"."tg_workout_messages" from "anon";

revoke select on table "public"."tg_workout_messages" from "anon";

revoke update on table "public"."tg_workout_messages" from "anon";

revoke delete on table "public"."tg_workout_messages" from "authenticated";

revoke insert on table "public"."tg_workout_messages" from "authenticated";

revoke select on table "public"."tg_workout_messages" from "authenticated";

revoke update on table "public"."tg_workout_messages" from "authenticated";

revoke delete on table "public"."training_formats" from "anon";

revoke insert on table "public"."training_formats" from "anon";

revoke select on table "public"."training_formats" from "anon";

revoke update on table "public"."training_formats" from "anon";

revoke delete on table "public"."training_formats" from "authenticated";

revoke insert on table "public"."training_formats" from "authenticated";

revoke select on table "public"."training_formats" from "authenticated";

revoke update on table "public"."training_formats" from "authenticated";

revoke delete on table "public"."training_formats" from "service_role";

revoke insert on table "public"."training_formats" from "service_role";

revoke update on table "public"."training_formats" from "service_role";


