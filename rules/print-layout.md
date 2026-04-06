---
description: "Print layout rules: @page, footer.jpg bg, template-driven page-breaks, annex=standalone parity"
alwaysApply: false
paths: ["ui/src/app.print.css", "ui/src/app.css", "ui/src/lib/components/TemplateRenderer.svelte"]
globs: ["ui/src/app.print.css", "ui/src/app.css", "ui/src/lib/components/TemplateRenderer.svelte"]
tags: [print, css, layout]
---

# Print Layout Rules

## Architecture
Named `@page` rules: `annex` with `margin: 0`, `cover` with `margin: 0`. Content margins are set via element `margin`, not page margin. This keeps the full page available for background images while still providing readable content insets.

## Chrome PDF Constraints
`::before` pseudo-elements with `position: absolute` and negative offsets do NOT render in Chrome PDF on paginated elements using named `@page`. Use `background-image` directly on the element for annex items. Standalone initiative `::before` works because it is not nested inside a paginated entity-loop context.

## Annex = Standalone Rule
An initiative rendered in the dashboard entity-loop annex MUST be visually identical to standalone print. The parent only adds `page-break-before: always` via the `sectionStyle` prop. The `sectionTitle` prop injects the h1 INSIDE `.template-initiative`. No wrapper element is used — the `.template-initiative` div IS the section.

## Page-Breaks in Template Seed
Use `pageBreakAfter`, `pageBreakBefore`, `pageBreakInside` attributes on template seed rows. `TemplateRenderer` applies them as inline styles. Do NOT hardcode page-break rules in CSS classes.

## Margin vs Padding
When `@page { margin: 0 }`, use `margin` on the element (not `padding`) to preserve the `::before` footer offset calculation. The `::before` pseudo-element with `bottom: -0.6cm` extends beyond the element's content box into the margin area.

## Footer.jpg Background Pattern
- **Standalone**: uses `::before` on `.template-initiative:not(.template-initiative .template-initiative)`.
- **Annex**: uses `background-image` directly on `.template-initiative.usecase-annex-item` (Chrome PDF limitation workaround).

## Reference Commits
- `a6768230` — annex h1 inside template-initiative
- `79832881` — page-break template seed attributes
- `e47f5ae8` — annex margin fix + background image
