# Feature: Minor Fixes and Improvements

## Objective
Implémenter les corrections mineures et améliorations identifiées dans TODO.md (lignes 47-101).

## Status
- **Progress**: 9/20 tâches complétées
- **Current**: Feat 4 complété (édition multiline du titre avec layouts différenciés)
- **Next**: Retravailler Fix WebAuthn pour login smartphone en localhost dev

## Commits
- [x] **Commit 1**: Fix 404 sur refresh GitHub Pages - activation du fallback 404.html
- [x] **Commit 2**: Fix comptage dans matrix - calcul et affichage du nombre de cas par seuil
- [x] **Commit 3**: Fix auto-save des seuils et recalcul automatique des comptages
- [x] **Commit 4**: Fix NavigationGuard - sauvegarde automatique au lieu d'afficher un dialogue
- [x] **Commit 5**: Feat ajout/suppression d'axes dans matrice
- [x] **Commit 6**: Feat tronquer taille dans fiches entreprise
- [x] **Commit 7**: Feat EditableInput markdown avec bordure orange et hover bord gauche gris
- [x] **Commit 8**: Feat édition du titre/nom du usecase avec EditableInput
- [x] **Commit 9**: Feat multiline title editing avec layout 50/50 pour entreprises

## Plan d'évolution des tests

### Tests à implémenter

#### 1. Tests E2E - Édition de titre (multiline)
**Fichiers concernés** : `e2e/tests/workflow.spec.ts`, `e2e/tests/companies.spec.ts`, `e2e/tests/companies-detail.spec.ts`

**Actions** :
- Mettre à jour les sélecteurs : `h1 input.editable-input` → `h1 textarea.editable-textarea, h1 input.editable-input`
- Tester l'édition multiline (retours à la ligne)
- Vérifier que le textarea s'ajuste automatiquement en hauteur

#### 2. Tests E2E - Matrice (ajout/suppression d'axes, comptage, auto-save)
**Fichier concerné** : `e2e/tests/matrix.spec.ts`

**Actions** :
- Ajouter test pour boutons "Ajouter axe de valeur" / "Ajouter axe de complexité"
- Ajouter test pour boutons de suppression d'axes
- Vérifier que le comptage se met à jour après modification des seuils
- Vérifier l'auto-save (attendre 5s après modification)

## Bilan des vérifications (typecheck + lint)

### Résultats
- ✅ **lint-api** : 0 erreur
- ❌ **typecheck-api** : 28 erreurs TypeScript
- ❌ **typecheck-ui** : 13 erreurs + 5 warnings
- ❌ **lint-ui** : 25 erreurs ESLint

### Plan de fix

#### 1. Typecheck API (28 erreurs)

**Priorité HAUTE - Bloquant pour le CI**

##### 1.1. Imports manquants `@simplewebauthn/types` (5 erreurs)
- `src/routes/auth/login.ts:13`
- `src/routes/auth/register.ts:14`
- `src/services/webauthn-authentication.ts:9`
- `src/services/webauthn-registration.ts:9`
- **Fix** : Ajouter `import type { ... } from '@simplewebauthn/types'` ou installer le package

##### 1.2. Types manquants WebAuthn (10 erreurs)
- `UserVerificationRequirement` non défini (5 occurrences)
- `AttestationConveyancePreference` non défini (2 occurrences)
- `src/services/webauthn-config.ts` : lignes 18, 20, 21, 22, 50, 67
- `src/services/webauthn-authentication.ts:48`
- **Fix** : Importer depuis `@simplewebauthn/types`

##### 1.3. Propriétés manquantes sur UseCase (4 erreurs)
- `src/routes/api/analytics.ts:45` : `useCase.name` n'existe pas
- `src/services/executive-summary.ts:92,102,103` : `useCase.name` et `useCase.description` n'existent pas
- **Fix** : Utiliser `useCase.data.name` et `useCase.data.description` ou adapter le type

##### 1.4. Incohérence titre/name (2 erreurs)
- `src/services/queue-manager.ts:328` : `title` vs `titre`
- `src/services/queue-manager.ts:477` : `name` manquant dans `UseCaseData`
- **Fix** : Normaliser sur `name` partout

##### 1.5. Types nodemailer manquants (2 erreurs)
- `src/services/email-verification.ts:8`
- `src/services/magic-link.ts:6`
- **Fix** : Installer `@types/nodemailer` ou créer un `.d.ts`

##### 1.6. Autres erreurs TypeScript (5 erreurs)
- `src/routes/api/queue.ts:155` : `del` de type `unknown`
- `src/routes/auth/register.ts:453` : `d.createdAt` possibly null
- `src/services/queue-manager.ts:518` : `domain` n'existe pas dans le type
- `src/services/queue-manager.ts:611-613` : `created_at` vs `createdAt` (snake_case vs camelCase)
- `src/services/session-manager.ts:126,289` : Conversions de types incorrectes
- `src/services/tools.ts:192` : `query` n'existe pas dans `SearchResult`
- `src/services/webauthn-authentication.ts:89,185,202` : Types incompatibles pour transports et credentials

#### 2. Typecheck UI (13 erreurs + 5 warnings)

**Priorité HAUTE - Bloquant pour le CI**

##### 2.1. Erreurs TypeScript dans matrice (10 erreurs)
- `src/routes/matrice/+page.svelte:22` : `availableFolders` type `any[]` implicite
- `src/routes/matrice/+page.svelte:193,215` : `points` de type `string | number` au lieu de `number`
- `src/routes/matrice/+page.svelte:318` : `MatrixAxis` non défini
- `src/routes/matrice/+page.svelte:665,758,827,872` : `e.target` possibly null et `value` n'existe pas sur `EventTarget`
- `src/routes/matrice/+page.svelte:1040` : `availableFolders` type `any[]` implicite
- **Fix** :
  - Typer `availableFolders: Folder[] = []`
  - Importer `MatrixAxis` depuis `src/types/matrix.ts`
  - Utiliser `(e.target as HTMLInputElement).value` avec vérification null
  - Convertir `points` en `number` avec `parseInt()` ou `Number()`

##### 2.2. Warnings Svelte (5 warnings)
- `EditableInput.svelte:535` : Label non associé à un contrôle (a11y)
- `EditableInput.svelte:800,809` : Sélecteurs CSS inutilisés
- `entreprises/+page.svelte:86` : Élément non-interactif avec click (a11y)
- **Fix** : 
  - Ajouter `for` au label ou utiliser `aria-label`
  - Supprimer les sélecteurs CSS inutilisés
  - Ajouter `on:keydown` ou transformer en `<button>`

#### 3. Lint UI (25 erreurs)

**Priorité MOYENNE - Non bloquant mais à corriger**

##### 3.1. Variables non utilisées (15 erreurs)
- `EditableInput.svelte:398` : `e` non utilisé
- `NavigationGuard.svelte:53,64` : `interceptPush`, `interceptReplace` non utilisés
- `UseCaseScatterPlot.svelte:1085` : `currentScale` non utilisé
- `entreprises/+page.svelte:2` : `Company` non utilisé
- `matrice/+page.svelte:5,613,616,706,709,815,818,860,863,941,947,950,956,959` : Variables `_` et `apiPost` non utilisées
- **Fix** : Supprimer ou préfixer avec `_` si intentionnel

##### 3.2. Erreurs ESLint/Svelte (10 erreurs)
- `EditableInput.svelte:535,800,809` : A11y et CSS (déjà identifiés dans typecheck)
- `entreprises/+page.svelte:86` : A11y (déjà identifié)
- `matrice/+page.svelte:318` : `MatrixAxis` non défini (déjà identifié)
- **Fix** : Voir section 2.2

### Ordre de priorité

1. **Typecheck API** : Corriger les imports WebAuthn et types manquants (bloquant CI)
2. **Typecheck UI** : Corriger les erreurs TypeScript dans matrice (bloquant CI)
3. **Lint UI** : Nettoyer les variables non utilisées (non bloquant)
4. **Warnings Svelte** : Améliorer l'accessibilité (non bloquant)

### Estimation
- **Typecheck API** : ~2-3h (corrections de types, imports, normalisation)
- **Typecheck UI** : ~1h (typage matrice, corrections event handlers)
- **Lint UI** : ~30min (nettoyage variables)
- **Total** : ~4h de travail
