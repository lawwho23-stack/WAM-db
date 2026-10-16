import MoneyTabs from "@/components/MoneyTabs";

/** Everything about money shares the tabs above it. */
export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <MoneyTabs />
      {children}
    </div>
  );
}
