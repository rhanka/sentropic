---
description: "Design tokens, typography, buttons, forms, accessibility, print styles"
alwaysApply: false
paths: ["ui/src/lib/components/**", "ui/src/app.css", "ui/src/app.print.css", "ui/tailwind.config.*"]
globs: ["ui/src/lib/components/**", "ui/src/app.css", "ui/src/app.print.css", "ui/tailwind.config.*"]
tags: [design, ui]
---

# DESIGN SYSTEM

## Purpose
- Keep UI consistent and predictable across the SvelteKit app
- Use **design tokens** (Tailwind config) as the single source of truth
- Prefer shared UI primitives over ad-hoc Tailwind class strings

## Tokens
- Colors live in `ui/tailwind.config.cjs` under `theme.extend.colors`
- **Never** introduce ad-hoc hex/OKLCH values inside components
- New semantic color needed? Add it to Tailwind, use the token everywhere
- Current tokens: `primary`, `accent`, `warning`

## Typography
- Reuse existing heading classes (see `ui/src/lib/extensions/tailwind-classes.ts`)
- Body text: `text-slate-700` (normal), `text-slate-900` (emphasis)

## Buttons
- **Primary**: `bg-primary text-white hover:opacity-90`
- **Secondary**: `bg-slate-100 text-slate-800 hover:bg-slate-200`
- **Icon-only**: `text-primary hover:bg-slate-100`
- **Danger**: `bg-red-600 text-white hover:bg-red-700`
- **Disabled**: `disabled:opacity-50 disabled:cursor-not-allowed`
- **Focus**: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30`
- **Menu triggers**: reuse `MenuTriggerButton` (`ui/src/lib/components/MenuTriggerButton.svelte`)

## Inputs & Forms
- **Reference input**: `EditableInput` (`ui/src/lib/components/EditableInput.svelte`)
- Base input: `rounded border border-slate-300 bg-white px-3 py-2 text-slate-800`
- Focus: `focus:outline-none focus:ring-2 focus:ring-primary/30`
- Error: `border-red-400` + `text-red-600` helper text
- Labels: `text-sm text-slate-600`

## Menus & Popovers
- Use `MenuPopover` + `MenuTriggerButton` + `FileMenu` patterns
- Styles in `ui/src/lib/components/MenuPopover.svelte`

## Layout & Spacing
- Tailwind spacing: `p-2`, `p-4`, `gap-2`, `gap-4`
- Cards: `rounded-lg border border-slate-200 bg-white shadow-sm`
- Controls: `rounded`
- Layout grid rules in `ui/src/app.css`

## Cards
- Base: `rounded-lg border border-slate-200 bg-white shadow-sm`
- Headers: `rounded-t-lg` + `border-b border-slate-200`
- Score cards: see `ui/src/lib/components/ScoreCard.svelte`

## Iconography
- `@lucide/svelte` icons only
- Sizes: `w-4 h-4` (inline), `w-5 h-5` (buttons/headers)
- Icon color aligned with text color

## Scrollbars
- Use global `slim-scroll` class from `ui/src/app.css`
- No component-specific scrollbar rules

## Print (MANDATORY)
- Overrides in `ui/src/app.print.css`
- Use `print-hidden` / `print-only` classes
- Use case layouts: `usecase-print` and annex rules in `app.print.css`

## Status & Feedback
- Success: `bg-green-50 text-green-800 border-green-200`
- Warning: `bg-yellow-50 text-yellow-800 border-yellow-200`
- Error: `bg-red-50 text-red-800 border-red-200`
- Info: `bg-blue-50 text-blue-800 border-blue-200`

## Accessibility (MANDATORY)
- All interactive elements must have visible focus state
- Button hit target >= 36px height (use padding, not font size)
- Ensure contrast on `primary` and `warning` backgrounds

## New UI Elements
- Prefer shared primitives (`Button`, `Input`, `Badge`) if they exist
- Missing primitive? Add under `ui/src/lib/components/ui/`
- Do **not** duplicate styling across pages without a shared primitive
