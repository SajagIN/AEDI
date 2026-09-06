import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Ticker } from "@/components/figures";
import { getMetrics, inr, pct, type Metrics } from "@/lib/api";
import { TriangleAlert } from "lucide-react";

/*  Overview
 *
 *  Two things live on this screen: whether the agent is accurate, and what
 *  that is worth per month. Nothing else.
 *
 *  What used to be here and isn't any more — the pipeline walkthrough, the
 *  judgment-vs-arithmetic split, the injection examples — was duplicating
 *  tabs that demonstrate the same thing with live data. Case Explorer runs
 *  the trace. Adversarial runs the attacks. Explaining them here as well was
 *  asking the reader to take on faith what the next tab simply shows.
 */

export default function Overview({ split }: { split: string }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [vol, setVol] = useState(4000);
  const [mins, setMins] = useState(12);

  useEffect(() => { getMetrics(split).then(setM); }, [split]);

  const agent = m?.available ? m.blocks[0] : null;
  const allrev = m?.available ? m.blocks[2] : null;

  const perCaseAgent = agent ? agent.cost.cost_per_100_inr / 100 : 0;
  const perCaseToday = allrev ? allrev.cost.cost_per_100_inr / 100 : 0;
  const reviewed = agent ? Math.round(vol * (1 - agent.coverage)) : 0;
  const auto = vol - reviewed;
  const hours = Math.round((auto * mins) / 60);
  const saved = (perCaseToday - perCaseAgent) * vol;
  const exposure = agent ? (agent.cost.bypassed_review_exposure_per_100_inr / 100) * vol : 0;

  /* A partial run is not a sample — the scored cases are whichever ones the
     pipeline reached before it stopped. Projecting from them would be a
     confident-looking wrong number. */
  const total = m?.n_cases ?? 0;
  const scored = m?.n_scored ?? 0;
  const projectable = !!agent && scored > 0 && scored >= total;

  const int = (n: number) => Math.round(n).toLocaleString("en-IN");

  const KPIS = agent ? [
    { l: "False positives", v: agent.cost.n_false_positive, f: int, t: "good",
      why: "Contested a case that should have been accepted." },
    { l: "False negatives", v: agent.cost.n_false_negative, f: int, t: "good",
      why: "Accepted a case that was winnable." },
    { l: "Coverage", v: agent.coverage, f: pct, t: "plain",
      why: "Decided automatically instead of routing to a human." },
    { l: "Bypassed reviews", v: agent.cost.n_bypassed_review, f: int, t: "warn",
      why: "The disclosed gap: risky cases the agent auto-decided anyway." },
  ] : [];

  return (
    <div className="space-y-24 pb-16">
      {/* ── the claim ─────────────────────────────────────────────────── */}
      <div className="reveal pt-16 sm:pt-24" style={{ "--i": 0 } as React.CSSProperties}>
        <h1 className="max-w-[14ch] font-display text-[clamp(52px,9vw,120px)] leading-[0.86] tracking-[-.02em]">
          Chargebacks,{" "}
          <span className="font-quote italic text-cobalt">answered with evidence.</span>
        </h1>
        {m?.available && (
          <div className="dateline mt-10 text-muted-foreground/50">
            {m.split} &middot; n={agent?.n}
          </div>
        )}
      </div>

      {/* ── is it accurate ────────────────────────────────────────────────
          Four numbers, four labels. The explanation of each is a tooltip,
          which costs the page nothing until someone wants it. */}
      <div className="grid gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        {(agent ? KPIS : [0, 1, 2, 3]).map((k: any, i) => (
          <div key={i} className="reveal" style={{ "--i": i + 1 } as React.CSSProperties}>
            {agent ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-default">
                    <div className={`font-display text-[clamp(48px,6vw,68px)] leading-[0.85] ${
                      k.t === "good" ? "text-signal-good" : k.t === "warn" ? "text-signal-warn" : "text-foreground"}`}>
                      <Ticker value={k.v} format={k.f} delay={0.12 + i * 0.08} />
                    </div>
                    <div className="dateline mt-4 text-muted-foreground/60">{k.l}</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{k.why}</TooltipContent>
              </Tooltip>
            ) : (
              <><Skeleton className="h-[52px] w-24" /><Skeleton className="mt-5 h-2.5 w-28" /></>
            )}
          </div>
        ))}
      </div>

      {/* ── what it is worth ──────────────────────────────────────────── */}
      <section className="reveal" style={{ "--i": 5 } as React.CSSProperties}>
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6 border-t border-border pt-8">
          <h2 className="font-display text-[clamp(30px,4vw,44px)] leading-none">What this is worth</h2>
          <div className="flex gap-3">
            <label>
              <div className="dateline mb-2 text-muted-foreground/50">Disputes / mo</div>
              <Input type="number" value={vol} min={1} step={100} className="h-9 w-28"
                onChange={(e) => setVol(Math.max(1, +e.target.value || 0))} />
            </label>
            <label>
              <div className="dateline mb-2 text-muted-foreground/50">Mins / review</div>
              <Input type="number" value={mins} min={1} className="h-9 w-24"
                onChange={(e) => setMins(Math.max(1, +e.target.value || 0))} />
            </label>
          </div>
        </div>

        {agent && !projectable && (
          <Card className="border-signal-warn/35 bg-signal-warn/[.06]">
            <CardContent className="flex gap-3 p-5">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-signal-warn" />
              <div>
                <div className="font-display text-[17px] text-signal-warn">
                  {scored === 0 ? `Nothing scored on ${m?.split}` : `Only ${scored} of ${total} scored`}
                </div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  A run that stopped early isn&rsquo;t a sample. Finish it, or switch splits.
                </p>
                <code className="mt-3 block overflow-x-auto rounded-lg border border-border bg-secondary p-3 font-mono text-[11px] text-foreground/85">
                  python code/main.py --input dataset/{m?.split}/cases.csv --output dataset/{m?.split}/output.csv
                </code>
              </div>
            </CardContent>
          </Card>
        )}

        {agent && projectable && (
          <>
            <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { l: "Auto-decided", v: auto, f: int, t: "plain" },
                { l: "To a human", v: reviewed, f: int, t: "plain" },
                { l: "Hours freed", v: hours, f: int, t: "good" },
                { l: "Cost avoided", v: saved, f: inr, t: "good" },
                { l: "Risk carried", v: exposure, f: inr, t: "warn" },
              ].map((x, i) => (
                <div key={x.l}>
                  <div className={`font-display text-[clamp(30px,3.4vw,42px)] leading-[0.9] ${
                    x.t === "good" ? "text-signal-good" : x.t === "warn" ? "text-signal-warn" : "text-foreground"}`}>
                    <Ticker value={x.v} format={x.f} delay={i * 0.06} />
                  </div>
                  <div className="dateline mt-3 text-muted-foreground/60">{x.l}</div>
                </div>
              ))}
            </div>

            {/* The one sentence worth keeping: without it the last number
                reads like a cost of the agent rather than a risk it takes. */}
            <p className="mt-10 max-w-[54ch] text-[12.5px] leading-relaxed text-muted-foreground">
              <span className="text-signal-warn">Risk carried</span> is modelled exposure from risky
              cases the agent decided alone. Deliberately not netted off the saving.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
