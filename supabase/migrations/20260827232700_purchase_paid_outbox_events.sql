-- Notification-only cutover support for successful-payment Telegram messages.
-- Bot-origin purchases already create canonical public.purchases rows before
-- paid processing. Do not mirror Airtable bot purchases in this backend task;
-- the known bot-side payment-link race is a follow-up in the bot flow.

create or replace function public.purchase_paid_notification_payload(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.purchases%rowtype;
begin
  select *
  into p
  from public.purchases
  where id = p_purchase_id;

  if not found then
    return '{}'::jsonb;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'purchase_id', p.id,
    'transaction_id', nullif(trim(coalesce(p.id_payment, '')), ''),
    'source_channel', nullif(trim(coalesce(p.source_channel, '')), ''),
    'client_name', nullif(trim(coalesce(p.fi, '')), ''),
    'email', nullif(trim(coalesce(p.email, '')), ''),
    'phone', nullif(trim(coalesce(p.phone, '')), ''),
    'sum', p.sum,
    'currency', nullif(trim(coalesce(p.currency, '')), ''),
    'lessons', p.lessons,
    'price_per_lesson', p.price_per_lesson,
    'course_name', nullif(trim(coalesce(p.course_name, '')), ''),
    'tag', nullif(trim(coalesce(p.tag, '')), ''),
    'tariff_label', nullif(trim(coalesce(p.tariff_label, '')), ''),
    'studio_slug', nullif(trim(coalesce(p.studio_slug, '')), ''),
    'slot_start_at', p.slot_start_at,
    'format', nullif(trim(coalesce(p.format, '')), ''),
    'template_version', 1
  ));
end;
$$;

revoke all on function public.purchase_paid_notification_payload(uuid) from public;
grant execute on function public.purchase_paid_notification_payload(uuid) to service_role;

do $migration$
declare
  v_sql text;
  v_return_anchor text := $anchor$  return jsonb_build_object(
    'ok', true,
    'client_id', v_client_id,$anchor$;
  v_return_replacement text := $replacement$  begin
    perform public.enqueue_client_notification_event(
      v_client_id,
      'purchase_paid_admin',
      'purchases',
      p_purchase_id::text,
      'admin',
      'admin_telegram',
      public.purchase_paid_notification_payload(p_purchase_id)
    );

    if v_tgid is not null
      and lower(coalesce(nullif(trim(coalesce(p.source_channel, '')), ''), 'bot')) <> 'website' then
      perform public.enqueue_client_notification_event(
        v_client_id,
        'purchase_paid_client',
        'purchases',
        p_purchase_id::text,
        'client',
        'telegram',
        public.purchase_paid_notification_payload(p_purchase_id)
      );
    end if;

    if v_format = 'gym'
      and (lower(coalesce(nullif(trim(coalesce(p.tariff_label, '')), ''), '')) = 'trial'
        or p.slot_start_at is not null)
      and lower(coalesce(nullif(trim(coalesce(p.studio_slug, '')), ''), '')) in (
        'msk_youcan',
        'msk_elfit',
        'spb_spirit',
        'spb_hkc'
      )
      and (
        lower(coalesce(nullif(trim(coalesce(p.source_channel, '')), ''), 'bot')) = 'website'
        or v_tgid is not null
      ) then
      perform public.enqueue_client_notification_event(
        v_client_id,
        'purchase_paid_coach',
        'purchases',
        p_purchase_id::text,
        'coach',
        'telegram',
        public.purchase_paid_notification_payload(p_purchase_id)
      );
    end if;
  exception
    when others then
      raise warning 'purchase_paid notification enqueue failed for purchase %, client %: %',
        p_purchase_id,
        v_client_id,
        sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'client_id', v_client_id,$replacement$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('purchase_paid_admin' in v_sql) > 0 then
    raise notice 'process_paid_purchase already enqueues purchase_paid_* notification events';
    return;
  end if;

  if position('subscription_purchase_trainer' in v_sql) = 0 then
    raise exception 'Expected subscription_purchase_trainer block before purchase_paid_* patch';
  end if;

  if position(v_return_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase success return anchor was not found';
  end if;

  v_sql := replace(v_sql, v_return_anchor, v_return_replacement);
  execute v_sql;
end;
$migration$;

create or replace function public.match_purchase_by_tg_token(
  p_token text,
  p_tgid text,
  p_username text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p purchases%rowtype;
  v_client_id uuid;
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

  if lower(coalesce(p.source_channel, '')) = 'website'
    and lower(coalesce(p.status, '')) in ('paid', 'matched')
    and nullif(trim(coalesce(p_tgid, '')), '') is not null then
    v_client_id := p.processed_client_id;

    if v_client_id is not null then
      perform public.enqueue_client_notification_event(
        v_client_id,
        'purchase_paid_client',
        'purchases',
        p.id::text,
        'client',
        'telegram',
        public.purchase_paid_notification_payload(p.id)
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'purchase_id', p.id,
    'status', 'matched'
  );
end;
$$;

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
    raise warning 'purchase_paid notification dispatcher config missing in Vault';
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
        'purchase_paid_coach'
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
    raise warning 'purchase_paid notification dispatcher failed: %', sqlerrm;
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
begin
  begin
    perform cron.unschedule('purchase_paid_notification_retry_dispatcher');
  exception
    when others then
      null;
  end;

  perform cron.schedule(
    'purchase_paid_notification_retry_dispatcher',
    '* * * * *',
    $$select public.dispatch_due_client_notification_events(50);$$
  );
end;
$migration$;
