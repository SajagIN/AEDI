import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMetrics, inr, nice, pct, type Health, type Metrics } from "@/lib/api";

/*  Evaluation
 *
 *  Rewritten because the person who built this could not read it. If the
 *  author cannot, a judge with ninety seconds certainly cannot.
 *
 *  What was wrong was not density, it was framing. The page rendered three
 *  identical blocks — agent, rules baseline, all-manual baseline — each with
 *  its own confusion matrix and five progress bars. Three identical blocks
 *  side by side is an invitation to compare them cell by cell, which is the
 *  one reading the numbers do not support, and fifteen progress bars say
 *  nothing that the fifteen percentages next to them were not already saying.
 *
 *  So: one table, three rows, plain-English column heads. The ML vocabulary
 *  is still here — precision, recall, the matrix — but demoted below a fold,
 *  because it is what a reviewer checks second, not what a reader needs
 *  first.
 */

/* The jargon still matters to a technical reader, so nothing is renamed away.
   Plain phrase leads, the real term follows in mono underneath. */
const COLUMNS = [
  { key: "auto", head: "Decided on its own", term: "coverage",
    help: "Closed without a human. Higher is cheaper, but only safe if the errors stay at zero." },
  { key: "human", head: "Sent to a person", term: "manual_review",
    help: "Handed to an analyst. Costs about twelve minutes and ₹150 each." },
  { key: "fp", head: "Fought one we owed", term: "false positive",
    help: "Contested a case that should have been paid. Wasted representment effort, ₹800." },
  { key: "fn", head: "Paid one we'd have won", term: "false negative",
    help: "Accepted liability on a winnable case. Costs the whole transaction." },
  { key: "cost", head: "Cost per 100 cases", term: "cost_per_100_inr",
    help: "The cost model applied to this system's actual mistakes on this split." },
] as const;

const SPLIT_NOTE: Record<string, string> = {
  dev: "Practice set. We tuned against these, so a good score here proves nothing.",
  held_out: "Sealed set, opened once at code freeze. This is the honest score.",
};

export default function Evaluation({ health, split, setSplit }:
  { health: Health; split: string; setSplit: (s: string) => void }) {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => { setM(null); getMetrics(split).then(setM); }, [split]);

  const agent = m?.available ? m.blocks[0] : null;
  const cell = (b: NonNullable<typeof agent>, key: string) => {
    switch (key) {
      case "auto":  return { v: `${b.n - b.cost.n_manual_review}`, sub: pct(b.coverage) };
      case "human": return { v: `${b.cost.n_manual_review}`, sub: pct(1 - b.coverage) };
      case "fp":    return { v: `${b.cost.n_false_positive}`, sub: b.cost.n_false_positive === 0 ? "none" : "" };
      case "fn":    return { v: `${b.cost.n_false_negative}`, sub: b.cost.n_false_negative === 0 ? "none" : "" };
      default:      return { v: inr(b.cost.cost_per_100_inr), sub: "" };
    }
  };

  return (
    <div className="space-y-10 pb-14">
      {/* ── which set of cases ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
        <select value={split} onChange={(e) => setSplit(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 font-mono text-[12.5px] text-foreground shadow-inset transition-colors focus-visible:border-cobalt/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cobalt/30">
          {Object.entries(health.splits).map(([k, v]) => (
            <option key={k} value={k}>{k} · {v.cases} cases</option>
          ))}
        </select>
        <span className="text-[12.5px] text-muted-foreground">{SPLIT_NOTE[split] ?? ""}</span>
        <span className="dateline ml-auto text-muted-foreground/50">computed live · code/evaluation/main.py</span>
      </div>

      {/* Loading state matches the shape of the table it replaces, so the
          page does not jump when the numbers land. */}
      {!m && (
        <div className="space-y-3">
          <div className="h-3 w-40 animate-pulse rounded bg-foreground/[.06]" />
          {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-foreground/[.05]" />)}
        </div>
      )}

      {m && !m.available && (
        <Card><CardContent className="p-10 text-center">
          <p className="text-[13.5px] text-muted-foreground">{m.message}</p>
          <code className="mt-3 inline-block rounded-lg bg-secondary px-3 py-2 font-mono text-[12px]">
            python code/main.py --input dataset/{m.split}/cases.csv --output dataset/{m.split}/output.csv
          </code>
        </CardContent></Card>
      )}

      {m?.available && m.complete === false && (
        <Card className="border-signal-warn/30 bg-signal-warn/[.06]">
          <CardContent className="p-5">
            <div className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold text-signal-warn">
              <TriangleAlert size={15} />
              Incomplete run — {m.n_scored} of {m.n_cases} scored
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              The rows below count different numbers of cases. Don&rsquo;t read them against each other.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── the answer, in a sentence ───────────────────────────────────── */}
      {agent && (
        <p className="max-w-[68ch] text-[15px] leading-relaxed">
          Out of <b className="tabular-nums">{agent.n}</b> disputes, AEDI closed{" "}
          <b className="tabular-nums text-cobalt">{agent.n - agent.cost.n_manual_review}</b> without a
          human and sent <b className="tabular-nums">{agent.cost.n_manual_review}</b> to a person.
          Of the ones it closed, it got{" "}
          <b className={agent.cost.n_false_positive + agent.cost.n_false_negative === 0
            ? "text-signal-good" : "text-signal-bad"}>
            {agent.cost.n_false_positive + agent.cost.n_false_negative === 0
              ? "none" : agent.cost.n_false_positive + agent.cost.n_false_negative}
          </b>{" "}
          wrong.
        </p>
      )}

      {/* ── one table, not three cards ──────────────────────────────────── */}
      {m?.available && (
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-3 pr-4 text-[12px] font-medium text-muted-foreground">System</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-3 align-bottom">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">
                          <span className="block text-[12px] font-medium text-foreground">{c.head}</span>
                          <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[.1em] text-muted-foreground/55">
                            {c.term}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{c.help}</TooltipContent>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.blocks.map((b, i) => (
                <tr key={b.name}
                  className={`border-b border-border/70 transition-colors hover:bg-foreground/[.025] ${i === 0 ? "bg-cobalt/[.035]" : ""}`}>
                  <td className="py-4 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13.5px] ${i === 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {b.name}
                      </span>
                      {i === 0
                        ? <Badge variant="cobalt">this system</Badge>
                        : <Badge variant="outline">for comparison</Badge>}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/60 tabular-nums">
                      n = {b.n}
                    </div>
                  </td>
                  {COLUMNS.map((c) => {
                    const { v, sub } = cell(b, c.key);
                    const bad = (c.key === "fp" || c.key === "fn") && Number(v) > 0;
                    const good = (c.key === "fp" || c.key === "fn") && Number(v) === 0;
                    return (
                      <td key={c.key} className="px-3 py-4">
                        <div className={`font-mono text-[17px] tabular-nums ${
                          bad ? "text-signal-bad" : good ? "text-signal-good"
                          : i === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                          {v}
                        </div>
                        {sub && <div className="mt-0.5 text-[10.5px] text-muted-foreground/60">{sub}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tooltips die on touch and vanish in a screenshot of a slide, which is
          how half of these numbers get read. Same definitions, in the flow,
          wherever hover cannot be assumed. */}
      {m?.available && (
        <dl className="grid gap-x-8 gap-y-2 border-t border-border pt-5 sm:grid-cols-2 lg:hidden">
          {COLUMNS.map((c) => (
            <div key={c.key} className="flex items-baseline gap-2">
              <dt className="shrink-0 text-[12px] font-medium text-foreground">{c.head}</dt>
              <dd className="text-[11.5px] leading-snug text-muted-foreground">{c.help}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Promoted out of the disclosure it started in. It is the number that
          argues against us, and a caveat you have to click for is a caveat you
          are half-hiding. */}
      {agent && (
        <div className="border-l-2 border-signal-warn/40 pl-5">
          <div className="dateline mb-2 text-signal-warn/80">
            The {agent.cost.n_bypassed_review} cases this table doesn&rsquo;t punish
          </div>
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">
                On {agent.cost.n_bypassed_review} cases the correct answer was &ldquo;a person should
                look at this&rdquo; and AEDI decided anyway. That is not a false positive or a false
                negative — the cost model prices exactly two kinds of mistake and this is a third —
                so it would score as correct if we let it. We count it separately instead, at{" "}
                {pct(m!.cost_model.bypassed_exposure_rate)} of the transaction value:{" "}
                <b className="font-mono text-signal-warn">
                  {inr(agent.cost.bypassed_review_exposure_per_100_inr)}
                </b>{" "}
            per 100 cases, never netted off the saving.
          </p>
        </div>
      )}

      {agent && (
        <Accordion type="single" collapsible className="border-t border-border">
          <AccordionItem value="matrix">
            <AccordionTrigger>Every case, sorted by what it was and what AEDI said</AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-8 lg:grid-cols-[minmax(300px,420px)_1fr]">
                <div>
                  <table className="w-full border-separate border-spacing-1">
                    <thead>
                      <tr>
                        <th />
                        {m!.decision_values.map((p) => (
                          <th key={p} className="pb-1 text-[10.5px] font-medium uppercase tracking-[.06em] text-muted-foreground">
                            {nice(p)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m!.decision_values.map((a) => (
                        <tr key={a}>
                          <th className="pr-2.5 text-right font-mono text-[11px] font-normal text-muted-foreground">{nice(a)}</th>
                          {m!.decision_values.map((p) => {
                            const v = agent.matrix[a][p];
                            const diag = a === p;
                            const err = !diag && v > 0 && a !== "manual_review";
                            return (
                              <td key={p} className={`rounded-lg border py-3 text-center font-mono text-[14px] tabular-nums ${
                                diag && v > 0 ? "border-signal-good/35 bg-signal-good/[.08] text-signal-good"
                                : err ? "border-signal-bad/30 bg-signal-bad/[.06] text-signal-bad"
                                : v === 0 ? "border-border bg-secondary/40 text-muted-foreground/40"
                                : "border-border bg-secondary/60"}`}>{v}</td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                    Down the side: what the case actually was. Across the top: what AEDI said.
                    The diagonal is agreement — everything off it is a disagreement.
                  </p>
                </div>

                <dl className="space-y-2.5 self-start">
                  {["contest", "accept_liability"].flatMap((cls) => {
                    const pr = agent.precision_recall[cls];
                    return [
                      [`${nice(cls)} precision`, pct(pr.precision), "of the ones it said, how many were right"],
                      [`${nice(cls)} recall`, pct(pr.recall), "of the ones it should have said, how many it caught"],
                    ];
                  }).map(([l, v, note]) => (
                    <div key={l} className="flex items-baseline gap-2">
                      <dt className="text-[12.5px] text-muted-foreground">{l}</dt>
                      <span className="leader h-3 flex-1" />
                      <dd className="font-mono text-[12.5px] tabular-nums text-foreground">{v}</dd>
                      <span className="hidden text-[10.5px] text-muted-foreground/55 xl:inline">{note}</span>
                    </div>
                  ))}
                </dl>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="cost">
            <AccordionTrigger>What each mistake is priced at</AccordionTrigger>
            <AccordionContent>
              <dl className="grid max-w-[70ch] gap-x-8 gap-y-3 sm:grid-cols-2">
                {[
                  ["Fought one we owed", inr(m!.cost_model.false_positive_inr), "wasted paperwork"],
                  ["Paid one we'd have won", "the transaction", "read per case"],
                  ["Sent to a person", inr(m!.cost_model.manual_review_inr), "analyst time"],
                  ["Skipped a needed review", pct(m!.cost_model.bypassed_exposure_rate), "of amount, counted apart"],
                ].map(([k, v, note]) => (
                  <div key={k} className="flex items-baseline gap-2">
                    <dt className="text-[12.5px] text-muted-foreground">{k}</dt>
                    <span className="leader h-3 flex-1" />
                    <dd className="font-mono text-[12px] text-foreground">{v}</dd>
                    <span className="text-[10.5px] text-muted-foreground/55">{note}</span>
                  </div>
                ))}
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
