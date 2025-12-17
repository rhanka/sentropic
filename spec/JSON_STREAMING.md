# Rapport d'analyse : Rendu JSON en streaming

## Contexte

L'objectif est d'afficher les JSONs (arguments de tool calls et réponses structurées) de manière formatée et lisible pendant le streaming, tout en gérant les JSONs incomplets/invalides qui apparaissent naturellement pendant le streaming.

## État actuel

### Rendu actuel
- **Fichier** : `ui/src/lib/components/StreamMessage.svelte`
- **Méthode** : Texte brut avec `whitespace-pre-wrap`
- **Zones concernées** :
  - `st.toolArgsById[toolId]` : Arguments JSON des tool calls (streaming via `tool_call_delta`)
  - `st.contentText` : Réponses structurées (potentiellement JSON)
  - `step.body` : Corps des étapes (peut contenir des JSONs)

### Problématique principale

**JSON incomplet/invalide pendant le streaming** :
- Pendant le streaming, le JSON est construit progressivement
- Exemple : `{"useCaseId": "123", "updates": [` → JSON invalide
- `JSON.parse()` échoue sur des JSONs incomplets
- Affichage brut = illisible pour des JSONs complexes

**Exemples de JSONs partiels** :
```json
// Étape 1 : {"useCaseId"
// Étape 2 : {"useCaseId": "123"
// Étape 3 : {"useCaseId": "123", "updates": [
// Étape 4 : {"useCaseId": "123", "updates": [{"path": "description"
// Étape 5 : {"useCaseId": "123", "updates": [{"path": "description", "value": "..."}]}
```

## Analyse technique

### 1. Problème du JSON incomplet

**Fonctionnement de `JSON.parse()`** :
- Parse uniquement des JSONs **valides et complets**
- Lance une exception `SyntaxError` sur JSON incomplet
- Ne peut pas parser progressivement

**Impact sur le streaming** :
- Impossible d'utiliser `JSON.parse()` pendant le streaming
- Affichage brut = illisible pour JSONs complexes
- Besoin d'une stratégie de "best-effort" parsing

### 2. Fréquence des updates

**Estimation** :
- Deltas tool_call : ~10-50ms entre chaque delta
- Taille typique d'un delta : 1-20 caractères
- Taille finale typique d'un JSON tool call : 100-2000 caractères
- Nombre de deltas pour un JSON complet : 10-100

**Impact** :
- **10-100 tentatives de parsing** pour un JSON complet
- Chaque tentative = validation + formatage (si valide)

### 3. Types de JSONs à gérer

**1. Arguments de tool calls** (`tool_call_delta`) :
```json
{
  "useCaseId": "abc123",
  "updates": [
    {"path": "description", "value": "Nouvelle description"},
    {"path": "problem", "value": "Nouveau problème"}
  ]
}
```

**2. Réponses structurées** (`content_delta`) :
```json
{
  "status": "completed",
  "results": [
    {"url": "https://...", "content": "..."}
  ]
}
```

**3. Erreurs JSON** :
```json
{
  "status": "error",
  "error": "Use case not found"
}
```

## Options proposées

### Option 1 : Formatage JSON simple avec try/catch

**Implémentation** :
```svelte
function formatJsonSafely(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // JSON incomplet : retourner tel quel ou avec indication
    return text + ' ⏳';
  }
}

$: formattedToolArgs = Object.entries(st.toolArgsById).map(([id, args]) => ({
  id,
  formatted: formatJsonSafely(args)
}));
```

**Avantages** :
- ✅ Simple à implémenter (5-10 lignes)
- ✅ Formatage automatique quand JSON valide
- ✅ Pas de crash sur JSON incomplet

**Inconvénients** :
- ❌ Pas de formatage pendant le streaming (JSON invalide)
- ❌ Affichage brut jusqu'à ce que JSON soit complet
- ❌ Indicateur visuel minimal (⏳)

**Performance estimée** :
- CPU : Faible (1 parse par delta, échoue rapidement si invalide)
- DOM : Updates fréquents (chaque delta)
- UX : Formatage seulement à la fin

**Recommandation** : ⚠️ **Acceptable mais UX limitée**

---

### Option 2 : Parser JSON partiel (best-effort)

**Implémentation** :
```svelte
function formatJsonPartial(text: string): string {
  // Essayer de parser le JSON complet
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // JSON incomplet : essayer de formater ce qui est valide
    // Exemple : {"key": "val → {"key": "val
    // On peut au moins indenter les parties valides
    return formatPartialJson(text);
  }
}

function formatPartialJson(text: string): string {
  // Algorithme simple : indent selon niveau de nesting
  let indent = 0;
  let result = '';
  let inString = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prev = text[i - 1];
    
    if (char === '"' && prev !== '\\') inString = !inString;
    if (inString) {
      result += char;
      continue;
    }
    
    if (char === '{' || char === '[') {
      result += char + '\n' + '  '.repeat(++indent);
    } else if (char === '}' || char === ']') {
      indent = Math.max(0, indent - 1);
      result += '\n' + '  '.repeat(indent) + char;
    } else if (char === ',') {
      result += ',\n' + '  '.repeat(indent);
    } else if (char === ':') {
      result += ': ';
    } else {
      result += char;
    }
  }
  
  return result;
}
```

**Avantages** :
- ✅ Formatage progressif même sur JSON incomplet
- ✅ Meilleure lisibilité pendant le streaming
- ✅ Indentation basique même si JSON invalide

**Inconvénients** :
- ❌ Complexité modérée (algorithme de parsing partiel)
- ❌ Peut produire des indentations incorrectes
- ❌ Nécessite gestion des cas edge (strings, échappements)

**Performance estimée** :
- CPU : Modéré (parsing caractère par caractère)
- DOM : Updates fréquents mais formatage visible
- UX : Formatage visible pendant streaming

**Recommandation** : ✅ **Bon compromis complexité/UX**

---

### Option 3 : Buffer avec formatage différé (debounce)

**Implémentation** :
```svelte
let bufferedToolArgs: Record<string, string> = {};
let formattedToolArgs: Record<string, string> = {};
let formatTimeout: ReturnType<typeof setTimeout> | null = null;

$: {
  bufferedToolArgs = st.toolArgsById;
  // Debounce : attendre 300ms sans update avant de formater
  if (formatTimeout) clearTimeout(formatTimeout);
  formatTimeout = setTimeout(() => {
    formattedToolArgs = {};
    for (const [id, args] of Object.entries(bufferedToolArgs)) {
      try {
        const parsed = JSON.parse(args);
        formattedToolArgs[id] = JSON.stringify(parsed, null, 2);
      } catch {
        // JSON incomplet : essayer formatage partiel
        formattedToolArgs[id] = formatPartialJson(args) + ' ⏳';
      }
    }
    formatTimeout = null;
  }, 300);
}
```

**Avantages** :
- ✅ Réduit les re-renders (10-100 → ~5-10)
- ✅ Formatage visible pendant streaming (avec délai)
- ✅ Combine Option 1 + Option 2
- ✅ Moins de blink

**Inconvénients** :
- ❌ Délai de 300ms avant formatage
- ❌ Complexité modérée (debounce + parsing)
- ❌ Nécessite gestion des timeouts

**Performance estimée** :
- CPU : Faible (10x moins de formatages)
- DOM : Blink minimal (updates <1Hz)
- UX : Formatage visible avec délai acceptable

**Recommandation** : ✅ **Meilleur compromis pour production**

---

### Option 4 : Bibliothèque de JSON streaming

**Bibliothèques candidates** :
- `json-stream-stringify` : Streaming JSON stringify
- `stream-json` : Parse JSON en streaming
- `oboe` : JSON streaming parser

**Implémentation** :
```svelte
import { StreamParser } from 'stream-json';

let parser = new StreamParser();

$: {
  parser.write(st.toolArgsById[toolId]);
  const formatted = parser.getFormatted();
  // ...
}
```

**Avantages** :
- ✅ Conçu pour le streaming JSON
- ✅ Gestion native des JSONs incomplets
- ✅ Performance optimale

**Inconvénients** :
- ❌ Nouvelle dépendance (maintenance, taille bundle)
- ❌ Peut nécessiter adaptation à notre architecture
- ❌ Complexité d'intégration

**Performance estimée** :
- CPU : Optimal (parsing streaming natif)
- DOM : Selon implémentation
- Maintenance : Risque (dépendance externe)

**Recommandation** : ⚠️ **À évaluer si Option 2/3 ne suffisent pas**

---

### Option 5 : Rendu hybride (texte brut → JSON formaté final)

**Implémentation** :
```svelte
$: isTerminal = isTerminalStatus(status);
$: formattedToolArgs = isTerminal
  ? Object.entries(st.toolArgsById).reduce((acc, [id, args]) => {
      try {
        const parsed = JSON.parse(args);
        acc[id] = JSON.stringify(parsed, null, 2);
      } catch {
        acc[id] = args; // Fallback brut si invalide
      }
      return acc;
    }, {} as Record<string, string>)
  : {};

{#each Object.entries(st.toolArgsById) as [id, args]}
  {#if isTerminal && formattedToolArgs[id]}
    <pre class="json-formatted">{formattedToolArgs[id]}</pre>
  {:else}
    <pre class="json-raw">{args}</pre>
  {/if}
{/each}
```

**Avantages** :
- ✅ Pas de parsing pendant streaming (performance optimale)
- ✅ JSON formaté à la fin (meilleure lisibilité)
- ✅ Simple à implémenter
- ✅ Pas de blink (pas de remplacement pendant streaming)

**Inconvénients** :
- ❌ Pas de formatage pendant le streaming (texte brut)
- ❌ Transition visuelle à la fin (brut → formaté)
- ❌ Moins "fluide" visuellement

**Performance estimée** :
- CPU : Optimal (0 parsing pendant streaming)
- DOM : Pas de blink (pas de remplacement)
- UX : Formatage seulement à la fin

**Recommandation** : ✅ **Excellent pour performance, UX acceptable**

---

### Option 6 : Syntax highlighting avec highlight.js ou Prism

**Implémentation** :
```svelte
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('json', json);

function formatJsonWithHighlight(text: string, isComplete: boolean): string {
  if (isComplete) {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      return hljs.highlight(formatted, { language: 'json' }).value;
    } catch {
      return hljs.highlight(text, { language: 'json' }).value;
    }
  } else {
    // JSON incomplet : highlight basique
    return hljs.highlight(text, { language: 'json' }).value;
  }
}
```

**Avantages** :
- ✅ Coloration syntaxique professionnelle
- ✅ Meilleure lisibilité (couleurs pour clés, valeurs, strings)
- ✅ Support des JSONs incomplets (highlight basique)

**Inconvénients** :
- ❌ Nouvelle dépendance (`highlight.js` ~50KB minifié)
- ❌ Coût CPU pour highlight (modéré)
- ❌ Nécessite styles CSS additionnels

**Performance estimée** :
- CPU : Modéré (highlight à chaque update)
- DOM : Blink possible selon fréquence
- UX : Excellente lisibilité

**Recommandation** : ⚠️ **Optionnel, à combiner avec Option 2 ou 3**

---

## Recommandation finale

### Pour les arguments de tool calls (`st.toolArgsById`)

**Option recommandée** : **Option 3 (Buffer avec debounce) + Option 6 (Syntax highlighting optionnel)**

**Justification** :
- Les tool calls sont souvent des JSONs complexes (arrays, objets imbriqués)
- Le formatage améliore drastiquement la lisibilité
- Le debounce de 300ms réduit les re-renders (10-100 → ~5-10)
- Le syntax highlighting améliore encore la lisibilité (optionnel)

**Implémentation** :
```svelte
let formattedToolArgs: Record<string, string> = {};
let formatTimeout: ReturnType<typeof setTimeout> | null = null;

function formatJsonSafely(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // JSON incomplet : formatage partiel basique
    return formatPartialJson(text) + ' ⏳';
  }
}

function formatPartialJson(text: string): string {
  // Algorithme simple d'indentation
  let indent = 0;
  let result = '';
  let inString = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prev = text[i - 1];
    
    if (char === '"' && prev !== '\\') inString = !inString;
    if (inString) {
      result += char;
      continue;
    }
    
    if (char === '{' || char === '[') {
      result += char + '\n' + '  '.repeat(++indent);
    } else if (char === '}' || char === ']') {
      indent = Math.max(0, indent - 1);
      result += '\n' + '  '.repeat(indent) + char;
    } else if (char === ',') {
      result += ',\n' + '  '.repeat(indent);
    } else if (char === ':') {
      result += ': ';
    } else {
      result += char;
    }
  }
  
  return result;
}

$: {
  if (formatTimeout) clearTimeout(formatTimeout);
  formatTimeout = setTimeout(() => {
    formattedToolArgs = {};
    for (const [id, args] of Object.entries(st.toolArgsById)) {
      formattedToolArgs[id] = formatJsonSafely(args);
    }
    formatTimeout = null;
  }, 300);
}

onDestroy(() => {
  if (formatTimeout) clearTimeout(formatTimeout);
});
```

**Affichage** :
```svelte
{#each Object.entries(st.toolArgsById) as [id, args]}
  <div class="tool-args">
    <pre class="json-content language-json">
      {formattedToolArgs[id] || args}
    </pre>
  </div>
{/each}
```

### Pour les réponses structurées (`st.contentText`)

**Option recommandée** : **Option 5 (Hybride) - Détection automatique JSON**

**Justification** :
- Les réponses peuvent être JSON ou texte/markdown
- Détection automatique : si JSON valide → formater, sinon → markdown/texte
- Formatage seulement à la fin (performance optimale)
- Pas de parsing pendant streaming

**Implémentation** :
```svelte
function isJsonContent(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

function formatJsonIfValid(text: string): string | null {
  if (!isJsonContent(text)) return null;
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null; // JSON invalide ou incomplet
  }
}

$: isTerminal = isTerminalStatus(status);
$: contentJson = isTerminal && st.contentText
  ? formatJsonIfValid(st.contentText)
  : null;
```

**Affichage** :
```svelte
{#if contentJson}
  <pre class="json-formatted">{contentJson}</pre>
{:else if st.contentText}
  <!-- Rendu markdown/texte normal -->
  <div class="content-text">{st.contentText}</div>
{/if}
```

---

## Impact estimé

### Option 3 (Buffer debounce) - Recommandée pour tool calls
- **CPU** : Réduction de ~90% des formatages (100 → 10)
- **DOM** : Blink minimal (updates <1Hz)
- **UX** : Formatage visible avec délai de 300ms
- **Complexité** : Modérée (+30-40 lignes de code)

### Option 5 (Hybride) - Recommandée pour réponses
- **CPU** : Optimal (0 parsing pendant streaming)
- **DOM** : Pas de blink (pas de remplacement)
- **UX** : Formatage seulement à la fin (acceptable)
- **Complexité** : Faible (+15 lignes de code)

### Option 6 (Syntax highlighting) - Optionnel
- **CPU** : Modéré (highlight à chaque formatage)
- **Bundle** : +50KB (highlight.js)
- **UX** : Excellente lisibilité
- **Complexité** : Faible (+10 lignes de code)

---

## Plan d'implémentation

1. **Phase 1** : Implémenter Option 5 (Hybride) pour réponses structurées
   - Détection automatique JSON
   - Formatage à la fin seulement
   - Test rapide, impact minimal

2. **Phase 2** : Implémenter Option 3 (Buffer) pour tool calls
   - Parser JSON partiel (`formatPartialJson`)
   - Debounce 300ms
   - Validation UX

3. **Phase 3** : Optionnel - Ajouter syntax highlighting
   - Intégrer `highlight.js` ou `Prism`
   - Styles CSS pour JSON
   - Amélioration visuelle

---

## Détection JSON vs Markdown/Text

**Stratégie de détection** :

```typescript
function detectContentType(text: string): 'json' | 'markdown' | 'text' {
  const trimmed = text.trim();
  
  // Détection JSON
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // JSON invalide : peut être JSON incomplet ou autre
      // On considère comme JSON si structure ressemble à JSON
      if (trimmed.match(/^[{\[]/)) return 'json';
    }
  }
  
  // Détection Markdown (patterns basiques)
  if (
    trimmed.includes('##') || // Titres
    trimmed.includes('- ') || // Listes
    trimmed.includes('*') || // Emphasis
    trimmed.includes('`') // Code
  ) {
    return 'markdown';
  }
  
  return 'text';
}
```

**Alternative** : Flag depuis l'API (ex: `contentFormat: 'json' | 'markdown' | 'text'`)

---

## Gestion des erreurs JSON

**Cas d'erreur** :
1. **JSON incomplet** (streaming) : Formatage partiel + indicateur ⏳
2. **JSON invalide** (syntax error) : Affichage brut + message d'erreur
3. **JSON malformé** (structure incorrecte) : Affichage brut + warning

**Implémentation** :
```typescript
type JsonFormatResult = {
  formatted: string;
  isValid: boolean;
  isComplete: boolean;
  error?: string;
};

function formatJsonWithStatus(text: string): JsonFormatResult {
  try {
    const parsed = JSON.parse(text);
    return {
      formatted: JSON.stringify(parsed, null, 2),
      isValid: true,
      isComplete: true
    };
  } catch (error) {
    // JSON invalide ou incomplet
    const isIncomplete = text.match(/[{\[].*[^}\]\s]*$/); // Se termine par { ou [
    return {
      formatted: formatPartialJson(text) + (isIncomplete ? ' ⏳' : ' ❌'),
      isValid: false,
      isComplete: !isIncomplete,
      error: error instanceof Error ? error.message : 'Invalid JSON'
    };
  }
}
```

---

## Conclusion

**Recommandation principale** :
- **Tool calls** : Option 3 (Buffer debounce 300ms) + formatage partiel
- **Réponses structurées** : Option 5 (Hybride) - Formatage à la fin seulement
- **Syntax highlighting** : Optionnel (Option 6) pour amélioration visuelle

**Bénéfices attendus** :
- Réduction de 90%+ des formatages
- Formatage visible pendant streaming (avec délai)
- Gestion robuste des JSONs incomplets
- Complexité modérée

**Risques** :
- Délai de 300ms avant formatage (acceptable)
- Formatage partiel peut être imparfait (acceptable)
- Syntax highlighting ajoute ~50KB au bundle (optionnel)

