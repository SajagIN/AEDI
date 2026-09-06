import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    ? <Badge variant="green"><Link2 size={10} />live from Razorpay</Badge>
    : <Badge variant="orange"><CircleDot size={10} />raised in console</Badge>;
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
        <Card className="border-ios-orange/30 bg-ios-orange/[.04] animate-fade-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <WifiOff size={16} className="text-ios-orange" />
              <CardTitle>Razorpay not connected</CardTitle>
            </div>
            <CardDescription>{status.detail}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px] leading-relaxed">
            <p className="text-muted-foreground">
              Add <b className="font-medium text-foreground">test-mode</b> credentials to{" "}
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">.env</code>{" "}
              and restart the console. Generate them from the Razorpay Dashboard with the
              Test/Live toggle set to <b className="font-medium text-foreground">Test</b> —
              Settings → API Keys.
            </p>
            <pre className="overflow-x-auto rounded-2xl bg-[#1c1c1e] p-4 font-mono text-[12px] leading-relaxed text-[#e5e5ea]">
{`RAZORPAY_KEY_ID=rzp_test_your_key_id_here
RAZORPAY_KEY_SECRET=your_key_here
# optional — lets real disputes arrive by webhook
RAZORPAY_WEBHOOK_SECRET=your_key_here`}
            </pre>
            <div className="rounded-2xl border border-ios-red/25 bg-ios-red/[.05] p-4">
              <div className="mb-1 flex items-center gap-2 font-medium text-ios-red">
                <ShieldAlert size={14} /> Live keys are refused
              </div>
              <p className="text-muted-foreground">
                This console creates orders and can submit dispute responses. Accepting a dispute
                is irreversible and moves real money, so a key beginning{" "}
                <code className="font-mono">rzp_live_</code> is rejected at startup rather than
                warned about.
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
      {/* honesty banner — deliberately the first thing on the tab */}
      <Card className="border-ios-blue/25 bg-gradient-to-br from-ios-blue/[.05] to-transparent animate-fade-up">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-ios-blue" />
            <div className="min-w-[280px] flex-1 text-[13px] leading-relaxed">
              <b className="font-semibold">What is real on this tab.</b>{" "}
              The order and the payment are genuine Razorpay test-mode objects — you can open your
              Razorpay dashboard and see them. The merchant history, reason-code rules and the
              decision all come from the real pipeline. The one thing that is{" "}
              <b className="font-medium">not</b> real is the arrival of the chargeback: Razorpay has
              no dispute-create API, because disputes are raised by the issuing bank, not the
              merchant. Chargebacks raised here are marked{" "}
              <Badge variant="orange" className="mx-0.5 align-middle">raised in console</Badge>
              and are never submitted to Razorpay. A genuine dispute — arriving by webhook or already
              on the account — is marked{" "}
              <Badge variant="green" className="mx-0.5 align-middle">live from Razorpay</Badge>
              and <i>is</i> actioned for real.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* connection */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <div className="flex items-center gap-2">
            <Wifi size={15} className="text-ios-green" />
            <span className="text-[14px] font-semibold">Razorpay test mode</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">{status?.key_id_masked}</Badge>
            {status?.webhook_secret_set
              ? <Badge variant="green">webhook secret set</Badge>
              : <Badge variant="outline">no webhook secret</Badge>}
            {status?.reachable === true && <Badge variant="green"><CheckCircle2 size={10} />credentials accepted</Badge>}
            {status?.reachable === false && <Badge variant="red">{status.reach_detail}</Badge>}
            {status?.real_disputes != null && (
              <Badge variant={status.real_disputes ? "green" : "outline"}>
                {status.real_disputes} real dispute{status.real_disputes === 1 ? "" : "s"} on account
              </Badge>
            )}
          </div>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={probe} disabled={probing}>
            {probing ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />} Test connection
          </Button>
        </CardContent>
      </Card>

      {/* stepper */}
      <div className="flex flex-wrap items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors
              ${i < step ? "border-ios-green/30 bg-ios-green/10 text-ios-green"
                : i === step ? "border-ios-blue/35 bg-ios-blue/10 text-ios-blue"
                : "border-black/[.07] bg-secondary/50 text-muted-foreground"}`}>
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold
                ${i < step ? "bg-ios-green text-white" : i === step ? "bg-ios-blue text-white" : "bg-black/10 text-muted-foreground"}`}>
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </div>
            {i < STEP_LABELS.length - 1 && <div className="h-px w-4 bg-black/10" />}
          </div>
        ))}
      </div>

      {/* A failing connection has to be loud. The keys being present in .env
          says nothing about whether Razorpay accepts them. */}
      {(conn || status?.reachable === false) && (
        <Card className="animate-fade-up border-ios-red/35 bg-ios-red/[.05]">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <WifiOff size={16} className="mt-0.5 shrink-0 text-ios-red" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ios-red">
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
                  For a full layer-by-layer check, run{" "}
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                    python scripts/razorpay_doctor.py
                  </code>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {err && (
        <div className="animate-fade-up rounded-2xl border border-ios-red/30 bg-ios-red/[.05] p-4 text-[13px] text-ios-red">
          {err}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          {/* 1 — payment */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-ios-blue" />
                <CardTitle>1 · Take a real test payment</CardTitle>
              </div>
              <CardDescription>
                Creates a genuine order, then opens Razorpay Checkout. Pay with test card{" "}
                <code className="font-mono text-foreground">4111 1111 1111 1111</code>, any future
                expiry, any CVV — or UPI id <code className="font-mono text-foreground">success@razorpay</code>.
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
                  <select value={merchant} onChange={(e) => setMerchant(e.target.value)}
                    className="h-10 rounded-xl border border-input bg-card px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                    {ref?.merchants.map((m) => (
                      <option key={m.merchant_id} value={m.merchant_id}>
                        {m.merchant_id}{m.repeat_pattern ? " · repeat-dispute pattern" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Button onClick={pay} disabled={busy === "pay"}>
                  {busy === "pay" ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                  Pay {inr(amount)}
                </Button>
              </div>

              {payment && (
                <div className="mt-4 animate-fade-up rounded-2xl border border-ios-green/25 bg-ios-green/[.05] p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <CheckCircle2 size={15} className="text-ios-green" />
                    <span className="font-mono text-[13px] font-medium">{payment.id}</span>
                    <OriginBadge origin="razorpay" />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span><b className="font-medium text-foreground tnum">{paise(payment.amount)}</b> {payment.currency}</span>
                    <span>method <b className="font-medium text-foreground">{payment.method}</b></span>
                    <span>status <b className="font-medium text-foreground">{payment.status}</b></span>
                  </div>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    Re-fetched from Razorpay server-side — the browser's word for it was not trusted.
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
                        className="flex w-full items-center gap-3 rounded-xl border border-black/[.06] bg-secondary/40 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-secondary">
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

          {/* 2 — chargeback */}
          <Card className={payment ? "" : "pointer-events-none opacity-45"}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Gavel size={16} className="text-ios-orange" />
                <CardTitle>2 · The bank raises a chargeback</CardTitle>
                <Badge variant="orange">stood in for</Badge>
              </div>
              <CardDescription>
                In production this arrives as a <code className="font-mono">payment.dispute.created</code>{" "}
                webhook. Here you compose it, because the API cannot create one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block text-[13px]">
                <div className="mb-1.5 font-medium text-muted-foreground">Network reason code</div>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="h-10 w-full max-w-xl rounded-xl border border-input bg-card px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  {ref?.reason_codes.map((r) => (
                    <option key={r.reason_code} value={r.reason_code}>
                      {r.reason_code} · {r.network} — {r.description}
                    </option>
                  ))}
                </select>
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
                        className={`rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition-colors
                          ${on ? "border-ios-blue/35 bg-ios-blue/10 text-ios-blue"
                               : req ? "border-ios-red/30 bg-ios-red/[.05] text-ios-red"
                               : "border-black/[.07] bg-secondary/50 text-muted-foreground hover:bg-secondary"}`}>
                        {t}{req && !on ? " · required" : ""}
                      </button>
                    );
                  })}
                </div>
                {missing.length > 0 && (
                  <p className="mt-2 text-[12px] text-ios-red">
                    Missing {missing.join(", ")} — the pipeline will mark this{" "}
                    <span className="font-mono">evidence_incomplete_for_reason_code</span>. Leave it
                    that way on purpose to show the deterministic guard firing.
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
                <div className="animate-fade-up rounded-2xl border border-ios-orange/25 bg-ios-orange/[.05] p-4">
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

          {/* 3 — decide */}
          <Card className={dispute ? "" : "pointer-events-none opacity-45"}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-ios-purple" />
                <CardTitle>3 · AEDI decides</CardTitle>
              </div>
              <CardDescription>
                The same bounded agent loop the batch pipeline runs, on this live case.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={decide} disabled={busy === "decide" || !dispute}>
                {busy === "decide" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Run the pipeline
              </Button>

              {decision && (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    {decision.trace.map((t, i) => (
                      <div key={i} className="animate-slide-in flex gap-3 rounded-xl border border-black/[.05] bg-secondary/40 px-3.5 py-2.5"
                        style={{ animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}>
                        <Badge variant={t.kind === "deterministic" ? "blue" : t.kind === "model" ? "purple"
                          : t.kind === "blocked" ? "orange" : "outline"} className="h-fit shrink-0">
                          {t.kind}
                        </Badge>
                        <div className="min-w-0">
                          <div className="font-mono text-[11.5px] font-medium">{t.step}</div>
                          <div className="text-[12px] leading-relaxed text-muted-foreground">{t.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={`animate-fade-up rounded-2xl border p-5
                    ${decision.result.decision === "contest" ? "border-ios-green/30 bg-ios-green/[.05]"
                      : decision.result.decision === "accept_liability" ? "border-ios-orange/30 bg-ios-orange/[.05]"
                      : "border-ios-blue/30 bg-ios-blue/[.05]"}`}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-[19px] font-semibold">{nice(decision.result.decision)}</span>
                      {decision.result.confidence != null && (
                        <Badge variant="outline">confidence {decision.result.confidence}</Badge>
                      )}
                      {decision.result.risk_flags.map((f) => <Badge key={f} variant="red">{f}</Badge>)}
                    </div>
                    <p className="text-[13px] leading-relaxed">{decision.result.reason}</p>
                  </div>

                  {/* 4 — the loop closing */}
                  <div className="rounded-2xl border border-black/[.07] bg-secondary/40 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      <Gavel size={14} /> 4 · Response to Razorpay
                      {decision.actionable
                        ? <Badge variant="green">would be issued</Badge>
                        : <Badge variant="orange">not issued — local chargeback</Badge>}
                    </div>
                    {decision.razorpay_request.path ? (
                      <pre className="overflow-x-auto rounded-xl bg-[#1c1c1e] p-4 font-mono text-[11.5px] leading-relaxed text-[#e5e5ea]">
{`${decision.razorpay_request.method} ${decision.razorpay_request.path}
${JSON.stringify(decision.razorpay_request.body ?? {}, null, 2)}`}
                      </pre>
                    ) : (
                      <p className="text-[12.5px] text-muted-foreground">
                        Routed to a human reviewer — there is no automatic response to send. That is
                        the coverage gap the Evaluation tab prices.
                      </p>
                    )}
                    {!decision.actionable && (
                      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        Razorpay has no dispute with this id, so nothing is sent. Against a real
                        dispute — one that arrived by webhook — this exact request is issued and
                        the dispute moves to <span className="font-mono">under_review</span>.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* live feed */}
        <div className="space-y-5">
          <Card className="lg:sticky lg:top-24">
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ios-green opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-ios-green" />
                </span>
                <CardTitle>Live activity</CardTitle>
              </div>
              <CardDescription>Server-side event feed, polled every 2s.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[520px] overflow-y-auto">
              {events.length === 0 && (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  Nothing yet. Take a test payment to start the flow.
                </p>
              )}
              <div className="space-y-1.5">
                {[...events].reverse().map((e) => (
                  <div key={e.id} className="animate-slide-in rounded-xl border border-black/[.05] bg-secondary/40 px-3 py-2">
                    <div className="mb-0.5 flex items-center gap-2">
                      <Badge variant={e.origin === "razorpay" ? "green" : e.origin === "aedi" ? "purple" : "orange"}>
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
        </div>
      </div>
    </div>
  );
}
