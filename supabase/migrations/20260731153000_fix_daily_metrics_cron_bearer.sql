do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'daily-metrics-report'
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'daily-metrics-report',
      '0 6 * * *',
      $cron$
      select net.http_post(
        url := 'https://ahmwnchujgenbkpjyxdz.supabase.co/functions/v1/daily-metrics-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_edge_function_bearer'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
      $cron$
    );
  else
    perform cron.alter_job(
      v_job_id,
      schedule := '0 6 * * *',
      command := $cron$
      select net.http_post(
        url := 'https://ahmwnchujgenbkpjyxdz.supabase.co/functions/v1/daily-metrics-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_edge_function_bearer'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
      $cron$,
      active := true
    );
  end if;
end
$$;