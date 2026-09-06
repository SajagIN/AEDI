import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getMetrics, inr, nice, pct, type Health, type Metrics } from "@/lib/api";

export default function Evaluation({ health, split, setSplit }:
  { health: Health; split: string; setSplit: (s: string) => void }) {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => { setM(null); getMetrics(split).then(setM); }, [split]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={split} onChange={(e) => setSplit(e.target.value)}
          className="h-9 rounded-[3px] border border-input bg-background/70 px-3 font-mono text-[12.5px] text-foreground shadow-inset transition-colors focus-visible:border-brass/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/30">
          {Object.entries(health.splits).map(([k, v]) => (
            <option key={k} value={k}>{k}{k === "held_out" ? " · opened once, at code freeze" : ""} · {v.cases} cases</option>
          ))}
        </select>
        <p className="text-[12.5px] text-muted-foreground">
          Computed in-process by <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11.5px]">code/evaluation/main.py</code> — nothing here is hard-coded.
        </p>
      </div>

      {!m && <div className="py-20 text-center text-[13px] text-muted-foreground">Running the evaluation harness…</div>}

      {m && !m.available && (
        <Card><CardContent className="p-10 text-center">
          <p className="text-[13.5px] text-muted-foreground">{m.message}</p>
          <code className="mt-3 inline-block rounded-[3px] bg-secondary px-3 py-2 font-mono text-[12px]">
            python code/main.py --input dataset/{m.split}/cases.csv --output dataset/{m.split}/output.csv
          </code>
        </CardContent></Card>
      )}

      {/* A partial run makes the comparison meaningless: the agent block is
          scored on the cases the run reached, while both baselines are scored
          on the whole split. Different denominators, so the rows are not
          comparable — say so above the tables rather than letting someone read
          them side by side. */}
      {m?.available && m.complete === false && (
        <Card className="animate-reveal border-signal-warn/30 bg-signal-warn/[.06]">
          <CardContent className="p-5">
            <div className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold text-signal-warn">
              <TriangleAlert size={15} />
              Incomplete run — {m.n_scored} of {m.n_cases} cases scored on {m.split}
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              The agent row below is measured on those {m.n_scored} case(s); both baseline rows are
              measured on all {m.n_cases}. Different denominators, so do not read them against each
              other. Finish the run first:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-[3px] border border-border bg-background/70 p-3.5 font-mono text-[11.5px] leading-relaxed text-foreground/85">
{`python code/main.py --input dataset/${m.split}/cases.csv \\
  --output dataset/${m.split}/output.csv`}
            </pre>
          </CardContent>
        </Card>
      )}

      {m?.available && m.blocks.map((b, bi) => (
        <Card key={b.name} className="animate-reveal" style={{ animationDelay: `${bi * 0.06}s` }}>
          <CardHeader>
            <div className="flex items-baseline gap-2.5">
              <CardTitle className="text-[16px]">{b.name}</CardTitle>
              <span className="text-[12px] text-muted-foreground tnum">n = {b.n} scored</span>
              {bi === 0 && <Badge variant="info" className="ml-auto">this system</Badge>}
              {bi > 0 && <Badge variant="outline" className="ml-auto">baseline</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-7 lg:grid-cols-[minmax(320px,1fr)_1fr]">
              {/* confusion matrix */}
              <div>
                <table className="w-full border-separate border-spacing-1">
                  <thead>
                    <tr>
                      <th />
                      {m.decision_values.map((p) => (
                        <th key={p} className="pb-1 text-[10px] font-semibold uppercase tracking-[.05em] text-muted-foreground">{nice(p)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.decision_values.map((a) => (
                      <tr key={a}>
                        <th className="pr-2.5 text-right font-mono text-[11.5px] font-medium text-muted-foreground">{nice(a)}</th>
                        {m.decision_values.map((p) => {
                          const v = b.matrix[a][p];
                          const diag = a === p;
                          const err = !diag && v > 0 && a !== "manual_review";
                          return (
                            <td key={p}
                              className={`rounded-[3px] border py-3 text-center text-[15px] font-semibold tnum ${
                                diag && v > 0 ? "border-signal-good/35 bg-signal-good/[.08] text-signal-good"
                                : err ? "border-signal-bad/30 bg-signal-bad/[.06] text-signal-bad"
                                : v === 0 ? "border-border bg-secondary/40 font-normal text-muted-foreground/50"
                                : "border-border bg-secondary/60"}`}>
                              {v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2.5 text-[11.5px] text-muted-foreground">rows = ground truth · columns = predicted</p>
              </div>

              {/* precision / recall */}
              <div className="space-y-3.5">
                {["contest", "accept_liability"].flatMap((cls) => {
                  const pr = b.precision_recall[cls];
                  return [
                    { k: `${cls}-p`, l: `${nice(cls)} precision`, v: pr.precision, g: false },
                    { k: `${cls}-r`, l: `${nice(cls)} recall`, v: pr.recall, g: true },
                  ];
                }).map((x) => (
                  <div key={x.k}>
                    <div className="mb-1.5 flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">{x.l}</span>
                      <span className="font-medium tnum">{pct(x.v)}</span>
                    </div>
                    <Progress value={(x.v ?? 0) * 100} barClassName={x.g ? "bg-signal-good" : "bg-signal-info"} />
                  </div>
                ))}
                <div>
                  <div className="mb-1.5 flex justify-between text-[12.5px]">
                    <span className="text-muted-foreground">coverage</span>
                    <span className="font-medium tnum">{pct(b.coverage)}</span>
                  </div>
                  <Progress value={b.coverage * 100} barClassName="bg-signal-alt" />
                </div>
              </div>
            </div>

            {/* costs */}
            <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Cost / 100 cases", inr(b.cost.cost_per_100_inr)],
                ["False positives", String(b.cost.n_false_positive)],
                ["False negatives", String(b.cost.n_false_negative)],
                ["Routed to review", String(b.cost.n_manual_review)],
                ["Bypassed reviews", String(b.cost.n_bypassed_review)],
                ["Unpriced exposure / 100", inr(b.cost.bypassed_review_exposure_per_100_inr)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-[3px] border border-border bg-secondary/40 p-3.5">
                  <div className="text-[10px] font-medium uppercase tracking-[.05em] text-muted-foreground">{l}</div>
                  <div className="mt-1 text-[17px] font-semibold tnum">{v}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {m?.available && (
        <Card>
          <CardHeader><CardTitle>Cost model assumptions — stated, not hidden</CardTitle></CardHeader>
          <CardContent>
            <p className="max-w-[92ch] text-[13px] leading-relaxed text-muted-foreground">
              A false positive (contested what should have been accepted) costs a flat{" "}
              <b className="font-medium text-foreground">{inr(m.cost_model.false_positive_inr)}</b> in wasted
              representment effort. A false negative (accepted a winnable case) costs the transaction amount
              itself, read per case. A manual review costs{" "}
              <b className="font-medium text-foreground">{inr(m.cost_model.manual_review_inr)}</b> of analyst time.
              The bonus row prices bypassed reviews at{" "}
              <b className="font-medium text-foreground">{pct(m.cost_model.bypassed_exposure_rate)}</b> of the
              transaction amount — a stated assumption, deliberately kept out of the primary number so it can
              never be silently absorbed into it.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
