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

## Linting Errors Analysis (70 errors found)

### Error Categories:
1. **Auto-fixable (2 errors)**: `prefer-const` - can be fixed automatically
2. **Variables non utilisées (~30 errors)**: `@typescript-eslint/no-unused-vars`
3. **Types `any` explicites (~40 errors)**: `@typescript-eslint/no-explicit-any`
4. **@ts-ignore au lieu de @ts-expect-error (3 errors)**: `@typescript-eslint/ban-ts-comment`
5. **Blocs vides (2 errors)**: `no-empty`

### Progressive Fix Plan

#### Phase 1: Auto-fixable + Quick wins (7 errors) ✅ COMPLETÉ
- [x] Fixed `prefer-const` errors (2 errors) - changed `let` to `const` in tools.ts
- [x] Fixed `@ts-ignore` → `@ts-expect-error` (3 errors) - db/client.ts
- [x] Fixed empty blocks (2 errors) - added comments in register.ts and queue-manager.ts

#### Phase 2: Variables non utilisées simples (~28 errors) ✅ COMPLETÉ
- [x] Removed unused imports: `cors`, `z`, `eq`, `companies`, `magicLinks`, `and`, `randomBytes`, `settings`, `UseCase`
- [x] Commented/removed unused variables: `enrichCompanyAsync`, `folderNamePrompt`, `matrixConfig`, `parseExecutiveSummary`, `jobId`, `deleted`, `CODE_LENGTH`, `refreshExpiresAt`, `credentialBackedUp`, `settingsResult`, `queueResult`
- [x] Changed `_` to named variable `,` in queue-manager.ts

**Résultat**: 70 erreurs → 42 erreurs (-28 erreurs, -40%)

#### Phase 3: Variables non utilisées complexes (10-15 errors)
- [ ] Analyser variables inutilisées qui pourraient être nécessaires
- [ ] Décider: supprimer ou préfixer avec `_` pour indiquer intentionnel

#### Phase 4: Types `any` explicites (~40 errors)
- [ ] Commencer par les plus simples (params de fonction)
- [ ] Progresser vers les types complexes
- [ ] Pour certains cas, utiliser `unknown` ou types génériques

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

## Status
- **Progress**: 3/5 tasks completed
- **Current**: All targets standardized following test-* pattern
- **Next**: Test all targets to verify they work correctly
