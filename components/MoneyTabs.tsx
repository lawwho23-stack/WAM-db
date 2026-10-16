"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The money section has four rooms and they all fit in one row.

const TABS = [
  { href: "/money", label: "Overview" },
  { href: "/money/transactions", label: "Transactions" },
  { href: "/money/accounts", label: "Accounts" },
  { href: "/money/categories", label: "Categories" },
];

export default function MoneyTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => {
        const active = tab.href === "/money" ? pathname === "/money" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] whitespace-nowrap transition ${
              active ? "border-cyan text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
