# Recipe – Use Case Markdown Editing

## Objectif
Garantir que les cartes « cas d’usage » exploitent `EditableInput` exactement comme le dashboard, sans casser les données historiques (puces `•`, sauts simples, totaux calculés côté API) et sans perturber les colonnes dérivées (`total_value_score`, `total_complexity_score`). Cette recette décrit le pipeline à répliquer pour les phases suivantes (listes, justifications, etc.).

---

## Chaîne de données

1. **Génération / stockage**
   - Les prompts (`use_case_detail`) imposent du Markdown, mais l’historique contient souvent des puces Unicode (`•`, `▪`) et des sauts simples.
   - L’API (`POST /use-cases`, `POST /:id/detail`) stocke la valeur telle quelle, sans normalisation.

2. **Lecture côté UI**
   - Toujours récupérer le use case via `apiGet('/use-cases/:id')` et pousser la version brute dans `useCasesStore`.
   - Avant d’initialiser `EditableInput`, normaliser localement la chaîne (cf. helper ci-dessous) pour assurer un rendu identique au dashboard.

3. **Écriture**
   - `EditableInput` n’envoie que les champs réellement modifiés. Pour la description : `fullData = { description: normalizeUseCaseMarkdown(value) }`.
   - L’API `PUT /use-cases/:id` recalcule les scores **uniquement si le payload fournit `valueScores` ou `complexityScores`** ; sinon les colonnes dérivées ne bougent pas.

---

## Helper de normalisation

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

- **Idempotent** : une fois les puces converties et les doubles sauts ajoutés, relancer la fonction ne modifie plus la chaîne.
- **Performance** : deux passages linéaires (pas de lookbehind), donc négligeable même pour des textes longs.

---

## Pattern côté composant (`UseCaseDetail.svelte`)

1. **Imports clés**
   ```ts
   import EditableInput from '$lib/components/EditableInput.svelte';
   import { apiGet } from '$lib/utils/api';
   import { useCasesStore } from '$lib/stores/useCases';
   import { normalizeUseCaseMarkdown } from '$lib/utils/markdown';
   ```

2. **État local**
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

3. **Wrapper HTML identique au dashboard**
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

4. **Reload après sauvegarde**
   ```ts
   const reloadUseCase = async (id: string) => {
     const updated = await apiGet(`/use-cases/${id}`);
     useCasesStore.update(items => items.map(uc => uc.id === id ? updated : uc));
     useCase = updated;
   };
   ```

---

## Backend : route `PUT /use-cases/:id`

- **Avant** : recalcul systématique des totaux (donnant parfois des décimales) → tentative d’écriture `"111.5"` dans une colonne `integer` → erreur `22P02`.
- **Maintenant** :
  ```ts
  const shouldRecompute = payload.valueScores !== undefined || payload.complexityScores !== undefined;
  if (matrix && shouldRecompute) {
    const computed = withComputedScores(...);
    roundedValueScore = Math.round(computed.totalValueScore);
    roundedComplexityScore = Math.round(computed.totalComplexityScore);
  }
  ```
- Résultat : une simple mise à jour (`description`, `contact`, etc.) ne touche plus aux totaux, et les recalculs sont arrondis comme lors de la génération initiale.

---

## Tests recommandés

1. **Edition description**
   - Modifier la description d’un use case contenant des puces `•` / références `[1]`.
   - Attendre la sauvegarde (5 s) et vérifier dans les logs API l’absence d’erreurs `22P02`.
   - Confirmer que la valeur rechargée dans la page reflète le markdown normalisé.

2. **Print**
   - Passer en preview impression et vérifier que `description-compact-print` continue de réduire la taille si besoin.

3. **Regression API**
   - Appeler `PUT /use-cases/:id` sans `valueScores`/`complexityScores` (ex via curl) → les colonnes `total_*` ne changent pas.
   - Appeler la même route avec un payload incluant des scores → arrondi appliqué, pas d’erreur Postgres.

Ce document doit servir de référence pour les phases suivantes (listes, justifications, etc.) afin de reproduire fidèlement le workflow dashboard côté cas d’usage.


