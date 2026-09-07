
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['Jakarta', 'ui-sans-serif', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        action: ['Sora', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        quote: ['"Bodoni Moda"', 'Georgia', 'serif'],
        script: ['Lobster', 'cursive'],
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

        cobalt: {
          DEFAULT: "#0058B0", bright: "#0071E3", deep: "#004E9E", ink: "#FFFFFF",
        },

        signal: {
          good: "#0B6B3A",
          bad: "#B3241A",
          warn: "#7E4A00",
          info: "#1A5F90",
          alt: "#4C3DA6",
        },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 1px)", sm: "calc(var(--radius) - 2px)" },
      boxShadow: {
        panel: "0 0 0 1px rgba(16,24,40,.05), 0 1px 2px rgba(16,24,40,.05), 0 12px 32px -16px rgba(16,24,40,.16)",
        lamp: "0 0 0 1px rgba(0,113,227,.35), 0 8px 26px -10px rgba(0,113,227,.35)",
        inset: "inset 0 1px 2px rgba(16,24,40,.06)",
      },
      keyframes: {
        reveal: { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "none" } },
        "reveal-x": { from: { opacity: "0", transform: "translateX(-10px)" }, to: { opacity: "1", transform: "none" } },
        sweep: { "0%": { backgroundPosition: "-120% 0" }, "100%": { backgroundPosition: "220% 0" } },
        ember: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        rule: { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
      },
      animation: {
        reveal: "reveal .55s cubic-bezier(.16,1,.3,1) both",
        "reveal-x": "reveal-x .5s cubic-bezier(.16,1,.3,1) both",
        sweep: "sweep 1.4s cubic-bezier(.4,0,.2,1) .2s both",
        ember: "ember 1.6s ease-in-out infinite",
        rule: "rule .7s cubic-bezier(.16,1,.3,1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
