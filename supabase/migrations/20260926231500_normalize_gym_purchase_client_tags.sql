do $migration$
declare
  v_function_count integer;
  v_function_oid oid;
  v_sql text;
  v_patched_sql text;
  v_function_hash text;
  v_expected_hash text := 'd11c2db9d642982a02888cf18745be16';

  v_old_anchor text := $anchor$  else
    v_client_tag := v_course;

    if v_format = 'ds' and v_coach is not null then$anchor$;
  v_new_anchor text := $replacement$  else
    if v_format = 'gym' then
      v_client_tag := regexp_replace(
        v_course,
        '_(short|long)$',
        '',
        'i'
      );
    else
      v_client_tag := v_course;
    end if;

    if v_format = 'ds' and v_coach is not null then$replacement$;

  v_gift_branch_marker text := $marker$  if v_is_gift_certificate then
    v_client_tag := 'gift_certificate';$marker$;
  v_deposit_branch_marker text := $marker$  elsif v_is_deposit then
    v_client_tag := coalesce(nullif(trim(coalesce(v_existing_client.tag, '')), ''), 'deposit');$marker$;
  v_gym_branch_marker text := $marker$    if v_format = 'gym' then
      v_client_tag := regexp_replace($marker$;
  v_ds_branch_marker text := $marker$    if v_format = 'ds' and v_coach is not null then$marker$;
  v_regex_marker text := $marker$'_(short|long)$'$marker$;
  v_tag_update_marker text := $marker$tag = v_client_tag$marker$;
begin
  select count(*)
    into v_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'process_paid_purchase'
    and pg_get_function_identity_arguments(p.oid) = 'p_purchase_id uuid';

  if v_function_count <> 1 then
    raise exception 'process_paid_purchase(p_purchase_id uuid) not found or ambiguous: % match(es)',
      v_function_count;
  end if;

  select p.oid
    into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'process_paid_purchase'
    and pg_get_function_identity_arguments(p.oid) = 'p_purchase_id uuid';

  select pg_get_functiondef(v_function_oid)
    into v_sql;

  if v_sql is null then
    raise exception 'process_paid_purchase(p_purchase_id uuid) definition is null';
  end if;

  if position(v_new_anchor in v_sql) > 0 then
    if (length(v_sql) - length(replace(v_sql, v_gym_branch_marker, ''))) / length(v_gym_branch_marker) <> 1
      or (length(v_sql) - length(replace(v_sql, v_regex_marker, ''))) / length(v_regex_marker) <> 1
      or (length(v_sql) - length(replace(v_sql, v_ds_branch_marker, ''))) / length(v_ds_branch_marker) <> 1
      or position(v_ds_branch_marker in v_sql) <= position(v_gym_branch_marker in v_sql)
      or position(v_gift_branch_marker in v_sql) = 0
      or position(v_deposit_branch_marker in v_sql) = 0
      or position('for update' in lower(v_sql)) = 0
      or position('already_processed' in v_sql) = 0
      or position(v_tag_update_marker in v_sql) = 0
      or not (position(v_old_anchor in v_sql) = 0) then
      raise exception 'process_paid_purchase appears partially patched or unexpected';
    end if;

    raise notice 'process_paid_purchase gym tag normalization already applied';
    return;
  end if;

  v_function_hash := md5(v_sql);
  if v_function_hash <> v_expected_hash then
    raise exception 'process_paid_purchase hash mismatch: expected %, got %',
      v_expected_hash,
      v_function_hash;
  end if;

  if (length(v_sql) - length(replace(v_sql, v_old_anchor, ''))) / length(v_old_anchor) <> 1 then
    raise exception 'process_paid_purchase old gym tag anchor not found or ambiguous';
  end if;
  if position(v_gift_branch_marker in v_sql) = 0 then
    raise exception 'process_paid_purchase gift branch marker missing';
  end if;
  if position(v_deposit_branch_marker in v_sql) = 0 then
    raise exception 'process_paid_purchase deposit branch marker missing';
  end if;
  if (length(v_sql) - length(replace(v_sql, v_ds_branch_marker, ''))) / length(v_ds_branch_marker) <> 1 then
    raise exception 'process_paid_purchase DS branch marker missing or ambiguous';
  end if;
  if position('for update' in lower(v_sql)) = 0 then
    raise exception 'process_paid_purchase FOR UPDATE marker missing';
  end if;
  if position('already_processed' in v_sql) = 0 then
    raise exception 'process_paid_purchase already_processed marker missing';
  end if;

  v_patched_sql := replace(v_sql, v_old_anchor, v_new_anchor);

  if position(v_old_anchor in v_patched_sql) > 0 then
    raise exception 'process_paid_purchase postcheck failed: old anchor remains';
  end if;
  if (length(v_patched_sql) - length(replace(v_patched_sql, v_gym_branch_marker, ''))) / length(v_gym_branch_marker) <> 1 then
    raise exception 'process_paid_purchase postcheck failed: gym branch count mismatch';
  end if;
  if (length(v_patched_sql) - length(replace(v_patched_sql, v_regex_marker, ''))) / length(v_regex_marker) <> 1 then
    raise exception 'process_paid_purchase postcheck failed: regex marker count mismatch';
  end if;
  if (length(v_patched_sql) - length(replace(v_patched_sql, v_ds_branch_marker, ''))) / length(v_ds_branch_marker) <> 1 then
    raise exception 'process_paid_purchase postcheck failed: DS branch count mismatch';
  end if;
  if position(v_gift_branch_marker in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: gift branch missing';
  end if;
  if position(v_deposit_branch_marker in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: deposit branch missing';
  end if;
  if position('for update' in lower(v_patched_sql)) = 0 then
    raise exception 'process_paid_purchase postcheck failed: FOR UPDATE missing';
  end if;
  if position('already_processed' in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: already_processed missing';
  end if;
  if position(v_tag_update_marker in v_patched_sql) = 0 then
    raise exception 'process_paid_purchase postcheck failed: tag update marker missing';
  end if;

  execute v_patched_sql;
end;
$migration$;
