import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import Counter, { displayValue, placesFromFormatted } from "@/components/reactbits/counter";
import { cn } from "@/lib/utils";

/*  Figures
 *
 *  The money numbers are the argument this whole console is making, so they
 *  get the one piece of real choreography on the page: each digit rolls into
 *  place on an odometer, once, when the figure scrolls into view.
 *
 *  Counting is not decoration here. A figure that lands on Rs 4,56,000 after
 *  visibly travelling there reads as computed; the same figure painted
 *  instantly reads as typed into a slide.
 *
 *  What replaced what: this used to interpolate a single number and reformat
 *  it every frame, which meant the whole string reflowed on every tick and the
 *  separators jittered. React Bits' Counter rolls each digit independently, so
 *  the commas hold still. The lamplight sweep that used to cross the glyphs
 *  after they settled is gone with it — an odometer and a light sweep are two
 *  animations doing one job, and the roll is the better of the two.
 */

type TickerProps = {
  value: number;
  /** Renders the number — pass inr(), pct(), toLocaleString(), anything. */
  format: (n: number) => string;
  className?: string;
  /** Seconds before the roll starts. */
  delay?: number;
};

export function Ticker({ value, format, className, delay = 0 }: TickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [fontPx, setFontPx] = useState(0);
  const [rolled, setRolled] = useState(false);

  const text = format(value);
  const places = useMemo(() => placesFromFormatted(text), [text]);
  const target = useMemo(() => displayValue(text), [text]);

  /* The roll is absolutely positioned, so it needs a pixel height, and every
     figure on this page is sized with a clamp() on an ancestor. Read what the
     browser actually resolved, before paint, and again on resize. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setFontPx(Number.parseFloat(getComputedStyle(el).fontSize) || 0);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduced) return;
    const t = setTimeout(() => setRolled(true), delay * 1000);
    return () => clearTimeout(t);
  }, [inView, reduced, delay]);

  /* Reduced motion gets the answer, not the journey. */
  if (reduced) {
    return <span ref={ref} className={cn("tnum inline-block", className)}>{text}</span>;
  }

  return (
    <span ref={ref} className={cn("tnum inline-block", className)}>
      {fontPx > 0
        ? <Counter value={rolled ? target : 0} places={places} fontSize={fontPx} />
        /* Holds the exact width of the final figure for the one frame before
           the measurement lands, so nothing reflows underneath it. */
        : <span className="invisible">{text}</span>}
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
