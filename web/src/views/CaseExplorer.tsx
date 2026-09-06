import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  analyze, decisionTone, getCase, getCases, nice, num,
  type AnalyzeResult, type CaseDetail, type CaseSummary, type Health,
} from "@/lib/api";
import { Check, ChevronRight, CircleAlert, Play, Search, X, Zap } from "lucide-react";

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
          className="h-10 rounded-xl border border-input bg-card px-3.5 text-[13px] shadow-[inset_0_1px_2px_rgba(0,0,0,.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
          {Object.entries(health.splits).map(([k, v]) => (
            <option key={k} value={k}>{k} · {v.cases} cases{v.has_predictions ? "" : " · no predictions"}</option>
          ))}
        </select>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search case, merchant, reason code…"
            className="w-[280px] pl-9" />
        </div>
        <div className="inline-flex gap-0.5 rounded-full bg-black/[.045] p-1">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${filter === f.id ? "bg-white text-foreground shadow-[0_1px_3px_rgba(0,0,0,.1)]" : "text-muted-foreground hover:text-foreground"}`}>
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
              className={`mb-0.5 w-full rounded-2xl px-3.5 py-3 text-left transition-all ${sel === c.case_id ? "bg-ios-blue/[.08] ring-1 ring-ios-blue/25" : "hover:bg-secondary/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-semibold">{c.case_id}</span>
                <span className="text-[12px] tnum text-muted-foreground">{num(c.amount)} {c.currency}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{c.reason_code}</Badge>
                {c.ground_truth && <Badge variant={decisionTone(c.ground_truth) as any}>{nice(c.ground_truth)}</Badge>}
                {!!c.risk_flags.length && <Badge variant="red">{c.risk_flags.length} risk</Badge>}
                {c.agrees === false && <X size={13} className="ml-auto text-ios-red" />}
                {c.agrees === true && <Check size={13} className="ml-auto text-ios-green/60" />}
              </div>
            </button>
          ))}
          {!visible.length && <div className="py-16 text-center text-[13px] text-muted-foreground">No cases match</div>}
        </Card>

        {/* detail */}
        {!detail ? (
          <div className="flex h-[420px] items-center justify-center rounded-[20px] border border-dashed border-black/10 text-[14px] text-muted-foreground">
            <ChevronRight size={16} className="mr-1.5" /> Select a case to inspect it
          </div>
        ) : (
          <div className="space-y-5 animate-fade-up">
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
                <CardTitle>Deterministic risk signals</CardTitle>
                <CardDescription>Computed by risk_signals.py. The model never gets a vote on these.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {[
                  { l: "Evidence sufficiency", v: nice(s?.evidence_sufficiency), bad: s?.evidence_sufficiency !== "sufficient" },
                  { l: "Amount anomaly", v: String(s?.amount_anomaly), bad: !!s?.amount_anomaly },
                  { l: "Merchant repeat pattern", v: String(s?.merchant_repeat_pattern), bad: !!s?.merchant_repeat_pattern },
                ].map((x) => (
                  <div key={x.l} className={`rounded-2xl border p-4 ${x.bad ? "border-ios-red/25 bg-ios-red/[.05]" : "border-ios-green/25 bg-ios-green/[.04]"}`}>
                    <div className="text-[10.5px] font-medium uppercase tracking-[.06em] text-muted-foreground">{x.l}</div>
                    <div className={`mt-1.5 font-mono text-[15px] font-medium ${x.bad ? "text-ios-red" : "text-ios-green"}`}>{x.v}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* evidence */}
            <Card>
              <CardHeader>
                <CardTitle>Evidence submitted</CardTitle>
                <CardDescription>IDs assigned by the pipeline, not the model — it can only cite what exists.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {s?.required_types.length ? s.required_types.map((t) => (
                    <Badge key={t} variant={present.has(t) ? "green" : "red"}>
                      {present.has(t) ? <Check size={11} /> : <X size={11} />}{t}
                    </Badge>
                  )) : <Badge variant="outline">no requirement on file</Badge>}
                </div>
                {s?.evidence_items.length ? s.evidence_items.map((e, i) => {
                  const cited = run?.cited_evidence_ids.includes(e.evidence_id);
                  return (
                    <div key={e.evidence_id}>
                      <div className="flex gap-3 py-3">
                        <span className={`h-fit shrink-0 rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${cited ? "border-ios-green/40 bg-ios-green/15 text-[#248A3D]" : "border-border bg-secondary text-muted-foreground"}`}>
                          {e.evidence_id}
                        </span>
                        <div className="min-w-0">
                          <div className="font-mono text-[12.5px] text-ios-blue">{e.type}</div>
                          <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{e.description}</div>
                        </div>
                        {cited && <Badge variant="green" className="ml-auto h-fit">cited</Badge>}
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
                <CardTitle>Merchant narrative</CardTitle>
                <CardDescription>Untrusted input — authored by the party with money on the line.</CardDescription>
              </CardHeader>
              <CardContent>
                <blockquote className="rounded-r-2xl border-l-[3px] border-ios-blue bg-secondary/50 px-4 py-3 text-[13px] italic leading-relaxed text-muted-foreground">
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
                  <div className="rounded-2xl border border-ios-orange/30 bg-ios-orange/[.06] p-4 text-[13px]">{run.error}</div>
                )}

                {run && !run.error && (
                  <>
                    <div className="mb-4">
                      {run.trace.map((t, i) => (
                        <div key={i} className="flex gap-3 py-2.5 animate-slide-in" style={{ animationDelay: `${i * 0.11}s` }}>
                          <div className="pt-0.5">
                            <Badge variant={t.kind === "deterministic" ? "blue" : t.kind === "cache" ? "green" : "purple"}>{t.kind}</Badge>
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono text-[12.5px] font-medium">{t.step}</div>
                            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{t.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="animate-fade-up rounded-2xl border border-black/[.07] bg-secondary/30 p-5"
                      style={{ animationDelay: `${run.trace.length * 0.11}s` }}>
                      <div className="mb-3 flex flex-wrap items-center gap-2.5">
                        <span className={`font-mono text-[24px] font-semibold tracking-tight ${run.result.decision === "contest" ? "text-ios-green" : run.result.decision === "accept_liability" ? "text-ios-orange" : "text-ios-blue"}`}>
                          {nice(run.result.decision)}
                        </span>
                        {run.ground_truth && (
                          <Badge variant={run.agrees ? "green" : "red"}>
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
                        {run.result.risk_flags.map((f) => <Badge key={f} variant="red">{f}</Badge>)}
                        {run.cited_evidence_ids.map((e) => <Badge key={e} variant="green">cited {e}</Badge>)}
                      </div>
                      <Separator className="mb-3" />
                      <p className="text-[13px] leading-relaxed">{run.result.reason}</p>
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
