# Theming @sentropic/chat-ui

`@sentropic/chat-ui` components are styled with Tailwind utility classes. There
are two supported ways to style them, and they must not be mixed:

## Mode A — Tailwind host (how the sentropic app consumes the package)

The host runs Tailwind over the package files (add them to `content`) and
defines the `primary` color:

```js
// tailwind.config.cjs
module.exports = {
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './node_modules/@sentropic/chat-ui/dist/**/*.{js,svelte}'
  ],
  theme: { extend: { colors: { primary: 'oklch(50% 0.134 242.749)' } } }
};
```

Do **not** import `theme.css` in this mode.

## Mode B — token-themed stylesheet (no Tailwind required)

For hosts that do not run Tailwind (e.g. the sent-tech design-system docs
site), the package ships a precompiled stylesheet whose every rule is scoped
under a `data-st-chat-theme` attribute and whose colors resolve through
`--st-*` design-system custom properties with fallbacks equal to the exact
sentropic look:

```svelte
<script>
  import '@sentropic/chat-ui/theme.css';
  import { ChatConversation } from '@sentropic/chat-ui';
</script>

<div data-st-chat-theme>
  <ChatConversation ... />
</div>
```

- **Unthemed** (no `--st-*` variables defined): renders pixel-identical to the
  sentropic app.
- **Themed**: set the tokens below on the scope element (or import a
  `@sentropic/design-system-themes` stylesheet that defines them globally) and
  the identical component renders in your design language. Dark mode = swap
  the token values, as the design system already does.

### Token contract (v1: colors, elevation, font)

Token names follow the frozen vocabulary of sent-tech-design-system
(`docs/chat-ui-contract.md`). One Tailwind utility maps to one token; the
fallback after each token is the exact sentropic value.

| Token | Themes | Defaults (sentropic) |
| --- | --- | --- |
| `--st-semantic-action-primary` | primary actions, user-bubble & send-button backgrounds, focus rings (30% alpha via color-mix) | `oklch(50% 0.134 242.749)` / `#1e293b` (send button) |
| `--st-semantic-action-primaryText` | text on primary surfaces (`text-white`) | `#ffffff` |
| `--st-semantic-surface-default` | panels, bubbles, composer (`bg-white`) | `#ffffff` |
| `--st-semantic-surface-subtle` | subtle fills (`bg-slate-50`) | `#f8fafc` |
| `--st-semantic-surface-sunken` | chips, tool cards (`bg-slate-100`) | `#f1f5f9` |
| `--st-component-control-hoverBackground` | hover fills (`bg-slate-200`) | `#e2e8f0` |
| `--st-component-control-disabledBackground` | disabled send button (`bg-slate-300`) | `#cbd5e1` |
| `--st-semantic-text-primary` | main text (`text-slate-900/800`) | `#0f172a` / `#1e293b` |
| `--st-semantic-text-secondary` | secondary text (`text-slate-700/600`) | `#334155` / `#475569` |
| `--st-semantic-text-muted` | muted text/icons (`text-slate-500/400`) | `#64748b` / `#94a3b8` |
| `--st-semantic-border-subtle` | borders (`border-slate-100/200`, `border-gray-200`) | `#f1f5f9` / `#e2e8f0` / `#e5e7eb` |
| `--st-semantic-status-failed` | error icons/text (`text-red-500`) | `#ef4444` |
| `--st-semantic-feedback-danger` | error text/hover (`text-red-600/700`) | `#dc2626` / `#b91c1c` |
| `--st-elevation-2` / `--st-elevation-3` | `shadow-lg` / `shadow-2xl` | tailwind defaults |
| `--st-font-sans` | base font of the chat subtree | tailwind sans stack |

Where one token themes several utilities (e.g. `text-slate-500` and
`text-slate-400` both map to `--st-semantic-text-muted`), the unthemed
fallbacks keep both sentropic shades; theming intentionally collapses them
onto the single design-system token.

### Known v1 limitations (by design — escalate before working around)

- **Semantic-level theming only.** Per-role component tokens
  (`--st-component-chat-userBubbleBackground`, `-assistantBubbleBackground`,
  `-composerSurface`, `-toolCallSurface`) are NOT directly consumable yet: the
  markup does not distinguish those roles by dedicated hooks, so e.g. the user
  bubble and the send button both theme through
  `--st-semantic-action-primary`. In the design system those component tokens
  fall back to the same semantic tokens, so a semantic theme is faithful.
  Per-role hooks require DOM changes (a future major, co-designed with the DS
  track).
- Error tints `bg-red-50` / `border-red-200`, image-lightbox scrims
  (`bg-black/80`, `bg-white/10`, `ring-white/50`) and one inline
  `background-color:#f1f5f9 !important` (resolved comments) stay literal.
- Spacing, radii and font sizes are fixed: the sentropic look corresponds to
  the design-system `small` density preset. Density presets are a phase-2
  item.
- Alpha-modified tokens use `color-mix(in srgb, ...)` — browser floor
  Chrome 111 / Firefox 113 / Safari 16.2.
- The stylesheet includes a *scoped* Tailwind preflight: everything inside
  `[data-st-chat-theme]` is reset exactly like in the sentropic app
  (fidelity-first). Host content portaled into the scope inherits that reset.
  A `@keyframes spin` definition is emitted at top level (identical to
  Tailwind's; harmless if your app also defines Tailwind's `spin`).
- Markdown is rendered by the `svelte-streamdown` peer; its internal Tailwind
  classes are uncompiled in BOTH modes (sentropic included) — markdown look
  comes from the components' scoped styles and inherits chat colors. Icons
  come from the `@lucide/svelte` peer.

### Regenerating the stylesheet

`src/theme/chat-ui.css` is generated — never edit it by hand:

```
make exec-ui CMD="node ../packages/chat-ui/scripts/gen-theme-css.mjs" <ports> ENV=<env>
```

Source of truth: `scripts/theme-token-map.mjs` (utility -> token mapping) plus
component class usage. The drift guard (`tests/theme-css.spec.ts`) fails when
component classes change without regeneration, and `npm pack`/`npm publish`
fail if the dist artifact is missing (`scripts/verify-publish-artifacts.mjs`).
