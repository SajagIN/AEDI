import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { merchantIntel, merchantIntelStatus, type MerchantIntel } from "@/lib/api";
import { Search, ExternalLink, ShieldQuestion } from "lucide-react";

/*  Merchant intel panel
 *
 *  Reads consumer complaints off the open web as a LEADING indicator of
 *  merchant risk. Every internal signal — chargeback_rate_90d,
 *  prior_contest_win_rate — is a consequence, and only names a bad merchant
 *  after ninety days of damage. Complaints show up weeks earlier.
 *
 *  Two things this deliberately does not do, both visible on screen:
 *  it never renders a verdict about a business, only counts and links; and
 *  it is labelled escalate-only, because the signal is unverifiable and
 *  gameable and so may buy a case human attention and nothing else.
 */

const TONE = {
  elevated: { v: "warn" as const, label: "Elevated", text: "text-signal-warn",
              note: "Enough complaint-shaped results to be worth a human's eye." },
  some:     { v: "info" as const, label: "Some signal", text: "text-signal-info",
              note: "A few results. Read them before drawing anything from it." },
  clear:    { v: "good" as const, label: "Nothing found", text: "text-signal-good",
              note: "No complaint-shaped results. Absence of evidence, not evidence of absence." },
};

export default function MerchantIntelPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<MerchantIntel | null>(null);

  useEffect(() => { merchantIntelStatus().then((s) => setConfigured(s.configured)).catch(() => setConfigured(false)); }, []);

  const run = async () => {
    if (!name.trim()) return;
    setBusy(true); setOut(null);
    try { setOut(await merchantIntel(name.trim())); }
    finally { setBusy(false); }
  };

  const tone = out && !out.error ? TONE[out.signal] : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldQuestion size={16} className="text-signal-alt" />
          <CardTitle>Merchant intel</CardTitle>
          <Badge variant="alt">escalate only</Badge>
          {configured === false && <Badge variant="outline">no SERPAPI_KEY</Badge>}
        </div>
        <CardDescription>
          Public complaints, as an early warning. Your own chargeback data only names a bad
          merchant after ninety days.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2.5">
          <Input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Registered business name…" className="w-[300px]" />
          <Button onClick={run} disabled={busy || !name.trim()}>
            <Search size={14} /> {busy ? "Searching…" : "Check"}
          </Button>
        </div>

        {busy && <div className="space-y-2"><Skeleton className="h-8 w-52" /><Skeleton className="h-4 w-full" /></div>}

        {out?.error && (
          <div className="rounded-lg border border-signal-warn/30 bg-signal-warn/[.06] p-4 text-[12.5px] leading-relaxed">
            {out.error}
          </div>
        )}

        {out && !out.error && tone && (
          <div className="animate-reveal space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`font-display text-[30px] leading-none ${tone.text}`}>{tone.label}</span>
              <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
                {out.n_complaint_results} complaint-shaped · {out.n_other_results} other
              </span>
              {out.cached && <Badge variant="outline">cached</Badge>}
            </div>
            <p className="text-[12.5px] text-muted-foreground">{tone.note}</p>

            {out.results.length > 0 && (
              <ul className="divide-y divide-border/70 border-y border-border/70">
                {out.results.map((r, i) => (
                  <li key={i} className="py-2.5">
                    <a href={r.link} target="_blank" rel="noreferrer noopener"
                      className="group flex items-start gap-2 text-[13px] text-foreground hover:text-cobalt">
                      <ExternalLink size={12} className="mt-1 shrink-0 text-muted-foreground/50 group-hover:text-cobalt" />
                      <span className="min-w-0">
                        <span className="line-clamp-1">{r.title || r.link}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[10.5px] text-muted-foreground/70">{r.domain}</span>
                          {r.on_complaint_site && <Badge variant="warn">complaint site</Badge>}
                          {r.matched_terms.slice(0, 2).map((t) => (
                            <Badge key={t} variant="outline">{t}</Badge>
                          ))}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {/* Restated on screen, not just in the payload. */}
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {out.advisory}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
