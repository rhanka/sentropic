# Templater contracts (migration lot T0)

Source baseline: `c40b8d1b56372fe1f2e8063ea6069e403dfe4942`.
The API descriptors and reference UI remain unchanged. This directory imports no
framework, component, design-system package or application store.

## Consumers

| Consumer | Family | Reference entry point | Candidate owner |
|---|---|---|---|
| Neutral workspace landing | a | `ui/src/routes/neutral/+page.svelte:124` (`ViewTemplateRenderer`) | T1a, A0b |
| Initiative detail | b | `ui/src/lib/components/InitiativeDetail.svelte:270` (`TemplateRenderer`) | T1b, A3 |
| Organization form | b | `ui/src/lib/components/OrganizationForm.svelte:183` (`TemplateRenderer`) | T1b, A2 |
| Dashboard report | b | `ui/src/routes/dashboard/+page.svelte:1266` (`TemplateRenderer`) | T1b, A4b |
| Settings catalogue | b, editor | `ui/src/routes/settings/+page.svelte:1234` (`ViewTemplateCatalog`); `ui/src/lib/components/ViewTemplateCatalog.svelte:10` (`listViewTemplates`) | T1b, A6b |

## Family (a): client-only container

`container.ts` replaces `ui/src/lib/types/view-template.ts:19-81` inside the
candidate only. Icons are DS icon names (resolved by the candidate icon registry),
never component constructors. `iconColorClass` becomes `iconTone`; badge
`colorClass` becomes `tone`. No Tailwind class enters the new contract.

`cardRenderer(item)` returns `CardProps`, preserving the original item reference.
`cardFor` keeps the reference title/subtitle fallback. `activate` dispatches an
action or card: a nonempty href wins over onClick; the caller supplies navigation.
`dispatchFileMenu` maps the five visible menu actions to their callbacks. Hidden
actions never dispatch; callback promises and failures propagate to the caller.
T1a binds the same activation function to click and Enter/Space in its DS host.
Sorting, grouping, loading, empty and header-only rendering belong to T1a.
`detail` remains a supported descriptor mode; this lot adds no detail view.
These callback-bearing objects must never be JSON-serialised or persisted.

## Family (b): stored JSON

`descriptor.schema.json` is JSON Schema draft 7. Its input is the descriptor,
not the API record envelope. `tabs[].rows[]` admits the three seeded shapes:
single-field flat row, multi-field flat row, or main/sidebar row. The latter
contains field groups with spans and an optional inner grid. These are the two
rendering branches at `ui/src/lib/components/TemplateRenderer.svelte:484` and
`:609`; single/multiple flat fields share a branch. A main-only row has no
reference rendering branch and is rejected. Empty field arrays remain valid.

The eight field kinds are `scores-summary`, `text`, `list`, `scores`,
`child-list`, `chart`, `component`, `entity-loop`. `chart` supplies the `chartKey`
slot parameter; `component` supplies `fieldKey` (`TemplateRenderer.svelte:705-710`).
`entity-loop` names a collection and templateRef, resolved at runtime; the
renderer recurses with locked and print modes (`:711-734`). A recursive object
is not embedded in the descriptor. T2 owns resolution, not this schema.

Unknown metadata and opaque colour/layout strings are allowed for stored custom
descriptors. Known properties are type-checked at every level; no API validation
or database rewrite is introduced. The schema does not assert that arbitrary
custom fields are supported in main/sidebar groups: the reference renders only
text/list there. T1b preserves that behavior.

## Presentation mappings

`presentation.ts` fixes colour-to-tone mapping: orange → category1, blue →
category2, green → category3, red → category4, purple → category5, white → neutral.
Absent/unknown colours map to neutral. `colored` → `accent`; `plain` and
`bordered` retain their names and use neutral (DS tones apply to accent only).
This maps semantic roles, not RGB equality. Filled headers becoming edge accents
are a proposed `ds-intended` difference for D4; T0 does not approve that decision.

`columns` maps to DS grid columns and `span` to DS col span. `printHooks` maps:

| Descriptor property | Hook |
|---|---|
| printClass | `data-print-layout` on its row/group wrapper |
| printGridClass | `data-print-layout` on its inner grid (`printHooks(value, true)`) |
| pageBreakBefore / After / Inside | `data-print-break-before` / `-after` / `-inside` |
| pageContext | `data-print-page` |
| printOnly / screenOnly | `data-print-only` / `data-print-hidden` |

Layout values stay opaque and unchanged: `layout-head`, `layout-main`,
`column-a colspan-2-print`, `column-b`, `layout-quad`, `layout-bottom`,
`report-introduction`, `report-analyse`, and custom token lists. T1c interprets
these attributes inside print media; no inline CSS or utility classes are emitted.
T1b also supplies `data-print-template`, semantic `data-print-part` wrapper hooks,
and `data-print-root` on the print host. T1c may consolidate overlapping reference
rules, but must preserve page behavior and never target private DS classes.

## Print inventory and qualification

`print-inventory-01.json` through `-05.json` cover every selector/prelude line
of `ui/src/app.print.css`, including all template, report and global print rules.
Each entry records the source line, selector, semantic target and future hook.
The specification's 441-line census includes 433 selector lines, three `@page`
lines and five `@media print` lines. At-rule preludes scope the selectors and
are inventoried explicitly. The inventory preserves duplicates
and cascade order; it is an input to T1c, not an executable replacement stylesheet.
An entry's hook identifies the wrapper/part carrying the rule, not a promise to
copy every declaration unchanged. T1c checks first/last child and compact content
behavior against AE1b's paged reference. No rule is silently dropped.

Run from the repository root, through the Docker slot wrapper:
`make -f ui-shared/templater/contract/Makefile test API_PORT=9300 UI_PORT=5500 MAILDEV_UI_PORT=1400 ENV=feat-app-vue-t0`.
The locked tool profile supplies TypeScript and Ajv; the test reads the actual
pure seed functions (17 records, 7 unique descriptors) without starting the API.
`inventory` regenerates the bounded inventory files; `test` checks source
coverage, callbacks, mappings, valid shapes and mutation rejection.
