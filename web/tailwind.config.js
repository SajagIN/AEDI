/** @type {import('tailwindcss').Config} */

/*  AEDI console — "Ledger Noir"
 *
 *  The product reads a dispute file, weighs submitted evidence and writes a
 *  defence. So the interface is built to look like the thing it replaces: a
 *  ruled ledger page under a desk lamp, set in an editorial serif with the
 *  numbers in a monospace that keeps columns honest.
 *
 *  Two rules hold the whole palette together:
 *    · warm ink is the ground, brass is the only bright — everything that
 *      glows is money or a warning about money;
 *    · provenance has a typeface. Anything the code computed is monospace;
 *      anything the model wrote is serif italic. That distinction is the
 *      product's central claim, so it is spelled in the type, not a caption.
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Editorial serif for mastheads, hero numbers and model prose.
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans Variable"', '"IBM Plex Sans"', 'ui-sans-serif', 'sans-serif'],
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

        /* The lamp. Used for money, for the active tab, for every primary
           action — and for nothing else, so it never stops meaning "look". */
        brass: {
          DEFAULT: "#E3A43C", bright: "#F2BC5E", deep: "#B87F25", ink: "#2A1E0C",
        },

        /* Verdict colours. Named for what they mean in a dispute, not for the
           hue, so a view never has to know which colour "won" is this month. */
        signal: {
          good: "#5FC48F",   // contested and won, control not flagged
          bad: "#E4664A",    // liability accepted, attack landed
          warn: "#E3A43C",   // the disclosed gap — same brass, deliberately
          info: "#7BA5C6",   // deterministic, computed in code
          alt: "#A98FC4",    // written by the model
        },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 1px)", sm: "calc(var(--radius) - 2px)" },
      boxShadow: {
        // Panels sit on the page rather than float above it: a hairline top
        // highlight and a deep soft drop, like card stock on felt.
        panel: "inset 0 1px 0 rgba(255,240,214,.045), 0 1px 2px rgba(0,0,0,.5), 0 16px 40px -24px rgba(0,0,0,.9)",
        lamp: "0 0 0 1px rgba(227,164,60,.28), 0 8px 30px -10px rgba(227,164,60,.28)",
        inset: "inset 0 1px 2px rgba(0,0,0,.6)",
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
