alter table public.client_notification_events
  add column if not exists attempt_count integer not null default 0;

alter table public.client_notification_events
  add column if not exists last_attempt_at timestamptz;

alter table public.client_notification_events
  add column if not exists next_attempt_at timestamptz;

alter table public.client_notification_events
  add column if not exists last_alerted_at timestamptz;

create or replace function public.enqueue_client_notification_event(
  p_client_id uuid,
  p_event_type text,
  p_source_table text default null::text,
  p_source_id text default null::text,
  p_recipient_type text default 'client'::text,
  p_channel text default 'telegram'::text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault'
as $function$
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
$function$;

do $$
begin
  begin
    perform cron.unschedule('client_notifications_stale_finalizer');
  exception
    when others then
      null;
  end;

  perform cron.schedule(
    'client_notifications_stale_finalizer',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CLIENT_NOTIFICATIONS_ENGINE_URL'
        limit 1
      ),
      body := jsonb_build_object('mode', 'finalize_stale'),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-notifications-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'NOTIFICATIONS_INTERNAL_SECRET'
          limit 1
        )
      ),
      timeout_milliseconds := 20000
    );
    $cron$
  );
end $$;
