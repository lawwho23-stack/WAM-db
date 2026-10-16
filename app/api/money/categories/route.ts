import { NextResponse } from "next/server";
import { z } from "zod";
import { createCategory, listCategories, updateCategory, type CategoryKind } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["income", "expense"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const PatchSchema = CreateSchema.partial().extend({ id: z.string().uuid(), archived: z.boolean().optional() });

export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const includeArchived = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ categories: await listCategories({ includeArchived }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  try {
    const category = await createCategory({
      name: parsed.data.name,
      kind: parsed.data.kind as CategoryKind,
      color: parsed.data.color ?? null,
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  const { id, ...rest } = parsed.data;
  try {
    return NextResponse.json({ category: await updateCategory(id, { ...rest, kind: rest.kind as CategoryKind | undefined }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
