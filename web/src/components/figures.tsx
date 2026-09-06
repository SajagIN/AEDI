import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/*  Figures
 *
 *  The money numbers are the argument this whole console is making, so they
 *  get the one piece of real choreography on the page: they count up once,
 *  when they scroll into view, with a single pass of lamplight across the
 *  glyphs as they settle.
 *
 *  Counting is not decoration here. A figure that lands on ₹4,56,000 after
 *  visibly travelling there reads as computed; the same figure painted
 *  instantly reads as typed into a slide.
 */

type TickerProps = {
  value: number;
  /** Renders the animated number — pass inr(), pct(), toLocaleString, etc. */
  format: (n: number) => string;
  className?: string;
  /** Seconds. Longer figures deserve a slightly longer travel. */
  duration?: number;
  delay?: number;
};

export function Ticker({ value, format, className, duration = 1.1, delay = 0 }: TickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (reduced) { setShown(value); setSettled(true); return; }

    setSettled(false);
    const controls = animate(0, value, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],          // the same easing every reveal uses
      onUpdate: (v) => setShown(v),
      onComplete: () => setSettled(true),
    });
    return () => controls.stop();
  }, [inView, value, duration, delay, reduced]);

  return (
    <span
      ref={ref}
      /* The sweep clips a moving highlight to the glyphs themselves, so the
         light appears to travel through the number rather than over it. */
      className={cn("tnum inline-block", settled && !reduced && "sweep animate-sweep", className)}
    >
      {format(shown)}
    </span>
  );
}

/*  A hero figure: the serif at display size, with its label set as a ledger
 *  column head above it. Used for the numbers a judge is meant to remember. */
export function Figure({
  label, value, format, tone = "plain", note, className, delay,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  tone?: "plain" | "good" | "warn" | "bad";
  note?: string;
  className?: string;
  delay?: number;
}) {
  const toneClass = {
    plain: "text-foreground",
    good: "text-signal-good",
    warn: "text-signal-warn",
    bad: "text-signal-bad",
  }[tone];

  return (
    <div className={cn("min-w-0", className)}>
      <div className="dateline mb-2 text-muted-foreground/70">{label}</div>
      <div className={cn("font-display text-[38px] leading-[0.95]", toneClass)}>
        <Ticker value={value} format={format} delay={delay} />
      </div>
      {note && <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">{note}</p>}
    </div>
  );
}
