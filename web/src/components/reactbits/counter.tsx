import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect } from "react";

export type Place = number | string;

function Rolling({ mv, digit, height }: { mv: MotionValue<number>; digit: number; height: number }) {
  const y = useTransform(mv, (latest) => {
    const place = latest % 10;
    const offset = (10 + digit - place) % 10;
    return offset > 5 ? offset * height - 10 * height : offset * height;
  });
  return (
    <motion.span
      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", y }}
    >
      {digit}
    </motion.span>
  );
}

function snap(n: number) {
  const nearest = Math.round(n);
  return Math.abs(n - nearest) < 1e-9 * Math.max(1, Math.abs(n)) ? nearest : n;
}

function DigitCell({ place, value, height }: { place: number; value: number; height: number }) {
  const target = Math.floor(snap(value / place)) % 10;
  const mv = useSpring(target, { stiffness: 190, damping: 26, mass: 0.7 });
  useEffect(() => { mv.set(Math.floor(snap(value / place))); }, [mv, value, place]);

  return (
    <span
      className="relative inline-flex overflow-hidden"
      style={{ height, width: "1ch", fontVariantNumeric: "tabular-nums" }}
    >
      {Array.from({ length: 10 }, (_, i) => <Rolling key={i} mv={mv} digit={i} height={height} />)}
    </span>
  );
}

export interface CounterProps {
  value: number;
  places: Place[];
  fontSize: number;
  maskColor?: string;
  maskHeight?: number;
  className?: string;
}

export default function Counter({
  value,
  places,
  fontSize,
  maskColor = "hsl(var(--background))",
  maskHeight = 10,
  className = "",
}: CounterProps) {
  const height = fontSize;

  return (
    <span className={`relative inline-block ${className}`.trim()} style={{ lineHeight: 1 }}>
      <span style={{ display: "flex", overflow: "hidden", lineHeight: 1, direction: "ltr" }}>
        {places.map((p, i) =>
          typeof p === "number" ? (
            <DigitCell key={i} place={p} value={value} height={height} />
          ) : (
            <span key={i} className="relative inline-flex items-center justify-center" style={{ height }}>
              {p}
            </span>
          ),
        )}
      </span>
      <span
        aria-hidden
        style={{ pointerEvents: "none", position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}
      >
        <span style={{ height: maskHeight, background: `linear-gradient(to bottom, ${maskColor}, transparent)` }} />
        <span style={{ height: maskHeight, background: `linear-gradient(to top, ${maskColor}, transparent)` }} />
      </span>
    </span>
  );
}

export function placesFromFormatted(text: string): Place[] {
  const chars = [...text];
  const dot = chars.lastIndexOf(".");
  const intDigits = chars.filter((c, i) => /\d/.test(c) && (dot < 0 || i < dot)).length;

  let whole = 0;
  let frac = 0;
  return chars.map((c, i) => {
    if (!/\d/.test(c)) return c;
    if (dot >= 0 && i > dot) { frac += 1; return 10 ** -frac; }
    const p = 10 ** (intDigits - 1 - whole);
    whole += 1;
    return p;
  });
}

export function displayValue(text: string): number {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
