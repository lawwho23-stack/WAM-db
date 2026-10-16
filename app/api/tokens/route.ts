import { NextResponse } from "next/server";
import { z } from "zod";
import { createToken, listTokens } from "@/lib/auth-tokens";

// Token management for the MCP door. The raw token is returned exactly once,
// on creation, and never again — only its hash is stored.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(60),
  scope: z.string().nullable().optional(),
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
});

export async function GET() {
  try {
    return NextResponse.json({ tokens: await listTokens() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    const out = await createToken(parsed.data);
    return NextResponse.json({
      ...out,
      warning: "Copy this token now. It is stored only as a hash and cannot be shown again.",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
