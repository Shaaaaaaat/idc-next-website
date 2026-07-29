create or replace function public.get_daily_student_metrics_report()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
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
$function$;

revoke execute
on function public.get_daily_student_metrics_report()
from public, anon, authenticated;

grant execute
on function public.get_daily_student_metrics_report()
to service_role;

do $migration$
declare
  v_project_url text := 'https://ahmwnchujgenbkpjyxdz.supabase.co';
  v_secret_name text := 'cron_edge_function_bearer';
  v_command text;
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'daily-metrics-report'
  ) then
    perform cron.unschedule('daily-metrics-report');
  end if;

  select format(
    $cmd$select
  net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select secret
          from vault.decrypted_secrets
          where name = %L
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
  );$cmd$,
    v_project_url || '/functions/v1/daily-metrics-report',
    v_secret_name
  ) into v_command;

  perform cron.schedule(
    'daily-metrics-report',
    '0 6 * * *',
    v_command
  );
end;
$migration$;
