import { PageHeader } from "@/components/ui";
import AccountManager from "@/components/AccountManager";
import { accountsWithThb, todayISO } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts · WAM-db" };

export default async function AccountsPage() {
  // The list arrives with the page instead of after it, archived ones included
  // — the page has a toggle for those.
  const accounts = await accountsWithThb(todayISO(), { includeArchived: true });

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Accounts"
        subtitle="Every place money sits: a wallet in baht, a bank account in kyat, a card in dollars. Archiving keeps the history and hides the row."
      />
      <AccountManager initialAccounts={accounts} />
    </>
  );
}
