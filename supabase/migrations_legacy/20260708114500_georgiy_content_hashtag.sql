-- Add Georgiy's real coach profile details and support the requested
-- Instagram content hashtag. P&L remains sourced from content_earnings via
-- monthly_pnl_view; this migration intentionally does not touch pnl_entries.

update public.coach_profiles
set
  email = 'carpediem21@yandex.ru',
  display_name = 'Георгий Шахназаров',
  updated_at = now()
where lower(coach_name) = lower('Gshakhnazarov');

do $$
declare
  v_sql text;
  v_old_condition text := 'if v_text like ''%#shakhnazarov%'' then';
  v_new_condition text := 'if v_text like ''%#gshakhnazarov%'' or v_text like ''%#shakhnazarov%'' then';
begin
  select pg_get_functiondef('public.process_instagram_post(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_instagram_post(uuid) does not exist';
  end if;

  if position('%#gshakhnazarov%' in v_sql) = 0 then
    v_sql := replace(v_sql, v_old_condition, v_new_condition);
  end if;

  if position('%#gshakhnazarov%' in v_sql) = 0 then
    raise exception 'process_instagram_post Georgiy hashtag patch failed';
  end if;

  execute v_sql;
end;
$$;
