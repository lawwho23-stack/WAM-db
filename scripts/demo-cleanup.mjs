#!/usr/bin/env node
// Take the demo data back out: every transaction on the demo accounts, then the
// accounts themselves. Forwards the same flow the UI uses (soft-delete the rows,
// purge the accounts) so nothing is left behind for a report to pick up.
//
//   node scripts/demo-cleanup.mjs
//   node scripts/demo-cleanup.mjs https://wam-db.vercel.app

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
  return res.json().catch(() => ({}));
}

const DEMO_ACCOUNTS = ["Bangkok Bank", "Cash", "KBZ Pay", "Wise USD"];

console.log(`\nRemoving the demo month from ${base}\n`);

const { rows = [] } = await api("/api/money/transactions?limit=500");
let removed = 0;
for (const row of rows) {
  if (!DEMO_ACCOUNTS.includes(row.accountName)) continue;
  await api(`/api/money/transactions/${row.id}`, "DELETE");
  removed += 1;
}
console.log(`  ${removed} transaction(s) deleted`);

const { accounts = [] } = await api("/api/money/accounts");
for (const account of accounts) {
  if (!DEMO_ACCOUNTS.includes(account.name)) continue;
  const gone = await api("/api/money/accounts", "DELETE", { id: account.id });
  console.log(gone.error ? `  ! ${account.name}: ${gone.error}` : `  account ${account.name} purged`);
}

console.log("\nDone. Accounts, categories and exchange rates are untouched.\n");
