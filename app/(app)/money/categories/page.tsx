import { PageHeader } from "@/components/ui";
import CategoryManager from "@/components/CategoryManager";
import { listCategories } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categories · WAM-db" };

export default async function CategoriesPage() {
  // Archived ones included: the page has a toggle for them.
  const categories = await listCategories({ includeArchived: true });

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Categories"
        subtitle="What money was for. The overview groups a month by these, so a category that stops being useful is better archived than deleted."
      />
      <CategoryManager initialCategories={categories} />
    </>
  );
}
