alter table public.studios
  add column if not exists tgid text;

create table if not exists public.studio_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  report_month date not null,
  recipient_tgid text not null,
  studio_title_snapshot text not null,
  total_amount numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  notification_event_id uuid references public.client_notification_events(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint studio_monthly_reports_total_positive_check check (total_amount > 0),
  constraint studio_monthly_reports_recipient_tgid_check check (nullif(trim(recipient_tgid), '') is not null),
  constraint studio_monthly_reports_unique_month unique (studio_id, report_month)
);

alter table public.client_notification_events
  drop constraint if exists client_notification_events_recipient_type_check;

alter table public.client_notification_events
  add constraint client_notification_events_recipient_type_check
  check (recipient_type = any (array['client'::text, 'trainer'::text, 'admin'::text, 'coach'::text, 'studio'::text]));

create index if not exists idx_studio_monthly_reports_month
  on public.studio_monthly_reports(report_month desc);

create index if not exists idx_studio_monthly_reports_studio_month
  on public.studio_monthly_reports(studio_id, report_month desc);

create index if not exists idx_studio_monthly_reports_event
  on public.studio_monthly_reports(notification_event_id);

comment on column public.studios.tgid is 'Telegram chat id for the studio manager monthly report recipient.';
comment on table public.studio_monthly_reports is 'Exactly-once ledger for monthly studio Telegram reports.';

revoke all on table public.studio_monthly_reports from anon;
revoke all on table public.studio_monthly_reports from authenticated;
grant all on table public.studio_monthly_reports to service_role;

create or replace function public.enqueue_monthly_studio_reports(p_report_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_report_month date := date_trunc(
    'month',
    coalesce(p_report_month, (current_date - interval '1 month')::date)
  )::date;
  v_next_month_start date := (date_trunc(
    'month',
    coalesce(p_report_month, (current_date - interval '1 month')::date)
  ) + interval '1 month')::date;
  v_period_end date := (v_next_month_start - interval '1 day')::date;
  v_inserted integer := 0;
  v_enqueued integer := 0;
  v_report public.studio_monthly_reports%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_event_id uuid;
  v_event_status text;
begin
  with base as (
    select
      p.id,
      p.studio_id,
      s.title as studio_title,
      trim(s.tgid) as recipient_tgid,
      p.workout_date,
      coalesce(p.scheduled_workout_id, p.id) as dedupe_workout_id,
      case
        when coalesce(tf.slug, lower(trim(coalesce(p.training_format_snapshot, '')))) in (
          'personal',
          'split',
          'персональная тренировка',
          'сплит-тренировка'
        ) then 'Персональная тренировка'
        when coalesce(tf.slug, lower(trim(coalesce(p.training_format_snapshot, '')))) in (
          'group',
          'групповая тренировка'
        ) then 'Групповая тренировка'
        else coalesce(nullif(trim(p.training_format_snapshot), ''), tf.slug, '—')
      end as normalized_format,
      p.studio_expense_amount
    from public.pnl_entries p
    join public.studios s on s.id = p.studio_id
    left join public.training_formats tf on tf.id = p.training_format_id
    where coalesce(s.is_active, true) = true
      and nullif(trim(s.tgid), '') is not null
      and p.workout_date >= v_report_month
      and p.workout_date < v_next_month_start
      and coalesce(p.studio_expense_amount, 0) > 0
      and p.reversed_at is null
  ),
  dedup as (
    select
      studio_id,
      studio_title,
      recipient_tgid,
      workout_date,
      dedupe_workout_id,
      normalized_format,
      max(studio_expense_amount) as amount
    from base
    group by
      studio_id,
      studio_title,
      recipient_tgid,
      workout_date,
      dedupe_workout_id,
      normalized_format
  ),
  breakdown as (
    select
      studio_id,
      studio_title,
      recipient_tgid,
      workout_date,
      normalized_format,
      count(*) as item_count,
      sum(amount) as amount
    from dedup
    group by
      studio_id,
      studio_title,
      recipient_tgid,
      workout_date,
      normalized_format
  ),
  reports as (
    select
      studio_id,
      studio_title,
      recipient_tgid,
      sum(amount) as total_amount,
      jsonb_agg(
        jsonb_build_object(
          'workout_date', workout_date,
          'format', normalized_format,
          'count', item_count,
          'amount', amount
        )
        order by workout_date asc, normalized_format asc
      ) as breakdown
    from breakdown
    group by studio_id, studio_title, recipient_tgid
    having sum(amount) > 0
  ),
  inserted as (
    insert into public.studio_monthly_reports (
      studio_id,
      report_month,
      recipient_tgid,
      studio_title_snapshot,
      total_amount,
      payload
    )
    select
      studio_id,
      v_report_month,
      recipient_tgid,
      studio_title,
      total_amount,
      jsonb_build_object(
        'studio_id', studio_id,
        'studio_title', studio_title,
        'report_month', v_report_month,
        'period_start', v_report_month,
        'period_end', v_period_end,
        'recipient_tgid', recipient_tgid,
        'total_amount', total_amount,
        'breakdown', breakdown
      )
    from reports
    on conflict (studio_id, report_month) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  for v_report in
    select *
    from public.studio_monthly_reports
    where report_month = v_report_month
      and notification_event_id is null
      and nullif(trim(recipient_tgid), '') is not null
      and total_amount > 0
    order by studio_title_snapshot asc
  loop
    v_payload := v_report.payload || jsonb_build_object(
      'report_id', v_report.id,
      'studio_id', v_report.studio_id,
      'studio_title', v_report.studio_title_snapshot,
      'report_month', v_report.report_month,
      'recipient_tgid', v_report.recipient_tgid,
      'total_amount', v_report.total_amount
    );

    update public.studio_monthly_reports
    set
      payload = v_payload,
      updated_at = now()
    where id = v_report.id;

    v_payload_hash := encode(
      digest(
        'studio_monthly_report' || '|' ||
        'studio_monthly_reports' || '|' ||
        v_report.id::text || '|' ||
        'studio' || '|' ||
        'telegram' || '|' ||
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
      null::uuid,
      'studio_monthly_report',
      'studio_monthly_reports',
      v_report.id::text,
      'studio',
      'telegram',
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
        when public.client_notification_events.status in ('sent', 'skipped', 'failed')
          then public.client_notification_events.next_attempt_at
        else now()
      end
    returning id, status into v_event_id, v_event_status;

    if v_event_id is not null then
      update public.studio_monthly_reports
      set
        notification_event_id = v_event_id,
        updated_at = now()
      where id = v_report.id
        and notification_event_id is null;

      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'report_month', v_report_month,
    'period_start', v_report_month,
    'period_end', v_period_end,
    'inserted', v_inserted,
    'enqueued', v_enqueued
  );
end;
$$;

revoke all on function public.enqueue_monthly_studio_reports(date) from public;
grant execute on function public.enqueue_monthly_studio_reports(date) to service_role;

create or replace function public.dispatch_due_client_notification_events(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  v_event record;
  v_function_url text;
  v_secret text;
  v_request_id bigint;
  v_dispatched integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
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
    raise warning 'notification dispatcher config missing in Vault';
    return jsonb_build_object(
      'ok', false,
      'error', 'notification_config_missing',
      'dispatched', 0
    );
  end if;

  for v_event in
    select id
    from public.client_notification_events
    where status = 'pending'
      and next_attempt_at is not null
      and next_attempt_at <= now()
      and event_type in (
        'purchase_paid_admin',
        'purchase_paid_client',
        'purchase_paid_coach',
        'studio_monthly_report'
      )
    order by next_attempt_at asc, created_at asc
    limit v_limit
  loop
    select net.http_post(
      url := v_function_url,
      body := jsonb_build_object('eventId', v_event.id),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-notifications-secret', v_secret
      ),
      timeout_milliseconds := 20000
    )
    into v_request_id;

    v_dispatched := v_dispatched + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dispatched', v_dispatched,
    'limit', v_limit
  );
exception
  when others then
    raise warning 'notification dispatcher failed: %', sqlerrm;
    return jsonb_build_object(
      'ok', false,
      'error', 'notification_dispatch_failed',
      'message', left(sqlerrm, 500),
      'dispatched', v_dispatched
    );
end;
$$;

revoke all on function public.dispatch_due_client_notification_events(integer) from public;
grant execute on function public.dispatch_due_client_notification_events(integer) to service_role;

do $migration$
declare
  v_job_id bigint;
begin
  begin
    perform cron.unschedule('monthly_studio_reports_enqueue');
  exception
    when others then
      null;
  end;

  select cron.schedule(
    'monthly_studio_reports_enqueue',
    '0 9 1 * *',
    $$select public.enqueue_monthly_studio_reports();$$
  )
  into v_job_id;

  perform cron.alter_job(
    job_id => v_job_id,
    active => false
  );
end;
$migration$;
