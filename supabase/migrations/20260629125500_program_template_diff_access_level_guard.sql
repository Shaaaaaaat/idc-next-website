-- Align program template diff-save RPC with the LK ownership/access model.
-- The full diff-save body is preserved; this migration patches only actor lookup
-- and template ownership checks inside the existing function definition.

do $$
declare
  v_sql text;
  v_old_select text := $old$
  select id
    into v_coach_id
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;
$old$;
  v_old_select_compact text := $old$
  select id into v_coach_id
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;
$old$;
  v_new_select text := $new$
  select id, coalesce(access_level, 'coach')
    into v_coach_id, v_access_level
  from public.coach_profiles
  where lower(email) = lower(trim(coalesce(p_coach_email, '')))
    and is_active = true;
$new$;
  v_old_guard text := $old$
  if v_template.coach_id is not null and v_template.coach_id <> v_coach_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
$old$;
  v_new_guard text := $new$
  if v_template.coach_id = v_coach_id then
    null;
  elsif coalesce(v_access_level, 'coach') = 'head_coach' then
    null;
  elsif v_template.coach_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'forbidden',
      'message', 'Only head coach can edit global program templates'
    );
  else
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
$new$;
begin
  select pg_get_functiondef('public.save_program_template_diff(uuid,text,timestamptz,jsonb)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'save_program_template_diff(uuid,text,timestamptz,jsonb) does not exist';
  end if;

  if position('v_access_level text;' in v_sql) = 0 then
    v_sql := replace(v_sql, '  v_coach_id uuid;', '  v_coach_id uuid;' || chr(10) || '  v_access_level text;');
  end if;

  if position('into v_coach_id, v_access_level' in v_sql) = 0 then
    v_sql := replace(v_sql, v_old_select, v_new_select);
  end if;

  if position('into v_coach_id, v_access_level' in v_sql) = 0 then
    v_sql := replace(v_sql, v_old_select_compact, v_new_select);
  end if;

  if position('into v_coach_id, v_access_level' in v_sql) = 0 then
    raise exception 'save_program_template_diff actor lookup patch failed';
  end if;

  if position('Only head coach can edit global program templates' in v_sql) = 0 then
    v_sql := replace(v_sql, v_old_guard, v_new_guard);
  end if;

  if position('Only head coach can edit global program templates' in v_sql) = 0 then
    raise exception 'save_program_template_diff ownership guard patch failed';
  end if;

  execute v_sql;
end;
$$;

grant execute on function public.save_program_template_diff(uuid, text, timestamptz, jsonb) to service_role;
