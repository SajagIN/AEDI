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
