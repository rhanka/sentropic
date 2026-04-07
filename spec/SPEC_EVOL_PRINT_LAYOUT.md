# SPEC_EVOL_PRINT_LAYOUT — Print Layout Contract (BR-04B)

## 1. Context

BR-04B introduced TemplateRenderer-driven print for dashboard and initiative pages. The dashboard entity-loop renders each initiative as an annex page, while standalone initiative pages use a direct TemplateRenderer instance. This spec documents the print contract for future reference.

## 2. Template Seed Page-Break Contract

Template seed rows support three page-break attributes:
- `pageBreakAfter`: applied as `page-break-after` inline style
- `pageBreakBefore`: applied as `page-break-before` inline style
- `pageBreakInside`: applied as `page-break-inside` inline style

`TemplateRenderer` reads these attributes from each row object and applies them as inline `style` attributes on the rendered row container. This replaces hardcoded CSS classes (`report-break-after`, `report-analyse-with-break`) with data-driven page-break control.

Example from dashboard seed:
```json
{
  "key": "analyse",
  "type": "text",
  "path": "data.executive_summary.analyse",
  "pageBreakAfter": "always"
}
```

## 3. Entity-Loop Print Contract

The entity-loop renders each entity via its own `TemplateRenderer` instance. The parent passes section props that are applied directly on the `.template-initiative` div:

- `sectionTitle`: h1 rendered INSIDE `.template-initiative` (not in a wrapper)
- `sectionStyle`: inline styles including `page-break-before: always` and `page: annex`
- `sectionClass`: CSS class, e.g. `usecase-annex-item`
- `sectionId`: optional HTML id attribute
- `sectionDataAttrs`: optional data attributes

No wrapper element is used. The `.template-initiative` div IS the section. This is critical for the footer.jpg background to reach the page edges without an intervening wrapper element adding unwanted spacing.

## 4. Footer.jpg Background

Two approaches are used due to Chrome PDF limitations:

**Standalone initiative** (`/initiative/[id]` print):
- Uses `::before` pseudo-element on `.template-initiative:not(.template-initiative .template-initiative)`
- `position: absolute`, `bottom: -0.6cm`, `left: 0`, `right: 0`
- `background-image: url('/footer.jpg')`, `background-size: cover`
- Works because the element is not nested inside a paginated entity-loop

**Annex initiative** (dashboard entity-loop print):
- Uses `background-image` directly on `.template-initiative.usecase-annex-item`
- `background-image: url('/footer.jpg')`, `background-position: bottom`, `background-repeat: no-repeat`, `background-size: 100% auto`
- Required because `::before` with `position: absolute` and negative offsets does NOT render in Chrome PDF on paginated elements with named `@page`

## 5. hideExcerptInPrint

Template seed field attribute `hideExcerptInPrint` controls whether reference excerpts are visible in print. When set, the excerpt `<span>` receives the CSS class `print-hidden` which applies `display: none` in `@media print`.

## 6. @page Rules

```css
@page annex {
  margin: 0;
}

@page cover {
  margin: 0;
}
```

Content margins are provided by the element itself (e.g. `margin: 0.6cm` on `.usecase-annex-item`), not by the page margin. This allows `background-image` to reach the page edges while keeping text inset.

## 7. Known Chrome PDF Limitations

Confirmed limitations encountered during BR-04B:

1. **`::before` with negative offsets on paginated elements**: `::before` pseudo-elements using `position: absolute` with negative `bottom` offsets do not render correctly on elements that span page breaks or use named `@page` rules in Chrome PDF output. Workaround: use `background-image` directly on the element.

2. **Background-image with named @page**: `background-image` on elements using named `@page` rules works correctly in Chrome PDF, but only when applied directly on the element (not via `::before`). This is the basis for the annex footer pattern.

3. **Page context inheritance**: Named `@page` rules (e.g. `page: annex`) apply to the element and all its descendants. The `sectionStyle` prop sets `page: annex` on the `.template-initiative` div, ensuring all content within uses the annex page rules.
