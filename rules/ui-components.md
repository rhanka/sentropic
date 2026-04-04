---
description: "UI component patterns — stores, streaming, multi-host, EditableInput, ChatPanel"
alwaysApply: false
paths: ["ui/src/lib/**", "ui/src/routes/**"]
globs: ["ui/src/lib/**", "ui/src/routes/**"]
tags: [ui, svelte, components]
---

# UI Component Patterns

## Large Components

- `ChatPanel` (5852 lines), `ChatWidget` (3202), `InitiativeScatterPlot` (2305), `StreamMessage` (1187), `EditableInput` (955).
- Navigate by section comment — don't attempt to read these files in full.
- Search for the specific function or reactive block you need.

## StreamHub

- Located at `stores/streamHub.ts`.
- SSE singleton dispatcher — never instantiate a second one.
- Handles:
  - Delta aggregation (partial tokens assembled into full messages).
  - LRU cache (50 streams x 50 events max).
  - Extension proxy (Chrome/VSCode receive events through bridge).
- Reconnection logic built-in with exponential backoff.

## EditableInput

- Autosave with debounce (200ms default).
- Maintains two values: `buffer` (what the user is editing) and `original` (last server-confirmed value).
- On SSE update from server:
  - If buffer is unchanged (user hasn't edited), update both buffer and original.
  - If buffer differs (user is actively editing), show unsaved indicator, don't overwrite.
- Supports markdown and plain text modes.

## Multi-Host Architecture

- Components are shared between web app, Chrome extension, and VSCode webview.
- Abstraction layers that MUST be used:
  - `api-client.ts` — injectable config for base URL, auth headers, fetch implementation.
  - `navigation-adapter.ts` — routing abstraction (SvelteKit goto vs extension messaging).
  - `context-provider.ts` — environment detection (web / chrome / vscode).
- Never use `window.location` or `goto()` directly in shared components.

## State Management

- Svelte writable/derived stores (`import { writable, derived } from 'svelte/store'`).
- `derived()` for computed values that depend on other stores.
- `get()` for one-time reads inside callbacks (not reactive context).
- `.subscribe()` with cleanup in `onDestroy()` to prevent memory leaks.
- Never mutate store value directly — always use `.set()` or `.update()`.

## Reactive Cascades

- Chain: session -> workspaceScope -> page permissions -> UI render.
- Changing session logic ripples through the entire UI.
- Test cascade impact by tracing derived store dependencies before modifying.

## Internationalization

- `$_('key')` via svelte-i18n.
- French (FR) is the default locale.
- All user-visible text must use translation keys — no hardcoded strings.
- Translation files in `ui/src/lib/i18n/`.

## Styling

- Tailwind utility classes only — no custom CSS classes.
- Design tokens defined in `tailwind.config`.
- Print styles in `app.print.css`.
- Responsive breakpoints follow Tailwind defaults (sm/md/lg/xl/2xl).

## Type Safety Gaps

- Several components pass data as `any` (TemplateRenderer, ChatPanel props).
- Runtime crashes are possible when assumptions about shape are wrong.
- Validate data shape assumptions with optional chaining and fallback defaults.
- When modifying these components, add type narrowing where practical.
