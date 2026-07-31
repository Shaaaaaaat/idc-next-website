do $migration$
declare
  v_sql text;
  v_anchor text := 'set next_attempt_at = now() + interval ''2 minutes''';
  v_replacement text := 'set next_attempt_at = now() + interval ''1 minute''';
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('first_online_purchase_welcome_email' in v_sql) = 0
    or position('strength_test_instruction_email' in v_sql) = 0 then
    raise exception 'process_paid_purchase does not contain first-purchase email enqueue logic';
  end if;

  if position(v_replacement in v_sql) > 0 then
    raise notice 'process_paid_purchase already uses one-minute instruction email delay';
    return;
  end if;

  if position(v_anchor in v_sql) = 0 then
    raise exception 'Expected two-minute instruction email delay anchor was not found';
  end if;

  v_sql := replace(v_sql, v_anchor, v_replacement);

  execute v_sql;
end;
$migration$;