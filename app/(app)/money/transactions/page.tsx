import { PageHeader } from "@/components/ui";
import MoneyTransactions from "@/components/MoneyTransactions";
import { monthOf } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transactions · WAM-db" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams;
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : monthOf();

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Transactions"
        subtitle="Record what moved, correct it when you get it wrong, and export the lot as CSV. Amounts in kyat or dollars keep the rate they were recorded at."
      />
      <MoneyTransactions initialMonth={month} />
    </>
  );
}
