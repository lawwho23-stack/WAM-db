import { notFound } from "next/navigation";
import { getMemoryDetail } from "@/lib/memory";
import MemoryDetail from "@/components/MemoryDetail";

export const dynamic = "force-dynamic";

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail;
  try {
    detail = await getMemoryDetail(id);
  } catch {
    notFound();
  }

  return <MemoryDetail memory={detail.memory} versions={detail.versions} relations={detail.relations} />;
}
