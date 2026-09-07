import { Children, forwardRef, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Check } from "lucide-react";

/*  Stepper — adapted from React Bits
 *
 *  The substantive change is that this one is controlled. The original owns
 *  its own `currentStep` and moves it with Back and Continue buttons, which
 *  is right for a signup form and wrong here: you cannot press Continue past
 *  "take a payment" without taking a payment. Razorpay decides when this
 *  advances, not the reader. So the step comes in as a prop, the footer is
 *  gone, and `reached` marks how far the workflow has actually got — you can
 *  click back to re-read a stage you have completed, and you cannot click
 *  forward into one you have not.
 *
 *  Cosmetic changes, all forced: #5227FF on the indicators and bg-green-500
 *  on the button are someone else's brand, `max-w-md` with an
 *  `aspect-[4/3]` wrapper would crush a dispute card into a letterbox, and
 *  `Step` applied px-8 on top of the px-8 the content wrapper already had.
 *
 *  One real bug: `onHeightReady` was an inline arrow in the parent's JSX, so
 *  it was a new function on every render and the layout effect that depends
 *  on it re-ran every render. It settles only because setState bails on an
 *  identical value. It is a useCallback now.
 */

const slide: Variants = {
  enter: (dir: number) => ({ x: dir >= 0 ? "-6%" : "6%", opacity: 0 }),
  center: { x: "0%", opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? "4%" : "-4%", opacity: 0 }),
};

export function Step({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export interface StepperProps {
  children: ReactNode;
  /** Zero-based, and owned by the caller. */
  currentStep: number;
  /** Furthest stage the workflow has actually reached. */
  reached: number;
  steps: string[];
  onStepChange?: (step: number) => void;
  className?: string;
}

const Stepper = forwardRef<HTMLDivElement, StepperProps>(function Stepper({
  children,
  currentStep,
  reached,
  steps,
  onStepChange,
  className = "",
}, ref) {
  const panes = Children.toArray(children);
  const prev = useRef(currentStep);
  const direction = currentStep >= prev.current ? 1 : -1;
  prev.current = currentStep;

  const [height, setHeight] = useState(0);
  const onHeightReady = useCallback((h: number) => setHeight(h), []);

  return (
    <div ref={ref} className={className}>
      {/* Indicators. Labels sit under the marks rather than beside them —
          four stage names in a row would not survive a narrow column. */}
      <div className="mb-5 flex items-start">
        {steps.map((label, i) => {
          const done = i < reached;
          const active = i === currentStep;
          const clickable = i <= reached && i !== currentStep;
          const isLast = i === steps.length - 1;
          return (
            <div key={label} className={`flex items-start ${isLast ? "flex-none" : "flex-1"}`}>
              <div className={`flex flex-col items-center gap-2 ${isLast ? "w-auto" : "w-full"}`}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onStepChange?.(i)}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${i + 1}. ${label}`}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10.5px] transition-colors
                    ${active ? "border-cobalt bg-cobalt text-cobalt-ink"
                      : done ? "border-signal-good/40 bg-signal-good/10 text-signal-good"
                      : "border-border bg-secondary text-muted-foreground/55"}
                    ${clickable ? "cursor-pointer hover:border-cobalt/50" : "cursor-default"}`}
                >
                  {done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
                </button>
                <span className={`text-center font-mono text-[10.5px] uppercase leading-tight tracking-[.1em]
                  ${active ? "text-cobalt" : done ? "text-signal-good" : "text-muted-foreground/55"}`}>
                  {label}
                </span>
              </div>
              {!isLast && (
                <div className="relative mx-1 mt-3.5 h-px flex-1 overflow-hidden bg-border">
                  <motion.div
                    className="absolute left-0 top-0 h-full bg-signal-good"
                    initial={false}
                    animate={{ width: done ? "100%" : "0%" }}
                    transition={{ duration: 0.35 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <motion.div
        style={{ position: "relative", overflow: "hidden" }}
        animate={{ height }}
        transition={{ type: "spring", duration: 0.4, bounce: 0 }}
      >
        <AnimatePresence initial={false} mode="sync" custom={direction}>
          <Pane key={currentStep} direction={direction} onHeightReady={onHeightReady}>
            {panes[currentStep]}
          </Pane>
        </AnimatePresence>
      </motion.div>
    </div>
  );
});

export default Stepper;

function Pane({
  children, direction, onHeightReady,
}: { children: ReactNode; direction: number; onHeightReady: (h: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  /* The pane is absolutely positioned so the outgoing and incoming ones can
     overlap, which means the wrapper has to be told how tall to become. A
     ResizeObserver rather than a one-shot read: these panes grow when a trace
     streams in or a verdict lands. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    onHeightReady(el.offsetHeight);
    const ro = new ResizeObserver(() => onHeightReady(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, onHeightReady]);

  return (
    <motion.div
      ref={ref}
      custom={direction}
      variants={slide}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: "absolute", left: 0, right: 0, top: 0 }}
    >
      {children}
    </motion.div>
  );
}
