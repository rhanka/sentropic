/**
 * theme-token-map.mjs — single source of truth for the chat-ui theming seam.
 *
 * Maps the Tailwind color utilities used by @sentropic/chat-ui components to
 * CSS custom properties (design-system token vocabulary, --st-*), each with a
 * fallback equal to the EXACT value the sentropic host compiles today
 * (Tailwind v3.4 default palette + sentropic's custom `primary`).
 *
 * Unthemed (no --st-* set): rendering is pixel-identical to sentropic.
 * Themed: a consumer (e.g. the design-system docs site) sets --st-* tokens and
 * the same component renders with its design language. Token names follow the
 * FROZEN vocabulary of sent-tech-design-system docs/chat-ui-contract.md.
 *
 * NOTE: the same token may appear with different fallbacks (e.g. text-primary
 * over #0f172a and #1e293b): unthemed keeps both sentropic shades; themed
 * intentionally collapses them onto the single DS token.
 *
 * Consumed by scripts/gen-theme-css.mjs (stylesheet generation) and by
 * tests (drift guard).
 */

/** Sentropic's custom `primary` color (ui/tailwind.config.cjs). */
export const SENTROPIC_PRIMARY = 'oklch(50% 0.134 242.749)';

/**
 * token(cssVar, fallback) -> value usable in tailwind theme colors.
 */
const v = (cssVar, fallback) => `var(${cssVar}, ${fallback})`;

/**
 * Alpha helper for `/NN` modifiers (bg-primary/90, ring-primary/30, ...).
 * Uses color-mix (Chrome 111 / Firefox 113 / Safari 16.2) rather than CSS
 * relative color syntax (Firefox 133+) for a wider browser floor.
 * color-mix(in srgb, C N%, transparent) == C at alpha N/100.
 */
const withAlpha = (color, opacityValue) =>
  `color-mix(in srgb, ${color} ${Number(opacityValue) * 100}%, transparent)`;

/**
 * True only for an explicit numeric `/NN` modifier < 1. Tailwind ALSO calls
 * color functions with opacityValue = 'var(--tw-bg-opacity, 1)' (legacy
 * text/bg-opacity-* plumbing) — that path must return the flat token (the
 * only legacy opacity user in this package is bg-black bg-opacity-40, and
 * black is unmapped).
 */
const hasExplicitAlpha = (opacityValue) =>
  opacityValue !== undefined &&
  Number.isFinite(Number(opacityValue)) &&
  Number(opacityValue) !== 1;

/**
 * Tailwind color overrides for the generated theme stylesheet.
 * Shape matches tailwind `theme.extend.colors`.
 *
 * HARD RULES:
 * - Colors consumed with `/NN` modifiers MUST be registered as
 *   `({ opacityValue }) => ...` color FUNCTIONS, otherwise Tailwind silently
 *   drops the alpha and renders full-opacity (focus rings, scrims, hovers).
 * - Colors consumed with the legacy `bg-opacity-*` plugin (bg-black
 *   bg-opacity-40 in ChatDock) MUST stay literal Tailwind colors — a
 *   var()/color-mix value cannot host <alpha-value>, the modifier would
 *   silently no-op. Hence `black` is NOT mapped.
 */
export const themeColors = {
  primary: ({ opacityValue }) =>
    hasExplicitAlpha(opacityValue)
      ? withAlpha(v('--st-semantic-action-primary', SENTROPIC_PRIMARY), opacityValue)
      : v('--st-semantic-action-primary', SENTROPIC_PRIMARY),
  // white: unmodified usage = themable surface; `/NN` usage (lightbox
  // controls over the image scrim) stays literal white-with-alpha.
  white: ({ opacityValue }) =>
    hasExplicitAlpha(opacityValue)
      ? `rgb(255 255 255 / ${opacityValue})`
      : v('--st-semantic-surface-default', '#ffffff'),
  slate: {
    50: v('--st-semantic-surface-subtle', '#f8fafc'),
    100: v('--st-semantic-surface-sunken', '#f1f5f9'),
    // BLOCKED (owner ratification 2026-06-13): kept literal — not in the DS frozen chat-token
    // list. Re-token to --st-component-control-hoverBackground only once the DS lane ratifies it.
    200: '#e2e8f0',
    400: v('--st-semantic-text-muted', '#94a3b8'),
    500: v('--st-semantic-text-muted', '#64748b'),
    600: v('--st-semantic-text-secondary', '#475569'),
    700: v('--st-semantic-text-secondary', '#334155'),
    800: v('--st-semantic-text-primary', '#1e293b'),
    900: v('--st-semantic-text-primary', '#0f172a')
  },
  red: {
    // Error affordances: 500 maps to DS status-failed (same default value),
    // 600/700 to feedback-danger. Light tints (50/200) stay literal in v1.
    500: v('--st-semantic-status-failed', '#ef4444'),
    600: v('--st-semantic-feedback-danger', '#dc2626'),
    700: v('--st-semantic-feedback-danger', '#b91c1c')
  }
  // black: intentionally NOT mapped — see HARD RULES above.
};

/**
 * Context-sensitive overrides applied per-corePlugin where a single
 * palette-level mapping would be semantically wrong:
 * - slate-100/200 and gray-200 as BORDER colors are borders, not surfaces
 *   (border-gray-200 = ChatDock shell border; tailwind gray, not slate).
 * - text-white sits on primary actions / user bubbles -> action-primaryText.
 * - bg-slate-800 / bg-slate-300 = ChatConversation send button
 *   enabled/disabled backgrounds -> action-primary / control-disabled.
 */
export const pluginColorOverrides = {
  borderColor: {
    slate: {
      100: v('--st-semantic-border-subtle', '#f1f5f9'),
      200: v('--st-semantic-border-subtle', '#e2e8f0')
    },
    gray: {
      200: v('--st-semantic-border-subtle', '#e5e7eb')
    }
  },
  textColor: {
    white: v('--st-semantic-action-primaryText', '#ffffff')
  },
  backgroundColor: {
    slate: {
      // BLOCKED (owner ratification 2026-06-13): kept literal — not in the DS frozen chat-token
      // list. Re-token to --st-component-control-disabledBackground only once the DS lane ratifies it.
      300: '#cbd5e1',
      800: v('--st-semantic-action-primary', '#1e293b')
    }
  }
};

/**
 * Font stack themable via the DS foundation token --st-font-sans; the
 * fallback is Tailwind's exact default sans stack (what sentropic renders).
 * Single-element array: the whole var() expression is one font-family value.
 */
export const themeFontFamily = {
  sans: [
    'var(--st-font-sans, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji")'
  ]
};

/** Box shadows themable via DS elevation tokens (defaults = tailwind v3). */
export const themeBoxShadow = {
  lg: v(
    '--st-elevation-2',
    '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)'
  ),
  '2xl': v('--st-elevation-3', '0 25px 50px -12px rgb(0 0 0 / 0.25)')
};

/** Scope selector: every generated rule only applies inside this attribute. */
export const SCOPE_SELECTOR = '[data-st-chat-theme]';
