import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toneFor } from "@/lib/decision";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  analyze, decisionTone, getCase, getCases, nice, num,
  type AnalyzeResult, type CaseDetail, type CaseSummary, type Health,
} from "@/lib/api";
import { Check, ChevronRight, CircleAlert, Play, Search, TriangleAlert, X, Zap } from "lucide-react";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "risk", label: "Risk-flagged" },
  { id: "disagree", label: "Disagreements" },
] as const;

export default function CaseExplorer({ health, split, setSplit }:
  { health: Health; split: string; setSplit: (s: string) => void }) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [run, setRun] = useState<AnalyzeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => { setSel(null); setDetail(null); setRun(null); getCases(split).then((d) => setCases(d.cases)); }, [split]);

  const visible = useMemo(() => cases.filter((c) => {
    if (filter === "risk" && !c.risk_flags.length) return false;
    if (filter === "disagree" && c.agrees !== false) return false;
    if (!q) return true;
    return `${c.case_id} ${c.merchant_id} ${c.reason_code}`.toLowerCase().includes(q.toLowerCase());
  }), [cases, filter, q]);

  const open = async (id: string) => {
    setSel(id); setDetail(null); setRun(null);
    setDetail(await getCase(split, id));
  };

  const doRun = async (mode: string) => {
    if (!sel) return;
    setBusy(true); setRun(null);
    setRun(await analyze(split, sel, mode));
    setBusy(false);
  };

  const s = detail?.signals;
  const present = new Set(s?.present_types ?? []);

  return (
    <div className="space-y-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={split} onChange={(e) => setSplit(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background/70 px-3 font-mono text-[12.5px] text-foreground shadow-inset transition-colors focus-visible:border-cobalt/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cobalt/30">
          {Object.entries(health.splits).map(([k, v]) => (
            <option key={k} value={k}>{k} · {v.cases} cases{v.has_predictions ? "" : " · no predictions"}</option>
          ))}
        </select>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search case, merchant, reason code…"
            className="w-[280px] pl-9" />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-secondary p-1 shadow-inset">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`rounded-md px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[.11em] transition-colors ${filter === f.id ? "bg-cobalt/15 text-cobalt" : "text-muted-foreground hover:text-foreground"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12.5px] text-muted-foreground tnum">{visible.length} of {cases.length}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* list */}
        <Card className="h-[calc(100vh-230px)] overflow-y-auto p-1.5">
          {visible.map((c) => (
            <button key={c.case_id} onClick={() => open(c.case_id)}
              className={`mb-0.5 w-full rounded-lg px-3.5 py-3 text-left transition-all ${sel === c.case_id ? "bg-signal-info/[.08] ring-1 ring-signal-info/25" : "hover:bg-secondary/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-semibold">{c.case_id}</span>
                <span className="text-[12px] tnum text-muted-foreground">{num(c.amount)} {c.currency}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{c.reason_code}</Badge>
                {c.ground_truth && <Badge variant={decisionTone(c.ground_truth) as any}>{nice(c.ground_truth)}</Badge>}
                {!!c.risk_flags.length && <Badge variant="bad">{c.risk_flags.length} risk</Badge>}
                {c.agrees === false && <X size={13} className="ml-auto text-signal-bad" />}
                {c.agrees === true && <Check size={13} className="ml-auto text-signal-good/60" />}
              </div>
            </button>
          ))}
          {!visible.length && <div className="py-16 text-center text-[13px] text-muted-foreground">No cases match</div>}
        </Card>

        {/* detail */}
        {!detail ? (
          <div className="flex h-[420px] items-center justify-center rounded-lg border border-dashed border-border text-[14px] text-muted-foreground">
            <ChevronRight size={16} className="mr-1.5" /> Select a case to inspect it
          </div>
        ) : (
          <div className="space-y-5 animate-reveal">
            {/* header + facts */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2.5">
                  <CardTitle className="text-[19px]">{detail.case.case_id}</CardTitle>
                  <Badge variant="outline">{detail.case.reason_code} · {detail.reason_requirement.network}</Badge>
                  {detail.ground_truth && (
                    <Badge variant={decisionTone(detail.ground_truth) as any}>truth: {nice(detail.ground_truth)}</Badge>
                  )}
                </div>
                <CardDescription>{detail.reason_requirement.description}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                <dl className="space-y-2">
                  {[
                    ["Disputed amount", `${num(detail.case.amount)} ${detail.case.currency}`],
                    ["Original amount", `${num(detail.case.original_amount)} ${detail.case.currency}`],
                    ["Date", detail.case.transaction_date],
                    ["Method", detail.case.payment_method],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 text-[13px]">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-mono text-[12.5px] tnum">{v}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="space-y-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
                    Merchant {detail.case.merchant_id}
                  </div>
                  {[
                    ["Chargeback rate 90d", s?.merchant.chargeback_rate_90d],
                    ["Transactions 30d", s?.merchant.total_transactions_30d],
                    ["Prior contest win rate", s?.merchant.prior_contest_win_rate],
                    ["Flags", s?.merchant.history_flags || "none"],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-4 text-[13px]">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-mono text-[12.5px] tnum">{v ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            {/* signals */}
            <Card>
              <CardHeader>
                <CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default border-b border-dashed border-border/60 pb-0.5">Deterministic risk signals</span>
                    </TooltipTrigger>
                    <TooltipContent>Computed by risk_signals.py. The model never gets a vote on these.</TooltipContent>
                  </Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {[
                  { l: "Evidence sufficiency", v: nice(s?.evidence_sufficiency), bad: s?.evidence_sufficiency !== "sufficient" },
                  { l: "Amount anomaly", v: String(s?.amount_anomaly), bad: !!s?.amount_anomaly },
                  { l: "Merchant repeat pattern", v: String(s?.merchant_repeat_pattern), bad: !!s?.merchant_repeat_pattern },
                ].map((x) => (
                  <div key={x.l} className={`rounded-lg border p-4 ${x.bad ? "border-signal-bad/25 bg-signal-bad/[.05]" : "border-signal-good/25 bg-signal-good/[.04]"}`}>
                    <div className="text-[10.5px] font-medium uppercase tracking-[.06em] text-muted-foreground">{x.l}</div>
                    <div className={`mt-1.5 font-mono text-[15px] font-medium ${x.bad ? "text-signal-bad" : "text-signal-good"}`}>{x.v}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* evidence */}
            <Card>
              <CardHeader>
                <CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default border-b border-dashed border-border/60 pb-0.5">Evidence submitted</span>
                    </TooltipTrigger>
                    <TooltipContent>IDs are assigned by the pipeline. The model can only cite one that exists.</TooltipContent>
                  </Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {s?.required_types.length ? s.required_types.map((t) => (
                    <Badge key={t} variant={present.has(t) ? "good" : "bad"}>
                      {present.has(t) ? <Check size={11} /> : <X size={11} />}{t}
                    </Badge>
                  )) : <Badge variant="outline">no requirement on file</Badge>}
                </div>
                {s?.evidence_items.length ? s.evidence_items.map((e, i) => {
                  const cited = run?.cited_evidence_ids.includes(e.evidence_id);
                  return (
                    <div key={e.evidence_id}>
                      <div className="flex gap-3 py-3">
                        <span className={`h-fit shrink-0 rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${cited ? "border-signal-good/40 bg-signal-good/15 text-signal-good" : "border-border bg-secondary text-muted-foreground"}`}>
                          {e.evidence_id}
                        </span>
                        <div className="min-w-0">
                          <div className="font-mono text-[12.5px] text-signal-info">{e.type}</div>
                          <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{e.description}</div>
                        </div>
                        {cited && <Badge variant="good" className="ml-auto h-fit">cited</Badge>}
                      </div>
                      {i < s.evidence_items.length - 1 && <Separator />}
                    </div>
                  );
                }) : <p className="text-[13px] text-muted-foreground">No evidence submitted at all.</p>}
              </CardContent>
            </Card>

            {/* narrative */}
            <Card>
              <CardHeader>
                <CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default border-b border-dashed border-border/60 pb-0.5">Merchant narrative</span>
                    </TooltipTrigger>
                    <TooltipContent>Untrusted input — authored by the party with money on the line.</TooltipContent>
                  </Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <blockquote className="rounded-r-2xl border-l-[3px] border-signal-info bg-secondary/50 px-4 py-3 font-quote text-[15px] italic leading-relaxed text-muted-foreground">
                  {detail.case.merchant_narrative || "[no narrative submitted]"}
                </blockquote>
              </CardContent>
            </Card>

            {/* run */}
            <Card>
              <CardHeader><CardTitle>Run the agent</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap items-center gap-2.5">
                  <Button onClick={() => doRun("replay")} disabled={busy}>
                    <Play size={14} /> Replay committed decision
                  </Button>
                  <Button variant="outline" onClick={() => doRun("live")} disabled={busy || !health.live_capable}>
                    <Zap size={14} /> Run live
                  </Button>
                  {!health.live_capable && <span className="text-[12px] text-muted-foreground">needs a GROQ_API_KEY</span>}
                  {busy && <span className="text-[12px] text-muted-foreground">working…</span>}
                </div>

                {run?.error && (
                  <div className="rounded-lg border border-signal-warn/30 bg-signal-warn/[.06] p-4 text-[13px]">{run.error}</div>
                )}

                {run?.fallback && (
                  <div className="mb-4 rounded-lg border border-signal-bad/35 bg-signal-bad/[.07] p-4">
                    <div className="mb-1.5 flex items-center gap-2 font-display text-[17px] text-signal-bad">
                      <TriangleAlert size={15} /> The model never answered
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                      Safe fallback, not a judgement. Check the server log for{" "}
                      <b className="font-mono text-[11.5px] text-foreground">OTPM</b> or{" "}
                      <b className="font-mono text-[11.5px] text-foreground">tool_use_failed</b>.
                    </p>
                  </div>
                )}

                {run && !run.error && (
                  <>
                    <div className="mb-4">
                      {run.trace.map((t, i) => (
                        <div key={i} className="flex gap-3 py-2.5 animate-reveal-x" style={{ animationDelay: `${i * 0.11}s` }}>
                          <div className="pt-0.5">
                            <Badge variant={t.kind === "deterministic" ? "info" : t.kind === "cache" ? "good" : "alt"}>{t.kind}</Badge>
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono text-[12.5px] font-medium">{t.step}</div>
                            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{t.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="animate-reveal rounded-lg border border-border bg-secondary/30 p-5"
                      style={{ animationDelay: `${run.trace.length * 0.11}s` }}>
                      <div className="mb-3 flex flex-wrap items-center gap-2.5">
                        <span className={`font-mono text-[24px] font-semibold tracking-tight ${toneFor(run.result.decision).text}`}>
                          {nice(run.result.decision)}
                        </span>
                        {run.ground_truth && (
                          <Badge variant={run.agrees ? "good" : "bad"}>
                            {run.agrees ? <><Check size={11} /> matches ground truth</> : <><CircleAlert size={11} /> truth: {nice(run.ground_truth)}</>}
                          </Badge>
                        )}
                        <Badge variant="outline">{run.source === "live" ? "live model call" : "committed run"}</Badge>
                        <div className="ml-auto text-right">
                          <div className="text-[10px] uppercase tracking-[.07em] text-muted-foreground">confidence</div>
                          <div className="text-[19px] font-semibold tnum">{run.result.confidence ?? "—"}</div>
                        </div>
                      </div>
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        <Badge variant="outline">sufficiency: {nice(run.result.evidence_sufficiency)}</Badge>
                        {run.result.risk_flags.map((f) => <Badge key={f} variant="bad">{f}</Badge>)}
                        {run.cited_evidence_ids.map((e) => <Badge key={e} variant="good">cited {e}</Badge>)}
                      </div>
                      <Separator className="mb-3" />
                      <p className="font-quote text-[16px] italic leading-relaxed">{run.result.reason}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
