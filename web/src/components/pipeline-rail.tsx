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
 *  Every `where` below was read out of the source with grep before it was
 *  written down, because a citation nobody checked is worse than no citation.
 */
type Stage = {
  id: string;
  n: string;
  short: string;
  title: string;
  where: string;
  kind: "rule" | "model";
  what: string;
  rule: string;
};

const STAGES: Stage[] = [
  {
    id: "context", n: "01", short: "Context", title: "Assemble the case",
    where: "code/main.py:289 · risk_signals.py:26", kind: "rule",
    what: "Splits the pipe-separated evidence field into numbered items, then pulls the reason code's requirements and the merchant's 90-day history.",
    rule: "Evidence gets IDs in file order — ev_1, ev_2, ev_3. The model may cite these IDs and no others. It cannot invent an ev_9 that was never submitted.",
  },
  {
    id: "sufficiency", n: "02", short: "Sufficiency", title: "Is the evidence complete?",
    where: "code/risk_signals.py:52", kind: "rule",
    what: "A set difference between the evidence types the reason code requires and the types actually attached.",
    rule: "Nothing submitted at all → not_enough_information. Some but not all required types → insufficient. Every required type present → sufficient. No model involvement: it is subtraction on two sets.",
  },
  {
    id: "amount", n: "03", short: "Amount", title: "Does the amount match?",
    where: "code/risk_signals.py:66", kind: "rule",
    what: "Compares the disputed amount against the original transaction on file.",
    rule: "Flagged if the dispute exceeds the original by more than ₹0.01, or differs from it by more than ₹0.01. A partial chargeback can never be larger than the transaction it came from. The tolerance is rounding slack, nothing more.",
  },
  {
    id: "merchant", n: "04", short: "Merchant", title: "Is this merchant a repeat?",
    where: "code/risk_signals.py:80", kind: "rule",
    what: "Reads the merchant's 90-day chargeback rate and their prior contest win rate together.",
    rule: "chargeback_rate_90d > 0.6% AND prior_contest_win_rate < 0.4. Both, never either. A busy merchant with a good record is not a risk; a busy merchant who keeps losing contests is.",
  },
  {
    id: "agent", n: "05", short: "The agent", title: "Read the narrative",
    where: "code/main.py:825", kind: "model",
    what: "A bounded two-round tool loop. The only stage that reads free text — the merchant's written account and the evidence descriptions — and the only one that can judge whether the story matches the transaction or is trying to manipulate the reader.",
    rule: "Tools always resolve against this case's pre-computed context, never against the identifiers the model passes in. A hallucinated or manipulated case_id cannot reach another merchant's record, because the argument is discarded before the lookup happens.",
  },
  {
    id: "sanitize", n: "06", short: "Sanitize", title: "Coerce to the schema",
    where: "code/main.py:618", kind: "rule",
    what: "Takes whatever the model returned and forces it into the allowed shape before anything downstream sees it.",
    rule: "A decision outside the allowed set becomes manual_review. Confidence is clamped to 0–1. Risk flags not on the allow-list are dropped. An unparseable answer fails toward a human, never toward an automated one.",
  },
  {
    id: "overrides", n: "07", short: "Overrides", title: "Overwrite the computable facts",
    where: "code/main.py:659", kind: "rule",
    what: "Replaces the model's answers about evidence sufficiency and the three mechanical flags with the values stages 02–04 already computed.",
    rule: "If the rules and the model disagree about a fact that can be computed, the rules win — every time, with no appeal. Decision, injection detection, reason and confidence are left alone: those need a narrative read, which is the model's actual job.",
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
        <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground/70">{shown.where}</p>
        <p className="mt-4 max-w-[74ch] text-[14px] leading-relaxed text-muted-foreground">{shown.what}</p>
        <p className="mt-3 max-w-[74ch] border-l-2 border-border pl-4 text-[14px] leading-relaxed text-foreground">
          {shown.rule}
        </p>
      </div>
    </section>
  );
}
