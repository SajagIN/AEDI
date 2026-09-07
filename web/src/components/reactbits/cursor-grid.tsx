import { useEffect, useRef } from "react";

/*  CursorGrid — adapted from React Bits
 *
 *  One change, but it is the change that makes it usable as a page
 *  background. The original binds `pointermove` to its own container. Mounted
 *  behind the app it is covered by every card and paragraph on the page, so
 *  it receives almost no events and the lattice only lights up over empty
 *  gutters. Pointer tracking moves to `window`, converted to canvas-local
 *  coordinates, and the wrapper stays `pointer-events: none` so it never
 *  steals a click from a control.
 *
 *  Everything else is the original's, including the part worth keeping: the
 *  RAF loop halts itself the moment no cell is still lit, so a stationary
 *  cursor costs nothing.
 */

type Falloff = "linear" | "smooth" | "sharp";

export interface CursorGridProps {
  cellSize?: number;
  color?: string;
  radius?: number;
  falloff?: Falloff;
  holdTime?: number;
  fadeDuration?: number;
  lineWidth?: number;
  maxOpacity?: number;
  fillOpacity?: number;
  gridOpacity?: number;
  cellRadius?: number;
  className?: string;
}

const FALLOFF: Record<Falloff, (t: number) => number> = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  sharp: (t) => t * t * t,
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(v.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export default function CursorGrid({
  cellSize = 68,
  color = "#0071E3",
  radius = 150,
  falloff = "smooth",
  holdTime = 260,
  fadeDuration = 900,
  lineWidth = 1,
  maxOpacity = 0.5,
  fillOpacity = 0.05,
  gridOpacity = 0,
  cellRadius = 3,
  className = "",
}: CursorGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ cellSize, color, radius, falloff, holdTime, fadeDuration, lineWidth, maxOpacity, fillOpacity, gridOpacity, cellRadius });
  cfg.current = { cellSize, color, radius, falloff, holdTime, fadeDuration, lineWidth, maxOpacity, fillOpacity, gridOpacity, cellRadius };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cols = 0, rows = 0, offX = 0, offY = 0, w = 0, h = 0;
    let alphas = new Float32Array(0);
    let touched = new Float64Array(0);
    let raf = 0, running = false, lastFrame = 0;

    const rebuild = () => {
      const p = cfg.current;
      w = container.offsetWidth;
      h = container.offsetHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / p.cellSize) + 1;
      rows = Math.ceil(h / p.cellSize) + 1;
      offX = (w - cols * p.cellSize) / 2;
      offY = (h - rows * p.cellSize) / 2;
      alphas = new Float32Array(cols * rows);
      touched = new Float64Array(cols * rows);
    };

    const centre = (i: number): [number, number] => {
      const p = cfg.current;
      return [
        offX + (i % cols) * p.cellSize + p.cellSize / 2,
        offY + Math.floor(i / cols) * p.cellSize + p.cellSize / 2,
      ];
    };

    const energize = (x: number, y: number) => {
      const p = cfg.current;
      const r = Math.max(p.radius, 1);
      const ease = FALLOFF[p.falloff] ?? FALLOFF.linear;
      const now = performance.now();
      const minCol = Math.max(0, Math.floor((x - r - offX) / p.cellSize));
      const maxCol = Math.min(cols - 1, Math.floor((x + r - offX) / p.cellSize));
      const minRow = Math.max(0, Math.floor((y - r - offY) / p.cellSize));
      const maxRow = Math.min(rows - 1, Math.floor((y + r - offY) / p.cellSize));
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const i = row * cols + col;
          const [cx, cy] = centre(i);
          const dist = Math.hypot(cx - x, cy - y);
          if (dist > r) continue;
          const level = ease(1 - dist / r) * p.maxOpacity;
          if (level > alphas[i]) { alphas[i] = level; touched[i] = now; }
          else if (level > 0) { touched[i] = now; }
        }
      }
    };

    const draw = (now: number) => {
      const p = cfg.current;
      const dt = Math.min(now - lastFrame, 50);
      lastFrame = now;
      ctx.clearRect(0, 0, w, h);
      const [cr, cg, cb] = hexToRgb(p.color);

      let anyVisible = false;
      const fadeStep = dt / Math.max(p.fadeDuration, 16);
      const half = p.cellSize / 2;

      for (let i = 0; i < alphas.length; i++) {
        let a = alphas[i];
        if (a <= 0) continue;
        if (now - touched[i] > p.holdTime) {
          a = Math.max(0, a - fadeStep);
          alphas[i] = a;
          if (a <= 0) continue;
        }
        anyVisible = true;

        const [cx, cy] = centre(i);
        const g = ctx.createRadialGradient(cx, cy, half * 0.1, cx, cy, p.cellSize);
        g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${a})`);
        g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

        const x = cx - half + 0.5;
        const y = cy - half + 0.5;
        const s = p.cellSize - 1;
        ctx.beginPath();
        if (p.cellRadius > 0) ctx.roundRect(x, y, s, s, p.cellRadius);
        else ctx.rect(x, y, s, s);
        if (p.fillOpacity > 0) {
          ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${a * p.fillOpacity})`;
          ctx.fill();
        }
        ctx.strokeStyle = g;
        ctx.lineWidth = p.lineWidth;
        ctx.stroke();
      }

      if (anyVisible) raf = requestAnimationFrame(draw);
      else { running = false; ctx.clearRect(0, 0, w, h); }
    };

    const wake = () => {
      if (running) return;
      running = true;
      lastFrame = performance.now();
      raf = requestAnimationFrame(draw);
    };

    /* Window, not container: this sits under the whole app and would other-
       wise never see a pointer that is over a card. */
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      energize(e.clientX - rect.left, e.clientY - rect.top);
      wake();
    };

    const ro = new ResizeObserver(() => { rebuild(); wake(); });
    ro.observe(container);
    rebuild();

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [cellSize]);

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden${className ? ` ${className}` : ""}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
