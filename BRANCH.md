# Feature: Minor Fixes and Improvements

## Objective
Implémenter les corrections mineures et améliorations identifiées dans TODO.md (lignes 47-101).

## Status
- **Progress**: 11/20 tâches complétées
- **Current**: Corrections typecheck API - createdAt NOT NULL (complété ✅)
- **Next**: Corriger les erreurs typecheck WebAuthn et Session Manager restantes

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
- [x] **Commit 10**: Fix typecheck API part 1 (sans WebAuthn - reset par utilisateur)
- [x] **Commit 11**: Feat dashboard folder title multiline et full width
- [x] **Commit 12**: Fix createdAt NOT NULL - ajout .notNull() à toutes les colonnes et suppression workarounds

## Bilan des vérifications (typecheck + lint)

### Résultats
- ✅ **lint-api** : 0 erreur
- ❌ **typecheck-api** : 9 erreurs TypeScript (était 28, -19 corrigées ✅)
- ❌ **typecheck-ui** : 13 erreurs + 5 warnings
- ❌ **lint-ui** : 25 erreurs ESLint

### Corrections typecheck API (complétées ✅)

#### Corrections effectuées
- ✅ **UseCase.name/description** : Utilisation de `data.name`/`data.description` au lieu de `name`/`description` au niveau racine
- ✅ **queue.ts** : Typage de `del` avec assertion de type
- ✅ **queue-manager.ts** : 
  - Suppression colonnes legacy (domain, prerequisites, deadline, etc.) du `.set()` (migration 0008 vers data JSONB)
  - Correction title vs titre
  - Correction createdAt/startedAt/completedAt (camelCase au lieu de snake_case)
  - Correction initialisation UseCaseData (Partial<UseCaseData>)
- ✅ **session-manager.ts** : Vérification explicite des types SessionPayload au lieu de double assertion (partiellement - 2 erreurs restantes)
- ✅ **tools.ts** : Correction type allSearchResults (`Array<{query, results}>` au lieu de `SearchResult[]`)
- ✅ **nodemailer** : Installation `@types/nodemailer` (types officiels)
- ✅ **createdAt NOT NULL** : Ajout de `.notNull()` à toutes les colonnes `createdAt` (9 tables) et suppression de 5 workarounds dans le code

### Erreurs restantes (9 erreurs)

#### 1. WebAuthn (6 erreurs) - ⚠️ PARTIELLEMENT CORRIGÉ
- ✅ **Imports corrigés** : Tous les imports `@simplewebauthn/types` remplacés par `@simplewebauthn/server`
- ✅ **createdAt fix** : Ajout de `.notNull()` à toutes les colonnes `createdAt` (erreur register.ts:453 corrigée)
- `src/routes/auth/login.ts:70` : Property 'challengeId' does not exist (should be 'challenge')
- `src/routes/auth/register.ts:179` : Property 'challengeId' does not exist (should be 'challenge')
- `src/routes/auth/register.ts:249,251` : instanceof error et Uint8Array constructor
- `src/services/webauthn-registration.ts:90` : Type 'AttestationConveyancePreference' incompatible ('indirect' non supporté)
- `src/services/webauthn-registration.ts:185,187` : instanceof error et Uint8Array constructor

#### 2. Session Manager (2 erreurs)
- `src/services/session-manager.ts:126` : Conversion JWTPayload to SessionPayload (double assertion nécessaire via unknown)
- `src/services/session-manager.ts:289` : No overload matches (lt/gt avec timestamps - utiliser gt + sql\`NOW()\`)

### Plan de fix restant

#### 1. Typecheck UI (13 erreurs + 5 warnings)

**Priorité HAUTE - Bloquant pour le CI**

##### 1.1. Erreurs TypeScript dans matrice (10 erreurs)
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

##### 1.2. Warnings Svelte (5 warnings)
- `EditableInput.svelte:535` : Label non associé à un contrôle (a11y)
- `EditableInput.svelte:800,809` : Sélecteurs CSS inutilisés
- `entreprises/+page.svelte:86` : Élément non-interactif avec click (a11y)
- **Fix** : 
  - Ajouter `for` au label ou utiliser `aria-label`
  - Supprimer les sélecteurs CSS inutilisés
  - Ajouter `on:keydown` ou transformer en `<button>`

#### 2. Lint UI (25 erreurs)

**Priorité MOYENNE - Non bloquant mais à corriger**

##### 2.1. Variables non utilisées (15 erreurs)
- `EditableInput.svelte:398` : `e` non utilisé
- `NavigationGuard.svelte:53,64` : `interceptPush`, `interceptReplace` non utilisés
- `UseCaseScatterPlot.svelte:1085` : `currentScale` non utilisé
- `entreprises/+page.svelte:2` : `Company` non utilisé
- `matrice/+page.svelte:5,613,616,706,709,815,818,860,863,941,947,950,956,959` : Variables `_` et `apiPost` non utilisées
- **Fix** : Supprimer ou préfixer avec `_` si intentionnel

##### 2.2. Erreurs ESLint/Svelte (10 erreurs)
- `EditableInput.svelte:535,800,809` : A11y et CSS (déjà identifiés dans typecheck)
- `entreprises/+page.svelte:86` : A11y (déjà identifié)
- `matrice/+page.svelte:318` : `MatrixAxis` non défini (déjà identifié)
- **Fix** : Voir section 1.2

### Ordre de priorité

1. **Typecheck API WebAuthn** : Corriger les erreurs WebAuthn (6 erreurs restantes)
2. **Typecheck API Session Manager** : Finir les corrections session-manager (2 erreurs)
3. **Typecheck UI** : Corriger les erreurs TypeScript dans matrice (bloquant CI)
4. **Lint UI** : Nettoyer les variables non utilisées (non bloquant)

### Estimation
- **Typecheck API WebAuthn** : ~2h (corrections de types, challengeId → challenge, Uint8Array)
- **Typecheck API Session Manager** : ~30min (finir corrections gt() avec timestamps)
- **Typecheck UI** : ~1h (typage matrice, corrections event handlers)
- **Lint UI** : ~30min (nettoyage variables)
- **Total** : ~4h de travail
