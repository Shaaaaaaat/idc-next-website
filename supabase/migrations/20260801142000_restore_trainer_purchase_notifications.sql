do $migration$
declare
  v_sql text;
  v_declaration_anchor text := '  v_restored_coach text;';
  v_declaration_replacement text := '  v_restored_coach text;' || chr(10) ||
    '  v_notify_trainer_purchase_existing_client boolean := false;' || chr(10) ||
    '  v_notification_coach text;' || chr(10) ||
    '  v_notification_balance numeric;';
  v_return_anchor text := $anchor$  exception
    when others then
      raise warning 'first_purchase_email_enqueue_failed for purchase %, client %',
        p_purchase_id,
        v_client_id;
  end;

  return jsonb_build_object($anchor$;
  v_return_replacement text := $replacement$  exception
    when others then
      raise warning 'first_purchase_email_enqueue_failed for purchase %, client %',
        p_purchase_id,
        v_client_id;
  end;

  begin
    v_notify_trainer_purchase_existing_client :=
      v_existing_client.id is not null
      and v_service_type = 'ds'
      and not v_is_balance_only
      and v_client_id is not null;

    if v_notify_trainer_purchase_existing_client then
      select
        nullif(trim(coalesce(coach, '')), ''),
        balance
      into v_notification_coach, v_notification_balance
      from public.clients
      where id = v_client_id;

      if v_notification_coach is not null
        and lower(trim(v_notification_coach)) <> 'wr_off' then
        perform public.enqueue_client_notification_event(
          v_client_id,
          'subscription_purchase_trainer',
          'purchases',
          p_purchase_id::text,
          'trainer',
          'telegram',
          jsonb_strip_nulls(jsonb_build_object(
            'purchase_id', p_purchase_id,
            'transaction_id', nullif(trim(coalesce(p.id_payment, '')), ''),
            'client_name', v_fio,
            'lessons', v_lessons,
            'balance_after', v_notification_balance,
            'currency', v_currency,
            'coach', v_notification_coach
          ))
        );
      end if;
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

  if position('v_notify_trainer_purchase_existing_client boolean' in v_sql) > 0 then
    raise notice 'process_paid_purchase already enqueues existing-client trainer purchase notifications';
    return;
  end if;

  if position('subscription_purchase_trainer' in v_sql) > 0 then
    raise exception 'process_paid_purchase already contains a trainer purchase notification block; review before patching';
  end if;

  if position('first_online_purchase_welcome_email' in v_sql) = 0 then
    raise exception 'Expected first-purchase Resend email events to exist before trainer purchase notification patch';
  end if;

  if position('interval ''1 minute''' in v_sql) = 0 then
    raise exception 'Expected one-minute instruction email delay before trainer purchase notification patch';
  end if;

  if position('v_restore_coach_from_purchase boolean' in v_sql) = 0 then
    raise exception 'Expected wr_off coach restoration patch before trainer purchase notification patch';
  end if;

  if position(v_declaration_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase declaration anchor was not found';
  end if;

  if position(v_return_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase return anchor after email block was not found';
  end if;

  v_sql := replace(v_sql, v_declaration_anchor, v_declaration_replacement);
  v_sql := replace(v_sql, v_return_anchor, v_return_replacement);

  execute v_sql;
end;
$migration$;

