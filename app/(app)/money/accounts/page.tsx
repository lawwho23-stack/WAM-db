import { PageHeader } from "@/components/ui";
import AccountManager from "@/components/AccountManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts · WAM-db" };

export default function AccountsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Accounts"
        subtitle="Every place money sits: a wallet in baht, a bank account in kyat, a card in dollars. Archiving keeps the history and hides the row."
      />
      <AccountManager />
    </>
  );
}
