#!/usr/bin/env node
// Owner passphrase helper.
//
//   node scripts/owner-password.mjs                 # generate one
//   node scripts/owner-password.mjs "my passphrase" # hash the one you picked
//
// Prints two lines:
//   passphrase: <the plaintext, so you can save it somewhere safe>
//   OWNER_PASSWORD_HASH=scrypt:<salt>:<hash>
//
// The hash is what belongs in .env.local and in Vercel. Keeping only the hash
// means the real passphrase never sits in an environment variable or a
// dashboard screenshot. Change it any time by running this again.

import { randomBytes, scryptSync } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1

function generate(groups = 5, size = 4) {
  const out = [];
  for (let g = 0; g < groups; g++) {
    let part = "";
    for (const byte of randomBytes(size)) part += ALPHABET[byte % ALPHABET.length];
    out.push(part);
  }
  return out.join("-");
}

const passphrase = process.argv[2]?.trim() || generate();
if (passphrase.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(passphrase, salt, 64).toString("hex");

console.log(`passphrase: ${passphrase}`);
console.log(`OWNER_PASSWORD_HASH=scrypt:${salt}:${hash}`);
