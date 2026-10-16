export const metadata = { title: "Agent Memory", description: "Whole agent memory: chat, runs, table" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0b0e14", color: "#e6e9f0" }}>
        <nav style={{ display: "flex", gap: 16, padding: "12px 20px", borderBottom: "1px solid #222", background: "#11141c" }}>
          <b>Agent Memory</b>
          <a href="/" style={{ color: "#9ecbff" }}>Chat</a>
          <a href="/memories" style={{ color: "#9ecbff" }}>Memories</a>
          <a href="/runs" style={{ color: "#9ecbff" }}>Runs</a>
          <a href="/skills" style={{ color: "#9ecbff" }}>Skills</a>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>Neon PG + Redis</span>
        </nav>
        <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
