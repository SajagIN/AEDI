import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect } from "react";

/*  Counter — adapted from React Bits
 *
 *  Three things had to change before this could carry money figures.
 *
 *  1. `useSpring` sat below an early `return` for the decimal-point branch,
 *     so a Digit either called one hook or none depending on its prop. It
 *     survives in practice because a given instance always takes the same
 *     branch, but it is still a conditional hook and the linter is right to
 *     hate it. Split into two components, one of which has no state at all.
 *
 *  2. `key={place}` collides the moment a number contains two of the same
 *     separator, which ₹6,99,702 does. Keys are positional now.
 *
 *  3. The original renders bare digits and nothing else. This is a finance
 *     console — dropping the ₹ and the lakh grouping to get an odometer is a
 *     bad trade. `places` now accepts any string as a literal glyph, so the
 *     separators sit in the run and only the digits roll behind them.
 *
 *  The black gradient defaults went too: they existed for a dark demo page
 *  and paint two dark bands across a white one.
 */

/** A power of ten rolls; anything else is printed as-is. */
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

/* Floating point drift means value/place lands on 4.999999999 where it should
   land on 5, and the digit reads one too low for the whole animation. */
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
  /** Pixels. The roll is absolutely positioned, so it cannot read a clamp(). */
  fontSize: number;
  /** Masks the top and bottom of the roll. Must match what sits behind it. */
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
      {/* Feathers the digits arriving and leaving rather than letting them
          appear at a hard edge. */}
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

/*  Derives the roll layout from an already-formatted string, which is the
 *  only way the Indian grouping survives. `inr(456000)` gives "₹4,56,000";
 *  walking that gives ₹ · 10^5 · 10^4 · , · 10^3 · 10^2 · , · 10 · 1, and the
 *  odometer ends up shaped like the number a reader expects instead of
 *  699702 in a row.
 */
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

/** The numeric value in display units — "₹4,56,000" is 456000, "76%" is 76. */
export function displayValue(text: string): number {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
