"use client";

import { useEffect, useRef } from "react";

// A quiet starfield behind everything. Two layers of stars drift at different
// speeds for a hint of depth, and the whole thing stays cheap: one canvas,
// ~160 stars, no per-frame allocations. Honors prefers-reduced-motion by
// rendering a single static frame.

type Star = { x: number; y: number; r: number; a: number; phase: number; speed: number };

export default function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let raf = 0;
    let start = 0;

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scales with area so big screens do not look empty.
      const count = Math.round(Math.min(Math.max((width * height) / 14000, 90), 240));
      stars = Array.from({ length: count }, (_, i) => {
        const deep = i % 3 === 0; // a sparser, slower far layer
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: deep ? Math.random() * 0.7 + 0.25 : Math.random() * 1.15 + 0.35,
          a: deep ? Math.random() * 0.22 + 0.08 : Math.random() * 0.4 + 0.14,
          phase: Math.random() * Math.PI * 2,
          speed: deep ? 0.00005 : 0.00013,
        };
      });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      // Two soft nebulae, drawn once per frame with a radial gradient.
      const glow = (cx: number, cy: number, radius: number, rgb: string, alpha: number) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      };
      glow(width * 0.16, height * 0.08, Math.max(width, height) * 0.42, "94, 231, 255", 0.055);
      glow(width * 0.9, height * 0.78, Math.max(width, height) * 0.46, "155, 140, 255", 0.06);

      const elapsed = t - start;
      for (const s of stars) {
        const twinkle = reduced ? 1 : 0.72 + 0.28 * Math.sin(elapsed * s.speed * 1000 + s.phase);
        const x = reduced ? s.x : s.x - elapsed * s.speed * 6;
        const wrapped = ((x % (width + 40)) + width + 40) % (width + 40);
        ctx.beginPath();
        ctx.arc(wrapped, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226, 236, 255, ${s.a * twinkle})`;
        ctx.fill();
      }
    };

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    build();
    start = performance.now();
    if (reduced) {
      draw(start);
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onResize = () => {
      build();
      if (reduced) draw(performance.now());
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ background: "radial-gradient(120% 90% at 50% -10%, #0a1020 0%, #04060d 55%, #03040a 100%)" }}
    />
  );
}
