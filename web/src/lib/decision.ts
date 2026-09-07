
export type DecisionTone = {
  badge: "good" | "warn" | "info";
  text: string;
  panel: string;
};

const TONES: Record<string, DecisionTone> = {
  contest: {
    badge: "good",
    text: "text-signal-good",
    panel: "border-signal-good/30 bg-signal-good/[.05]",
  },
  accept_liability: {
    badge: "warn",
    text: "text-signal-warn",
    panel: "border-signal-warn/30 bg-signal-warn/[.05]",
  },
  manual_review: {
    badge: "info",
    text: "text-signal-info",
    panel: "border-signal-info/30 bg-signal-info/[.05]",
  },
};

export function toneFor(decision: string | null | undefined): DecisionTone {
  return TONES[decision ?? ""] ?? TONES.manual_review;
}

export function confidence(value: number | null | undefined): string {
  return value == null ? "\u2014" : String(value);
}
