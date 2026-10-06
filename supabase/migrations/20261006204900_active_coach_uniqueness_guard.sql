do $$
begin
  if exists (
    select 1
    from public.coach_clients
    where is_active = true
    group by client_id
    having count(*) > 1
  ) then
    raise exception 'duplicate active coach links detected';
  end if;
end;
$$;

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
  where id = p_client_id
  for update;

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

alter function public.sync_client_coach_link(uuid) owner to postgres;

create unique index coach_clients_one_active_per_client_uidx
on public.coach_clients (client_id)
where is_active = true;
