/**
 * Money, the parts a browser can have.
 *
 * This file holds the types, the constants and the arithmetic — nothing that
 * touches the database. Client components import from here, which keeps
 * `lib/money.ts` (and the Postgres driver behind it) out of the browser bundle.
 */

export type Currency = "THB" | "MMK" | "USD";
export const CURRENCIES: readonly Currency[] = ["THB", "MMK", "USD"];
export const CURRENCY_LABEL: Record<Currency, string> = { THB: "Thai baht", MMK: "Myanmar kyat", USD: "US dollar" };
export const BASE: Currency = "THB";

export type AccountKind = "cash" | "bank" | "ewallet" | "credit" | "investment" | "other";
export const ACCOUNT_KINDS: readonly AccountKind[] = ["cash", "bank", "ewallet", "credit", "investment", "other"];
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: "Cash",
  bank: "Bank",
  ewallet: "E-wallet",
  credit: "Credit",
  investment: "Investment",
  other: "Other",
};

export type CategoryKind = "income" | "expense";

export type AccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  currency: Currency;
  openingBalanceMinor: number;
  balanceMinor: number;
  balanceThbMinor: number;
  txCount: number;
  note: string | null;
  archivedAt: string | null;
};

export type CategoryRow = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
  txCount: number;
  archivedAt: string | null;
};

export type TxRow = {
  id: string;
  occurredOn: string;
  accountId: string;
  accountName: string;
  accountCurrency: Currency;
  categoryId: string | null;
  categoryName: string | null;
  categoryKind: CategoryKind | null;
  amountMinor: number;
  currency: Currency;
  rateToThb: number;
  amountThbMinor: number;
  payee: string | null;
  note: string | null;
  tags: string[];
  source: string;
  createdAt: string;
};

export type RateRow = { currency: Currency; rateToThb: number; asOf: string; source: string };

// ------------------------------------------------------------- numbers & text

/** Postgres hands back bigint and numeric as strings; make them numbers. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 12.34 → 1234 */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

/** 1234 → 12.34 */
export function fromMinor(minor: number): number {
  return minor / 100;
}

const SYMBOL: Record<Currency, string> = { THB: "฿", MMK: "K", USD: "$" };

/** 1234567 (THB) → "฿12,345.67" */
export function fmt(minor: number, currency: Currency = BASE, decimals = 2): string {
  const value = fromMinor(minor);
  const sign = value < 0 ? "-" : "";
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${SYMBOL[currency]}${body}`;
}

/** For the big cards: 123456789 → "฿1.23M". The full value goes in the title. */
export function fmtCompact(minor: number, currency: Currency = BASE): string {
  const value = Math.abs(fromMinor(minor));
  const sign = minor < 0 ? "-" : "";
  const unit = value >= 1_000_000 ? (["M", 1_000_000] as const) : value >= 10_000 ? (["k", 1_000] as const) : null;
  if (!unit) return fmt(minor, currency, value % 1 === 0 ? 0 : 2);
  const scaled = value / unit[1];
  return `${sign}${SYMBOL[currency]}${scaled.toFixed(scaled >= 100 ? 0 : 2)}${unit[0]}`;
}

/** A date like "2026-10-16", written in local time rather than UTC. */
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "2026-10" for the month a date falls in. */
export function monthOf(date: Date | string = new Date()): string {
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00`) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The first day of a month, the first day of the next, and "October 2026". */
export function monthRange(month: string): { start: string; end: string; label: string } {
  const [year, m] = month.split("-").map(Number);
  const start = `${year}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? { y: year + 1, m: 1 } : { y: year, m: m + 1 };
  const end = `${next.y}-${String(next.m).padStart(2, "0")}-01`;
  const label = new Date(`${start}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, label };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "16 Oct" for a table cell. */
export function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}
