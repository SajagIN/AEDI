import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Ticker } from "@/components/figures";
import StrokeText from "@/components/reactbits/stroke-text";
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

  /* The remedy for the exposure, priced. Escalating the bypassed cases to a
     human removes the disclosed risk entirely and costs one more review each
     - so the saving survives, smaller. Stating both halves is the difference
     between "our net is negative" and "we know where the dial sits". */
  const bypassed = agent?.cost.n_bypassed_review ?? 0;
  const reviewRate = m?.available ? m.cost_model.manual_review_inr : 150;
  const perCaseSafe = agent
    ? ((agent.cost.n_manual_review + bypassed) * reviewRate) / agent.n : 0;
  const savedSafe = (perCaseToday - perCaseSafe) * vol;
  const coverageSafe = agent
    ? (agent.n - agent.cost.n_manual_review - bypassed) / agent.n : 0;

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
        {/* The first word is drawn rather than set: the outline writes itself
            on in cobalt and the fill floods after it, which is the one place
            on this console where an animation is allowed to be the point. The
            second line stays live text in the serif, because the two-tone
            split is the provenance grammar the rest of the app reads by and
            flattening it into one SVG would cost more than the effect. */}
        {/* The ch unit resolves against the element's own font-size, and this
            h1 no longer sets one — so max-w-[11ch] was measuring against the
            inherited 16px body text and handing StrokeText a 176px box to fit
            a display word into. Widths are absolute now. */}
        <h1 className="leading-[0.86] tracking-[-.02em]">
          <span className="sr-only">Chargebacks, answered with evidence.</span>
          <span aria-hidden className="block w-full max-w-[min(100%,860px)]">
            <StrokeText text="Chargebacks," strokeColor="#0071E3" fillColor="hsl(var(--foreground))"
              advance={0.52} minFontSize={52} maxFontSize={168} strokeWidth={0.9} drawDuration={1.3} />
          </span>
          <span aria-hidden className="mt-1 block max-w-[13ch] font-quote text-[clamp(48px,8.4vw,112px)] italic leading-[0.92] text-cobalt">
            answered with evidence.
          </span>
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
              <div className="dateline mb-2 text-muted-foreground/50">Disputes / month</div>
              <Input type="number" value={vol} min={1} step={100} className="h-9 w-28"
                onChange={(e) => setVol(Math.max(1, +e.target.value || 0))} />
            </label>
            <label>
              <div className="dateline mb-2 text-muted-foreground/50">Minutes / review</div>
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
            <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { l: "Auto-decided", v: auto, f: int, t: "plain",
                  m: `${pct(agent.coverage)} of ${int(vol)}` },
                { l: "To a human", v: reviewed, f: int, t: "plain",
                  m: `${pct(1 - agent.coverage)} of ${int(vol)}` },
                { l: "Hours freed", v: hours, f: int, t: "good",
                  m: `${mins} min × ${int(auto)}` },
                { l: "Cost avoided", v: saved, f: inr, t: "good",
                  m: `${inr(perCaseToday - perCaseAgent)} × ${int(vol)}` },
              ].map((x, i) => (
                <div key={x.l}>
                  <div className={`font-display text-[clamp(30px,3.4vw,42px)] leading-[0.9] ${
                    x.t === "good" ? "text-signal-good" : x.t === "warn" ? "text-signal-warn" : "text-foreground"}`}>
                    <Ticker value={x.v} format={x.f} delay={i * 0.06} />
                  </div>
                  <div className="dateline mt-3 text-muted-foreground/60">{x.l}</div>
                  {/* The multiplication, stated. Without it a six-figure total
                      invites the reader to assume the input was rupees. */}
                  <div className="mt-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground/45">{x.m}</div>
                </div>
              ))}
            </div>

            <p className="mt-10 max-w-[62ch] text-[12.5px] leading-relaxed text-muted-foreground">
              Reviewing every dispute by hand costs {inr(perCaseToday)} a case; AEDI averages{" "}
              {inr(perCaseAgent)}.
            </p>

            {/* Subordinate on purpose. Level with the four figures above it, a
                reader subtracts one from the other and walks away - but the
                subtraction is wrong, because the exposure is a modelled risk you
                can buy out, not a bill that has arrived. So: quieter type, and
                the price of removing it stated in the same breath. */}
            <div className="mt-14 border-t border-signal-warn/25 pt-7">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="dateline text-signal-warn/80">Risk carried, not netted off</span>
                <span className="font-mono text-[19px] tabular-nums text-signal-warn">{inr(exposure)}</span>
                <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/45">
                  {inr(exposure / vol)} &times; {int(vol)}
                </span>
              </div>
              <p className="mt-3 max-w-[68ch] text-[12.5px] leading-relaxed text-muted-foreground">
                On {bypassed} of {agent.n} held-out cases the right answer was &ldquo;a person should
                look at this&rdquo; and AEDI decided anyway. It was right each time, and the cost
                model would score it clean, so we price it separately rather than let luck bank as
                accuracy.{" "}
                <b className="font-medium text-foreground">
                  Route those to a human and the exposure goes to zero: coverage falls to{" "}
                  {pct(coverageSafe)} and {inr(savedSafe)} a month survives.
                </b>{" "}
                That is the dial, and both ends of it are measured.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
