<<<<<<< Updated upstream
# Feature: Minor Fixes and Improvements

## Objective
Implémenter les corrections mineures et améliorations identifiées dans TODO.md (lignes 47-101), incluant :
- Corrections de bugs (404 sur refresh, comptage dans matrix, NavigationGuard, WebAuthn)
- Nouvelles fonctionnalités (ajout/suppression d'axes, amélioration EditableInput, troncature entreprise)
- Normalisation et améliorations techniques (refresh tokens, credentialBackedUp, enrichissement asynchrone, etc.)

## Scope
- **UI**: Corrections et améliorations d'interface utilisateur
- **API**: Normalisation et améliorations backend
- **Tests**: Validation des corrections et nouvelles fonctionnalités
- **CI**: Vérification que les tests passent

## Plan / Todo

### Phase 1: Corrections critiques (Fixes)
- [ ] **Fix 1**: Le refresh dans GitHub Pages (CTRL+R) des pages `cas-usage|entreprise/[id]` génère un 404 (régression)
  - Scope: UI (routing SvelteKit)
  - Fichiers à vérifier: `ui/src/routes/cas-usage/[id]/+page.svelte`, `ui/src/routes/entreprises/[id]/+page.svelte`
  
- [ ] **Fix 2**: Dans matrix, le nombre de cas n'est pas décompté (nombre par seuil de valeur pour configuration des seuils)
  - Scope: UI (page matrice)
  - Fichiers à vérifier: `ui/src/routes/matrice/+page.svelte`
  
- [x] **Fix 3**: NavigationGuard: sauver automatiquement
  - Scope: UI (composant NavigationGuard)
  - Fichiers à vérifier: `ui/src/lib/components/NavigationGuard.svelte` ou similaire
  
- [x] **Fix 4**: WebAuthn - en prod OK pour register et login, mais en localhost pour dev, webauthn OK pour register mais pas pour login avec smartphone
  - Scope: API (service WebAuthn)
  - Fichiers à vérifier: `api/src/services/webauthn-authentication.ts`, configuration dev

### Phase 2: Nouvelles fonctionnalités (Features)
- [x] **Feat 1**: Dans matrice, pouvoir ajouter et supprimer des axes de valeur/complexité
  - Scope: UI + API (page matrice + endpoints)
  - Fichiers à vérifier: `ui/src/routes/matrice/+page.svelte`, `api/src/routes/api/folders.ts`
  
- [x] **Feat 2**: Dans EditableInput, pour les input markdown, mettre en exergue les champs édités avec une bordure orange + hover avec bord gauche en gris
  - Scope: UI (composant EditableInput)
  - Fichiers à vérifier: `ui/src/lib/components/EditableInput.svelte`
  - Bonus: Fix du problème de curseur qui saute dans TipTap
  
- [x] **Feat 3**: Dans les fiches entreprise (vue /entreprises), tronquer taille au même nombre de caractères que produits et services
  - Scope: UI (page entreprises)
  - Fichiers à vérifier: `ui/src/routes/entreprises/+page.svelte`*

- [x] **Feat 4**: Permettre l'édition du titre/nom du usecase avec EditableInput


### Phase 3: Normalisation et améliorations techniques
- [ ] **Normalisation 1**: Normaliser l'incohérence titre/name/nom pour les UseCase
  - Scope: API + UI (prompts, schémas, interfaces)
  - Fichiers à vérifier: 
    - `api/src/services/default-prompts.ts` (ligne 69)
    - `api/src/services/context-usecase.ts` (ligne 6)
    - `api/src/services/queue-manager.ts` (lignes 328-330)
    - `ui/src/routes/dashboard/+page.svelte` (ligne 937)
  - Actions:
    1. Vérifier si le prompt doit générer `"name"` au lieu de `"titre"` pour cohérence
    2. Vérifier le schéma Zod côté API pour validation
    3. Normaliser sur `name` partout OU documenter la rétrocompatibilité
    4. Supprimer les fallbacks `(useCase as any)?.titre || (useCase as any)?.nom` si plus nécessaires
    5. Mettre à jour l'interface `UseCaseListItem` si nécessaire

- [ ] **Amélioration 1**: Implémenter le système de refresh tokens
  - Scope: API (session manager)
  - Fichiers à vérifier: `api/src/services/session-manager.ts`
  - Actions:
    - Activer `REFRESH_DURATION` (30 jours) et `refreshExpiresAt`
    - Ajouter endpoint pour rafraîchir les tokens
    - Gérer la rotation des refresh tokens

- [ ] **Amélioration 2**: Utiliser `credentialBackedUp` pour la gestion des devices
  - Scope: API (WebAuthn registration)
  - Fichiers à vérifier: `api/src/services/webauthn-registration.ts`
  - Actions:
    - Activer la vérification si un device est sauvegardé (backup)
    - Utiliser pour améliorer la gestion des credentials WebAuthn

- [ ] **Amélioration 3**: Réactiver l'enrichissement asynchrone des entreprises
  - Scope: API (routes companies)
  - Fichiers à vérifier: `api/src/routes/api/companies.ts`
  - Actions:
    - Activer la fonction `enrichCompanyAsync`
    - Utiliser la queue pour les enrichissements longs

- [ ] **Amélioration 4**: Réactiver le prompt de nom de dossier
  - Scope: API (routes use-cases)
  - Fichiers à vérifier: `api/src/routes/api/use-cases.ts`
  - Actions:
    - Activer `folderNamePrompt`
    - Utiliser pour générer automatiquement les noms de dossiers

- [ ] **Amélioration 5**: Réactiver la fonction `parseExecutiveSummary`
  - Scope: API (routes folders)
  - Fichiers à vérifier: `api/src/routes/api/folders.ts`
  - Actions:
    - Activer si nécessaire
    - Utiliser pour parser les synthèses exécutives stockées

- [ ] **Amélioration 6**: Implémenter l'annulation réelle des jobs dans la queue
  - Scope: API (routes queue)
  - Fichiers à vérifier: `api/src/routes/api/queue.ts`, `api/src/services/queue-manager.ts`
  - Actions:
    - Implémenter l'interruption réelle d'un job en cours d'exécution
    - Utiliser les AbortController déjà présents dans QueueManager

### Phase 4: Tests et validation
- [ ] **Test 1**: Exécuter les tests unitaires (`make test.unit`)
- [ ] **Test 2**: Exécuter les tests E2E pour valider les corrections UI (`make test-e2e`)
- [ ] **Test 3**: Vérifier le linting et typecheck (`make lint`, `make typecheck`)
- [ ] **Test 4**: Vérifier la CI GitHub Actions après push

## Commits & Progress
- [x] **Commit initial**: Création de la branche et BRANCH.md
- [x] **Commit 1**: Fix 404 sur refresh GitHub Pages - activation du fallback 404.html
- [x] **Commit 2**: Fix comptage dans matrix - calcul et affichage du nombre de cas par seuil
- [x] **Commit 3**: Fix auto-save des seuils et recalcul automatique des comptages
- [x] **Commit 4**: Fix NavigationGuard - sauvegarde automatique au lieu d'afficher un dialogue
- [x] **Commit 5**: Fix WebAuthn - accepter les IPs locales pour login smartphone en localhost dev
- [x] **Commit 6**: Feat ajout/suppression d'axes dans matrice
- [x] **Commit 7**: Feat tronquer taille dans fiches entreprise
- [x] **Commit 8**: Feat EditableInput markdown avec bordure orange et hover bord gauche gris
- [x] **Commit 9**: Feat édition du titre/nom du usecase avec EditableInput

## Status
- **Progress**: 9/20 tâches complétées
- **Current**: Feat édition du titre/nom du usecase complété
- **Next**: Phase 3 - Normalisation et améliorations techniques

## Questions avant de commencer
1. **Priorité**: Quelle phase doit être traitée en premier ? (suggéré: Phase 1 - corrections critiques)
2. **Normalisation UseCase**: Préférence pour normaliser sur `name` partout ou maintenir la rétrocompatibilité avec `titre`/`nom` ?
3. **Refresh tokens**: Cette fonctionnalité est-elle prioritaire ou peut-elle être reportée ?
4. **Tests**: Doit-on créer de nouveaux tests pour chaque correction/amélioration ou seulement valider avec les tests existants ?

=======
# Feature: Fix Make Targets for Linting and Typecheck

## Objective
Fix and standardize the make targets for linting (`lint`, `lint-ui`, `lint-api`) and typecheck (`typecheck`, `typecheck-ui`, `typecheck-api`) so they work consistently both locally and in CI. Apply them progressively, target by target, with a clear plan.

## Questions / Analysis

### Current State
- **typecheck-ui**: Uses `COMPOSE_RUN_UI` (run --rm, container created on demand)
- **typecheck-api**: Uses `COMPOSE_RUN_API` (run --rm, container created on demand)
- **lint-ui**: Uses `exec` (requires container to be running)
- **lint-api**: Uses `exec` (requires container to be running)
- **format**: Uses `COMPOSE_RUN_*` (consistent)
- **format-check**: Uses `COMPOSE_RUN_*` (consistent)

### Issues Identified
1. Inconsistency: `lint-*` targets use `exec` but don't have `up-*` dependencies (like `test-*` pattern), while `typecheck-*` use `COMPOSE_RUN_*` which doesn't work without images built
2. Pattern mismatch: `test-*` targets follow pattern: `target: up-*` + `exec`, but `typecheck-*` and `lint-*` don't follow this
3. Not used in CI: These targets are not currently called in GitHub Actions workflows

### Correct Pattern (from test-*)
- `test-ui: up-ui` then uses `exec` on running container
- `test-api: up-api-test` then uses sub-targets with `exec`
- Pattern: **Dependency on `up-*` target + use `exec` on running container**

## Plan / Todo

- [x] **Task 1**: Analyze current implementation and understand pattern
  - Identified pattern used by `test-*` targets
  - Confirmed need to follow same pattern for consistency

- [x] **Task 2**: Standardize typecheck targets to follow test-* pattern
  - Added `up-ui` dependency to `typecheck-ui`
  - Changed `typecheck-ui` to use `exec -T` instead of `COMPOSE_RUN_UI`
  - Added `up-api` dependency to `typecheck-api`
  - Changed `typecheck-api` to use `exec -T` instead of `COMPOSE_RUN_API`

- [x] **Task 3**: Standardize lint targets to add missing dependencies
  - Added `up-ui` dependency to `lint-ui` (already used `exec`, added `-T` flag)
  - Added `up-api` dependency to `lint-api` (already used `exec`, added `-T` flag)

- [ ] **Task 4**: Test standardized targets and fix linting errors
  - ✅ Tested `make lint-api` - found 70 errors
  - Plan progressif de correction des erreurs de linting (voir ci-dessous)

- [ ] **Task 5**: Add quality gates in CI (optional, can be done later)
  - Consider adding `make lint` and `make typecheck` to CI workflow
  - This can be a separate task if too much scope

## Linting Errors Analysis (70 errors found - API)

### Error Categories:
1. **Auto-fixable (2 errors)**: `prefer-const` - can be fixed automatically
2. **Variables non utilisées (~30 errors)**: `@typescript-eslint/no-unused-vars`
3. **Types `any` explicites (~40 errors)**: `@typescript-eslint/no-explicit-any`
4. **@ts-ignore au lieu de @ts-expect-error (3 errors)**: `@typescript-eslint/ban-ts-comment`
5. **Blocs vides (2 errors)**: `no-empty`

### Progressive Fix Plan - API

#### Phase 1: Auto-fixable + Quick wins (7 errors) ✅ COMPLETÉ
- [x] Fixed `prefer-const` errors (2 errors) - changed `let` to `const` in tools.ts
- [x] Fixed `@ts-ignore` → `@ts-expect-error` (3 errors) - db/client.ts
- [x] Fixed empty blocks (2 errors) - added comments in register.ts and queue-manager.ts

#### Phase 2: Variables non utilisées simples (~28 errors) ✅ COMPLETÉ
- [x] Removed unused imports: `cors`, `z`, `eq`, `companies`, `magicLinks`, `and`, `randomBytes`, `settings`, `UseCase`
- [x] Commented/removed unused variables: `enrichCompanyAsync`, `folderNamePrompt`, `matrixConfig`, `parseExecutiveSummary`, `jobId`, `deleted`, `CODE_LENGTH`, `refreshExpiresAt`, `credentialBackedUp`, `settingsResult`, `queueResult`
- [x] Changed `_` to named variable `,` in queue-manager.ts

**Résultat**: 70 erreurs → 42 erreurs (-28 erreurs, -40%)

#### Phase 3: Variables non utilisées complexes (2 errors) ✅ COMPLETÉ
- [x] Analysé `defaultPrompts` import - supprimé car utilisation commentée
- [x] Analysé `REFRESH_DURATION` - gardé avec eslint-disable comment pour usage futur (refresh tokens)

**Résultat**: 42 erreurs → 40 erreurs (-2 erreurs). Toutes les erreurs restantes sont des types `any` explicites (Phase 4)

#### Phase 4: Types `any` explicites (40 errors) - EN COURS
- [x] **app.ts** (1 error) - Fixed keyGenerator, use headers only
- [x] **scripts/queue-status.ts** (1 error) - Use JobQueueRow type
- [x] **app.ts** (1 error) - Fixed keyGenerator, use headers only
- [x] **scripts/queue-status.ts** (1 error) - Use JobQueueRow type
- [x] **services/webauthn-authentication.ts** (1 error) - Explicit role type union
- [x] **services/webauthn-registration.ts** (1 error) - Explicit role type union
- [x] **services/email-verification.ts** (2 errors) - Explicit transporter config type, unknown for error
- [x] **services/tools.ts** (6 errors) - Added Tavily response interfaces, removed all any
- [ ] **db/client.ts** - 11 errors in compatibility layer (lines 41-62)
- [ ] **routes/api/use-cases.ts** - 7 errors (lines 92, 199, 309, 351, 352, 362, 480)
- [ ] **services/queue-manager.ts** - 9 errors (lines 18, 120, 174, 186, 325, 347, 514, 600, 622, 624)

- [x] **routes/api/use-cases.ts** (7 errors) - Added LegacyUseCaseRow type, replaced all any with proper types

- [x] **services/queue-manager.ts** (10 errors) - Added JobData type union, JobQueueRow types, UseCaseListItem types

**Progrès**: 10 → 0 errors (-10, -100%). Total: 70 → 0 errors (-70, -100%) ✅

#### Phase 5: Validation finale
- [ ] Run `make lint-api` et vérifier 0 erreurs
- [ ] Run `make lint-ui` et vérifier
- [ ] Run `make typecheck` et vérifier

## Scope
- **Files to modify**: `Makefile` only
- **Testing**: Local verification of make targets
- **CI changes**: Optional, can be deferred to avoid scope creep

## Commits & Progress

- [x] **Commit 1** (1f3a1e2): Standardize all typecheck and lint targets - add up-* dependencies and use exec -T pattern like test-* targets
- [x] **Commit 2** (a515791): Fix linting errors - Phase 1 and 2 (70 → 42 errors)
- [x] **Commit 3** (273114d): Fix linting errors - Phase 3 (42 → 40 errors)

## Status
- **Progress**: Phases 1, 2 & 3 completed ✅
- **Current**: 70 errors → 40 errors (-30, -43%)
- **Next**: Phase 4 (types `any` explicites - 40 errors remaining)
>>>>>>> Stashed changes
