do $migration$
declare
  v_sql text;
  v_first_lesson_anchor text := $anchor$  if v_first_fact_after = 1 then
    perform public.enqueue_client_notification_event(
      c.id,
      'first_lesson_followup',
      'client_transactions',
      v_transaction_id::text,
      'client',
      'telegram',
      jsonb_build_object(
        'transaction_id', v_transaction_id,
        'scheduled_workout_id', w.id,
        'training_format', tf.slug,
        'training_date', v_training_date,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'currency', v_client_currency,
        'client_name', c.fio,
        'trainer_name', v_coach_handle
      )
    );
  else$anchor$;
  v_first_lesson_replacement text := $replacement$  if v_first_fact_after = 1 then
    perform public.enqueue_client_notification_event(
      c.id,
      'first_lesson_followup',
      'client_transactions',
      v_transaction_id::text,
      'client',
      'telegram',
      jsonb_build_object(
        'transaction_id', v_transaction_id,
        'scheduled_workout_id', w.id,
        'training_format', tf.slug,
        'training_date', v_training_date,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'currency', v_client_currency,
        'client_name', c.fio,
        'trainer_name', v_coach_handle
      )
    );

    perform public.enqueue_client_notification_event(
      c.id,
      'first_lesson_followup',
      'client_transactions',
      v_transaction_id::text,
      'client',
      'email',
      jsonb_build_object(
        'transaction_id', v_transaction_id,
        'scheduled_workout_id', w.id,
        'training_format', tf.slug,
        'training_date', v_training_date,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'currency', v_client_currency,
        'client_name', c.fio,
        'trainer_name', v_coach_handle,
        'template_version', 1
      )
    );
  else$replacement$;
  v_first_lesson_marker text := $marker$'first_lesson_followup',
      'client_transactions',
      v_transaction_id::text,
      'client',
      'email'$marker$;
  v_wr_off_anchor text := $anchor$  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_client',
    'client_transactions',
    v_transaction_id::text,
    'client',
    'telegram',
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'source_id', v_source_id,
      'write_off_date', p_write_off_date,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'amount_client_currency', v_amount_client_currency,
      'currency', v_currency
    )
  );

  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_admin',$anchor$;
  v_wr_off_replacement text := $replacement$  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_client',
    'client_transactions',
    v_transaction_id::text,
    'client',
    'telegram',
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'source_id', v_source_id,
      'write_off_date', p_write_off_date,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'amount_client_currency', v_amount_client_currency,
      'currency', v_currency
    )
  );

  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_client',
    'client_transactions',
    v_transaction_id::text,
    'client',
    'email',
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'source_id', v_source_id,
      'write_off_date', p_write_off_date,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'amount_client_currency', v_amount_client_currency,
      'currency', v_currency,
      'template_version', 1
    )
  );

  perform public.enqueue_client_notification_event(
    c.id,
    'subscription_wr_off_admin',$replacement$;
  v_wr_off_marker text := $marker$'subscription_wr_off_client',
    'client_transactions',
    v_transaction_id::text,
    'client',
    'email'$marker$;
begin
  select pg_get_functiondef('public.charge_scheduled_workout(uuid, boolean)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'charge_scheduled_workout(uuid, boolean) does not exist';
  end if;

  if position(v_first_lesson_marker in v_sql) = 0 then
    if position(v_first_lesson_anchor in v_sql) = 0 then
      raise exception 'Expected first_lesson_followup enqueue anchor was not found';
    end if;

    v_sql := replace(v_sql, v_first_lesson_anchor, v_first_lesson_replacement);
    execute v_sql;
  else
    raise notice 'charge_scheduled_workout already enqueues first_lesson_followup email events';
  end if;

  select pg_get_functiondef('public.create_client_write_off(uuid, numeric, date, text)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'create_client_write_off(uuid, numeric, date, text) does not exist';
  end if;

  if position(v_wr_off_marker in v_sql) = 0 then
    if position(v_wr_off_anchor in v_sql) = 0 then
      raise exception 'Expected subscription_wr_off_client enqueue anchor was not found';
    end if;

    v_sql := replace(v_sql, v_wr_off_anchor, v_wr_off_replacement);
    execute v_sql;
  else
    raise notice 'create_client_write_off already enqueues subscription_wr_off_client email events';
  end if;
end;
$migration$;

