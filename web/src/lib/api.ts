
export type Health = {
  mode: "live" | "replay";
  live_capable: boolean;
  model: string;
  cache_entries: number;
  splits: Record<string, { cases: number; has_predictions: boolean; scored: number; complete: boolean }>;
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
  fallback?: boolean;
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
  n_cases?: number; n_scored?: number; complete?: boolean;
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

export const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
export const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
export const nice = (s?: string | null) => String(s ?? "").replace(/_/g, " ");
export const num = (v: string | number) => Number(v).toLocaleString("en-IN");

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
  fallback?: boolean;
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

export type IntelResult = {
  title: string; link: string; domain: string; snippet: string;
  on_complaint_site: boolean; matched_terms: string[];
};
export type MerchantIntel = {
  merchant_name: string; query: string;
  signal: "clear" | "some" | "elevated";
  n_complaint_results: number; n_other_results: number;
  results: IntelResult[]; cached: boolean;
  escalate_only: boolean; advisory: string;
  error?: string; configured?: boolean;
};
export const merchantIntelStatus = () =>
  j("/api/merchant-intel/status") as Promise<{ configured: boolean; provider: string; escalate_only: boolean }>;
export const merchantIntel = (merchant_name: string) =>
  post("/api/merchant-intel", { merchant_name }) as Promise<MerchantIntel>;
