-- Align selected template-workout calendar import with the LK access model.
-- This patches only actor lookup + template visibility inside the existing RPC.
-- Student ownership validation, idempotency, copy logic, and active client_program
-- lookup/creation are intentionally left unchanged.

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
  if v_template.coach_id is null then
    null;
  elsif v_template.coach_id = v_coach_id then
    null;
  elsif coalesce(v_access_level, 'coach') = 'head_coach' then
    null;
  else
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
$new$;
begin
  select pg_get_functiondef('public.import_program_template_workouts_to_client_calendar(text,uuid,uuid,date,uuid[],jsonb)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'import_program_template_workouts_to_client_calendar(text,uuid,uuid,date,uuid[],jsonb) does not exist';
  end if;

  if position('v_access_level text;' in v_sql) = 0 then
    v_sql := replace(v_sql, '  v_coach_id uuid;', '  v_coach_id uuid;' || chr(10) || '  v_access_level text;');
  end if;

  if position('into v_coach_id, v_access_level' in v_sql) = 0 then
    v_sql := replace(v_sql, v_old_select, v_new_select);
  end if;

  if position('into v_coach_id, v_access_level' in v_sql) = 0 then
    raise exception 'import_program_template_workouts actor lookup patch failed';
  end if;

  if position('coalesce(v_access_level, ''coach'') = ''head_coach''' in v_sql) = 0 then
    v_sql := replace(v_sql, v_old_guard, v_new_guard);
  end if;

  if position('coalesce(v_access_level, ''coach'') = ''head_coach''' in v_sql) = 0 then
    raise exception 'import_program_template_workouts template visibility patch failed';
  end if;

  execute v_sql;
end;
$$;

grant execute on function public.import_program_template_workouts_to_client_calendar(text, uuid, uuid, date, uuid[], jsonb) to service_role;
