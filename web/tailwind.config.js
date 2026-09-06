/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','"SF Pro Text"','"SF Pro Display"','"Segoe UI"','Inter','system-ui','sans-serif'],
        mono: ['"SF Mono"','ui-monospace','SFMono-Regular','Menlo','Consolas','monospace'],
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
        ios: {
          blue: "#007AFF", green: "#34C759", red: "#FF3B30", orange: "#FF9500",
          purple: "#AF52DE", teal: "#5AC8FA", gray: "#8E8E93",
        },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 4px)", sm: "calc(var(--radius) - 8px)" },
      boxShadow: {
        ios: "0 1px 2px rgba(16,24,40,.04), 0 4px 16px -4px rgba(16,24,40,.08)",
        "ios-lg": "0 2px 4px rgba(16,24,40,.04), 0 12px 32px -8px rgba(16,24,40,.12)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "slide-in": { from: { opacity: "0", transform: "translateX(-8px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { "fade-up": "fade-up .45s cubic-bezier(.22,1,.36,1) both", "slide-in": "slide-in .4s cubic-bezier(.22,1,.36,1) both" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
