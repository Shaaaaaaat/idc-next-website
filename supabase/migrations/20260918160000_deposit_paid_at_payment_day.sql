alter table public.purchases
  add column if not exists paid_at timestamptz;

do $migration$
declare
  v_sql text;
  v_patched_sql text;
  v_function_hash text;
  v_expected_hash text := 'bb61dc0e20d61172673c65523284b61b';

  v_declaration_anchor text := $anchor$  v_start_day date;
  v_final_day date;
  v_future_plan date;$anchor$;
  v_declaration_replacement text := $replacement$  v_start_day date;
  v_payment_day date;
  v_final_day date;
  v_future_plan date;$replacement$;

  v_purchase_select_anchor text := $anchor$  select *
  into p
  from purchases
  where id = p_purchase_id;$anchor$;
  v_purchase_select_replacement text := $replacement$  select *
  into p
  from purchases
  where id = p_purchase_id
  for update;$replacement$;

  v_processed_guard_anchor text := $anchor$  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if lower(coalesce(p.status, '')) not in ('paid', 'matched') then$anchor$;
  v_processed_guard_replacement text := $replacement$  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if p.processed_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'client_id', p.processed_client_id
    );
  end if;

  if lower(coalesce(p.status, '')) not in ('paid', 'matched') then$replacement$;

  v_payment_day_anchor text := $anchor$  v_start_day := coalesce(p.created_time, now())::date;$anchor$;
  v_payment_day_replacement text := $replacement$  v_start_day := coalesce(p.created_time, now())::date;
  v_payment_day := (
    coalesce(p.paid_at, p.created_time, now())
    at time zone 'Europe/Moscow'
  )::date;$replacement$;

  v_new_client_deposit_anchor text := $anchor$  elsif v_is_deposit then
    v_final_day :=
      v_start_day
      + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day';$anchor$;
  v_new_client_deposit_replacement text := $replacement$  elsif v_is_deposit then
    v_final_day :=
      v_payment_day
      + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day';$replacement$;
  v_new_client_deposit_marker text := $marker$  elsif v_is_deposit then
    v_final_day :=
      v_payment_day
      + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day';$marker$;

  v_existing_client_deposit_anchor text := $anchor$      final_day = case
  when v_is_deposit then
    coalesce(clients.final_day, v_start_day)
    + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day'

  when v_is_gift_certificate then$anchor$;
  v_existing_client_deposit_replacement text := $replacement$      final_day = case
  when v_is_deposit then
    greatest(
      coalesce(clients.final_day, v_payment_day),
      v_payment_day
    )
    + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day'

  when v_is_gift_certificate then$replacement$;

  v_existing_client_deposit_marker text := $marker$greatest(
      coalesce(clients.final_day, v_payment_day),
      v_payment_day
    )
    + get_deposit_like_duration_days(v_currency, v_sum) * interval '1 day'$marker$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
  into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('v_payment_day date;' in v_sql) > 0
    and position('for update;' in lower(v_sql)) > 0
    and position('p.processed_at is not null' in v_sql) > 0
    and position('''already_processed'', true' in v_sql) > 0
    and position(v_new_client_deposit_marker in v_sql) > 0
    and position(v_existing_client_deposit_marker in v_sql) > 0 then
    raise notice 'process_paid_purchase already has paid_at payment-day deposit protection';
    return;
  end if;

  v_function_hash := md5(v_sql);
  if v_function_hash <> v_expected_hash then
    raise exception 'process_paid_purchase hash mismatch: expected %, got %',
      v_expected_hash,
      v_function_hash;
  end if;

  if (length(v_sql) - length(replace(v_sql, v_declaration_anchor, ''))) / length(v_declaration_anchor) <> 1 then
    raise exception 'process_paid_purchase declaration anchor not found or ambiguous';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_purchase_select_anchor, ''))) / length(v_purchase_select_anchor) <> 1 then
    raise exception 'process_paid_purchase purchase select anchor not found or ambiguous';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_processed_guard_anchor, ''))) / length(v_processed_guard_anchor) <> 1 then
    raise exception 'process_paid_purchase processed guard anchor not found or ambiguous';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_payment_day_anchor, ''))) / length(v_payment_day_anchor) <> 1 then
    raise exception 'process_paid_purchase payment day assignment anchor not found or ambiguous';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_new_client_deposit_anchor, ''))) / length(v_new_client_deposit_anchor) <> 1 then
    raise exception 'process_paid_purchase new-client deposit anchor not found or ambiguous';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_existing_client_deposit_anchor, ''))) / length(v_existing_client_deposit_anchor) <> 1 then
    raise exception 'process_paid_purchase existing-client deposit anchor not found or ambiguous';
  end if;

  v_patched_sql := replace(v_sql, v_declaration_anchor, v_declaration_replacement);
  v_patched_sql := replace(v_patched_sql, v_purchase_select_anchor, v_purchase_select_replacement);
  v_patched_sql := replace(v_patched_sql, v_processed_guard_anchor, v_processed_guard_replacement);
  v_patched_sql := replace(v_patched_sql, v_payment_day_anchor, v_payment_day_replacement);
  v_patched_sql := replace(v_patched_sql, v_new_client_deposit_anchor, v_new_client_deposit_replacement);
  v_patched_sql := replace(v_patched_sql, v_existing_client_deposit_anchor, v_existing_client_deposit_replacement);

  if regexp_count(v_patched_sql, 'v_payment_day date;') <> 1 then
    raise exception 'process_paid_purchase postcheck failed: v_payment_day declaration count mismatch';
  end if;
  if position('for update;' in lower(v_patched_sql)) = 0 then
    raise exception 'process_paid_purchase postcheck failed: FOR UPDATE missing';
  end if;
  if position('p.processed_at is not null' in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: processed_at guard missing';
  end if;
  if position('''already_processed'', true' in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: already_processed guard missing';
  end if;
  if position(v_new_client_deposit_marker in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: new-client deposit formula missing';
  end if;
  if position(v_existing_client_deposit_marker in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: existing-client deposit formula missing';
  end if;
  if position(v_new_client_deposit_anchor in v_patched_sql) > 0 then
    raise exception 'process_paid_purchase postcheck failed: old new-client deposit formula remains';
  end if;
  if position(v_existing_client_deposit_anchor in v_patched_sql) > 0 then
    raise exception 'process_paid_purchase postcheck failed: old existing-client deposit formula remains';
  end if;

  execute v_patched_sql;
end;
$migration$;
