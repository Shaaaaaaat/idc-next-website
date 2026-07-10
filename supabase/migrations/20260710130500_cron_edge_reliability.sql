alter table public.n8n_webhook_logs
  add column if not exists attempt_count integer not null default 1,
  add column if not exists delivery_status text,
  add column if not exists error_code text;

create or replace function public.reliability_monitor_pg_net_failure_summary(
  p_since timestamptz,
  p_limit integer default 10
)
returns table(
  failure_count bigint,
  sample_ids bigint[],
  sample_status_codes integer[],
  sample_errors text[]
)
language sql
security definer
set search_path = public, net
as $function$
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
$function$;

create or replace function public.reliability_monitor_cron_job_status()
returns table(
  jobname text,
  schedule text,
  active boolean,
  job_exists boolean
)
language sql
security definer
set search_path = public, cron
as $function$
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
$function$;

grant execute on function public.reliability_monitor_pg_net_failure_summary(timestamptz, integer) to service_role;
grant execute on function public.reliability_monitor_cron_job_status() to service_role;

do $migration$
declare
  v_project_url text := 'https://ahmwnchujgenbkpjyxdz.supabase.co';
  v_secret_name text := 'cron_edge_function_bearer';
  v_existing_bearer text;
  v_secret_id uuid;
  v_job record;
  v_existing_job record;
  v_command text;
begin
  select (regexp_match(command, $re$Bearer ([^"'}]+)$re$))[1]
    into v_existing_bearer
  from cron.job
  where jobname in (
    'process-coach-acts-daily',
    'process-expired-clients-daily',
    'update_exchange_rates_daily'
  )
    and command like '%Bearer %'
  limit 1;

  select id
    into v_secret_id
  from vault.secrets
  where name = v_secret_name;

  if v_secret_id is null and nullif(v_existing_bearer, '') is null then
    raise exception 'Vault secret % is missing and no existing cron bearer could be extracted', v_secret_name;
  end if;

  if nullif(v_existing_bearer, '') is not null then
    if v_secret_id is null then
      perform vault.create_secret(
        v_existing_bearer,
        v_secret_name,
        'Bearer token for pg_cron Edge Function invocations',
        null
      );
    else
      perform vault.update_secret(
        v_secret_id,
        v_existing_bearer,
        v_secret_name,
        'Bearer token for pg_cron Edge Function invocations',
        null
      );
    end if;
  end if;

  for v_job in
    select *
    from (
      values
        ('process-coach-acts-daily'::text, 'process-coach-acts-daily'::text),
        ('process-expired-clients-daily'::text, 'process-expired-clients-daily'::text),
        ('update_exchange_rates_daily'::text, 'update-exchange-rates'::text)
    ) as target(jobname, function_slug)
  loop
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
      v_project_url || '/functions/v1/' || v_job.function_slug,
      v_secret_name
    ) into v_command;

    select *
      into v_existing_job
    from cron.job
    where jobname = v_job.jobname;

    if not found then
      raise exception 'Expected cron job % was not found', v_job.jobname;
    end if;

    perform cron.alter_job(
      job_id := v_existing_job.jobid,
      command := v_command
    );
  end loop;

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
    v_project_url || '/functions/v1/hourly-reliability-monitor',
    v_secret_name
  ) into v_command;

  if exists (select 1 from cron.job where jobname = 'hourly-reliability-monitor') then
    select *
      into v_existing_job
    from cron.job
    where jobname = 'hourly-reliability-monitor';

    perform cron.alter_job(
      job_id := v_existing_job.jobid,
      schedule := '0 * * * *',
      command := v_command,
      active := true
    );
  else
    perform cron.schedule(
      'hourly-reliability-monitor',
      '0 * * * *',
      v_command
    );
  end if;
end;
$migration$;
