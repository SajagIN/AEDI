/* Every number rendered by this console comes from these endpoints, which are
   served by app/server.py calling the real pipeline / evaluation modules. */

export type Health = {
  mode: "live" | "replay";
  live_capable: boolean;
  model: string;
  cache_entries: number;
  splits: Record<string, { cases: number; has_predictions: boolean }>;
};

export type CaseSummary = {
  case_id: string; merchant_id: string; amount: string; currency: string;
  reason_code: string; payment_method: string; transaction_date: string;
  n_evidence: number; evidence_sufficiency: string; risk_flags: string[];
  ground_truth: string | null; prediction: string | null; agrees: boolean | null;
};

export type EvidenceItem = { evidence_id: string; type: string; description: string };

export type CaseDetail = {
  case: Record<string, string>;
  signals: {
    evidence_items: EvidenceItem[]; required_types: string[]; present_types: string[];
    missing_types: string[]; evidence_sufficiency: string;
    amount_anomaly: boolean; merchant_repeat_pattern: boolean;
    merchant: Record<string, string>;
  };
  reason_requirement: Record<string, string>;
  ground_truth: string | null;
};

export type AnalyzeResult = {
  source: string;
  result: { decision: string; evidence_sufficiency: string; risk_flags: string[]; reason: string; confidence: number | null; cited_evidence_ids: string };
  cited_evidence_ids: string[];
  trace: { step: string; kind: string; detail: string }[];
  ground_truth: string | null; agrees: boolean | null;
  error?: string;
};

export type Block = {
  name: string; n: number;
  matrix: Record<string, Record<string, number>>;
  precision_recall: Record<string, { precision: number | null; recall: number | null }>;
  coverage: number;
  cost: {
    cost_per_100_inr: number; total_cost_inr: number; n_false_positive: number;
    n_false_negative: number; n_manual_review: number; n_bypassed_review: number;
    bypassed_review_exposure_per_100_inr: number;
  };
};

export type Metrics = {
  split: string; available: boolean; message?: string;
  decision_values: string[];
  cost_model: { false_positive_inr: number; manual_review_inr: number; bypassed_exposure_rate: number };
  blocks: Block[];
};

export type Fixture = { id: string; kind: string; category: string; narrative: string };
export type Adversarial = {
  attacks: Fixture[]; controls: Fixture[];
  summary: { n_attacks: number; n_controls: number; defense_rate: number; control_false_positive_rate: number; note: string };
};

const j = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init);
  return r.json();
};

export const getHealth = () => j("/api/health") as Promise<Health>;
export const getCases = (split: string) => j(`/api/cases?split=${split}`) as Promise<{ cases: CaseSummary[] }>;
export const getCase = (split: string, id: string) => j(`/api/case/${split}/${id}`) as Promise<CaseDetail>;
export const getMetrics = (split: string) => j(`/api/metrics?split=${split}`) as Promise<Metrics>;
export const getAdversarial = () => j("/api/adversarial") as Promise<Adversarial>;

export const analyze = (split: string, case_id: string, mode: string) =>
  j("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ split, case_id, mode }) }) as Promise<AnalyzeResult>;

export const injectionTest = (narrative: string) =>
  j("/api/injection-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrative }) }) as Promise<any>;

/* formatting */
export const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
export const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
export const nice = (s?: string | null) => String(s ?? "").replace(/_/g, " ");
export const num = (v: string | number) => Number(v).toLocaleString("en-IN");

export const decisionTone = (d?: string | null) =>
  d === "contest" ? "green" : d === "accept_liability" ? "orange" : d === "manual_review" ? "blue" : "default";

/* ── Razorpay test-mode bridge ──────────────────────────────────────────
   Objects carry an `origin`: "razorpay" means fetched from the Razorpay API,
   "local" means constructed by the console because Razorpay has no
   dispute-create endpoint. The UI must never render the two identically. */

export type RzpStatus = {
  state: "unconfigured" | "incomplete" | "refused" | "unknown_key" | "configured";
  detail: string;
  key_id_masked: string | null;
  api_base: string;
  webhook_secret_set: boolean;
  reachable: boolean | null;
  reach_detail: string | null;
  real_disputes: number | null;
  cause?: string;
  fix?: string;
};

/* Every Razorpay failure comes back shaped like this — `cause` and `fix` are
   plain-language, so the UI never has to render a bare 502 at the user. */
export type RzpFailure = {
  error: string; status: number | null; code: string | null;
  cause?: string; fix?: string;
};

export type RzpMerchant = {
  merchant_id: string; chargeback_rate_90d: string;
  prior_contest_win_rate: string; history_flags: string; repeat_pattern: boolean;
};
export type RzpReason = {
  reason_code: string; network: string; description: string; required_evidence_types: string[];
};
export type RzpReference = {
  merchants: RzpMerchant[]; reason_codes: RzpReason[]; evidence_catalog: Record<string, string>;
};

export type RzpPayment = {
  id: string; amount: number; currency: string; status: string;
  method: string; order_id: string; created_at: number; description?: string;
};

export type RzpDispute = {
  origin: "razorpay" | "local";
  dispute_id: string; payment_id: string; amount_paise: number; currency: string;
  status: string; phase: string; razorpay_reason_code: string;
  reason_description: string; respond_by: number; created_at: number;
  actionable: boolean; network_reason_code?: string; case?: Record<string, string>;
};

export type RzpEvent = {
  id: number; at: number; kind: string; message: string;
  origin?: string; decision?: string;
};

export type RzpDecision = {
  dispute_id: string;
  result: AnalyzeResult["result"];
  deterministic_flags: string[];
  signals: CaseDetail["signals"];
  trace: { step: string; kind: string; detail: string }[];
  actionable: boolean;
  razorpay_request: { method: string | null; path: string | null; body: any };
  error?: string;
};

const post = (url: string, body: unknown) =>
  j(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const rzpStatus = (probe = false) =>
  j(`/api/rzp/status${probe ? "?probe=1" : ""}`) as Promise<RzpStatus>;
export const rzpReference = () => j("/api/rzp/reference") as Promise<RzpReference>;
export const rzpPayments = () =>
  j("/api/rzp/payments") as Promise<{ payments: RzpPayment[] } & Partial<RzpFailure>>;
export const rzpDisputes = () =>
  j("/api/rzp/disputes") as Promise<{
    disputes: RzpDispute[]; decisions: Record<string, any>; note: string;
    fetch_error: RzpFailure | null;
  }>;
export const rzpEvents = (after: number) =>
  j(`/api/rzp/events?after=${after}`) as Promise<{ events: RzpEvent[] }>;

export const rzpOrder = (amount_inr: number, merchant_id: string) =>
  post("/api/rzp/order", { amount_inr, merchant_id }) as Promise<any>;
export const rzpConfirm = (payment_id: string) =>
  post("/api/rzp/confirm", { payment_id }) as Promise<any>;
export const rzpChargeback = (b: {
  payment_id: string; merchant_id: string; reason_code: string;
  evidence_types: string[]; narrative: string;
}) => post("/api/rzp/chargeback", b) as Promise<any>;
export const rzpDecide = (dispute_id: string) =>
  post("/api/rzp/decide", { dispute_id }) as Promise<RzpDecision>;
export const rzpSubmit = (dispute_id: string, payload?: unknown) =>
  post("/api/rzp/submit", { dispute_id, payload }) as Promise<any>;

export const paise = (v: number) => inr((v || 0) / 100);
export const clock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("en-IN", { hour12: false });
