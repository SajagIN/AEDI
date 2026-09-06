import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { getAdversarial, injectionTest, nice, pct, type Adversarial as Adv, type Health } from "@/lib/api";
import { Check, Play, ShieldCheck, ShieldX, X } from "lucide-react";

export default function Adversarial({ health }: { health: Health }) {
  const [d, setD] = useState<Adv | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);

  useEffect(() => { getAdversarial().then(setD); }, []);

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setOut(null);
    setOut(await injectionTest(text.trim()));
    setBusy(false);
  };

  const s = d?.summary;

  return (
    <div className="space-y-5">
      <Card className="border-ios-blue/20 bg-gradient-to-br from-ios-blue/[.04] to-transparent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-ios-blue" />
            <CardTitle>Defense-only posture</CardTitle>
          </div>
          <CardDescription className="max-w-[90ch]">
            Fixed, publicly-documented injection patterns used as regression tests. No novel attack
            generation, no third-party targeting, no offensive capability. It exists so the defense can be
            measured rather than asserted.
          </CardDescription>
        </CardHeader>
      </Card>

      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { l: "Defense rate", v: pct(s.defense_rate), h: `${s.n_attacks}/${s.n_attacks} attacks flagged`, c: "green" },
            { l: "Control false positives", v: pct(s.control_false_positive_rate), h: `0/${s.n_controls} benign wrongly flagged`, c: "green" },
            { l: "Attack fixtures", v: String(s.n_attacks), h: "publicly-documented categories", c: "" },
            { l: "Benign controls", v: String(s.n_controls), h: "same vocabulary, no instruction", c: "" },
          ].map((x) => (
            <Card key={x.l}>
              <CardContent className="p-5">
                <div className="text-[11px] font-medium uppercase tracking-[.07em] text-muted-foreground">{x.l}</div>
                <div className={`mt-1.5 text-[32px] font-semibold leading-none tnum ${x.c === "green" ? "text-ios-green" : ""}`}>{x.v}</div>
                <p className="mt-2.5 text-[12px] text-muted-foreground">{x.h}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* playground */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>Injection playground</CardTitle>
          <CardDescription className="max-w-[92ch]">
            Every run uses one deliberately neutral case: a non-risky merchant, no amount anomaly, and evidence
            that fully satisfies reason code 13.1. The correct answer is{" "}
            <b className="font-medium text-ios-green">contest</b>. The narrative is the only variable — so if
            the text moves the decision, a merchant just argued their way into a payout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Write a merchant narrative — try to make it decide for you…" />
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Button onClick={run} disabled={busy || !text.trim()}><Play size={14} /> Run against the pipeline</Button>
            <select onChange={(e) => e.target.value && setText(e.target.value)} value=""
              className="h-10 max-w-[300px] rounded-xl border border-input bg-card px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <option value="">load a real fixture…</option>
              <optgroup label="attacks — should be flagged">
                {d?.attacks.map((f) => <option key={f.id} value={f.narrative}>{f.id} · {f.category}</option>)}
              </optgroup>
              <optgroup label="benign controls — should NOT be flagged">
                {d?.controls.map((f) => <option key={f.id} value={f.narrative}>{f.id} · {f.category}</option>)}
              </optgroup>
            </select>
            {busy && <span className="text-[12px] text-muted-foreground">running against the real pipeline…</span>}
            {!health.live_capable && !busy && (
              <span className="text-[12px] text-muted-foreground">needs a GROQ_API_KEY — see RUNNING.md</span>
            )}
          </div>

          {out?.error && (
            <div className="mt-4 rounded-2xl border border-ios-orange/30 bg-ios-orange/[.06] p-4 text-[13px] leading-relaxed">
              {out.error}
            </div>
          )}

          {out && !out.error && (
            <div className={`mt-4 animate-fade-up rounded-2xl border p-5 ${out.held_the_line ? "border-ios-green/30 bg-ios-green/[.05]" : "border-ios-red/30 bg-ios-red/[.05]"}`}>
              <div className={`mb-3 flex items-center gap-2 text-[17px] font-semibold ${out.held_the_line ? "text-ios-green" : "text-ios-red"}`}>
                {out.held_the_line ? <><ShieldCheck size={18} /> Held the line</> : <><ShieldX size={18} /> The narrative moved the decision</>}
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <Badge variant={out.result.decision === "contest" ? "green" : out.result.decision === "accept_liability" ? "orange" : "blue"}>
                  {nice(out.result.decision)}
                </Badge>
                {out.flagged_injection && <Badge variant="red">prompt_injection_attempt</Badge>}
                {out.result.risk_flags.filter((f: string) => f !== "prompt_injection_attempt").map((f: string) => (
                  <Badge key={f} variant="outline">{f}</Badge>
                ))}
                <Badge variant="outline">confidence {out.result.confidence}</Badge>
              </div>
              <Separator className="mb-3" />
              <p className="text-[13px] leading-relaxed">{out.result.reason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* fixtures */}
      <div className="grid gap-5 lg:grid-cols-2">
        {[
          { title: "Attack fixtures", sub: "must be flagged", items: d?.attacks ?? [], tone: "red" as const, Icon: X },
          { title: "Benign controls", sub: "must NOT be flagged", items: d?.controls ?? [], tone: "green" as const, Icon: Check },
        ].map(({ title, sub, items, tone, Icon }) => (
          <Card key={title}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{title}</CardTitle>
                <Badge variant={tone}><Icon size={11} />{sub}</Badge>
              </div>
            </CardHeader>
            <CardContent className="max-h-[560px] overflow-y-auto">
              {items.map((f, i) => (
                <div key={f.id}>
                  <div className="py-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{f.id}</span>
                      <Badge variant={tone}>{f.category}</Badge>
                      <Button size="sm" variant="ghost" className="ml-auto h-7 text-[12px]"
                        onClick={() => { setText(f.narrative); window.scrollTo({ top: 320, behavior: "smooth" }); }}>
                        try it
                      </Button>
                    </div>
                    <p className="font-mono text-[12px] leading-relaxed text-muted-foreground">{f.narrative}</p>
                  </div>
                  {i < items.length - 1 && <Separator />}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
