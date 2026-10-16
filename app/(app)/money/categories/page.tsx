import { PageHeader } from "@/components/ui";
import CategoryManager from "@/components/CategoryManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categories · WAM-db" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Categories"
        subtitle="What money was for. The overview groups a month by these, so a category that stops being useful is better archived than deleted."
      />
      <CategoryManager />
    </>
  );
}
