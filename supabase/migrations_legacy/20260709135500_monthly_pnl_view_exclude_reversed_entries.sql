create or replace view public.monthly_pnl_view as
with months as (
  select distinct date_trunc('month'::text, pnl_entries.pnl_date)::date as month
  from public.pnl_entries
  where pnl_entries.reversed_at is null

  union

  select distinct date_trunc('month'::text, business_expenses.expense_month::timestamp with time zone)::date as month
  from public.business_expenses

  union

  select distinct date_trunc('month'::text, purchases.created_time)::date as month
  from public.purchases
  where lower(coalesce(purchases.status, ''::text)) = any (array['paid'::text, 'matched'::text])

  union

  select distinct date_trunc('month'::text, content_earnings.earning_date::timestamp with time zone)::date as month
  from public.content_earnings
),
pnl as (
  select
    date_trunc('month'::text, pnl_entries.pnl_date)::date as month,
    sum(coalesce(pnl_entries.revenue_amount, 0::numeric)) as total_revenue,
    sum(
      case
        when coalesce(pnl_entries.entry_type, 'workout'::text) = 'workout'::text then coalesce(pnl_entries.revenue_amount, 0::numeric)
        else 0::numeric
      end
    ) as workout_revenue,
    sum(
      case
        when pnl_entries.entry_type = 'write_off'::text then coalesce(pnl_entries.revenue_amount, 0::numeric)
        else 0::numeric
      end
    ) as write_off_revenue,
    sum(coalesce(pnl_entries.main_coach_expense_amount, 0::numeric)) as main_coach_expenses,
    sum(coalesce(pnl_entries.extra_coach_expense_amount, 0::numeric)) as extra_coach_expenses,
    sum(coalesce(pnl_entries.studio_expense_amount, 0::numeric)) as studio_expenses
  from public.pnl_entries
  where pnl_entries.reversed_at is null
  group by (date_trunc('month'::text, pnl_entries.pnl_date)::date)
),
expenses as (
  select
    date_trunc('month'::text, business_expenses.expense_month::timestamp with time zone)::date as month,
    sum(coalesce(business_expenses.amount_rub, 0::numeric)) as business_expenses
  from public.business_expenses
  group by (date_trunc('month'::text, business_expenses.expense_month::timestamp with time zone)::date)
),
content as (
  select
    date_trunc('month'::text, content_earnings.earning_date::timestamp with time zone)::date as month,
    sum(coalesce(content_earnings.amount, 0::numeric)) as content_expenses
  from public.content_earnings
  group by (date_trunc('month'::text, content_earnings.earning_date::timestamp with time zone)::date)
),
acquiring as (
  select
    date_trunc('month'::text, pnl_entries.pnl_date)::date as month,
    sum(
      round(
        coalesce(pnl_entries.revenue_amount, 0::numeric) *
        case
          when upper(coalesce(pnl_entries.client_currency, 'RUB'::text)) = 'RUB'::text then 0.031
          else 0.025
        end,
        2
      )
    ) as acquiring_fees
  from public.pnl_entries
  where pnl_entries.reversed_at is null
  group by (date_trunc('month'::text, pnl_entries.pnl_date)::date)
)
select
  m.month,
  coalesce(p.total_revenue, 0::numeric) as total_revenue,
  coalesce(p.workout_revenue, 0::numeric) as workout_revenue,
  coalesce(p.write_off_revenue, 0::numeric) as write_off_revenue,
  coalesce(a.acquiring_fees, 0::numeric) as acquiring_fees,
  coalesce(p.main_coach_expenses, 0::numeric) as main_coach_expenses,
  coalesce(p.extra_coach_expenses, 0::numeric) as extra_coach_expenses,
  coalesce(p.main_coach_expenses, 0::numeric) + coalesce(p.extra_coach_expenses, 0::numeric) as total_coach_expenses,
  coalesce(p.studio_expenses, 0::numeric) as studio_expenses,
  coalesce(e.business_expenses, 0::numeric) as business_expenses,
  coalesce(p.total_revenue, 0::numeric)
    - coalesce(a.acquiring_fees, 0::numeric)
    - coalesce(p.main_coach_expenses, 0::numeric)
    - coalesce(p.extra_coach_expenses, 0::numeric)
    - coalesce(p.studio_expenses, 0::numeric)
    - coalesce(e.business_expenses, 0::numeric)
    - coalesce(c.content_expenses, 0::numeric) as net_profit,
  coalesce(p.total_revenue, 0::numeric) - coalesce(a.acquiring_fees, 0::numeric) as revenue_after_acquiring,
  coalesce(p.main_coach_expenses, 0::numeric)
    + coalesce(p.extra_coach_expenses, 0::numeric)
    + coalesce(p.studio_expenses, 0::numeric) as coach_and_studio_expenses,
  coalesce(c.content_expenses, 0::numeric) as content_expenses
from months m
left join pnl p on p.month = m.month
left join acquiring a on a.month = m.month
left join expenses e on e.month = m.month
left join content c on c.month = m.month
order by m.month desc;
