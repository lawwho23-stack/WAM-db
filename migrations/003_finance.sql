-- 003_finance.sql — money, in minor units.
--
-- Four tables: where the money sits (accounts), what it was for (categories),
-- what moved (transactions), and what one currency is worth in the base
-- currency (fx rates). The base is THB, because that is where the money is
-- spent and reported.
--
-- Three rules worth stating out loud:
--
--   1. Money is stored as a whole number of minor units, never as a float.
--      0.1 + 0.2 = 0.30000000000000004 in binary floating point; satang and
--      pyas cannot tolerate that. THB, MMK and USD all have two decimals, so
--      the minor unit is 1/100 in every case.
--   2. amount_minor is signed. Negative is money out, positive is money in.
--      A category says what it was for, the sign says which way it went.
--   3. Every row keeps the rate it was converted at (rate_to_thb) plus the
--      converted amount (amount_thb_minor). Reports never recompute history
--      with today's rate, so last month's numbers do not move when the kyat
--      or the dollar does.

-- ------------------------------------------------------------------ accounts

create table if not exists finance_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  kind text not null default 'bank',
  currency text not null,
  opening_balance_minor bigint not null default 0,
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_currency check (currency in ('THB', 'MMK', 'USD')),
  constraint finance_accounts_kind check (kind in ('cash', 'bank', 'ewallet', 'credit', 'investment', 'other')),
  constraint finance_accounts_name unique (workspace_id, name)
);

-- ---------------------------------------------------------------- categories

create table if not exists finance_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  kind text not null,
  color text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_categories_kind check (kind in ('income', 'expense')),
  constraint finance_categories_name unique (workspace_id, name)
);

-- -------------------------------------------------------------- transactions

create table if not exists finance_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  account_id uuid not null references finance_accounts (id) on delete restrict,
  category_id uuid references finance_categories (id) on delete set null,
  occurred_on date not null,
  amount_minor bigint not null,
  currency text not null,
  rate_to_thb numeric(20, 10) not null,
  amount_thb_minor bigint not null,
  payee text,
  note text,
  tags text[] not null default '{}',
  source text not null default 'manual',
  external_id text,
  actor_id uuid references actors (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint finance_transactions_currency check (currency in ('THB', 'MMK', 'USD')),
  constraint finance_transactions_source check (source in ('manual', 'csv', 'agent', 'recurring'))
);

-- One CSV row may only be imported once. The index is partial because
-- hand-typed transactions have no external id at all.
create unique index if not exists uq_finance_tx_external
  on finance_transactions (workspace_id, external_id)
  where external_id is not null;

create index if not exists idx_finance_tx_day
  on finance_transactions (workspace_id, occurred_on desc)
  where deleted_at is null;

create index if not exists idx_finance_tx_account
  on finance_transactions (account_id, occurred_on desc)
  where deleted_at is null;

create index if not exists idx_finance_tx_category
  on finance_transactions (category_id)
  where deleted_at is null;

-- ------------------------------------------------------------------ fx rates

create table if not exists finance_fx_rates (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  rate_to_thb numeric(20, 10) not null,
  as_of date not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint finance_fx_currency check (currency in ('THB', 'MMK', 'USD')),
  constraint finance_fx_rate_positive check (rate_to_thb > 0),
  constraint finance_fx_unique unique (currency, as_of)
);

-- --------------------------------------------------------------------- seed

-- Categories that cover an ordinary month in Thailand with family in Myanmar.
-- Rename or archive them freely; nothing references them by name.
insert into finance_categories (workspace_id, name, kind, color)
select w.id, c.name, c.kind, c.color
from workspaces w
cross join (values
  ('Salary',        'income',  '#63f2c0'),
  ('Freelance',     'income',  '#5ee7ff'),
  ('Client payment','income',  '#9b8cff'),
  ('Interest',      'income',  '#ffc46b'),
  ('Other income',  'income',  '#8a94ac'),
  ('Food',          'expense', '#ff7b9c'),
  ('Groceries',     'expense', '#63f2c0'),
  ('Transport',     'expense', '#5ee7ff'),
  ('Rent',          'expense', '#9b8cff'),
  ('Utilities',     'expense', '#ffc46b'),
  ('Internet',      'expense', '#5ee7ff'),
  ('Phone',         'expense', '#8a94ac'),
  ('Health',        'expense', '#ff7b9c'),
  ('Education',     'expense', '#9b8cff'),
  ('Software',      'expense', '#5ee7ff'),
  ('Subscriptions', 'expense', '#9b8cff'),
  ('Travel',        'expense', '#63f2c0'),
  ('Family',        'expense', '#ffc46b'),
  ('Giving',        'expense', '#ffc46b'),
  ('Fees',          'expense', '#8a94ac'),
  ('Shopping',      'expense', '#ff7b9c'),
  ('Other',         'expense', '#8a94ac')
) as c(name, kind, color)
where w.name = 'laww-main'
on conflict (workspace_id, name) do nothing;

-- A starting rate so the first transaction can be recorded before the daily
-- job has ever run. The job overwrites it the first time it fires.
insert into finance_fx_rates (currency, rate_to_thb, as_of, source)
values
  ('USD', 33.5255,   current_date, 'seed'),
  ('MMK', 0.0159845, current_date, 'seed')
on conflict (currency, as_of) do nothing;
