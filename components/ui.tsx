import type { ReactNode } from "react";

// A small set of shared pieces. Everything visual in the app is built from
// these so a theme change stays a one-file edit.

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="label mb-2">{eyebrow}</p> : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[30px]">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  children,
  className = "",
  flat = false,
}: {
  children: ReactNode;
  className?: string;
  flat?: boolean;
}) {
  return <section className={`${flat ? "panel-flat" : "panel"} ${className}`}>{children}</section>;
}

export function PanelHeader({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-medium tracking-wide text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11.5px] text-faint">{hint}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  extra,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** A second reading of the same number — another currency, a comparison. */
  extra?: ReactNode;
  tone?: "ink" | "cyan" | "violet" | "mint" | "amber" | "rose";
}) {
  const toneClass = {
    ink: "text-ink",
    cyan: "text-cyan",
    violet: "text-violet",
    mint: "text-mint",
    amber: "text-amber",
    rose: "text-rose",
  }[tone];
  return (
    <div className="panel px-4 py-3.5">
      <p className="label">{label}</p>
      <p className={`num mt-2 text-[22px] leading-none ${toneClass}`}>{value}</p>
      {extra ? <p className="mt-1.5 text-[12px] text-muted">{extra}</p> : null}
      {hint ? <p className="mt-1.5 text-[11px] text-faint">{hint}</p> : null}
    </div>
  );
}

const TONES: Record<string, string> = {
  cyan: "chip chip-cyan",
  violet: "chip chip-violet",
  mint: "chip chip-mint",
  rose: "chip chip-rose",
  amber: "chip chip-amber",
  neutral: "chip",
};

export function Chip({ children, tone = "neutral", title }: { children: ReactNode; tone?: keyof typeof TONES | string; title?: string }) {
  return (
    <span className={TONES[tone] ?? TONES.neutral} title={title}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan/60 shadow-[0_0_12px_var(--color-cyan)]" />
      <p className="text-[13px] text-faint">{children}</p>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
      <span className="orbit" />
      {label}
    </span>
  );
}

export function relTime(iso: string | null | undefined) {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(Math.round((Date.now() - then) / 1000), 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
