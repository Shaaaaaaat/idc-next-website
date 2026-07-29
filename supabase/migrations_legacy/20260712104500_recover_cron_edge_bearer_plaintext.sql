-- The previous cron reliability migration moved Edge Function bearer lookup to
-- Vault, but cron commands must read vault.decrypted_secrets.decrypted_secret
-- rather than the encrypted storage column.
do $migration$
declare
  v_project_url text := 'https://ahmwnchujgenbkpjyxdz.supabase.co';
  v_secret_name text := 'cron_edge_function_bearer';
  v_secret_id uuid;
  v_recovered_bearer text;
  v_job record;
  v_existing_job record;
  v_command text;
begin
  select id
    into v_secret_id
  from vault.secrets
  where name = v_secret_name;

  if v_secret_id is null then
    raise exception 'Vault secret % is missing', v_secret_name;
  end if;

  select nullif(
    regexp_replace(
      regexp_replace((regexp_match(command, $re$Bearer ([^'"}[:space:]]+)$re$))[1], '[[:cntrl:]]', '', 'g'),
      '\s+',
      '',
      'g'
    ),
    ''
  )
    into v_recovered_bearer
  from cron.job_run_details
  where command like '%Authorization%Bearer %'
    and command not like '%vault.decrypted_secrets%'
    and jobid in (1, 2, 3, 6)
    and (regexp_match(command, $re$Bearer ([^'"}[:space:]]+)$re$))[1] is not null
  order by start_time desc
  limit 1;

  if v_recovered_bearer is null then
    select nullif(
      regexp_replace(
        regexp_replace(coalesce(decrypted_secret, ''), '[[:cntrl:]]', '', 'g'),
        '\s+',
        '',
        'g'
      ),
      ''
    )
      into v_recovered_bearer
    from vault.decrypted_secrets
    where name = v_secret_name
    limit 1;
  end if;

  if v_recovered_bearer is null then
    raise exception 'No usable bearer found for %', v_secret_name;
  end if;

  if lower(left(v_recovered_bearer, 7)) = 'bearer ' then
    v_recovered_bearer := nullif(trim(substr(v_recovered_bearer, 8)), '');
  end if;

  if v_recovered_bearer is null then
    raise exception 'Recovered bearer for % contains only an authorization prefix', v_secret_name;
  end if;

  perform vault.update_secret(
    v_secret_id,
    v_recovered_bearer,
    v_secret_name,
    'Bearer token for pg_cron Edge Function invocations',
    null
  );

  for v_job in
    select *
    from (
      values
        ('process-coach-acts-daily'::text, 'process-coach-acts-daily'::text, '0 7 * * *'::text),
        ('process-expired-clients-daily'::text, 'process-expired-clients-daily'::text, '0 7 * * *'::text),
        ('update_exchange_rates_daily'::text, 'update-exchange-rates'::text, '0 6 * * *'::text),
        ('hourly-reliability-monitor'::text, 'hourly-reliability-monitor'::text, '0 * * * *'::text)
    ) as target(jobname, function_slug, schedule)
  loop
    select *
      into v_existing_job
    from cron.job
    where jobname = v_job.jobname;

    if not found then
      raise exception 'Expected cron job % was not found', v_job.jobname;
    end if;

    select format(
      $cmd$select
  net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select nullif(
            regexp_replace(
              regexp_replace(coalesce(decrypted_secret, ''), '[[:cntrl:]]', '', 'g'),
              '\s+',
              '',
              'g'
            ),
            ''
          )
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

    perform cron.alter_job(
      job_id := v_existing_job.jobid,
      schedule := v_job.schedule,
      command := v_command,
      active := true
    );
  end loop;
end;
$migration$;
