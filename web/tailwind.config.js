/** @type {import('tailwindcss').Config} */

/*  AEDI console — "Aluminium"
 *
 *  White surfaces, graphite text, one blue. The product decides who keeps the
 *  money in a payment dispute, so the interface is built like hardware: cool
 *  neutral ground, generous radii, shadow instead of outline, and colour
 *  rationed hard enough that it still means something when it appears.
 *
 *  Three rules hold the palette together:
 *    · white is the ground, cobalt is the only bright — everything saturated
 *      is money, or a warning about money;
 *    · provenance has a typeface. Anything the code computed is monospace;
 *      anything the model wrote is serif italic. That distinction is the
 *      product's central claim, so it is spelled in the type, not a caption;
 *    · type tightens as it grows. Tracking is negative everywhere and most
 *      negative on the hero, which is most of why large type reads premium.
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Manrope for mastheads and hero numbers: geometric, near-uniform
        // figure widths, and it holds an edge when set tight and heavy.
        display: ['"Manrope Variable"', 'Manrope', 'ui-sans-serif', 'sans-serif'],
        sans: ['"Manrope Variable"', 'Manrope', 'ui-sans-serif', 'sans-serif'],
        // Kept for one job only: model-authored prose is serif italic.
        quote: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))", input: "hsl(var(--input))", ring: "hsl(var(--ring))",
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },

        /* The one bright. Used for money, the active tab and every primary
           action — and nothing else, so it never stops meaning "look". */
        cobalt: {
          // DEFAULT is the text cut (4.9:1 on white). `bright` is the fill and
          // hover cut — legible as a background, too light to set type in.
          DEFAULT: "#0066CC", bright: "#0071E3", deep: "#004E9E", ink: "#FFFFFF",
        },

        /* Verdict colours. Named for what they mean in a dispute, not for the
           hue, so a view never has to know which colour "won" is this month. */
        /* Re-cut for white. The dark theme's verdict colours were chosen to
           glow on near-black; at those luminances they are unreadable here,
           so each has been darkened to clear 4.5:1 on paper while keeping
           its hue relationship to the others. */
        signal: {
          good: "#0F7B43",   // contested and won, control not flagged
          bad: "#C62A1B",    // liability accepted, attack landed
          warn: "#9A5B00",   // the disclosed gap
          info: "#1F6FA8",   // deterministic, computed in code
          alt: "#5B4BB8",    // written by the model
        },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 1px)", sm: "calc(var(--radius) - 2px)" },
      boxShadow: {
        // On white a panel cannot be found by its border without the border
        // becoming the loudest thing on screen. So: a hairline tint, a tight
        // contact shadow, and a wide soft one for the lift off the page.
        panel: "0 0 0 1px rgba(16,24,40,.05), 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -16px rgba(16,24,40,.16)",
        lamp: "0 0 0 1px rgba(0,113,227,.35), 0 8px 26px -10px rgba(0,113,227,.35)",
        inset: "inset 0 1px 2px rgba(16,24,40,.06)",
      },
      keyframes: {
        // One orchestrated page load: everything rises through the same easing,
        // staggered by --i.
        reveal: { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "none" } },
        "reveal-x": { from: { opacity: "0", transform: "translateX(-10px)" }, to: { opacity: "1", transform: "none" } },
        // A brass highlight travelling once across a fresh number.
        sweep: { "0%": { backgroundPosition: "-120% 0" }, "100%": { backgroundPosition: "220% 0" } },
        // The lamp breathing, for anything actively working.
        ember: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        // A hairline rule drawing itself in.
        rule: { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
        // Radix reports the measured height on the content element.
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        reveal: "reveal .55s cubic-bezier(.16,1,.3,1) both",
        "reveal-x": "reveal-x .5s cubic-bezier(.16,1,.3,1) both",
        sweep: "sweep 1.4s cubic-bezier(.4,0,.2,1) .2s both",
        ember: "ember 1.6s ease-in-out infinite",
        rule: "rule .7s cubic-bezier(.16,1,.3,1) both",
        "accordion-down": "accordion-down .28s cubic-bezier(.16,1,.3,1)",
        "accordion-up": "accordion-up .22s cubic-bezier(.16,1,.3,1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
