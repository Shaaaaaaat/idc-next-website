do $migration$
declare
  v_sql text;
  v_old_deposit_tag_logic text := $old$
  elsif v_is_deposit then
    v_client_tag := 'deposit';$old$;
  v_new_deposit_tag_logic text := $new$
  elsif v_is_deposit then
    v_client_tag := coalesce(nullif(trim(coalesce(v_existing_client.tag, '')), ''), 'deposit');$new$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('v_base_ds := 1100;' in v_sql) = 0 then
    raise exception 'Expected old RUB ds fallback was not found in process_paid_purchase';
  end if;

  if position(v_old_deposit_tag_logic in v_sql) = 0 then
    raise exception 'Expected old deposit tag logic was not found in process_paid_purchase';
  end if;

  v_sql := replace(v_sql, 'v_base_ds := 1100;', 'v_base_ds := 800;');
  v_sql := replace(v_sql, v_old_deposit_tag_logic, v_new_deposit_tag_logic);

  execute v_sql;
end;
$migration$;
