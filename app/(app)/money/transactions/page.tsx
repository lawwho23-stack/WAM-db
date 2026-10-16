import { PageHeader } from "@/components/ui";
import MoneyTransactions from "@/components/MoneyTransactions";
import { accountsWithThb, latestRates, listCategories, listTransactions, monthOf } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transactions · WAM-db" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams;
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : monthOf();

  // Everything the page needs, fetched in parallel while the HTML is built.
  // Letting the browser ask for this afterwards was four requests and four
  // function invocations, with the list and the dropdowns empty until the
  // slowest one landed.
  const [list, accounts, categories, rates] = await Promise.all([
    listTransactions({ month, limit: 200 }),
    accountsWithThb(),
    listCategories(),
    latestRates(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Transactions"
        subtitle="Record what moved, correct it when you get it wrong, and export the lot as CSV. Amounts in kyat or dollars keep the rate they were recorded at."
      />
      <MoneyTransactions
        initialMonth={month}
        initialList={list}
        initialAccounts={accounts}
        initialCategories={categories}
        initialRates={rates}
      />
    </>
  );
}
