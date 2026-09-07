import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import Counter, { displayValue, placesFromFormatted } from "@/components/reactbits/counter";
import { cn } from "@/lib/utils";

type TickerProps = {
  value: number;
  format: (n: number) => string;
  className?: string;
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

  if (reduced) {
    return <span ref={ref} className={cn("tnum inline-block", className)}>{text}</span>;
  }

  return (
    <span ref={ref} className={cn("tnum inline-block", className)}>
      {fontPx > 0
        ? <Counter value={rolled ? target : 0} places={places} fontSize={fontPx} />
        : <span className="invisible">{text}</span>}
    </span>
  );
}

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
