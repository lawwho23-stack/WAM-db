#!/usr/bin/env node
// Put a demo month of money into the database, so the money pages have
// something to show before real numbers exist.
//
//   node scripts/demo-seed.mjs                      # against http://localhost:3000
//   node scripts/demo-seed.mjs https://wam-db.vercel.app
//
// It signs in as the owner (OWNER_EMAIL / OWNER_PASSWORD from .env.local) and
// writes four accounts and fourteen transactions through the same API the UI
// uses. Run scripts/demo-cleanup.mjs to take it all back out again.

import { readFileSync } from "node:fs";

function loadEnvFile(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
    }
  } catch {
    // no .env.local here: rely on the real environment
  }
}
loadEnvFile();

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;
if (!email || !password) throw new Error("Set OWNER_EMAIL and OWNER_PASSWORD (the passphrase itself, not the hash).");

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`Sign-in failed (${login.status}). Is OWNER_PASSWORD the passphrase?`);
const cookie = login.headers.getSetCookie().find((c) => c.startsWith("wam_session=")).split(";")[0];

async function api(path, method = "GET", body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// The current month, so the dashboard opens on data rather than an empty state.
const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const day = (n) => `${month}-${String(n).padStart(2, "0")}`;

const ACCOUNTS = [
  { name: "Bangkok Bank", kind: "bank", currency: "THB", openingBalance: 24000 },
  { name: "Cash", kind: "cash", currency: "THB", openingBalance: 1500 },
  { name: "KBZ Pay", kind: "ewallet", currency: "MMK", openingBalance: 620000 },
  { name: "Wise USD", kind: "bank", currency: "USD", openingBalance: 250 },
];

const TX = [
  [1, "Bangkok Bank", "Salary", 45000, "Payroll", ""],
  [2, "Bangkok Bank", "Rent", -12000, "Condo rent", "this month"],
  [3, "Cash", "Groceries", -1850.75, "Big C", ""],
  [5, "KBZ Pay", "Family", -300000, "Ma", "monthly"],
  [6, "Wise USD", "Client payment", 600, "Acme invoice #014", "paid in USD"],
  [7, "Bangkok Bank", "Health", -1200, "Clinic", ""],
  [8, "Bangkok Bank", "Internet", -599, "AIS Fibre", ""],
  [9, "Cash", "Food", -180, "Breakfast near the office", ""],
  [10, "Cash", "Transport", -320, "BTS and Grab", ""],
  [12, "Wise USD", "Software", -29, "Perplexity", "agent stack"],
  [13, "Cash", "Food", -420, "Noodle shop", ""],
  [14, "Bangkok Bank", "Phone", -300, "AIS top-up", ""],
  [15, "Bangkok Bank", "Groceries", -2140.5, "Tops", ""],
  [16, "Bangkok Bank", "Freelance", 8500, "Landing page build", "client 2"],
];

console.log(`\nSeeding a demo month into ${base}\n`);

const ids = {};
for (const account of ACCOUNTS) {
  const { account: created } = await api("/api/money/accounts", "POST", account);
  ids[account.name] = created.id;
  console.log(`  account ${created.name} (${created.currency})`);
}

const { categories } = await api("/api/money/categories");
const categoryId = (name) => categories.find((c) => c.name === name)?.id ?? null;

let count = 0;
for (const [dayOfMonth, accountName, category, amount, payee, note] of TX) {
  const { transaction } = await api("/api/money/transactions", "POST", {
    accountId: ids[accountName],
    categoryId: categoryId(category),
    occurredOn: day(dayOfMonth),
    amount,
    payee,
    note: note || null,
  });
  count += 1;
  console.log(
    `  ${transaction.occurredOn}  ${String(amount).padStart(9)} ${transaction.currency.padEnd(3)}  ${payee.padEnd(24)} → ${transaction.amountThbMinor / 100} THB`,
  );
}

console.log(`\n${ACCOUNTS.length} accounts and ${count} transactions added. Run scripts/demo-cleanup.mjs to remove them.\n`);
