# Rapport d'analyse : Rendu Markdown en streaming

## Contexte

L'objectif est d'afficher les streams (reasoning et réponses) en markdown formaté au lieu de texte brut, tout en maintenant une expérience fluide sans blink ni surcharge CPU excessive.

## État actuel

### Rendu actuel
- **Fichier** : `ui/src/lib/components/StreamMessage.svelte`
- **Méthode** : Texte brut avec `whitespace-pre-wrap`
- **Zones concernées** :
  - `st.contentText` : Contenu principal (réponses)
  - `st.auxText` : Reasoning/étapes intermédiaires
  - `step.body` : Corps des étapes détaillées

### Bibliothèques disponibles
- `marked` v12.0.0 (déjà installé)
- `renderMarkdownWithRefs()` dans `ui/src/lib/utils/markdown.ts` (utilise `marked`)

## Analyse technique

### 1. Comportement de `marked`

**Fonctionnement** :
- `marked()` parse **tout le markdown** à chaque appel
- Pas de support natif pour le streaming incrémental
- Retourne du HTML complet à chaque fois

**Impact sur le streaming** :
- Chaque delta (ex: "+ 3 caractères") → re-parse complet du texte accumulé
- Exemple : 1000 caractères → delta de 10 → re-parse de 1010 caractères
- **Coût CPU** : O(n) à chaque delta, où n = taille totale accumulée

### 2. Comportement de `{@html}` dans Svelte

**Fonctionnement** :
- Svelte remplace **tout le contenu HTML** du nœud à chaque changement
- Le DOM est **complètement recréé** (pas de diff)
- Les éléments DOM existants sont **supprimés puis recréés**

**Impact visuel** :
- **Blink potentiel** : Si le contenu change fréquemment (chaque delta)
- **Perte de focus/scroll** : Le scroll position peut être perdu
- **Animations interrompues** : Toute animation CSS est réinitialisée

**Performance** :
- Coût de destruction + création DOM : modéré pour de petits contenus
- Peut devenir coûteux pour de gros contenus (>10KB HTML)

### 3. Fréquence des updates

**Estimation** :
- Deltas reasoning : ~10-50ms entre chaque delta
- Deltas content : ~50-200ms entre chaque delta
- Taille typique d'un delta : 5-50 caractères
- Taille finale typique : 500-5000 caractères

**Impact** :
- **100-200 re-renders** pour un message complet
- Chaque re-render = re-parse markdown + remplacement DOM complet

## Options proposées

### Option 1 : Rendu markdown simple avec `marked` + `{@html}`

**Implémentation** :
```svelte
$: contentHtml = st.contentText 
  ? renderMarkdownWithRefs(st.contentText, [], { addListStyles: true })
  : '';

<div class="..." {@html contentHtml}></div>
```

**Avantages** :
- ✅ Simple à implémenter (2-3 lignes)
- ✅ Réutilise l'infrastructure existante (`renderMarkdownWithRefs`)
- ✅ Support complet du markdown (listes, titres, liens, etc.)

**Inconvénients** :
- ❌ Re-parse complet à chaque delta (coût CPU cumulatif)
- ❌ Remplacement DOM complet à chaque delta (risque de blink)
- ❌ Perte potentielle de scroll position
- ❌ Pas de rendu progressif (tout ou rien)

**Performance estimée** :
- CPU : Modéré pour petits contenus (<1KB), élevé pour gros contenus (>5KB)
- DOM : Blink visible si updates >10Hz, acceptable si <5Hz

**Recommandation** : ⚠️ **Acceptable pour POC, à optimiser ensuite**

---

### Option 2 : Buffer avec rendu différé (debounce/throttle)

**Implémentation** :
```svelte
let bufferedContent = '';
let renderedHtml = '';

$: {
  bufferedContent = st.contentText;
  // Debounce : attendre 200ms sans update avant de re-render
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    renderedHtml = renderMarkdownWithRefs(bufferedContent, [], { addListStyles: true });
  }, 200);
}

<div class="..." {@html renderedHtml}></div>
```

**Avantages** :
- ✅ Réduit drastiquement le nombre de re-renders (ex: 200 → 10)
- ✅ Moins de blink (updates moins fréquentes)
- ✅ Réutilise `marked` existant
- ✅ Bon compromis performance/fluidité

**Inconvénients** :
- ❌ Délai de 200ms avant affichage du markdown (texte brut visible pendant le streaming)
- ❌ Nécessite un état de "streaming" vs "finalisé"
- ❌ Légère complexité supplémentaire

**Performance estimée** :
- CPU : Faible (10x moins de re-renders)
- DOM : Blink minimal (updates <1Hz pendant streaming)
- UX : Légère latence visuelle (200ms)

**Recommandation** : ✅ **Meilleur compromis pour production**

---

### Option 3 : Rendu hybride (texte brut → markdown final)

**Implémentation** :
```svelte
$: isStreaming = status !== 'completed' && status !== 'failed';
$: contentHtml = isStreaming 
  ? null  // Texte brut pendant streaming
  : renderMarkdownWithRefs(st.contentText, [], { addListStyles: true });

{#if isStreaming}
  <div class="... whitespace-pre-wrap">{st.contentText}</div>
{:else if contentHtml}
  <div class="..." {@html contentHtml}></div>
{/if}
```

**Avantages** :
- ✅ Pas de re-parse pendant streaming (performance optimale)
- ✅ Markdown formaté à la fin (meilleure lisibilité finale)
- ✅ Simple à implémenter
- ✅ Pas de blink (pas de remplacement DOM pendant streaming)

**Inconvénients** :
- ❌ Pas de formatage markdown pendant le streaming (texte brut uniquement)
- ❌ Transition visuelle à la fin (texte → HTML)
- ❌ Moins "fluide" visuellement

**Performance estimée** :
- CPU : Optimal (0 re-parse pendant streaming)
- DOM : Pas de blink (pas de remplacement pendant streaming)
- UX : Formatage visible seulement à la fin

**Recommandation** : ✅ **Excellent pour performance, UX acceptable**

---

### Option 4 : Bibliothèque de streaming markdown

**Bibliothèque candidate** : `streaming-markdown` ou similaire

**Implémentation** :
```svelte
import { StreamingMarkdown } from 'streaming-markdown';

let renderer = new StreamingMarkdown();

$: {
  renderer.append(st.contentText);
  contentHtml = renderer.getHtml();
}
```

**Avantages** :
- ✅ Conçu pour le streaming (parsing incrémental)
- ✅ Pas de re-parse complet à chaque delta
- ✅ Rendu progressif optimal

**Inconvénients** :
- ❌ Nouvelle dépendance (maintenance, taille bundle)
- ❌ Peut ne pas supporter toutes les features de `marked`
- ❌ Nécessite migration de `renderMarkdownWithRefs`
- ❌ Moins mature que `marked`

**Performance estimée** :
- CPU : Optimal (parsing incrémental)
- DOM : Blink possible selon implémentation
- Maintenance : Risque (dépendance externe)

**Recommandation** : ⚠️ **À évaluer si les autres options ne suffisent pas**

---

### Option 5 : Diff algorithm personnalisé (DOM diff)

**Implémentation** :
```svelte
import { diff } from 'diff-dom';

let container: HTMLElement;

$: {
  const newHtml = renderMarkdownWithRefs(st.contentText, [], { addListStyles: true });
  if (container) {
    diff(container, newHtml); // Met à jour seulement les parties changées
  }
}

<div bind:this={container}></div>
```

**Avantages** :
- ✅ Pas de remplacement DOM complet (pas de blink)
- ✅ Conserve scroll position, focus, animations
- ✅ Performance DOM optimale

**Inconvénients** :
- ❌ Complexité élevée (implémentation custom)
- ❌ Nécessite une bibliothèque de diff (ex: `diff-dom`)
- ❌ Re-parse markdown complet toujours nécessaire
- ❌ Risque de bugs (diff algorithm)

**Performance estimée** :
- CPU : Identique à Option 1 (re-parse complet)
- DOM : Optimal (pas de blink, diff incrémental)
- Maintenance : Élevée (complexité)

**Recommandation** : ⚠️ **Overkill pour ce cas d'usage**

---

## Recommandation finale

### Pour le reasoning (`st.auxText`, `step.body`)

**Option recommandée** : **Option 3 (Hybride)**

**Justification** :
- Le reasoning est souvent du texte brut ou des logs
- Le formatage markdown n'est pas critique pendant le streaming
- Performance optimale (0 re-parse)
- Transition propre à la fin

**Implémentation** :
```svelte
$: isTerminal = isTerminalStatus(status);
$: auxHtml = isTerminal && st.auxText
  ? renderMarkdownWithRefs(st.auxText, [], { addListStyles: true })
  : null;

{#if auxHtml}
  <div class="..." {@html auxHtml}></div>
{:else if st.auxText}
  <div class="... whitespace-pre-wrap">{st.auxText}</div>
{/if}
```

### Pour le contenu principal (`st.contentText`, `finalContent`)

**Option recommandée** : **Option 2 (Buffer avec debounce)**

**Justification** :
- Le contenu principal bénéficie du formatage markdown
- Le debounce de 200ms est acceptable (delta typique ~50-200ms)
- Réduit drastiquement les re-renders (200 → ~10)
- Bon compromis performance/UX

**Implémentation** :
```svelte
let contentHtml = '';
let renderTimeout: ReturnType<typeof setTimeout> | null = null;

$: {
  const text = st.contentText || finalContent || '';
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => {
    contentHtml = text 
      ? renderMarkdownWithRefs(text, [], { addListStyles: true })
      : '';
    renderTimeout = null;
  }, 200);
}

onDestroy(() => {
  if (renderTimeout) clearTimeout(renderTimeout);
});

<div class="..." {@html contentHtml}></div>
```

**Alternative si blink persiste** : **Option 3 (Hybride)** pour le contenu aussi

---

## Impact estimé

### Option 2 (Buffer debounce) - Recommandée
- **CPU** : Réduction de ~90% des re-renders (200 → 20)
- **DOM** : Blink minimal (updates <1Hz)
- **UX** : Formatage visible avec délai de 200ms
- **Complexité** : Faible (+10 lignes de code)

### Option 3 (Hybride) - Alternative
- **CPU** : Réduction de 100% des re-renders pendant streaming
- **DOM** : Aucun blink (pas de remplacement)
- **UX** : Formatage seulement à la fin
- **Complexité** : Très faible (+5 lignes de code)

---

## Plan d'implémentation

1. **Phase 1** : Implémenter Option 3 (Hybride) pour reasoning
   - Test rapide, impact minimal
   - Validation UX

2. **Phase 2** : Implémenter Option 2 (Buffer) pour contenu principal
   - Ajuster le délai de debounce selon feedback (100-300ms)
   - Monitorer les performances

3. **Phase 3** : Optimisation si nécessaire
   - Si blink persiste → passer à Option 3 pour contenu aussi
   - Si CPU élevé → augmenter délai debounce

---

## Détection JSON vs Markdown

**Question** : Comment détecter si le contenu est JSON ou Markdown ?

**Proposition** :
```typescript
function isJsonContent(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

// Usage
$: shouldRenderMarkdown = !isJsonContent(st.contentText);
```

**Alternative** : Utiliser un flag depuis l'API (ex: `contentFormat: 'json' | 'markdown' | 'text'`)

---

## Conclusion

**Recommandation principale** :
- **Reasoning** : Option 3 (Hybride) - Texte brut pendant streaming, markdown à la fin
- **Contenu principal** : Option 2 (Buffer debounce 200ms) - Markdown avec délai

**Bénéfices attendus** :
- Réduction de 90%+ des re-renders
- Blink minimal ou inexistant
- Formatage markdown visible
- Complexité faible

**Risques** :
- Délai de 200ms avant formatage (acceptable)
- Transition visuelle à la fin pour reasoning (acceptable)

