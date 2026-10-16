import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { authConfigured } from "@/lib/auth-session";
import { currentSession } from "@/lib/owner-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · WAM-db" };

/** Only a same-site path is accepted, so `next` cannot bounce anyone off-site. */
function safeNext(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentSession()) redirect(safeNext(next));

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="relative grid h-9 w-9 place-items-center rounded-[11px] border border-line-strong bg-white/5">
            <span className="h-2 w-2 rounded-full bg-cyan shadow-[0_0_14px_var(--color-cyan)]" />
            <span className="orbit absolute inset-0 rounded-[11px] border border-cyan/20" />
          </span>
          <span className="leading-tight">
            <span className="num block text-[13px] tracking-[0.14em] text-ink">WAM·DB</span>
            <span className="block text-[10.5px] tracking-[0.06em] text-faint">WHOLE AGENT MEMORY</span>
          </span>
        </div>

        {authConfigured() ? (
          <LoginForm next={safeNext(next)} />
        ) : (
          <div className="panel px-5 py-5">
            <p className="label">Not configured</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Set <span className="num text-cyan">OWNER_EMAIL</span>, <span className="num text-cyan">OWNER_PASSWORD</span> and{" "}
              <span className="num text-cyan">SESSION_SECRET</span> (32+ characters) in the environment, then reload this page.
            </p>
          </div>
        )}

        <p className="mt-5 text-center text-[11.5px] text-faint">
          Agents do not use this page. They carry a bearer token to <span className="num">/api/mcp</span>.
        </p>
      </div>
    </main>
  );
}
