alter table public.client_notification_events
  add column if not exists provider text;

alter table public.client_notification_events
  add column if not exists provider_message_id text;

comment on column public.client_notification_events.provider is
  'External delivery provider used for the final send, for example resend.';

comment on column public.client_notification_events.provider_message_id is
  'Provider message id for successful external deliveries. Do not store full provider responses.';

do $migration$
declare
  v_sql text;
  v_anchor text := $anchor$  v_payload_hash := encode(
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
  );$anchor$;
  v_replacement text := $replacement$  if p_channel = 'email'
    and p_event_type in (
      'first_online_purchase_welcome_email',
      'strength_test_instruction_email'
    ) then
    v_payload_hash := encode(
      digest(
        coalesce(p_event_type, '') || '|' ||
        coalesce(p_source_table, '') || '|' ||
        coalesce(p_source_id, '') || '|' ||
        coalesce(p_recipient_type, '') || '|' ||
        coalesce(p_channel, ''),
        'sha256'
      ),
      'hex'
    );
  else
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
  end if;$replacement$;
begin
  select pg_get_functiondef('public.enqueue_client_notification_event(uuid,text,text,text,text,text,jsonb)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'enqueue_client_notification_event(...) does not exist';
  end if;

  if position('first_online_purchase_welcome_email' in v_sql) > 0
    and position('strength_test_instruction_email' in v_sql) > 0 then
    raise notice 'enqueue_client_notification_event already has first-purchase email hash rules';
    return;
  end if;

  if position(v_anchor in v_sql) = 0 then
    raise exception 'Expected enqueue_client_notification_event payload hash anchor was not found';
  end if;

  v_sql := replace(v_sql, v_anchor, v_replacement);

  execute v_sql;
end;
$migration$;

-- Reconciliation check, intentionally not an automatic backfill:
--
-- The current schema does not persist an independent reliable relation proving
-- that a client row was created by a specific purchase after the RPC completes.
-- Do not infer first-purchase status from timestamp equality. This narrower
-- check only finds processed purchases where one first-purchase email event is
-- already persisted but its sibling event is missing.
--
-- select
--   p.id as purchase_id,
--   p.processed_client_id,
--   upper(coalesce(p.currency, '')) as currency,
--   bool_or(e.event_type = 'first_online_purchase_welcome_email') as has_welcome_email,
--   bool_or(e.event_type = 'strength_test_instruction_email') as has_instruction_email
-- from public.purchases p
-- join public.client_notification_events e
--   on e.source_table = 'purchases'
--  and e.source_id = p.id::text
--  and e.channel = 'email'
--  and e.event_type in (
--    'first_online_purchase_welcome_email',
--    'strength_test_instruction_email'
--  )
-- where p.processed_at is not null
--   and upper(coalesce(p.currency, '')) in ('USD', 'EUR')
-- group by p.id, p.processed_client_id, upper(coalesce(p.currency, ''))
-- having count(distinct e.event_type) < 2;

do $migration$
declare
  v_sql text;
  v_declaration_anchor text := '  v_service_type text;' || chr(10) || '  v_coach_id uuid;';
  v_declaration_replacement text := '  v_service_type text;' || chr(10) ||
    '  v_coach_id uuid;' || chr(10) ||
    '  v_is_new_client boolean := false;' || chr(10) ||
    '  v_valid_weeks integer;' || chr(10) ||
    '  v_welcome_event_id uuid;' || chr(10) ||
    '  v_instruction_event_id uuid;';
  v_new_client_anchor text := $anchor$  v_client_id := v_existing_client.id;$anchor$;
  v_new_client_replacement text := $replacement$  v_is_new_client := v_existing_client.id is null;

  v_client_id := v_existing_client.id;$replacement$;
  v_purchase_update_anchor text := $anchor$  update purchases
  set
    price_per_lesson = case when v_lessons > 0 then v_price else price_per_lesson end,
    processed_at = now(),
    processed_client_id = v_client_id,
    updated_at = now()
  where id = p_purchase_id;

  return jsonb_build_object($anchor$;
  v_purchase_update_replacement text := $replacement$  update purchases
  set
    price_per_lesson = case when v_lessons > 0 then v_price else price_per_lesson end,
    processed_at = now(),
    processed_client_id = v_client_id,
    updated_at = now()
  where id = p_purchase_id;

  begin
    if v_is_new_client
      and v_service_type = 'ds'
      and v_currency in ('USD', 'EUR')
      and not v_is_balance_only
      and v_email is not null
      and v_client_id is not null then

      v_valid_weeks := case
        when v_plan_tag in ('short1', 'short12') then 4
        when v_plan_tag = 'long12' then 8
        when v_plan_tag = 'long36' then 18
        else null
      end;

      if v_valid_weeks is null then
        raise warning 'first_purchase_email_duration_mapping_missing for purchase %', p_purchase_id;
      else
        v_welcome_event_id := public.enqueue_client_notification_event(
          v_client_id,
          'first_online_purchase_welcome_email',
          'purchases',
          p_purchase_id::text,
          'client',
          'email',
          jsonb_build_object(
            'purchase_id', p_purchase_id,
            'client_id', v_client_id,
            'recipient_email', v_email,
            'client_name', v_fio,
            'course_name', v_course,
            'tariff_label', coalesce(nullif(trim(coalesce(p.tariff_label, '')), ''), v_course),
            'currency', v_currency,
            'valid_weeks', v_valid_weeks,
            'telegram_url', case
              when nullif(trim(coalesce(p.tg_link_token, '')), '') is not null
                then 'https://t.me/IDCMAIN_bot?start=' || trim(p.tg_link_token)
              else 'https://t.me/IDCMAIN_bot'
            end,
            'template_version', 1,
            'sender_profile', 'international'
          )
        );

        v_instruction_event_id := public.enqueue_client_notification_event(
          v_client_id,
          'strength_test_instruction_email',
          'purchases',
          p_purchase_id::text,
          'client',
          'email',
          jsonb_build_object(
            'purchase_id', p_purchase_id,
            'client_id', v_client_id,
            'recipient_email', v_email,
            'client_name', v_fio,
            'course_name', v_course,
            'tariff_label', coalesce(nullif(trim(coalesce(p.tariff_label, '')), ''), v_course),
            'currency', v_currency,
            'valid_weeks', v_valid_weeks,
            'telegram_url', case
              when nullif(trim(coalesce(p.tg_link_token, '')), '') is not null
                then 'https://t.me/IDCMAIN_bot?start=' || trim(p.tg_link_token)
              else 'https://t.me/IDCMAIN_bot'
            end,
            'template_version', 1,
            'sender_profile', 'international'
          )
        );

        if v_instruction_event_id is not null then
          update public.client_notification_events
          set next_attempt_at = now() + interval '2 minutes'
          where id = v_instruction_event_id
            and status = 'pending';
        end if;
      end if;
    end if;
  exception
    when others then
      raise warning 'first_purchase_email_enqueue_failed for purchase %, client %',
        p_purchase_id,
        v_client_id;
  end;

  return jsonb_build_object($replacement$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('first_online_purchase_welcome_email' in v_sql) > 0 then
    raise notice 'process_paid_purchase already enqueues first-purchase email events';
    return;
  end if;

  if position(v_declaration_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase declaration anchor was not found';
  end if;

  if position(v_new_client_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase new-client anchor was not found';
  end if;

  if position(v_purchase_update_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase purchase update anchor was not found';
  end if;

  v_sql := replace(v_sql, v_declaration_anchor, v_declaration_replacement);
  v_sql := replace(v_sql, v_new_client_anchor, v_new_client_replacement);
  v_sql := replace(v_sql, v_purchase_update_anchor, v_purchase_update_replacement);

  execute v_sql;
end;
$migration$;