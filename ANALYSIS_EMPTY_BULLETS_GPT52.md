# Analysis: Empty bullet points in list fields (gpt-5.2) — use case `7c741333-1f0d-43ef-abbb-37a8c8149635`

## Scope
Investigate why list fields (benefits, risks, success metrics, next steps) render **extra empty bullet points**, especially observed with model `gpt-5.2`.

Constraints: **no code or data fix applied** in this analysis. Only inspection.

## What we observed (facts)

### 1) The problematic use case contains “marker-only” list items

DB row:

- Use case id: `7c741333-1f0d-43ef-abbb-37a8c8149635`
- Folder id: `ff993d03-9bfb-4db0-879d-087086d2f1e0`
- Model: `gpt-5.2`
- Status: `completed`

Query executed:

```sql
SELECT id, folder_id, model, status, data->>'name' AS name
FROM use_cases
WHERE id = '7c741333-1f0d-43ef-abbb-37a8c8149635';
```

Result (excerpt):
- `model = gpt-5.2`
- `folder_id = ff993d03-9bfb-4db0-879d-087086d2f1e0`

Then we enumerated list-array entries to spot malformed items:

```sql
SELECT field, idx, value, (btrim(value) = '') AS is_empty
FROM (
  SELECT 'benefits'::text AS field, ordinality-1 AS idx, value
  FROM use_cases,
       jsonb_array_elements_text(coalesce(data->'benefits','[]'::jsonb))
       WITH ORDINALITY AS t(value, ordinality)
  WHERE id='7c741333-1f0d-43ef-abbb-37a8c8149635'

  UNION ALL
  SELECT 'risks', ordinality-1, value
  FROM use_cases,
       jsonb_array_elements_text(coalesce(data->'risks','[]'::jsonb))
       WITH ORDINALITY AS t(value, ordinality)
  WHERE id='7c741333-1f0d-43ef-abbb-37a8c8149635'

  UNION ALL
  SELECT 'metrics', ordinality-1, value
  FROM use_cases,
       jsonb_array_elements_text(coalesce(data->'metrics','[]'::jsonb))
       WITH ORDINALITY AS t(value, ordinality)
  WHERE id='7c741333-1f0d-43ef-abbb-37a8c8149635'

  UNION ALL
  SELECT 'nextSteps', ordinality-1, value
  FROM use_cases,
       jsonb_array_elements_text(coalesce(data->'nextSteps','[]'::jsonb))
       WITH ORDINALITY AS t(value, ordinality)
  WHERE id='7c741333-1f0d-43ef-abbb-37a8c8149635'
) q
ORDER BY field, idx;
```

Key findings from the result:

- `benefits` includes entries with `value = '-'` at multiple indices (0,2,4,6,8, …).
- `metrics` includes entries with `value = '-'` at multiple indices (0,2,4, …).
- `risks` entries start with `- ` (markdown bullet), but there are no marker-only `'-'` entries.
- `nextSteps` entries start with `- ` (markdown bullet), no marker-only `'-'` entries.

So, for this specific use case: **`benefits` and `metrics` arrays are polluted with marker-only bullet tokens**.

### 2) Other use cases in the same folder do *not* contain marker-only entries

We computed, per use case in the folder, the count of:
- **marker-only items**: `'-'`, `'*'`, `'•'`
- **leading-bullet items**: strings starting with `- `, `* `, `+ `, `• `

Query executed:

```sql
SELECT
  id, model, status, data->>'name' AS name,
  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'benefits','[]'::jsonb)) AS b(value)
   WHERE btrim(value) IN ('-','*','•')) AS benefits_marker_only,
  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'benefits','[]'::jsonb)) AS b(value)
   WHERE btrim(value) ~ '^(?:[-*+]|\\u2022)\\s+') AS benefits_has_leading_bullet,

  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'metrics','[]'::jsonb)) AS m(value)
   WHERE btrim(value) IN ('-','*','•')) AS metrics_marker_only,
  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'metrics','[]'::jsonb)) AS m(value)
   WHERE btrim(value) ~ '^(?:[-*+]|\\u2022)\\s+') AS metrics_has_leading_bullet,

  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'risks','[]'::jsonb)) AS r(value)
   WHERE btrim(value) IN ('-','*','•')) AS risks_marker_only,
  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'risks','[]'::jsonb)) AS r(value)
   WHERE btrim(value) ~ '^(?:[-*+]|\\u2022)\\s+') AS risks_has_leading_bullet,

  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'nextSteps','[]'::jsonb)) AS n(value)
   WHERE btrim(value) IN ('-','*','•')) AS nextSteps_marker_only,
  (SELECT count(*)
   FROM jsonb_array_elements_text(coalesce(data->'nextSteps','[]'::jsonb)) AS n(value)
   WHERE btrim(value) ~ '^(?:[-*+]|\\u2022)\\s+') AS nextSteps_has_leading_bullet
FROM use_cases
WHERE folder_id = 'ff993d03-9bfb-4db0-879d-087086d2f1e0'
ORDER BY created_at ASC;
```

Outcome:
- All use cases in that folder are `gpt-5.2`.
- **Only** `7c741...` has `benefits_marker_only = 5` and `metrics_marker_only = 3`.
- The other use cases have `*_marker_only = 0`.

So this is not “all gpt-5.2 outputs”, but it is still **a valid gpt-5.2 failure mode**: the model sometimes emits marker-only bullet tokens in arrays.

## Where the malformed data enters the system

### API: generation parses JSON but does not normalize list fields

`generateUseCaseDetail(...)` uses:
- `executeWithToolsStream(..., responseFormat: 'json_object')`
- `parseJsonLenient(...)` which simply calls `JSON.parse` (with light trimming/extraction)

No post-processing is applied to:
- remove marker-only items (e.g. `'-'`)
- strip leading bullet prefixes (`- `) from array items
- trim whitespace / deduplicate

Then `QueueManager.processUseCaseDetail(...)` persists the lists as-is into `use_cases.data`:
- `benefits: useCaseDetail.benefits`
- `metrics: useCaseDetail.metrics`
- `risks: useCaseDetail.risks`
- `nextSteps: useCaseDetail.nextSteps`

=> **If the model returns `["-", "...", "-", "..."]`, the DB will store it.**

### UI: print rendering wraps array items in an outer bullet *and* renders markdown inside

In `UseCaseDetail.svelte` print mode:
- it iterates `parsedBenefits`/`parsedMetrics`/`parsedRisks` and renders each item inside an outer `<li>` with a bullet marker `•`.
- each array element is converted to HTML via `renderMarkdownWithRefs(...)`.

If an array element is exactly `"-"`:
- it is valid markdown syntax for an (empty) list item; markdown renderers typically produce an empty `<li>`.
- this results visually in **an “empty bullet”**.

This matches the symptom: extra blank bullets in list-type fields.

## Why this happens more with some models (gpt-5.2)

The prompt explicitly requires that:
- “each items of benefits/metrics/risks/nextSteps … must be formatted in markdown, potentially multilines (listes à puces)”

But these fields are already arrays. Asking the model to produce “bullet lists” inside array elements is ambiguous:
- Best-case: array items are plain markdown text with emphasis (no list syntax).
- Worst-case: the model emits bullet syntax redundantly, producing:
  - strings starting with `- ` inside each array element (nested list)
  - or, as observed, marker-only `"-"` elements split out as separate array entries.

The system currently has no “shape guardrails” after parsing, so a model-specific formatting quirk leaks into persisted data.

## Options / remediation paths (no action taken)

### Option A — Fix in API (recommended): normalize list arrays before persisting
Add a normalization step between `parseJsonLenient` and DB update:

- Trim strings
- Drop marker-only items: `'-'`, `'*'`, `'•'` (and maybe other unicode bullets)
- Strip a *single* leading bullet marker from each element (`- `, `* `, `• `, numbered `1. `)
- (Optional) Split multi-line bullet blocks into separate array items

Pros:
- Canonical, model-agnostic data in DB
- UI becomes simpler and consistent across print/non-print
- Prevents future “data pollution” from reappearing

Cons:
- Needs careful implementation to avoid over-stripping legitimate content (e.g. “-5%” vs “- ”).

### Option B — Fix in UI rendering: filter/strip at display time
Before mapping to `renderMarkdownWithRefs`, normalize defensively:

- `.filter((s) => s && s.trim() && s.trim() !== '-')`
- optionally strip leading bullet prefix only for print mode to avoid nested bullets

Pros:
- Immediate symptom relief in the UI (print/PDF) even with polluted data

Cons:
- DB still stores malformed values, which can affect exports, APIs, analytics, and future features.

### Option C — Fix prompt specification for list fields
Clarify that list fields are arrays and each element must be:
- a self-contained markdown sentence/paragraph
- **must not** start with `-`, `*`, `•`, or numbered list prefixes
- must be non-empty and meaningful

Pros:
- Reduces probability of malformed output

Cons:
- Prompts alone are not sufficient; models can still violate formatting under some conditions.

### Option D — Data remediation (one-time cleanup)
Run a DB cleanup script to normalize all existing use cases:
- remove marker-only items and leading bullets, possibly splitting multi-line lists

Pros:
- Retroactively fixes existing bad rows (including this one)

Cons:
- Writes to DB ⇒ should be treated as a “⚠ approval” operation if run on production.

## Conclusion
The empty bullets are not a “mysterious UI normalization” issue: they are directly explained by persisted list arrays containing malformed bullet markers (notably `"-"` elements) coming from `gpt-5.2` output, combined with UI print rendering that wraps each array element as a bullet while rendering markdown inside.


