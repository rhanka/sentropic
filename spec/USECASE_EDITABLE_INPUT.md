# Recipe – Use Case Markdown Editing

## Objective
Ensure that “use case” cards use `EditableInput` exactly like the dashboard, without breaking historical data (bullets `•`, single line breaks, API‑computed totals) and without disturbing derived columns (`total_value_score`, `total_complexity_score`). This recipe describes the pipeline to replicate for subsequent phases (lists, justifications, etc.).

---

## Data flow

1. **Generation / storage**
   - Prompts (`use_case_detail`) enforce Markdown, but historical data often contains Unicode bullets (`•`, `▪`) and single line breaks.
   - The API (`POST /use-cases`, `POST /:id/detail`) stores the value as‑is, without normalization.

2. **UI read**
   - Always fetch the use case via `apiGet('/use-cases/:id')` and push the raw version into `useCasesStore`.
   - Before initializing `EditableInput`, normalize the string locally (see helper below) to ensure the same rendering as the dashboard.

3. **Write**
   - `EditableInput` only sends fields that are actually modified. For description: `fullData = { description: normalizeUseCaseMarkdown(value) }`.
   - The API `PUT /use-cases/:id` recalculates scores **only if the payload provides `valueScores` or `complexityScores`**; otherwise derived columns do not change.

---

## Normalization helper

Fichier : `ui/src/lib/utils/markdown.ts`

```ts
const BULLET_PATTERN = /(^|\n)[ \t]*[•▪‣●◦]/g;
const SINGLE_NEWLINE_PATTERN = /([^\n\r])\r?\n(?!\r?\n|\s*[-*•])/g;

export function normalizeUseCaseMarkdown(text?: string | null) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')        // CRLF → LF
    .replace(BULLET_PATTERN, '$1- ')
    .replace(SINGLE_NEWLINE_PATTERN, '$1\n\n')
    .trim();
}
```

- **Idempotent**: once bullets are converted and double line breaks added, re‑running the function does not change the string.
- **Performance**: two linear passes (no lookbehind), negligible even for long texts.

---

## Component pattern (`UseCaseDetail.svelte`)

1. **Key imports**
   ```ts
   import EditableInput from '$lib/components/EditableInput.svelte';
   import { apiGet } from '$lib/utils/api';
   import { useCasesStore } from '$lib/stores/useCases';
   import { normalizeUseCaseMarkdown } from '$lib/utils/markdown';
   ```

2. **Local state**
   ```ts
   let editedDescription = '';
   let descriptionOriginalValue = '';
   let lastUseCaseId: string | null = null;

   $: if (useCase?.id) {
     const normalized = normalizeUseCaseMarkdown(useCase.description || '');
     if (useCase.id !== lastUseCaseId) {
       lastUseCaseId = useCase.id;
       editedDescription = normalized;
       descriptionOriginalValue = normalized;
     }
   }

   $: descriptionFullData = useCase?.id
     ? { description: normalizeUseCaseMarkdown(editedDescription || '') }
     : null;
   ```

3. **HTML wrapper identical to the dashboard**
   ```svelte
   {#if mode === 'print-only'}
     <div class="prose ..." class:description-compact-print={isDescriptionLong}>
       {@html descriptionHtml}
     </div>
   {:else}
     <div class="prose prose-slate max-w-none" class:description-compact-print={isDescriptionLong}>
       <div class="text-slate-700 ...">
         <EditableInput
           markdown={true}
           value={editedDescription}
           apiEndpoint={`/use-cases/${useCase.id}`}
           fullData={descriptionFullData}
           changeId={`usecase-description-${useCase.id}`}
           originalValue={descriptionOriginalValue}
           references={useCase?.references || []}
           on:change={(e) => editedDescription = e.detail.value}
           on:saved={() => reloadUseCase(useCase.id)}
         />
       </div>
     </div>
   {/if}
   ```

4. **Reload after save**
   ```ts
   const reloadUseCase = async (id: string) => {
     const updated = await apiGet(`/use-cases/${id}`);
     useCasesStore.update(items => items.map(uc => uc.id === id ? updated : uc));
     useCase = updated;
   };
   ```

---

## Backend: `PUT /use-cases/:id` route

- **Before**: systematic total recomputation (sometimes decimals) → attempted write `"111.5"` into an `integer` column → `22P02` error.
- **Now**:
  ```ts
  const shouldRecompute = payload.valueScores !== undefined || payload.complexityScores !== undefined;
  if (matrix && shouldRecompute) {
    const computed = withComputedScores(...);
    roundedValueScore = Math.round(computed.totalValueScore);
    roundedComplexityScore = Math.round(computed.totalComplexityScore);
  }
  ```
- Result: a simple update (`description`, `contact`, etc.) no longer touches totals, and recomputations are rounded like the initial generation.

---

## Recommended tests

1. **Edit description**
   - Modify a use case description containing bullets `•` / references `[1]`.
   - Wait for save (5s) and verify API logs contain no `22P02` errors.
   - Confirm the reloaded value reflects normalized markdown.

2. **Print**
   - Switch to print preview and verify `description-compact-print` still reduces size if needed.

3. **API regression**
   - Call `PUT /use-cases/:id` without `valueScores`/`complexityScores` (e.g., via curl) → `total_*` columns do not change.
   - Call the same route with a payload including scores → rounding applied, no Postgres error.

This document should serve as a reference for subsequent phases (lists, justifications, etc.) to faithfully reproduce the dashboard workflow for use cases.


