create or replace function public.process_expired_clients_daily()
returns jsonb
language plpgsql
security definer
as $function$
declare
  r record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_processed integer := 0;
begin
  for r in
    select
      id,
      fio,
      final_day,
      balance
    from clients
    where final_day < current_date
      and balance > 0
      and is_active = true
    order by final_day
  loop
    v_result := create_client_write_off(
      r.id,
      null,
      current_date,
      'Auto write-off expired subscription'
    );

    v_results := v_results || jsonb_build_object(
      'client_id', r.id,
      'fio', r.fio,
      'final_day', r.final_day,
      'balance_before', r.balance,
      'result', v_result
    );

    v_processed := v_processed + 1;
  end loop;

  for r in
    select
      id,
      fio,
      final_day,
      balance
    from clients
    where final_day < current_date
      and balance = 0
      and is_active = true
    order by final_day
  loop
    update clients
    set
      status = 'pass',
      is_active = false,
      updated_at = now()
    where id = r.id
      and is_active = true;

    if found then
      v_result := jsonb_build_object(
        'ok', true,
        'action', 'expired_zero_balance_passivated'
      );
    else
      v_result := jsonb_build_object(
        'ok', true,
        'action', 'already_inactive'
      );
    end if;

    v_results := v_results || jsonb_build_object(
      'client_id', r.id,
      'fio', r.fio,
      'final_day', r.final_day,
      'balance_before', r.balance,
      'result', v_result
    );

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'results', v_results
  );
end;
$function$;
