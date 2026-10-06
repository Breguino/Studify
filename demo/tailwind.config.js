/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg": "hsl(var(--bg) / <alpha-value>)",
        "surface": "hsl(var(--surface) / <alpha-value>)",
        "surface-2": "hsl(var(--surface-2) / <alpha-value>)",
        "text": "hsl(var(--text) / <alpha-value>)",
        "muted": {
                "DEFAULT": "hsl(var(--muted) / <alpha-value>)",
                "foreground": "hsl(var(--muted) / <alpha-value>)"
        },
        "line": "hsl(var(--line) / <alpha-value>)",
        "line-strong": "hsl(var(--line-strong) / <alpha-value>)",
        "brand": "hsl(var(--brand) / <alpha-value>)",
        "brand-ink": "hsl(var(--brand-ink) / <alpha-value>)",
        "brand-soft": "hsl(var(--brand-soft) / <alpha-value>)",
        "good": "hsl(var(--good) / <alpha-value>)",
        "good-soft": "hsl(var(--good-soft) / <alpha-value>)",
        "warn": "hsl(var(--warn) / <alpha-value>)",
        "warn-soft": "hsl(var(--warn-soft) / <alpha-value>)",
        "bad": "hsl(var(--bad) / <alpha-value>)",
        "bad-soft": "hsl(var(--bad-soft) / <alpha-value>)",
        "hero": "hsl(var(--hero) / <alpha-value>)",
        "hero-ink": "hsl(var(--hero-ink) / <alpha-value>)",
        "hero-muted": "hsl(var(--hero-muted) / <alpha-value>)",
        "hero-faint": "hsl(var(--hero-faint) / <alpha-value>)",
        "hero-learn": "hsl(var(--hero-learn) / <alpha-value>)",
        "hero-warn": "hsl(var(--hero-warn) / <alpha-value>)",
        "hero-good": "hsl(var(--hero-good) / <alpha-value>)",
        "border": "hsl(var(--line) / <alpha-value>)",
        "input": "hsl(var(--line-strong) / <alpha-value>)",
        "ring": "hsl(var(--brand) / <alpha-value>)",
        "background": "hsl(var(--bg) / <alpha-value>)",
        "foreground": "hsl(var(--text) / <alpha-value>)",
        "primary": {
                "DEFAULT": "hsl(var(--brand) / <alpha-value>)",
                "foreground": "hsl(var(--brand-ink) / <alpha-value>)"
        },
        "secondary": {
                "DEFAULT": "hsl(var(--surface-2) / <alpha-value>)",
                "foreground": "hsl(var(--text) / <alpha-value>)"
        },
        "destructive": {
                "DEFAULT": "hsl(var(--bad) / <alpha-value>)",
                "foreground": "hsl(var(--brand-ink) / <alpha-value>)"
        },
        "accent": {
                "DEFAULT": "hsl(var(--brand-soft) / <alpha-value>)",
                "foreground": "hsl(var(--brand) / <alpha-value>)"
        },
        "popover": {
                "DEFAULT": "hsl(var(--surface) / <alpha-value>)",
                "foreground": "hsl(var(--text) / <alpha-value>)"
        },
        "card": {
                "DEFAULT": "hsl(var(--surface) / <alpha-value>)",
                "foreground": "hsl(var(--text) / <alpha-value>)"
        }
      },
      borderRadius: { card: "18px", ctl: "12px", row: "14px", lg: "12px", md: "10px", sm: "8px" },
      fontFamily: { sans: ['"Figtree Variable"', "Figtree", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      boxShadow: { card: "0 1px 2px rgba(20, 24, 40, .05), 0 6px 20px rgba(20, 24, 40, .05)", lift: "0 2px 4px rgba(20, 24, 40, .06), 0 16px 36px rgba(20, 24, 40, .1)" },
      keyframes: { "fade-up": { from: { opacity: ".35", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } } },
      animation: { "fade-up": "fade-up .25s ease-out both" },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
