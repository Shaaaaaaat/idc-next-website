alter table public.coach_clients
  add column if not exists last_program_template_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.coach_clients'::regclass
      and conname = 'coach_clients_last_program_template_id_fkey'
  ) then
    alter table public.coach_clients
      add constraint coach_clients_last_program_template_id_fkey
      foreign key (last_program_template_id)
      references public.program_templates(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_coach_clients_last_program_template_id
  on public.coach_clients(last_program_template_id)
  where last_program_template_id is not null;
