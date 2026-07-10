create or replace function public.sync_client_coach_link(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_client public.clients%rowtype;
  v_coach_handle text;
  v_coach_id uuid;
  v_deactivated_count integer := 0;
begin
  select *
    into v_client
  from public.clients
  where id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'client_not_found');
  end if;

  v_coach_handle := nullif(trim(coalesce(v_client.coach, '')), '');

  if v_coach_handle is null or v_coach_handle ilike '%wr_off%' then
    update public.coach_clients
    set
      is_active = false,
      updated_at = now()
    where client_id = p_client_id
      and is_active = true;

    get diagnostics v_deactivated_count = row_count;

    return jsonb_build_object(
      'ok', true,
      'action', 'deactivated',
      'reason', case when v_coach_handle is null then 'empty_coach' else 'wr_off' end,
      'deactivated_count', v_deactivated_count
    );
  end if;

  select id
    into v_coach_id
  from public.coach_profiles
  where lower(coach_name) = lower(v_coach_handle)
    and is_active = true
  order by created_at
  limit 1;

  if v_coach_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'coach_profile_not_found',
      'coach', v_coach_handle
    );
  end if;

  update public.coach_clients
  set
    is_active = false,
    updated_at = now()
  where client_id = p_client_id
    and coach_id <> v_coach_id
    and is_active = true;

  get diagnostics v_deactivated_count = row_count;

  insert into public.coach_clients (
    coach_id,
    client_id,
    is_active,
    created_at,
    updated_at
  )
  values (
    v_coach_id,
    p_client_id,
    true,
    now(),
    now()
  )
  on conflict (coach_id, client_id)
  do update
  set
    is_active = true,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'action', 'linked',
    'coach_id', v_coach_id,
    'coach', v_coach_handle,
    'deactivated_count', v_deactivated_count
  );
end;
$function$;

do $migration$
declare
  v_sql text;
  v_anchor text := $anchor$  insert into client_transactions ($anchor$;
  v_replacement text := $replacement$  perform public.sync_client_coach_link(v_client_id);

  insert into client_transactions ($replacement$;
begin
  select pg_get_functiondef('public.process_paid_purchase(uuid)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(uuid) does not exist';
  end if;

  if position('perform public.sync_client_coach_link(v_client_id);' in lower(v_sql)) > 0 then
    raise notice 'process_paid_purchase already calls sync_client_coach_link';
    return;
  end if;

  if position(v_anchor in v_sql) = 0 then
    raise exception 'Expected process_paid_purchase transaction anchor was not found';
  end if;

  v_sql := replace(v_sql, v_anchor, v_replacement);

  execute v_sql;
end;
$migration$;

update public.coach_clients cc
set
  is_active = false,
  updated_at = now()
from public.clients c
where cc.client_id = c.id
  and cc.is_active = true
  and (
    nullif(trim(coalesce(c.coach, '')), '') is null
    or c.coach ilike '%wr_off%'
  );

with matched_clients as (
  select
    c.id as client_id,
    cp.id as coach_id
  from public.clients c
  join public.coach_profiles cp
    on lower(cp.coach_name) = lower(trim(c.coach))
   and cp.is_active = true
  where nullif(trim(coalesce(c.coach, '')), '') is not null
    and c.coach not ilike '%wr_off%'
),
upserted as (
  insert into public.coach_clients (
    coach_id,
    client_id,
    is_active,
    created_at,
    updated_at
  )
  select
    coach_id,
    client_id,
    true,
    now(),
    now()
  from matched_clients
  on conflict (coach_id, client_id)
  do update
  set
    is_active = true,
    updated_at = now()
  returning client_id, coach_id
)
update public.coach_clients cc
set
  is_active = false,
  updated_at = now()
from upserted u
where cc.client_id = u.client_id
  and cc.coach_id <> u.coach_id
  and cc.is_active = true;
