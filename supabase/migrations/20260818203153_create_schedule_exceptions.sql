create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),

  type text not null,
  studio_id text not null,
  product_scope text not null,

  start_date date not null,
  end_date date not null,

  message text not null default '',
  status text not null default 'active',

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint schedule_exceptions_date_range_check
    check (end_date >= start_date),

  constraint schedule_exceptions_status_check
    check (status in ('active', 'archived'))
);

create index if not exists idx_schedule_exceptions_lookup
on public.schedule_exceptions
(studio_id, product_scope, status, start_date, end_date);

create index if not exists idx_schedule_exceptions_active_dates
on public.schedule_exceptions
(status, start_date, end_date);