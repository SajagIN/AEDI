import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { confidence, toneFor } from "@/lib/decision";
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
      <Card className="border-signal-info/20 bg-signal-info/[.03]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-signal-info" />
            <CardTitle>Defense-only posture</CardTitle>
          </div>
          <CardDescription>
            We only test attacks that are already public, and only against ourselves.
            Nothing new is invented here.
          </CardDescription>
        </CardHeader>
      </Card>

      {!d && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-5">
              <div className="h-2.5 w-24 animate-pulse rounded bg-foreground/[.07]" />
              <div className="mt-3 h-8 w-16 animate-pulse rounded bg-foreground/[.06]" />
              <div className="mt-3 h-2.5 w-full animate-pulse rounded bg-foreground/[.05]" />
            </CardContent></Card>
          ))}
        </div>
      )}

      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { l: "Attacks caught", v: pct(s.defense_rate), h: `${s.n_attacks} of ${s.n_attacks} trick messages spotted`, c: "green" },
            { l: "Honest ones misjudged", v: pct(s.control_false_positive_rate), h: `0 of ${s.n_controls} normal messages wrongly accused`, c: "green" },
            { l: "Trick messages", v: String(s.n_attacks), h: "known, published attack wordings", c: "" },
            { l: "Honest messages", v: String(s.n_controls), h: "same words, no hidden order — must NOT be flagged", c: "" },
          ].map((x) => (
            <Card key={x.l}>
              <CardContent className="p-5">
                <div className="text-[11px] font-medium uppercase tracking-[.07em] text-muted-foreground">{x.l}</div>
                <div className={`mt-1.5 text-[32px] font-semibold leading-none tnum ${x.c === "green" ? "text-signal-good" : ""}`}>{x.v}</div>
                <p className="mt-2.5 text-[12px] text-muted-foreground">{x.h}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="animate-reveal">
        <CardHeader>
          <CardTitle>Injection playground</CardTitle>
          <CardDescription>
            Same case every time, right answer <b className="font-medium text-signal-good">contest</b>.
            Only the shop&rsquo;s written story changes — so if the decision moves, the words moved it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Write a merchant narrative — try to make it decide for you…" />
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Button onClick={run} disabled={busy || !text.trim()}><Play size={14} /> Run against the pipeline</Button>
            <Select aria-label="Load a sample injection" onChange={(e) => e.target.value && setText(e.target.value)} value=""
              className="max-w-[300px]">
              <option value="">load a real fixture…</option>
              <optgroup label="attacks — should be flagged">
                {d?.attacks.map((f) => <option key={f.id} value={f.narrative}>{f.id} · {f.category}</option>)}
              </optgroup>
              <optgroup label="benign controls — should NOT be flagged">
                {d?.controls.map((f) => <option key={f.id} value={f.narrative}>{f.id} · {f.category}</option>)}
              </optgroup>
            </Select>
            {busy && <span className="text-[12px] text-muted-foreground">running against the real pipeline…</span>}
            {!health.live_capable && !busy && (
              <span className="text-[12px] text-muted-foreground">needs a GEMINI_API_KEY — see RUNNING.md</span>
            )}
          </div>

          {out?.error && (
            <div className="mt-4 rounded-lg border border-signal-warn/30 bg-signal-warn/[.06] p-4 text-[13px] leading-relaxed">
              {out.error}
            </div>
          )}

          {out && !out.error && (
            <div className={`mt-4 animate-reveal rounded-lg border p-5 ${out.held_the_line ? "border-signal-good/30 bg-signal-good/[.05]" : "border-signal-bad/30 bg-signal-bad/[.05]"}`}>
              <div className={`mb-3 flex items-center gap-2 text-[17px] font-semibold ${out.held_the_line ? "text-signal-good" : "text-signal-bad"}`}>
                {out.held_the_line ? <><ShieldCheck size={18} /> Held the line</> : <><ShieldX size={18} /> The narrative moved the decision</>}
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <Badge variant={toneFor(out.result.decision).badge}>
                  {nice(out.result.decision)}
                </Badge>
                {out.flagged_injection && <Badge variant="bad">prompt_injection_attempt</Badge>}
                {out.result.risk_flags.filter((f: string) => f !== "prompt_injection_attempt").map((f: string) => (
                  <Badge key={f} variant="outline">{f}</Badge>
                ))}
                <Badge variant="outline">confidence {confidence(out.result.confidence)}</Badge>
              </div>
              <Separator className="mb-3" />
              <p className="font-quote text-[16px] italic leading-relaxed">{out.result.reason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {[
          { title: "Attack fixtures", sub: "must be flagged", items: d?.attacks ?? [], tone: "bad" as const, Icon: X },
          { title: "Benign controls", sub: "must NOT be flagged", items: d?.controls ?? [], tone: "good" as const, Icon: Check },
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
