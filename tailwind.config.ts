import type { Config } from "tailwindcss";

/**
 * Imperium design tokens.
 *
 * Aesthetic: Byzantine imperial court — dark, refined, parchment + deep
 * burgundy + aged gold. Serif display for headings, serif body for prose,
 * no sans-serif anywhere unless explicitly opted in.
 *
 * Color values are stored in `app/globals.css` as space-separated RGB
 * triples (e.g. `--color-gold: 201 164 76;`). The `withAlpha` helper
 * below wraps each in `rgb(var(--color-X) / <alpha-value>)` so Tailwind's
 * opacity modifiers (`bg-gold/20`, `text-parchment/80`) work transparently.
 *
 * Don't add hex literals here. Add a new variable in globals.css and an
 * alias here.
 */
const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: withAlpha("--color-ink"),
        parchment: {
          DEFAULT: withAlpha("--color-parchment"),
          dark: withAlpha("--color-parchment-dark"),
          deep: withAlpha("--color-parchment-deep"),
        },
        imperial: {
          DEFAULT: withAlpha("--color-imperial"),
          deep: withAlpha("--color-imperial-deep"),
          shadow: withAlpha("--color-imperial-shadow"),
        },
        gold: {
          DEFAULT: withAlpha("--color-gold"),
          dim: withAlpha("--color-gold-dim"),
          bright: withAlpha("--color-gold-bright"),
        },
        verdigris: withAlpha("--color-verdigris"),
        bone: withAlpha("--color-bone"),
        ash: withAlpha("--color-ash"),
        blood: withAlpha("--color-blood"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Cinzel", "Georgia", "serif"],
        serif: ["var(--font-serif)", "Cormorant Garamond", "Georgia", "serif"],
        body: ["var(--font-body)", "Lora", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        seal:
          "0 1px 0 rgba(212, 175, 55, 0.15) inset, 0 0 0 1px rgba(212, 175, 55, 0.18), 0 12px 30px -12px rgba(0, 0, 0, 0.6)",
        carved:
          "inset 0 1px 0 rgba(255, 240, 200, 0.04), inset 0 -1px 0 rgba(0, 0, 0, 0.5)",
      },
      backgroundImage: {
        parchment: "var(--bg-parchment)",
        vellum: "var(--bg-vellum)",
      },
      letterSpacing: {
        imperial: "0.18em",
      },
    },
  },
  plugins: [],
};

export default config;
