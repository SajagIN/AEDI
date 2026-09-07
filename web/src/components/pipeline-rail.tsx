import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

/*  The decision pipeline, as a rail.
 *
 *  Seven stages run for every case, in this order, and only one of them is
 *  the model. That is the whole argument of the project in one picture: the
 *  agent is a component inside a deterministic pipeline, not the pipeline
 *  itself, and it is fenced on both sides — three rules compute facts before
 *  it reads anything, and two passes overwrite whatever it says about those
 *  facts afterwards.
 *
 *  Colour follows the provenance grammar already used everywhere else here:
 *  info is deterministic and computed in code, alt is written by the model.
 *  Six info nodes, one alt node. The rail makes the ratio literal.
 *
 *  One line each. These were three-paragraph entries with file-and-line
 *  citations, which is a reference manual, not a diagram — nobody standing at
 *  a demo reads a wall of text off a circle they just clicked.
 */
type Stage = {
  id: string;
  n: string;
  short: string;
  title: string;
  kind: "rule" | "model";
  line: string;
};

const STAGES: Stage[] = [
  {
    id: "context", n: "01", short: "Context", title: "Assemble the case", kind: "rule",
    line: "Numbers the submitted evidence and pulls the reason code's requirements. The model may cite those items and no others — it cannot invent one that was never submitted.",
  },
  {
    id: "sufficiency", n: "02", short: "Sufficiency", title: "Is the evidence complete?", kind: "rule",
    line: "Compares the evidence types the reason code demands against what was actually attached. Complete, partial, or nothing at all.",
  },
  {
    id: "amount", n: "03", short: "Amount", title: "Does the amount match?", kind: "rule",
    line: "Flags a dispute that does not match the original transaction. A partial chargeback can never be larger than the payment it came from.",
  },
  {
    id: "merchant", n: "04", short: "Merchant", title: "Is this merchant a repeat?", kind: "rule",
    line: "Flags a high chargeback rate only when the merchant also loses most of the contests they file. Both conditions, never either alone.",
  },
  {
    id: "agent", n: "05", short: "The agent", title: "Read the narrative", kind: "model",
    line: "The only stage that reads the merchant's written account, and the only one that can tell a true story from one built to mislead whoever reads it.",
  },
  {
    id: "sanitize", n: "06", short: "Sanitize", title: "Coerce to the schema", kind: "rule",
    line: "Forces the answer into the allowed shape. Anything unparseable becomes a manual review — it fails toward a person, never toward an automated decision.",
  },
  {
    id: "overrides", n: "07", short: "Overrides", title: "Overwrite the computable facts", kind: "rule",
    line: "Where the rules and the model disagree about a fact that can be computed, the rules win. Every time, with no appeal.",
  },
];

export function PipelineRail() {
  const [pinned, setPinned] = useState("agent");
  const [hovered, setHovered] = useState<string | null>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = STAGES.find((s) => s.id === (hovered ?? pinned)) ?? STAGES[0];

  /* A horizontal rail invites arrow keys, so it answers to them. */
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + STAGES.length) % STAGES.length;
    setPinned(STAGES[next].id);
    btns.current[next]?.focus();
  };

  return (
    <section className="reveal" style={{ "--i": 8 } as React.CSSProperties}>
      <div className="mb-8 border-t border-border pt-8">
        <h2 className="font-display text-[clamp(30px,4vw,44px)] leading-none">
          Where the model actually sits
        </h2>
        <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
          Seven stages run for every case. One of them is the model. Three rules compute facts
          before it reads a word, and two passes overwrite anything it says about those facts
          afterwards.
        </p>
      </div>

      <div className="no-scrollbar overflow-x-auto pb-2">
        <ol className="relative flex min-w-[720px] items-start justify-between gap-2 px-2">
          {/* The rail itself — a groove the nodes sit in. Decorative: the
              ordered list already communicates sequence to a screen reader. */}
          <span aria-hidden className="nm-inset absolute left-2 right-2 top-[21px] h-1.5 rounded-full" />

          {STAGES.map((s, i) => {
            const isShown = shown.id === s.id;
            const isPinned = pinned === s.id;
            return (
              <li key={s.id} className="relative flex flex-1 flex-col items-center gap-2.5">
                <button
                  ref={(el) => { btns.current[i] = el; }}
                  type="button"
                  onClick={() => setPinned(s.id)}
                  onMouseEnter={() => setHovered(s.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(s.id)}
                  onBlur={() => setHovered(null)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  aria-expanded={isPinned}
                  aria-controls="pipeline-detail"
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full font-mono text-[11px] transition-[box-shadow,color,transform] duration-200
                    ${isShown
                      ? s.kind === "model"
                        ? "bg-signal-alt text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/.25),-3px_-3px_8px_hsl(var(--nm-light)/.7),3px_4px_10px_hsl(255_45%_35%/.45)]"
                        : "bg-cobalt text-cobalt-ink shadow-[inset_0_1px_0_hsl(0_0%_100%/.25),-3px_-3px_8px_hsl(var(--nm-light)/.7),3px_4px_10px_hsl(210_70%_35%/.45)]"
                      : "nm-raised-sm text-muted-foreground hover:scale-105 hover:text-foreground"}`}
                >
                  {s.n}
                </button>
                <span className={`text-center font-mono text-[10px] uppercase leading-tight tracking-[.09em] transition-colors
                  ${isShown ? (s.kind === "model" ? "text-signal-alt" : "text-cobalt") : "text-muted-foreground/70"}`}>
                  {s.short}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Recessed, because it is a readout — the same form the deterministic
          risk signals on Case Explorer use. */}
      <div id="pipeline-detail" aria-live="polite" className="nm-inset mt-6 rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display text-[19px] leading-tight">{shown.title}</h3>
          <Badge variant={shown.kind === "model" ? "alt" : "info"}>
            {shown.kind === "model" ? "written by the model" : "computed in code"}
          </Badge>
        </div>
        <p className="mt-3 max-w-[76ch] text-[14.5px] leading-relaxed text-foreground">{shown.line}</p>
      </div>
    </section>
  );
}
