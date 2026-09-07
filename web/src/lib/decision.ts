/*  One decision, one set of colours.
 *
 *  The mapping from a decision to its colour was written out three times —
 *  a Badge variant in Adversarial, a text colour in Case Explorer, a border
 *  and tint in Live — each with its own ternary chain and its own idea of
 *  what manual_review looks like. Three places to edit and three chances to
 *  disagree. The tones live here now.
 *
 *  These are complete class strings on purpose. Tailwind scans src for
 *  literals and cannot see through interpolation, so `bg-signal-${tone}` would
 *  compile to nothing.
 */

export type DecisionTone = {
  /** Badge variant name. */
  badge: "good" | "warn" | "info";
  /** Foreground colour, for a decision set as a headline. */
  text: string;
  /** Border plus wash, for a decision set in a panel. */
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

/** Anything unrecognised is treated as a handoff, which is the safe default. */
export function toneFor(decision: string | null | undefined): DecisionTone {
  return TONES[decision ?? ""] ?? TONES.manual_review;
}

/** A missing confidence is a real state — the model can decline to give one.
 *  Adversarial printed it raw, so a null rendered as "confidence undefined";
 *  Case Explorer had its own em-dash fallback. One answer for both. */
export function confidence(value: number | null | undefined): string {
  return value == null ? "\u2014" : String(value);
}
