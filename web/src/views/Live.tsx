import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import MerchantIntelPanel from "@/components/merchant-intel-panel";
import Stepper, { Step } from "@/components/reactbits/stepper";
import { confidence, toneFor } from "@/lib/decision";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  rzpStatus, rzpReference, rzpPayments, rzpDisputes, rzpEvents, rzpOrder,
  rzpConfirm, rzpChargeback, rzpDecide, paise, clock, nice, inr,
  type RzpStatus, type RzpReference, type RzpPayment, type RzpDispute,
  type RzpEvent, type RzpDecision, type RzpFailure,
} from "@/lib/api";
import {
  AlertTriangle, CheckCircle2, CircleDot, CreditCard, Gavel, Link2, Loader2,
  Radio, ShieldAlert, Sparkles, Wifi, WifiOff,
} from "lucide-react";

declare global { interface Window { Razorpay?: any } }

/* Checkout.js is loaded on demand — a console running purely in REPLAY mode
   should not be pulling a third-party script it will never use. */
function loadCheckout(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

const STEP_LABELS = ["Payment", "Chargeback", "AEDI decides", "Respond"];

function OriginBadge({ origin }: { origin: string }) {
  return origin === "razorpay"
    ? <Badge variant="good"><Link2 size={10} />live from Razorpay</Badge>
    : <Badge variant="warn"><CircleDot size={10} />raised in console</Badge>;
}

export default function Live() {
  const [status, setStatus] = useState<RzpStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [ref, setRef] = useState<RzpReference | null>(null);
  const [events, setEvents] = useState<RzpEvent[]>([]);
  const [payments, setPayments] = useState<RzpPayment[]>([]);
  const [disputes, setDisputes] = useState<RzpDispute[]>([]);

  const [amount, setAmount] = useState(5000);
  const [merchant, setMerchant] = useState("mch_015");
  const [reason, setReason] = useState("13.1");
  const [evidence, setEvidence] = useState<string[]>(["proof_of_delivery", "shipping_carrier_record"]);
  const [narrative, setNarrative] = useState("Order was delivered and signed for by the customer.");

  const [payment, setPayment] = useState<RzpPayment | null>(null);
  const [dispute, setDispute] = useState<RzpDispute | null>(null);
  const [decision, setDecision] = useState<RzpDecision | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conn, setConn] = useState<RzpFailure | null>(null);

  const lastEventId = useRef(0);
  const connected = status?.state === "configured";

  /* Probe on mount. Previously the card said "configured" — meaning only that
     .env had values — while every call was failing, which made a dead
     connection look healthy until something was clicked. */
  useEffect(() => {
    rzpStatus(true).then(setStatus);
    rzpReference().then(setRef).catch(() => {});
  }, []);

  /* Poll the event feed. Polling rather than SSE on purpose: it survives
     proxies that buffer streamed responses, which is most of them. */
  useEffect(() => {
    if (!connected) return;
    const tick = async () => {
      try {
        const { events: fresh } = await rzpEvents(lastEventId.current);
        if (fresh.length) {
          lastEventId.current = fresh[fresh.length - 1].id;
          setEvents((prev) => [...prev, ...fresh].slice(-60));
        }
      } catch { /* the feed is cosmetic; never break the page over it */ }
    };
    tick();
    const h = setInterval(tick, 2000);
    return () => clearInterval(h);
  }, [connected]);

  const refreshLists = () => {
    rzpPayments()
      .then((r) => {
        setPayments(r.payments || []);
        setConn(r.error ? (r as RzpFailure) : null);
      })
      .catch(() => setConn({ error: "Could not reach the console's own API.", status: null, code: null }));
    rzpDisputes()
      .then((r) => { setDisputes(r.disputes || []); if (r.fetch_error) setConn(r.fetch_error); })
      .catch(() => {});
  };
  useEffect(() => { if (connected) refreshLists(); }, [connected]);

  const probe = async () => {
    setProbing(true);
    setStatus(await rzpStatus(true));
    setProbing(false);
  };

  const required = useMemo(
    () => ref?.reason_codes.find((r) => r.reason_code === reason)?.required_evidence_types ?? [],
    [ref, reason],
  );
  const missing = required.filter((t) => !evidence.includes(t));
  const step = decision ? 3 : dispute ? 2 : payment ? 1 : 0;

  /* The stage the reader is looking at, which is normally the stage the
     workflow is on. Kept separate so a completed stage can be re-opened —
     the trace is worth going back to once the verdict has landed. */
  const [viewStep, setViewStep] = useState(0);
  const flowRef = useRef<HTMLDivElement>(null);
  const lastAuto = useRef(0);

  /* When Razorpay moves the workflow on, the left column changes under a
     reader who may be watching the event feed on the right. Follow it. Only
     on an automatic advance — scrolling someone who just clicked back to
     re-read stage 2 would be taking the page away from them. */
  useEffect(() => {
    setViewStep(step);
    if (lastAuto.current === step) return;
    lastAuto.current = step;
    const el = flowRef.current;
    if (!el || step === 0) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    /* Offset clears the sticky masthead and its tab row, which scrollIntoView
       has no way to know about. */
    const y = el.getBoundingClientRect().top + window.scrollY - 128;
    window.scrollTo({ top: Math.max(0, y), behavior: reduced ? "auto" : "smooth" });
  }, [step]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e: any) { setErr(String(e?.message || e)); }
    setBusy(null);
  };

  const pay = () => run("pay", async () => {
    const ok = await loadCheckout();
    if (!ok) throw new Error("Could not load Razorpay Checkout — check the browser's network access.");
    const { order, key_id, error } = await rzpOrder(amount, merchant);
    if (error) throw new Error(error);

    const rz = new window.Razorpay({
      key: key_id,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      name: "AEDI demo merchant",
      description: `Test payment · ${merchant}`,
      handler: async (resp: any) => {
        const confirmed = await rzpConfirm(resp.razorpay_payment_id);
        if (confirmed.error) { setErr(confirmed.error); return; }
        setPayment(confirmed.payment);
        setDispute(null); setDecision(null);
        refreshLists();
      },
      modal: { ondismiss: () => setErr("Checkout closed before the payment completed.") },
      theme: { color: "#0A84FF" },
    });
    rz.on("payment.failed", (e: any) =>
      setErr(e?.error?.description || "Razorpay reported the payment failed."));
    rz.open();
  });

  const usePayment = (p: RzpPayment) => run("use", async () => {
    const confirmed = await rzpConfirm(p.id);
    if (confirmed.error) throw new Error(confirmed.error);
    setPayment(confirmed.payment); setDispute(null); setDecision(null);
  });

  const raise = () => run("raise", async () => {
    if (!payment) return;
    const r = await rzpChargeback({
      payment_id: payment.id, merchant_id: merchant, reason_code: reason,
      evidence_types: evidence, narrative,
    });
    if (r.error) throw new Error(r.error);
    setDispute(r.dispute); setDecision(null); refreshLists();
  });

  const decide = () => run("decide", async () => {
    if (!dispute) return;
    const d = await rzpDecide(dispute.dispute_id);
    if (d.error) { setErr(d.error); setDecision(null); return; }
    setDecision(d); refreshLists();
  });

  /* ── not configured ─────────────────────────────────────────────────── */
  if (status && status.state !== "configured") {
    return (
      <div className="space-y-5">
        <Card className="border-signal-warn/30 bg-signal-warn/[.04] animate-reveal">
          <CardHeader>
            <div className="flex items-center gap-2">
              <WifiOff size={16} className="text-signal-warn" />
              <CardTitle>Razorpay not connected</CardTitle>
            </div>
            <CardDescription>{status.detail}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px] leading-relaxed">
            <p className="text-muted-foreground">
              Add test-mode keys to <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">.env</code>{" "}
              and restart. Dashboard &rarr; Settings &rarr; API Keys, with the toggle on Test.
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 font-mono text-[12px] leading-relaxed text-foreground/85">
{`RAZORPAY_KEY_ID=rzp_test_your_key_id_here
RAZORPAY_KEY_SECRET=your_key_here
# optional — lets real disputes arrive by webhook
RAZORPAY_WEBHOOK_SECRET=your_key_here`}
            </pre>
            <div className="rounded-lg border border-signal-bad/25 bg-signal-bad/[.05] p-4">
              <div className="mb-1 flex items-center gap-2 font-medium text-signal-bad">
                <ShieldAlert size={14} /> Live keys are refused
              </div>
              <p className="text-muted-foreground">
                Accepting a dispute is irreversible and moves real money, so{" "}
                <code className="font-mono">rzp_live_</code> is rejected at startup.
              </p>
            </div>
            <Button variant="secondary" onClick={() => rzpStatus().then(setStatus)}>
              Re-check configuration
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ── connected ──────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">
      {/* connection */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <div className="flex items-center gap-2">
            <Wifi size={15} className="text-signal-good" />
            <span className="text-[14px] font-semibold">Razorpay test mode</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">{status?.key_id_masked}</Badge>
            {status?.webhook_secret_set
              ? <Badge variant="good">webhook secret set</Badge>
              : <Badge variant="outline">no webhook secret</Badge>}
            {status?.reachable === true && <Badge variant="good"><CheckCircle2 size={10} />credentials accepted</Badge>}
            {status?.reachable === false && <Badge variant="bad">{status.reach_detail}</Badge>}
            {status?.real_disputes != null && (
              <Badge variant={status.real_disputes ? "good" : "outline"}>
                {status.real_disputes} real dispute{status.real_disputes === 1 ? "" : "s"} on account
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Said once, here, before anything is clicked.
          This used to be three separate lines that appeared after the fact —
          a badge, a paragraph under the request, and a second paragraph under
          that — all circling the same constraint. Volunteering it up front is
          also the better demo: the limitation is the API's, and saying so
          first reads as candour rather than as an excuse afterwards. */}
      <div className="flex gap-3 rounded-lg border border-signal-warn/25 bg-signal-warn/[.05] px-4 py-3">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-signal-warn" />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <b className="font-medium text-foreground">Razorpay has no create-dispute endpoint</b>, in test
          mode or in production — a chargeback can only arrive from a real issuing bank. Disputes raised
          here are therefore local, and AEDI&rsquo;s response to those is composed and shown in full but
          never transmitted. Against one of the{" "}
          <span className="font-mono text-foreground">{status?.real_disputes ?? 0}</span> real disputes on
          this account, that same request goes out.
        </p>
      </div>

      {/* A failing connection has to be loud. The keys being present in .env
          says nothing about whether Razorpay accepts them. */}
      {(conn || status?.reachable === false) && (
        <Card className="animate-reveal border-signal-bad/35 bg-signal-bad/[.05]">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <WifiOff size={16} className="mt-0.5 shrink-0 text-signal-bad" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-signal-bad">
                  {conn?.cause || status?.cause || "Razorpay calls are failing"}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed">
                  {conn?.fix || status?.fix ||
                    "The credentials are present in .env, but Razorpay is not accepting the calls."}
                </p>
                <p className="mt-2 font-mono text-[11.5px] text-muted-foreground">
                  {conn?.status || status?.reachable === false ? `HTTP ${conn?.status ?? "?"} · ` : ""}
                  {conn?.error || status?.reach_detail}
                </p>
                <p className="mt-3 text-[12px] text-muted-foreground">
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">python scripts/razorpay_doctor.py</code>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {err && (
        <div className="animate-reveal rounded-lg border border-signal-bad/30 bg-signal-bad/[.05] p-4 text-[13px] text-signal-bad">
          {err}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <Stepper ref={flowRef} steps={STEP_LABELS} currentStep={viewStep} reached={step} onStepChange={setViewStep}>
          <Step>
          {/* 1 — payment */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-signal-info" />
                <CardTitle>Take a real test payment</CardTitle>
              </div>
              <CardDescription>
                Test card <code className="font-mono text-foreground">4111 1111 1111 1111</code>, any future
                expiry &middot; or UPI <code className="font-mono text-foreground">success@razorpay</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-[13px]">
                  <div className="mb-1.5 font-medium text-muted-foreground">Amount (INR)</div>
                  <Input type="number" min={1} value={amount} className="w-36 tnum"
                    onChange={(e) => setAmount(Math.max(1, +e.target.value || 0))} />
                </label>
                <label className="text-[13px]">
                  <div className="mb-1.5 font-medium text-muted-foreground">Merchant</div>
                  <Select value={merchant} onChange={(e) => setMerchant(e.target.value)}>
                    {ref?.merchants.map((m) => (
                      <option key={m.merchant_id} value={m.merchant_id}>
                        {m.merchant_id}{m.repeat_pattern ? " · repeat-dispute pattern" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button onClick={pay} disabled={busy === "pay"}>
                  {busy === "pay" ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                  Pay {inr(amount)}
                </Button>
              </div>

              {payment && (
                <div className="mt-4 animate-reveal rounded-lg border border-signal-good/25 bg-signal-good/[.05] p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <CheckCircle2 size={15} className="text-signal-good" />
                    <span className="font-mono text-[13px] font-medium">{payment.id}</span>
                    <OriginBadge origin="razorpay" />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span><b className="font-medium text-foreground tnum">{paise(payment.amount)}</b> {payment.currency}</span>
                    <span>method <b className="font-medium text-foreground">{payment.method}</b></span>
                    <span>status <b className="font-medium text-foreground">{payment.status}</b></span>
                  </div>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    Re-fetched server-side.
                  </p>
                </div>
              )}

              {!payment && payments.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-[12px] font-medium uppercase tracking-[.06em] text-muted-foreground">
                    or reuse a payment already on the account
                  </div>
                  <div className="max-h-40 space-y-1.5 overflow-y-auto">
                    {payments.slice(0, 8).map((p) => (
                      <button key={p.id} onClick={() => usePayment(p)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-secondary">
                        <span className="font-mono text-[11.5px]">{p.id}</span>
                        <span className="tnum">{paise(p.amount)}</span>
                        <span className="text-muted-foreground">{p.method}</span>
                        <span className="ml-auto text-muted-foreground">{p.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          </Step>

          <Step>
          {/* 2 — chargeback */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Gavel size={16} className="text-signal-warn" />
                <CardTitle>The bank raises a chargeback</CardTitle>
                <Badge variant="warn">stood in for</Badge>
              </div>
              <CardDescription>
                Normally a <code className="font-mono">payment.dispute.created</code> webhook. Composed here &mdash;
                the API cannot create one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block text-[13px]">
                <div className="mb-1.5 font-medium text-muted-foreground">Network reason code</div>
                <Select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full max-w-xl">
                  {ref?.reason_codes.map((r) => (
                    <option key={r.reason_code} value={r.reason_code}>
                      {r.reason_code} · {r.network} — {r.description}
                    </option>
                  ))}
                </Select>
              </label>

              <div>
                <div className="mb-2 text-[13px] font-medium text-muted-foreground">
                  Evidence on file
                  {required.length > 0 && (
                    <span className="ml-2 text-[11.5px] font-normal">
                      this code requires {required.join(" + ")}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(ref?.evidence_catalog ?? {}).map((t) => {
                    const on = evidence.includes(t);
                    const req = required.includes(t);
                    return (
                      <button key={t}
                        onClick={() => setEvidence((cur) => on ? cur.filter((x) => x !== t) : [...cur, t])}
                        aria-pressed={on}
                        className={`rounded-full px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[.09em] transition-[box-shadow,color]
                          ${on ? "nm-inset text-signal-info"
                               : req ? "nm-raised-sm text-signal-bad"
                               : "nm-raised-sm text-muted-foreground hover:text-foreground"}`}>
                        {t}{req && !on ? " · required" : ""}
                      </button>
                    );
                  })}
                </div>
                {missing.length > 0 && (
                  <p className="mt-2 text-[12px] text-signal-bad">
                    Missing {missing.join(", ")} — expect{" "}
                    <span className="font-mono">evidence_incomplete_for_reason_code</span>.
                  </p>
                )}
              </div>

              <label className="block text-[13px]">
                <div className="mb-1.5 font-medium text-muted-foreground">
                  Merchant narrative <span className="text-[11px] uppercase tracking-wide opacity-60">untrusted input</span>
                </div>
                <Textarea rows={2} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
              </label>

              <Button variant="secondary" onClick={raise} disabled={busy === "raise" || !payment}>
                {busy === "raise" ? <Loader2 size={14} className="animate-spin" /> : <Gavel size={14} />}
                Raise chargeback on {payment?.id?.slice(0, 12) ?? "payment"}…
              </Button>

              {dispute && (
                <div className="animate-reveal rounded-lg border border-signal-warn/25 bg-signal-warn/[.05] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-medium">{dispute.dispute_id}</span>
                    <OriginBadge origin={dispute.origin} />
                    <Badge variant="outline">reason {dispute.network_reason_code}</Badge>
                    <Badge variant="outline" className="tnum">{paise(dispute.amount_paise)}</Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          </Step>

          <Step>
          {/* 3 — decide */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-signal-alt" />
                <CardTitle>AEDI decides</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Button onClick={decide} disabled={busy === "decide" || !dispute}>
                {busy === "decide" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Run the pipeline
              </Button>

              {decision?.fallback && (
                <div className="mt-4 rounded-lg border border-signal-bad/35 bg-signal-bad/[.07] p-4">
                  <div className="mb-1.5 flex items-center gap-2 font-display text-[17px] text-signal-bad">
                    <AlertTriangle size={15} /> The model never answered
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    Safe fallback, not a judgement. Nothing was sent. Check the server log for{" "}
                    <b className="font-mono text-[11.5px] text-foreground">OTPM</b> or{" "}
                    <b className="font-mono text-[11.5px] text-foreground">tool_use_failed</b>.
                  </p>
                </div>
              )}

              {decision && (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    {decision.trace.map((t, i) => (
                      <div key={i} className="animate-reveal-x flex gap-3 rounded-lg border border-border bg-secondary/40 px-3.5 py-2.5"
                        style={{ animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}>
                        <Badge variant={t.kind === "deterministic" ? "info" : t.kind === "model" ? "alt"
                          : t.kind === "blocked" ? "warn" : "outline"} className="h-fit shrink-0">
                          {t.kind}
                        </Badge>
                        <div className="min-w-0">
                          <div className="font-mono text-[11.5px] font-medium">{t.step}</div>
                          <div className="text-[12px] leading-relaxed text-muted-foreground">{t.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          </Step>

          <Step>
          {/* 4 — the loop closing */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Gavel size={16} className="text-signal-good" />
                <CardTitle>Respond to Razorpay</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {decision && (
                <div className="space-y-3">
                  <div className={`animate-reveal rounded-lg border p-5 ${toneFor(decision.result.decision).panel}`}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-[19px] font-semibold">{nice(decision.result.decision)}</span>
                      <Badge variant="outline">confidence {confidence(decision.result.confidence)}</Badge>
                      {decision.result.risk_flags.map((f) => <Badge key={f} variant="bad">{f}</Badge>)}
                    </div>
                    <p className="font-quote text-[16px] italic leading-relaxed">{decision.result.reason}</p>
                  </div>

                  <div className="rounded-lg border border-border bg-secondary/40 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      <Gavel size={14} /> What goes on the wire
                      {decision.actionable
                        ? <Badge variant="good">transmitted</Badge>
                        : <Badge variant="warn">not transmitted</Badge>}
                    </div>
                    {decision.razorpay_request.path ? (
                      <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 font-mono text-[11.5px] leading-relaxed text-foreground/85">
{`${decision.razorpay_request.method} ${decision.razorpay_request.path}
${JSON.stringify(decision.razorpay_request.body ?? {}, null, 2)}`}
                      </pre>
                    ) : (
                      <p className="text-[12.5px] text-muted-foreground">
                        Routed to a human &mdash; nothing to send. This is the coverage gap.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          </Step>
        </Stepper>

        {/* live feed */}
        <div className="space-y-5">
          <Card className="lg:sticky lg:top-24">
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-good opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-signal-good" />
                </span>
                <CardTitle>Live activity</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="max-h-[520px] overflow-y-auto" role="log" aria-live="polite" aria-relevant="additions">
              {events.length === 0 && (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  Nothing yet. Take a test payment to start the flow.
                </p>
              )}
              <div className="space-y-1.5">
                {[...events].reverse().map((e) => (
                  <div key={e.id} className="nm-raised-sm animate-reveal-x rounded-lg px-3 py-2">
                    <div className="mb-0.5 flex items-center gap-2">
                      <Badge variant={e.origin === "razorpay" ? "good" : e.origin === "aedi" ? "alt" : "warn"}>
                        {e.kind}
                      </Badge>
                      <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{clock(e.at)}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{e.message}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {disputes.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Disputes in this session</CardTitle></CardHeader>
              <CardContent>
                {disputes.map((d, i) => (
                  <div key={d.dispute_id}>
                    <div className="py-2.5">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11.5px]">{d.dispute_id}</span>
                        <OriginBadge origin={d.origin} />
                      </div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {d.payment_id} · <span className="tnum">{paise(d.amount_paise)}</span> · {d.status}
                      </div>
                    </div>
                    {i < disputes.length - 1 && <Separator />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Early warning, alongside the live flow. Deliberately its own
              panel rather than a field on the decision: this signal informs
              a person, it does not feed the pipeline. */}
          <MerchantIntelPanel />
        </div>
      </div>
    </div>
  );
}
