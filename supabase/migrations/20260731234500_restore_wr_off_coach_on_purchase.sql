do $migration$
declare
  v_sql text;
  v_declaration_anchor text := '  v_instruction_event_id uuid;';
  v_declaration_replacement text := '  v_instruction_event_id uuid;' || chr(10) ||
    '  v_restore_coach_from_purchase boolean := false;' || chr(10) ||
    '  v_history_coach text;' || chr(10) ||
    '  v_restored_coach text;';
  v_restore_anchor text := $anchor$  v_is_new_client := v_existing_client.id is null;

  v_client_id := v_existing_client.id;$anchor$;
  v_restore_replacement text := $replacement$  v_is_new_client := v_existing_client.id is null;
  v_restore_coach_from_purchase := v_existing_client.id is not null
    and lower(trim(coalesce(v_existing_client.coach, ''))) = 'wr_off';

  v_client_id := v_existing_client.id;$replacement$;
  v_resolution_anchor text := $anchor$  if v_client_id is null then
    insert into clients ($anchor$;
  v_resolution_replacement text := $replacement$  if v_restore_coach_from_purchase then
    select nullif(trim(cp.coach_name), '')
    into v_history_coach
    from public.coach_clients cc
    join public.coach_profiles cp on cp.id = cc.coach_id
    where cc.client_id = v_existing_client.id
      and cp.is_active = true
      and nullif(trim(cp.coach_name), '') is not null
      and lower(trim(cp.coach_name)) <> 'wr_off'
      and cp.access_level in ('coach', 'head_coach')
    order by
      cc.is_active desc,
      coalesce(cc.updated_at, cc.created_at) desc,
      cc.created_at desc,
      cc.id desc
    limit 1;

    v_restored_coach := coalesce(v_history_coach, v_coach);

    if nullif(trim(coalesce(v_restored_coach, '')), '') is null
      or lower(trim(v_restored_coach)) = 'wr_off' then
      v_restored_coach := null;
    end if;
  end if;

  if v_client_id is null then
    insert into clients ($replacement$;
  v_update_anchor text := '      coach = clients.coach,';
  v_update_replacement text := $replacement$      coach = case
        when lower(trim(coalesce(clients.coach, ''))) = 'wr_off'
          and nullif(trim(coalesce(v_restored_coach, '')), '') is not null
          and lower(trim(v_restored_coach)) <> 'wr_off'
          then v_restored_coach
        else clients.coach
      end,$replacement$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('v_restore_coach_from_purchase boolean' in v_sql) > 0 then
    raise notice 'process_paid_purchase already restores wr_off coach on purchase';
    return;
  end if;

  if position('first_online_purchase_welcome_email' in v_sql) = 0 then
    raise exception 'Expected first-purchase email migration to be applied before wr_off coach restore';
  end if;

  if position(v_declaration_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase declaration anchor was not found';
  end if;

  if position(v_restore_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase new-client restore anchor was not found';
  end if;

  if position(v_resolution_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase coach restore resolution anchor was not found';
  end if;

  if position(v_update_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase coach update anchor was not found';
  end if;

  v_sql := replace(v_sql, v_declaration_anchor, v_declaration_replacement);
  v_sql := replace(v_sql, v_restore_anchor, v_restore_replacement);
  v_sql := replace(v_sql, v_resolution_anchor, v_resolution_replacement);
  v_sql := replace(v_sql, v_update_anchor, v_update_replacement);

  execute v_sql;
end;
$migration$;