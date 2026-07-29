do $migration$
declare
  v_sql text;
  v_old_coach_assignment text := '      coach = coalesce(v_coach, clients.coach),';
  v_new_coach_assignment text := '      coach = clients.coach,';
  v_old_coach_link_guard text := '  if v_coach is not null then';
  v_new_coach_link_guard text := '  if v_existing_client.id is null and v_coach is not null then';
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position(v_new_coach_assignment in v_sql) > 0
     and position(v_new_coach_link_guard in v_sql) > 0 then
    raise notice 'process_paid_purchase already preserves first-purchase coach';
    return;
  end if;

  if position(v_old_coach_assignment in v_sql) = 0 then
    raise exception 'Expected existing-client coach assignment was not found in process_paid_purchase';
  end if;

  if position(v_old_coach_link_guard in v_sql) = 0 then
    raise exception 'Expected purchase-derived coach_clients guard was not found in process_paid_purchase';
  end if;

  v_sql := replace(v_sql, v_old_coach_assignment, v_new_coach_assignment);
  v_sql := replace(v_sql, v_old_coach_link_guard, v_new_coach_link_guard);

  if position(v_new_coach_assignment in v_sql) = 0 then
    raise exception 'process_paid_purchase coach assignment patch failed';
  end if;

  if position(v_new_coach_link_guard in v_sql) = 0 then
    raise exception 'process_paid_purchase coach_clients guard patch failed';
  end if;

  execute v_sql;
end;
$migration$;
