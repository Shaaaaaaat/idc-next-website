do $migration$
declare
  v_sql text;
  v_declaration_anchor text := '  v_service_type text;' || chr(10) || '  v_coach_id uuid;';
  v_declaration_replacement text := '  v_service_type text;' || chr(10) ||
    '  v_coach_id uuid;' || chr(10) ||
    '  v_notification_coach text;' || chr(10) ||
    '  v_notification_balance numeric;';
  v_anchor text := $anchor$  update purchases
  set
    price_per_lesson = case when v_lessons > 0 then v_price else price_per_lesson end,
    processed_at = now(),
    processed_client_id = v_client_id,
    updated_at = now()
  where id = p_purchase_id;

  return jsonb_build_object($anchor$;
  v_replacement text := $replacement$  update purchases
  set
    price_per_lesson = case when v_lessons > 0 then v_price else price_per_lesson end,
    processed_at = now(),
    processed_client_id = v_client_id,
    updated_at = now()
  where id = p_purchase_id;

  begin
    select
      nullif(trim(coalesce(coach, '')), ''),
      balance
    into v_notification_coach, v_notification_balance
    from clients
    where id = v_client_id;

    if v_notification_coach is not null then
      perform public.enqueue_client_notification_event(
        v_client_id,
        'subscription_purchase_trainer',
        'purchases',
        p_purchase_id::text,
        'trainer',
        'telegram',
        jsonb_build_object(
          'purchase_id', p_purchase_id,
          'client_name', v_fio,
          'lessons', v_lessons,
          'balance_after', v_notification_balance,
          'currency', v_currency,
          'coach', v_notification_coach
        )
      );
    end if;
  exception
    when others then
      raise warning 'subscription_purchase_trainer enqueue failed for purchase %, client %: %',
        p_purchase_id,
        v_client_id,
        sqlerrm;
  end;

  return jsonb_build_object($replacement$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('subscription_purchase_trainer' in v_sql) > 0 then
    raise notice 'process_paid_purchase already enqueues subscription_purchase_trainer';
    return;
  end if;

  if position(v_declaration_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase declaration anchor was not found';
  end if;

  if position(v_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase purchase update anchor was not found';
  end if;

  v_sql := replace(v_sql, v_declaration_anchor, v_declaration_replacement);
  v_sql := replace(v_sql, v_anchor, v_replacement);

  if position('v_notification_coach text;' in v_sql) = 0 then
    raise exception 'process_paid_purchase notification declarations patch failed';
  end if;

  if position('subscription_purchase_trainer' in v_sql) = 0 then
    raise exception 'process_paid_purchase notification enqueue patch failed';
  end if;

  execute v_sql;
end;
$migration$;
