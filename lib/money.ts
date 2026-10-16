import { sql, getWorkspaceId, getActorByKind } from "./db";

/**
 * Money.
 *
 * Everything is kept in minor units (1/100 of the currency) as whole numbers,
 * because binary floating point cannot hold 0.10 exactly and money that drifts
 * by a satang per thousand rows is money you cannot reconcile.
 *
 * THB is the base. Every transaction stores the rate it was converted at, so a
 * report for last month still reads the same after the kyat moves.
 */

// The types, the constants and the arithmetic live in money-types.ts, which a
// browser can import without pulling Postgres in behind it. Re-exported here so
// server code has a single place to import money from.
import { BASE, CURRENCIES, monthOf, monthRange, num, toMinor, todayISO } from "./money-types";
import type { AccountKind, AccountRow, CategoryKind, CategoryRow, Currency, RateRow, TxRow } from "./money-types";

export * from "./money-types";

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : String(value);
}

// -------------------------------------------------------------- workspace

let workspaceCache: string | null = null;
async function workspaceId(): Promise<string> {
  if (!workspaceCache) workspaceCache = await getWorkspaceId();
  return workspaceCache;
}

// The owner's actor row never changes either, and finding it was a round trip
// per write. Remembered like the workspace id.
let ownerActorCache: string | null = null;
async function ownerActorId(): Promise<string> {
  if (!ownerActorCache) ownerActorCache = await getActorByKind(await workspaceId(), "owner");
  return ownerActorCache;
}

// ------------------------------------------------------------------ fx rates

/**
 * The newest rate at or before `asOf` for each currency, falling back to the
 * newest rate we have at all. THB is always 1 — it is the base.
 *
 * One statement, because this sits on the critical path of every money page and
 * each round trip to Postgres is real time. Sorting the preferred rows first
 * lets DISTINCT ON pick them, so the fallback is the same query rather than a
 * second pass.
 */
export async function latestRates(asOf: string = todayISO()): Promise<Record<Currency, RateRow | null>> {
  const db = sql();
  const rows = await db`
    select distinct on (currency) currency, rate_to_thb, as_of::text as as_of, source
    from finance_fx_rates
    where currency in ('USD', 'MMK')
    order by currency, (as_of <= ${asOf}) desc, as_of desc`;

  const byCurrency = new Map<string, RateRow>();
  for (const row of rows) {
    byCurrency.set(row.currency, {
      currency: row.currency as Currency,
      rateToThb: num(row.rate_to_thb),
      asOf: text(row.as_of).slice(0, 10),
      source: text(row.source),
    });
  }

  return {
    THB: { currency: "THB", rateToThb: 1, asOf, source: "base" },
    USD: byCurrency.get("USD") ?? null,
    MMK: byCurrency.get("MMK") ?? null,
  };
}

/** The rate to convert one unit of `currency` into THB on a given day. */
export async function rateFor(currency: Currency, asOf: string): Promise<number> {
  if (currency === BASE) return 1;
  const rates = await latestRates(asOf);
  const found = rates[currency];
  if (!found) throw new Error(`No ${currency} → THB rate yet. Add one on the Money page.`);
  return found.rateToThb;
}

export async function listRates(limit = 40): Promise<RateRow[]> {
  const db = sql();
  const rows = await db`
    select currency, rate_to_thb, as_of::text as as_of, source
    from finance_fx_rates order by as_of desc, currency limit ${limit}`;
  return rows.map((r) => ({
    currency: r.currency as Currency,
    rateToThb: num(r.rate_to_thb),
    asOf: text(r.as_of).slice(0, 10),
    source: text(r.source),
  }));
}

/** Record a rate by hand, or overwrite today's. */
export async function upsertRate(currency: Currency, rateToThb: number, asOf = todayISO(), source = "manual"): Promise<RateRow> {
  if (currency === BASE) throw new Error("THB is the base currency — it does not need a rate.");
  if (!(rateToThb > 0)) throw new Error("A rate must be greater than zero.");
  const db = sql();
  const rows = await db`
    insert into finance_fx_rates (currency, rate_to_thb, as_of, source)
    values (${currency}, ${rateToThb}, ${asOf}, ${source})
    on conflict (currency, as_of) do update set rate_to_thb = excluded.rate_to_thb, source = excluded.source
    returning currency, rate_to_thb, as_of::text as as_of, source`;
  return {
    currency: rows[0].currency as Currency,
    rateToThb: num(rows[0].rate_to_thb),
    asOf: text(rows[0].as_of).slice(0, 10),
    source: text(rows[0].source),
  };
}

/** Pull today's rates from the free exchangerate-api feed. Used by /api/cron. */
export async function refreshRatesFromFeed(): Promise<RateRow[]> {
  const res = await fetch("https://open.er-api.com/v6/latest/THB", { cache: "no-store" });
  if (!res.ok) throw new Error(`Rate feed answered ${res.status}.`);
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (body.result !== "success" || !body.rates) throw new Error("Rate feed did not return a usable payload.");

  const written: RateRow[] = [];
  for (const currency of ["USD", "MMK"] as const) {
    const perThb = body.rates[currency];
    if (!perThb || perThb <= 0) continue;
    // The feed quotes THB → X, and we store X → THB.
    written.push(await upsertRate(currency, 1 / perThb, todayISO(), "feed"));
  }
  return written;
}

// ------------------------------------------------------------------ accounts

type AccountDbRow = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  opening_balance_minor: unknown;
  balance_minor: unknown;
  tx_count: unknown;
  note: string | null;
  archived_at: unknown;
  rate: unknown;
};

export async function listAccounts(options: { includeArchived?: boolean } = {}): Promise<AccountRow[]> {
  const db = sql();
  const rows = await db`
    select a.id, a.name, a.kind, a.currency, a.opening_balance_minor, a.note, a.archived_at::text as archived_at,
           a.opening_balance_minor + coalesce(sum(t.amount_minor), 0) as balance_minor,
           count(t.id) as tx_count
    from finance_accounts a
    left join finance_transactions t on t.account_id = a.id and t.deleted_at is null
    where a.workspace_id = ${await workspaceId()}
      and (${options.includeArchived === true} or a.archived_at is null)
    group by a.id
    order by a.archived_at nulls first, a.name`;
  return rows.map((r) => mapAccount(r as AccountDbRow, 1));
}

function mapAccount(row: AccountDbRow, rate: number): AccountRow {
  const balanceMinor = num(row.balance_minor);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as AccountKind,
    currency: row.currency as Currency,
    openingBalanceMinor: num(row.opening_balance_minor),
    balanceMinor,
    balanceThbMinor: Math.round(balanceMinor * rate),
    txCount: num(row.tx_count),
    note: row.note,
    archivedAt: row.archived_at ? text(row.archived_at) : null,
  };
}

export async function accountsWithThb(asOf = todayISO(), options: { includeArchived?: boolean } = {}): Promise<AccountRow[]> {
  const [accounts, rates] = await Promise.all([listAccounts(options), latestRates(asOf)]);
  return accounts.map((a) => ({ ...a, balanceThbMinor: Math.round(a.balanceMinor * (rates[a.currency]?.rateToThb ?? 0)) }));
}

/**
 * The one rule a person can break on purpose: two accounts cannot share a name
 * in the same workspace. Postgres says so in its own language; this says it in
 * the one the page shows.
 */
function namedTwice(error: unknown, name: string): never {
  if (error instanceof Error && error.message.includes("finance_accounts_name")) {
    throw new Error(`There is already an account called "${name}". Rename it, or use the one that is there.`);
  }
  throw error;
}

export async function createAccount(input: {
  name: string;
  kind?: AccountKind;
  currency: Currency;
  openingBalanceMinor?: number;
  note?: string | null;
}): Promise<AccountRow> {
  const db = sql();
  try {
    const rows = await db`
      insert into finance_accounts (workspace_id, name, kind, currency, opening_balance_minor, note)
      values (${await workspaceId()}, ${input.name.trim()}, ${input.kind ?? "bank"}, ${input.currency},
              ${input.openingBalanceMinor ?? 0}, ${input.note ?? null})
      returning id, name, kind, currency, opening_balance_minor, note, archived_at::text as archived_at,
                opening_balance_minor as balance_minor, 0 as tx_count`;
    return mapAccount(rows[0] as AccountDbRow, 1);
  } catch (error) {
    namedTwice(error, input.name.trim());
  }
}

export async function updateAccount(
  id: string,
  patch: { name?: string; kind?: AccountKind; openingBalanceMinor?: number; note?: string | null; archived?: boolean },
): Promise<AccountRow> {
  const db = sql();
  // Written with db() rather than the tagged template: "leave the note
  // alone" and "set the note to null" are different requests, and the tagged
  // form would send one parameter doing both jobs.
  let rows: Record<string, unknown>[];
  try {
    rows = (await db(
      `update finance_accounts set
         name = coalesce($2, name),
         kind = coalesce($3, kind),
         opening_balance_minor = coalesce($4, opening_balance_minor),
         note = case when $5 then $6 else note end,
         archived_at = case when $7::boolean is null then archived_at
                            when $7 then coalesce(archived_at, now())
                            else null end,
         updated_at = now()
       where id = $1 and workspace_id = $8
       returning id, name, kind, currency, opening_balance_minor, note, archived_at::text as archived_at,
                 opening_balance_minor as balance_minor, 0 as tx_count`,
      [
        id,
        patch.name?.trim() ?? null,
        patch.kind ?? null,
        patch.openingBalanceMinor ?? null,
        patch.note !== undefined,
        patch.note ?? null,
        patch.archived ?? null,
        await workspaceId(),
      ],
    )) as Record<string, unknown>[];
  } catch (error) {
    namedTwice(error, patch.name?.trim() ?? "that name");
  }
  if (rows.length === 0) throw new Error("Account not found.");
  return mapAccount(rows[0] as AccountDbRow, 1);
}

/**
 * Remove an account for good.
 *
 * Only when nothing live references it. An account with real history is
 * archived instead: deleting it would take its transactions with it and
 * quietly change months that are already closed.
 */
export async function purgeAccount(id: string): Promise<{ id: string; purgedTransactions: number }> {
  const db = sql();
  const workspace = await workspaceId();
  const live = await db`
    select count(*) as n from finance_transactions
    where account_id = ${id} and workspace_id = ${workspace} and deleted_at is null`;
  if (num(live[0]?.n) > 0) {
    throw new Error("This account still has transactions. Archive it, or delete them first.");
  }
  // Soft-deleted rows would block the delete (the foreign key is RESTRICT), and
  // they are only kept as a safety net — once the account is going, they go too.
  const gone = await db`delete from finance_transactions where account_id = ${id} and workspace_id = ${workspace} returning id`;
  const rows = await db`delete from finance_accounts where id = ${id} and workspace_id = ${workspace} returning id`;
  if (rows.length === 0) throw new Error("Account not found.");
  return { id, purgedTransactions: gone.length };
}

// ---------------------------------------------------------------- categories

export async function listCategories(options: { includeArchived?: boolean } = {}): Promise<CategoryRow[]> {
  const db = sql();
  const rows = await db`
    select c.id, c.name, c.kind, c.color, c.archived_at::text as archived_at, count(t.id) as tx_count
    from finance_categories c
    left join finance_transactions t on t.category_id = c.id and t.deleted_at is null
    where c.workspace_id = ${await workspaceId()}
      and (${options.includeArchived === true} or c.archived_at is null)
    group by c.id
    order by c.kind desc, c.name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as CategoryKind,
    color: r.color,
    txCount: num(r.tx_count),
    archivedAt: r.archived_at ? text(r.archived_at) : null,
  }));
}

export async function createCategory(input: { name: string; kind: CategoryKind; color?: string | null }): Promise<CategoryRow> {
  const db = sql();
  const rows = await db`
    insert into finance_categories (workspace_id, name, kind, color)
    values (${await workspaceId()}, ${input.name.trim()}, ${input.kind}, ${input.color ?? null})
    on conflict (workspace_id, name) do update set kind = excluded.kind, archived_at = null, color = coalesce(excluded.color, finance_categories.color)
    returning id, name, kind, color, archived_at::text as archived_at`;
  return {
    id: rows[0].id,
    name: rows[0].name,
    kind: rows[0].kind as CategoryKind,
    color: rows[0].color,
    txCount: 0,
    archivedAt: rows[0].archived_at ? text(rows[0].archived_at) : null,
  };
}

export async function updateCategory(id: string, patch: { name?: string; kind?: CategoryKind; color?: string | null; archived?: boolean }): Promise<CategoryRow> {
  const db = sql();
  const rows = await db(
    `update finance_categories set
       name = coalesce($2, name),
       kind = coalesce($3, kind),
       color = case when $4 then $5 else color end,
       archived_at = case when $6::boolean is null then archived_at
                          when $6 then coalesce(archived_at, now())
                          else null end,
       updated_at = now()
     where id = $1 and workspace_id = $7
     returning id, name, kind, color, archived_at::text as archived_at`,
    [id, patch.name?.trim() ?? null, patch.kind ?? null, patch.color !== undefined, patch.color ?? null, patch.archived ?? null, await workspaceId()],
  );
  if (rows.length === 0) throw new Error("Category not found.");
  return {
    id: rows[0].id,
    name: rows[0].name,
    kind: rows[0].kind as CategoryKind,
    color: rows[0].color,
    txCount: 0,
    archivedAt: rows[0].archived_at ? text(rows[0].archived_at) : null,
  };
}

// -------------------------------------------------------------- transactions

// Split in two so a write can reuse the columns: `insert ... returning *` in a
// CTE, then these columns joined to the account and category, means one round
// trip where there used to be two (insert, then read it back).
const TX_COLUMNS = `
  select t.id, t.occurred_on::text as occurred_on, t.account_id, a.name as account_name, a.currency as account_currency,
         t.category_id, c.name as category_name, c.kind as category_kind,
         t.amount_minor, t.currency, t.rate_to_thb, t.amount_thb_minor,
         t.payee, t.note, t.tags, t.source, t.created_at`;
const TX_FROM = `
  from finance_transactions t
  join finance_accounts a on a.id = t.account_id
  left join finance_categories c on c.id = t.category_id`;
const TX_SELECT = `${TX_COLUMNS} ${TX_FROM}`;

function mapTx(row: Record<string, unknown>): TxRow {
  return {
    id: String(row.id),
    occurredOn: text(row.occurred_on).slice(0, 10),
    accountId: String(row.account_id),
    accountName: String(row.account_name),
    accountCurrency: row.account_currency as Currency,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: row.category_name ? String(row.category_name) : null,
    categoryKind: row.category_kind ? (row.category_kind as CategoryKind) : null,
    amountMinor: num(row.amount_minor),
    currency: row.currency as Currency,
    rateToThb: num(row.rate_to_thb),
    amountThbMinor: num(row.amount_thb_minor),
    payee: row.payee ? String(row.payee) : null,
    note: row.note ? String(row.note) : null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    source: text(row.source),
    createdAt: text(row.created_at),
  };
}

export type TxFilters = {
  month?: string | null;
  from?: string | null;
  to?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  kind?: CategoryKind | null;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export async function listTransactions(filters: TxFilters = {}): Promise<{ rows: TxRow[]; total: number; sumThbMinor: number }> {
  const where: string[] = ["t.workspace_id = $1", "t.deleted_at is null"];
  const params: unknown[] = [await workspaceId()];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.month) {
    const { start, end } = monthRange(filters.month);
    where.push(`t.occurred_on >= ${add(start)} and t.occurred_on < ${add(end)}`);
  }
  if (filters.from) where.push(`t.occurred_on >= ${add(filters.from)}`);
  if (filters.to) where.push(`t.occurred_on <= ${add(filters.to)}`);
  if (filters.accountId) where.push(`t.account_id = ${add(filters.accountId)}`);
  if (filters.categoryId) where.push(`t.category_id = ${add(filters.categoryId)}`);
  if (filters.kind === "income") where.push("t.amount_minor > 0");
  if (filters.kind === "expense") where.push("t.amount_minor < 0");
  if (filters.q) {
    const like = `%${filters.q}%`;
    where.push(`(t.payee ilike ${add(like)} or t.note ilike ${add(like)} or c.name ilike ${add(like)} or a.name ilike ${add(like)})`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const clause = where.join(" and ");
  const db = sql();

  const [rows, totals] = await Promise.all([
    db(`${TX_SELECT} where ${clause} order by t.occurred_on desc, t.created_at desc limit ${limit} offset ${offset}`, params),
    db(
      `select count(*) as n, coalesce(sum(t.amount_thb_minor), 0) as total
       from finance_transactions t
       join finance_accounts a on a.id = t.account_id
       left join finance_categories c on c.id = t.category_id
       where ${clause}`,
      params,
    ),
  ]);

  return {
    rows: rows.map(mapTx),
    total: num((totals[0] as Record<string, unknown>)?.n),
    sumThbMinor: num((totals[0] as Record<string, unknown>)?.total),
  };
}

export type TxInput = {
  accountId: string;
  categoryId?: string | null;
  occurredOn: string;
  amountMinor: number;
  currency?: Currency;
  rateToThb?: number;
  payee?: string | null;
  note?: string | null;
  tags?: string[];
  source?: "manual" | "csv" | "agent" | "recurring";
  externalId?: string | null;
  actorId?: string | null;
};

export async function createTransaction(input: TxInput): Promise<TxRow> {
  if (input.amountMinor === 0) throw new Error("An amount of zero moves nothing.");
  const db = sql();
  const workspace = await workspaceId();

  // One statement answers the three things the write depends on: does the
  // account exist and in which currency, what is that currency worth in baht on
  // that day, and who is the owner. As separate awaits this was up to four round
  // trips, and the person at the keyboard waits for the sum of them.
  const [lookup] = await db(
    `with acct as (
       select id, currency from finance_accounts where id = $1 and workspace_id = $2
     ), want as (
       select coalesce($3::text, (select currency from acct)) as currency
     ), rate as (
       select rate_to_thb from finance_fx_rates
       where currency = (select currency from want)
       order by (as_of <= $4::date) desc, as_of desc
       limit 1
     ), person as (
       select id from actors where workspace_id = $2 and kind = 'owner' limit 1
     )
     select (select currency from acct) as account_currency,
            (select currency from want) as currency,
            (select rate_to_thb from rate) as rate_to_thb,
            (select id from person) as actor_id`,
    [input.accountId, workspace, input.currency ?? null, input.occurredOn],
  );

  if (!lookup?.account_currency) throw new Error("Account not found.");
  const currency = (input.currency ?? String(lookup.account_currency)) as Currency;
  const stored = num(lookup.rate_to_thb);
  const rate = input.rateToThb && input.rateToThb > 0 ? input.rateToThb : currency === BASE ? 1 : stored;
  if (!(rate > 0)) throw new Error(`No ${currency} → THB rate yet. Add one on the Money page.`);
  const amountThbMinor = Math.round(input.amountMinor * rate);
  const actorId = input.actorId ?? (lookup.actor_id ? String(lookup.actor_id) : await ownerActorId());

  // The insert and the read-back are one statement, so the row the caller gets
  // is the row the database stored.
  const rows = await db(
    `with ins as (
       insert into finance_transactions
         (workspace_id, account_id, category_id, occurred_on, amount_minor, currency, rate_to_thb, amount_thb_minor,
          payee, note, tags, source, external_id, actor_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning *
     )
     ${TX_COLUMNS}
     from ins t
     join finance_accounts a on a.id = t.account_id
     left join finance_categories c on c.id = t.category_id`,
    [
      workspace,
      input.accountId,
      input.categoryId ?? null,
      input.occurredOn,
      input.amountMinor,
      currency,
      rate,
      amountThbMinor,
      input.payee ?? null,
      input.note ?? null,
      input.tags ?? [],
      input.source ?? "manual",
      input.externalId ?? null,
      actorId,
    ],
  );
  if (rows.length === 0) throw new Error("The transaction was written but could not be read back.");
  return mapTx(rows[0] as Record<string, unknown>);
}

export async function getTransaction(id: string): Promise<TxRow | null> {
  const db = sql();
  const rows = await db(`${TX_SELECT} where t.id = $1 and t.workspace_id = $2`, [id, await workspaceId()]);
  return rows.length > 0 ? mapTx(rows[0]) : null;
}

export async function updateTransaction(id: string, patch: Partial<TxInput>): Promise<TxRow> {
  const db = sql();
  const workspace = await workspaceId();
  const current = await getTransaction(id);
  if (!current) throw new Error("Transaction not found.");

  const accountId = patch.accountId ?? current.accountId;
  const occurredOn = patch.occurredOn ?? current.occurredOn;
  const amountMinor = patch.amountMinor ?? current.amountMinor;
  const currency = patch.currency ?? current.currency;
  // Baht needs no lookup, so the common edit costs two round trips, not four.
  const rate =
    patch.rateToThb && patch.rateToThb > 0
      ? patch.rateToThb
      : currency === BASE
        ? 1
        : await rateFor(currency, occurredOn);
  const amountThbMinor = Math.round(amountMinor * rate);

  const rows = await db(
    `with upd as (
       update finance_transactions set
         account_id = $3,
         category_id = $4,
         occurred_on = $5,
         amount_minor = $6,
         currency = $7,
         rate_to_thb = $8,
         amount_thb_minor = $9,
         payee = $10,
         note = $11,
         tags = $12,
         updated_at = now()
       where id = $1 and workspace_id = $2
       returning *
     )
     ${TX_COLUMNS}
     from upd t
     join finance_accounts a on a.id = t.account_id
     left join finance_categories c on c.id = t.category_id`,
    [
      id,
      workspace,
      accountId,
      patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      occurredOn,
      amountMinor,
      currency,
      rate,
      amountThbMinor,
      patch.payee === undefined ? current.payee : patch.payee,
      patch.note === undefined ? current.note : patch.note,
      patch.tags ?? current.tags,
    ],
  );
  if (rows.length === 0) throw new Error("Transaction not found.");
  return mapTx(rows[0] as Record<string, unknown>);
}

/** Soft delete: the row stays, so a mistake is recoverable from SQL. */
export async function deleteTransaction(id: string): Promise<{ id: string }> {
  const db = sql();
  const rows = await db`
    update finance_transactions set deleted_at = now()
    where id = ${id} and workspace_id = ${await workspaceId()} and deleted_at is null
    returning id`;
  if (rows.length === 0) throw new Error("Transaction not found.");
  return { id };
}

// ------------------------------------------------------------------ summary

export type Summary = {
  month: string;
  label: string;
  netWorthThbMinor: number;
  byCurrency: { currency: Currency; balanceMinor: number; balanceThbMinor: number; rateToThb: number }[];
  accounts: AccountRow[];
  /** The rates the numbers above were converted with, handed to the panel so
   *  it does not ask for them a second time. */
  rates: Record<Currency, RateRow | null>;
  incomeThbMinor: number;
  expenseThbMinor: number;
  netThbMinor: number;
  txCount: number;
  byCategory: { id: string | null; name: string; kind: CategoryKind; color: string | null; totalThbMinor: number; count: number }[];
  trend: { month: string; incomeThbMinor: number; expenseThbMinor: number }[];
  recent: TxRow[];
  biggest: TxRow[];
};

export async function moneySummary(month: string = monthOf()): Promise<Summary> {
  const db = sql();
  const workspace = await workspaceId();
  const { start, end, label } = monthRange(month);
  const [accounts, rates] = await Promise.all([listAccounts(), latestRates(todayISO())]);
  const rateOf = (currency: Currency) => rates[currency]?.rateToThb ?? 0;
  const withThb = accounts.map((a) => ({ ...a, balanceThbMinor: Math.round(a.balanceMinor * rateOf(a.currency)) }));

  const byCurrency = new Map<Currency, { balanceMinor: number; balanceThbMinor: number }>();
  for (const account of withThb) {
    const bucket = byCurrency.get(account.currency) ?? { balanceMinor: 0, balanceThbMinor: 0 };
    bucket.balanceMinor += account.balanceMinor;
    bucket.balanceThbMinor += account.balanceThbMinor;
    byCurrency.set(account.currency, bucket);
  }

  const [totals, byCategory, trendRows, recentRows, biggestRows] = await Promise.all([
    db`
      select coalesce(sum(amount_thb_minor) filter (where amount_thb_minor > 0), 0) as income,
             coalesce(sum(amount_thb_minor) filter (where amount_thb_minor < 0), 0) as expense,
             count(*) as n
      from finance_transactions
      where workspace_id = ${workspace} and deleted_at is null and occurred_on >= ${start} and occurred_on < ${end}`,
    db`
      select c.id, c.name, c.kind, c.color,
             sum(t.amount_thb_minor) as total, count(*) as n
      from finance_transactions t
      join finance_categories c on c.id = t.category_id
      where t.workspace_id = ${workspace} and t.deleted_at is null and t.occurred_on >= ${start} and t.occurred_on < ${end}
      group by c.id
      order by abs(sum(t.amount_thb_minor)) desc
      limit 8`,
    db`
      select to_char(date_trunc('month', occurred_on), 'YYYY-MM') as month,
             coalesce(sum(amount_thb_minor) filter (where amount_thb_minor > 0), 0) as income,
             coalesce(sum(amount_thb_minor) filter (where amount_thb_minor < 0), 0) as expense
      from finance_transactions
      where workspace_id = ${workspace} and deleted_at is null and occurred_on >= (date_trunc('month', ${start}::date) - interval '5 months')
      group by 1
      order by 1`,
    db(`${TX_SELECT} where t.workspace_id = $1 and t.deleted_at is null order by t.occurred_on desc, t.created_at desc limit 8`, [workspace]),
    db(
      `${TX_SELECT} where t.workspace_id = $1 and t.deleted_at is null and t.occurred_on >= $2 and t.occurred_on < $3
       order by abs(t.amount_thb_minor) desc limit 3`,
      [workspace, start, end],
    ),
  ]);

  const incomeThbMinor = num((totals[0] as Record<string, unknown>)?.income);
  const expenseThbMinor = num((totals[0] as Record<string, unknown>)?.expense);

  return {
    month,
    label,
    netWorthThbMinor: withThb.reduce((sum, a) => sum + a.balanceThbMinor, 0),
    byCurrency: CURRENCIES.map((currency) => ({
      currency,
      balanceMinor: byCurrency.get(currency)?.balanceMinor ?? 0,
      balanceThbMinor: byCurrency.get(currency)?.balanceThbMinor ?? 0,
      rateToThb: rateOf(currency),
    })),
    accounts: withThb,
    rates,
    incomeThbMinor,
    expenseThbMinor,
    netThbMinor: incomeThbMinor + expenseThbMinor,
    txCount: num((totals[0] as Record<string, unknown>)?.n),
    byCategory: byCategory.map((r: Record<string, unknown>) => ({
      id: r.id ? String(r.id) : null,
      name: String(r.name),
      kind: r.kind as CategoryKind,
      color: r.color ? String(r.color) : null,
      totalThbMinor: num(r.total),
      count: num(r.n),
    })),
    trend: trendRows.map((r: Record<string, unknown>) => ({
      month: text(r.month),
      incomeThbMinor: num(r.income),
      expenseThbMinor: num(r.expense),
    })),
    recent: recentRows.map(mapTx),
    biggest: biggestRows.map(mapTx),
  };
}

// ---------------------------------------------------------------------- csv

const CSV_COLUMNS = ["date", "account", "category", "amount", "currency", "rate_to_thb", "payee", "note", "tags", "external_id"] as const;

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: TxRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.occurredOn,
        row.accountName,
        row.categoryName ?? "",
        (row.amountMinor / 100).toFixed(2),
        row.currency,
        row.rateToThb.toFixed(8),
        row.payee ?? "",
        row.note ?? "",
        row.tags.join(" "),
        row.id,
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** A real CSV parser: quotes, escaped quotes, commas and newlines inside fields. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export type ImportReport = {
  inserted: number;
  skipped: number;
  createdAccounts: string[];
  createdCategories: string[];
  errors: string[];
};

/**
 * Import transactions from CSV. Unknown accounts and categories are created
 * rather than rejected, because a bank export names accounts the app has never
 * seen and stopping to add them by hand defeats the point of an import.
 *
 * Re-importing the same file changes nothing: each row carries a fingerprint in
 * external_id and the unique index refuses the duplicate.
 */
export async function importCsv(input: string): Promise<ImportReport> {
  const rows = parseCsv(input);
  if (rows.length < 2) throw new Error("The file has a header but no rows.");

  const header = rows[0].map((h) => h.trim().toLowerCase().replaceAll(" ", "_"));
  const index = (name: string) => header.indexOf(name);
  const col = {
    date: index("date"),
    account: index("account"),
    category: index("category"),
    amount: index("amount"),
    currency: index("currency"),
    rate: index("rate_to_thb"),
    payee: index("payee"),
    note: index("note"),
    tags: index("tags"),
    externalId: index("external_id"),
  };

  if (col.date < 0 || col.amount < 0) throw new Error('The file needs at least a "date" and an "amount" column.');

  const report: ImportReport = { inserted: 0, skipped: 0, createdAccounts: [], createdCategories: [], errors: [] };
  const db = sql();
  const workspace = await workspaceId();
  const actorId = await ownerActorId();

  // Everything the loop needs that does not change per row is fetched once.
  // Per-row lookups made a two-hundred-line file cost six hundred round trips;
  // the report is still per line, which is the part worth keeping exact.
  const [accountRows, categoryRows, rateRows] = await Promise.all([
    listAccounts({ includeArchived: true }),
    listCategories({ includeArchived: true }),
    db`select currency, rate_to_thb, as_of::text as as_of from finance_fx_rates order by currency, as_of desc`,
  ]);
  const accounts = new Map(accountRows.map((a) => [a.name.toLowerCase(), a]));
  const categories = new Map(categoryRows.map((c) => [c.name.toLowerCase(), c]));

  // Rates answered from memory: newest per currency first, so "the newest on or
  // before the day" is the first match and the newest we have at all is the
  // fallback — the same rule latestRates uses, without the round trip per row.
  const ratesByCurrency = new Map<string, { asOf: string; rate: number }[]>();
  for (const r of rateRows) {
    const forCurrency = ratesByCurrency.get(String(r.currency)) ?? [];
    forCurrency.push({ asOf: text(r.as_of).slice(0, 10), rate: num(r.rate_to_thb) });
    ratesByCurrency.set(String(r.currency), forCurrency);
  }
  const rateOn = (currency: Currency, date: string): number => {
    if (currency === BASE) return 1;
    const forCurrency = ratesByCurrency.get(currency) ?? [];
    const found = forCurrency.find((r) => r.asOf <= date) ?? forCurrency[0];
    if (!found) throw new Error(`no ${currency} → THB rate stored yet`);
    return found.rate;
  };

  // An exported file carries our row id per line. One query answers for all of
  // them whether those rows are still here.
  const claimedIds = rows
    .slice(1)
    .map((row) => (row[col.externalId] ?? "").trim())
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const existingIds = new Set<string>();
  if (claimedIds.length > 0) {
    const found = await db(`select id from finance_transactions where workspace_id = $1 and id = any($2::uuid[])`, [workspace, claimedIds]);
    for (const r of found) existingIds.add(String(r.id));
  }

  for (const [lineNumber, row] of rows.slice(1).entries()) {
    try {
      const cell = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
      const date = cell(col.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date "${date}" is not YYYY-MM-DD`);

      const amount = Number(cell(col.amount).replaceAll(",", ""));
      if (!Number.isFinite(amount) || amount === 0) throw new Error(`amount "${cell(col.amount)}" is not a number`);

      const currency = (cell(col.currency) || "THB").toUpperCase() as Currency;
      if (!CURRENCIES.includes(currency)) throw new Error(`currency "${currency}" is not THB, MMK or USD`);

      const accountName = cell(col.account) || "Imported";
      let account = accounts.get(accountName.toLowerCase());
      if (!account) {
        account = await createAccount({ name: accountName, currency, kind: "other" });
        accounts.set(accountName.toLowerCase(), account);
        report.createdAccounts.push(accountName);
      }

      const categoryName = cell(col.category);
      let categoryId: string | null = null;
      if (categoryName) {
        let category = categories.get(categoryName.toLowerCase());
        if (!category) {
          category = await createCategory({ name: categoryName, kind: amount > 0 ? "income" : "expense" });
          categories.set(categoryName.toLowerCase(), category);
          report.createdCategories.push(categoryName);
        }
        categoryId = category.id;
      }

      const explicitRate = Number(cell(col.rate));

      // An exported file carries each row's own id in the external_id column.
      // If that row is still here, there is nothing to do — which is what makes
      // export → import → export safe to repeat.
      const exportedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cell(col.externalId))
        ? cell(col.externalId)
        : "";
      if (exportedId && existingIds.has(exportedId)) {
        report.skipped += 1;
        continue;
      }

      // Rows that came from a bank export have no id of ours, so the file's own
      // values become the fingerprint. Same row twice, same fingerprint.
      const externalId = cell(col.externalId) || `csv:${[date, accountName, amount, currency, cell(col.payee), cell(col.note)].join("|")}`;
      const amountMinor = toMinor(amount);
      const rate = Number.isFinite(explicitRate) && explicitRate > 0 ? explicitRate : rateOn(currency, date);

      const inserted = await db`
        insert into finance_transactions
          (workspace_id, account_id, category_id, occurred_on, amount_minor, currency, rate_to_thb, amount_thb_minor,
           payee, note, tags, source, external_id, actor_id)
        values (${workspace}, ${account.id}, ${categoryId}, ${date}, ${amountMinor}, ${currency},
                ${rate}, ${Math.round(amountMinor * rate)}, ${cell(col.payee) || null}, ${cell(col.note) || null},
                ${cell(col.tags) ? cell(col.tags).split(/[\s,]+/).filter(Boolean) : []}, 'csv', ${externalId}, ${actorId})
        on conflict (workspace_id, external_id) where external_id is not null do nothing
        returning id`;
      if (inserted.length === 0) {
        report.skipped += 1;
        continue;
      }
      report.inserted += 1;
    } catch (error) {
      report.errors.push(`line ${lineNumber + 2}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return report;
}
