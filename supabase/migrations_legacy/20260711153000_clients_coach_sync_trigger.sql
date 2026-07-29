create or replace function public.sync_client_coach_link_on_clients_coach_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if tg_op = 'INSERT' or old.coach is distinct from new.coach then
    v_result := public.sync_client_coach_link(new.id);

    if coalesce(v_result->>'ok', 'false') <> 'true' then
      raise notice 'sync_client_coach_link skipped for client %, result: %', new.id, v_result;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists clients_coach_sync_trigger on public.clients;

create trigger clients_coach_sync_trigger
after insert or update of coach on public.clients
for each row
execute function public.sync_client_coach_link_on_clients_coach_change();
