import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/** An opaque token: an HSL triplet in the variable, so Tailwind's opacity modifiers work. */
const opaque = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;
/** An alpha token: the variable holds a full colour (alpha included), so no <alpha-value>. */
const alpha = (name: string) => `var(--${name})`;
/** A status family (spec ui-light-theme §3.1): base, text, text-on-surface, surface, border. */
const status = (name: string) => ({
  DEFAULT: opaque(name),
  strong: opaque(`${name}-strong`),
  fg: opaque(`${name}-fg`),
  surface: alpha(`${name}-surface`),
  border: alpha(`${name}-border`),
});

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./providers/**/*.{js,ts,jsx,tsx}",
  ],
  // `dark:` follows the app theme: the OS dark preference unless Light is chosen, or an explicit Dark.
  // The ancestors sit in :where() so a dark: utility keeps the plain utility's specificity (as under
  // main's `media` strategy) and state classes such as focus-visible: and aria-invalid: still win.
  darkMode: [
    "variant",
    [
      '@media (prefers-color-scheme: dark) { :where(:root:not([data-theme="light"])) & }',
      ':where([data-theme="dark"]) &',
    ],
  ],
  theme: {
    extend: {
      colors: {
        border: opaque("border"),
        input: opaque("input"),
        ring: opaque("ring"),
        background: opaque("background"),
        foreground: opaque("foreground"),
        primary: {
          DEFAULT: opaque("primary"),
          foreground: opaque("primary-foreground"),
        },
        secondary: {
          DEFAULT: opaque("secondary"),
          foreground: opaque("secondary-foreground"),
        },
        destructive: {
          ...status("destructive"),
          foreground: opaque("destructive-foreground"),
        },
        muted: {
          DEFAULT: opaque("muted"),
          foreground: opaque("muted-foreground"),
        },
        accent: {
          DEFAULT: opaque("accent"),
          foreground: opaque("accent-foreground"),
          strong: opaque("accent-strong"),
          hover: opaque("accent-hover"),
          dim: opaque("accent-dim"),
        },
        popover: {
          DEFAULT: opaque("popover"),
          foreground: opaque("popover-foreground"),
        },
        card: {
          DEFAULT: opaque("card"),
          foreground: opaque("card-foreground"),
        },
        "text-dim": opaque("text-dim"),
        // Lighter banner tints (today's 5% / 10% in dark): GuardNotice, DeploymentNotice, EnableCollateral.
        success: { ...status("success"), "surface-subtle": alpha("success-surface-subtle") },
        warning: { ...status("warning"), "surface-subtle": alpha("warning-surface-subtle") },
        danger: status("danger"),
        info: status("info"),
        alert: {
          DEFAULT: opaque("alert"),
          foreground: opaque("alert-foreground"),
        },
        switch: {
          thumb: opaque("switch-thumb"),
          track: alpha("switch-track"),
        },
        "gauge-track": opaque("gauge-track"),
        "status-dot-neutral": alpha("status-dot-neutral"),
        overlay: {
          DEFAULT: alpha("overlay"),
          subtle: alpha("overlay-subtle"),
        },
        scrim: alpha("scrim"),
        "dialog-scrim": alpha("dialog-scrim"),
        "sheet-scrim": alpha("sheet-scrim"),
      },
      boxShadow: {
        cta: "var(--cta-shadow)",
        "cta-lg": "var(--cta-shadow-lg)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
