import Link from "next/link";
import Nav from "@/components/Nav";
import { currentSession } from "@/lib/owner-guard";

/** Everything behind the login shares this shell. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();

  return (
    <div className="flex min-h-screen">
      <Nav email={session?.email} />
      <div className="min-w-0 flex-1">
        {/* Mobile: the sidebar is hidden, so a compact bar carries the links. */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-void/80 px-4 py-3 backdrop-blur md:hidden">
          <span className="num text-[12px] tracking-[0.14em] text-ink">WAM·DB</span>
          <nav className="ml-auto flex gap-3 text-[12px] text-muted">
            <Link href="/">Overview</Link>
            <Link href="/money">Money</Link>
            <Link href="/memories">Memory</Link>
            <Link href="/agents">Agents</Link>
            <Link href="/skills">Skills</Link>
          </nav>
        </div>
        <main className="mx-auto w-full max-w-6xl px-5 py-7 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  );
}
