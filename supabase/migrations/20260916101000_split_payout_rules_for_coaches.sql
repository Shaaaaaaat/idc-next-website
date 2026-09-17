do $$
declare
  v_split_format_id uuid;
  v_coach_handle text;
  v_active_count integer;
begin
  select id
  into v_split_format_id
  from public.training_formats
  where slug = 'split'
  limit 1;

  if v_split_format_id is null then
    raise exception 'split training format not found';
  end if;

  foreach v_coach_handle in array array[
    'Lokatororator',
    'fitfrol',
    'dima_dubinin'
  ]
  loop
    select count(*)
    into v_active_count
    from public.coach_payout_rules
    where training_format_id = v_split_format_id
      and coach_role = 'main'
      and main_coach_handle = v_coach_handle
      and extra_coach_handle is null
      and is_active = true;

    if v_active_count > 1 then
      raise exception
        'multiple active personal split payout rules for coach %',
        v_coach_handle;
    elsif v_active_count = 1 then
      update public.coach_payout_rules
      set
        rate_type = 'fixed',
        amount = 2120,
        currency = 'RUB',
        updated_at = now()
      where training_format_id = v_split_format_id
        and coach_role = 'main'
        and main_coach_handle = v_coach_handle
        and extra_coach_handle is null
        and is_active = true;
    else
      insert into public.coach_payout_rules (
        training_format_id,
        coach_role,
        main_coach_handle,
        extra_coach_handle,
        rate_type,
        amount,
        currency,
        is_active
      )
      values (
        v_split_format_id,
        'main',
        v_coach_handle,
        null,
        'fixed',
        2120,
        'RUB',
        true
      );
    end if;
  end loop;
end;
$$;
