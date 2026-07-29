-- Coach-level privileges for managing shared/global LK resources.

alter table public.coach_profiles
  add column if not exists access_level text not null default 'coach';

update public.coach_profiles
set access_level = 'coach'
where access_level is null
   or access_level not in ('coach', 'head_coach');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.coach_profiles'::regclass
      and conname = 'coach_profiles_access_level_check'
  ) then
    alter table public.coach_profiles
      add constraint coach_profiles_access_level_check
      check (access_level in ('coach', 'head_coach'));
  end if;
end;
$$;
