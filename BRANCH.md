# Feature: Organizations (rename companies + enrich org data model)

## Objective
Replace the "Company" concept with "Organization" across the stack (DB schema, API, UI) and evolve the organization profile model:
- Deep rename `companies/company` → `organizations/organization` (types, routes, UI screens).
- Migrate organization profile fields to a JSONB `data` payload (similar to `use_cases.data`) to reduce future schema churn.
- Add a KPI section (single field): `kpis` as a markdown string displayed under “Processus”.
- Include references in AI generations + org enrichment (store and expose sources used by the model).

## Scope / Guardrails
- Docker-first: all installs/build/tests run through `make` (no native `npm`).
- Minimal refactors outside the organization scope.
- **Décision**: **aucune rétrocompatibilité** à conserver (sauf migration des données déjà faite).
  - Supprimer l’alias API `/companies`.
  - Supprimer les routes UI `/entreprises` (y compris redirects).
  - Supprimer l’alias store UI `ui/src/lib/stores/companies.ts`.
  - Remplacer les events SSE `company_update` / canaux `company_events` / ids `companyId` par `organization_*`.
  - Renommer le tool OpenAI `company_update` → `organization_update` (breaking), et aligner tous les usages.

## Inventaire restant (grep)
Occurrences `company/companies` (hors “organization”): **634** au total, réparties principalement ainsi:
- `api/src`: **38** (rétrocompat explicite + streams + chat/tools)
- `ui/src`: **214** (alias store `companies`, pages `/entreprises`, paramètres `companyId`, streamHub `company_update`)
- `api/tests`: **178** (tests API/queue/enrich encore en `/companies` + `companies` schema alias)
- `e2e`: **26** (tests encore sur `/entreprises` + /api/v1/companies)
- `spec`: **61** (docs/specs)

Occurrences `entreprise(s)`:
- `ui/src`: **32**
- `e2e`: **135** (dont beaucoup dans `e2e/playwright-report/**` → artefacts à supprimer du repo et ignorer)

## Plan / Todo
- [x] **Lot 0 — Cleanup repo (artefacts)**:
  - [x] Supprimer `e2e/playwright-report/**` du repo (si versionné) et l’ajouter au `.gitignore`. (commit: `519fefe`)
- [ ] **Lot 1 — Suppression de la rétrocompat “companies/entreprises” (breaking)**:
  - [ ] **API**
    - [ ] Retirer le montage `/companies` dans `api/src/routes/api/index.ts`.
    - [ ] Supprimer `api/src/routes/api/companies.ts`.
    - [ ] Supprimer l’alias `companies` dans `api/src/db/schema.ts` (et ajuster les imports).
    - [ ] OpenAPI: remplacer `/companies` par `/organizations` (ex: `api/src/openapi/export.ts`).
  - [ ] **SSE / Streams**
    - [ ] `api/src/routes/api/streams.ts`: `company_update` → `organization_update` + `companyIds` → `organizationIds`.
    - [ ] `NOTIFY/LISTEN`: `company_events` → `organization_events` (queue manager + organizations router).
    - [ ] `streamId` prefix: `company_` → `organization_` (et aligner StreamMessage UI).
  - [ ] **Chat Tools**
    - [ ] Renommer le tool OpenAI `company_update` → `organization_update` + ajuster `api/src/services/tools.ts` + `tool-service.ts` + specs.
    - [ ] Renommer le contexte `company` → `organization` partout (API + UI ChatPanel + tests).
  - [ ] **UI**
    - [ ] Supprimer `ui/src/lib/stores/companies.ts` et migrer tous les imports vers `organizations`.
    - [ ] Supprimer `ui/src/routes/entreprises/**` (plus de redirects).
    - [ ] Corriger les params/labels: `companyId` → `organizationId`, “Entreprise” → “Organisation”.
    - [ ] `ui/src/lib/stores/streamHub.ts`: `company_update` → `organization_update`, caches et types.
- [ ] **Lot 2 — Tests (Vitest)**
  - [ ] Renommer `api/tests/api/companies.test.ts` → `organizations.test.ts` et basculer tous les endpoints en `/organizations`.
  - [ ] Mettre à jour les tests queue/enrich/smoke qui appellent `/companies/*`.
  - [ ] Mettre à jour les fixtures/seed tests qui importent `companies` depuis le schema.
- [ ] **Lot 3 — E2E (Playwright)**
  - [ ] Renommer `e2e/tests/companies*.spec.ts` en `organizations*.spec.ts`.
  - [ ] Remplacer `/entreprises` → `/organisations` (et supprimer les attentes de redirect).
  - [ ] Remplacer `/api/v1/companies` → `/api/v1/organizations` dans les assertions réseau.
  - [ ] Chat E2E: `primaryContextType: company` → `organization`.
- [ ] **Lot 4 — Docs / Spec**
  - [ ] Mettre à jour `spec/DATA_MODEL.md` (source de vérité alignée sur `api/src/db/schema.ts`).
  - [ ] Mettre à jour `spec/SPEC*.md`, `spec/TOOLS.md`, `README.md` pour “organization”.

## Commits & Progress (aligné sur l’historique git)

### Déjà fait (commits réels)
- [x] `0fd6ae8`: docs — plan initial Organizations (BRANCH.md)
- [x] `a3ccaf3`: db+api — migration `companies` → `organizations` (+ JSONB `data`)
- [x] `469abc3`: ui — routes `/entreprises` → `/organisations` (avec redirects à ce stade)
- [x] `d59d18f`: docs — update BRANCH progress (intermédiaire)
- [x] `5d5fc99`: db — register migration organizations
- [x] `023f70f`: api — normalize organization profile values
- [x] `818e4ae`: api — fix headers/fields for organization
- [x] `6a3604c`: api — KPI: `kpis` string (tolérance legacy)
- [x] `8376d2d`: api — prompts: `organization_info` + références (+ excerpt)
- [x] `d46501e`: docs — clarify field mapping pour tool (company_update → champs)
- [x] `7400971`: api — SSE: hydrate payload `company_update` (compat temporaire)
- [x] `5eb49d1`: api — sanitize null bytes/control chars avant insert JSONB
- [x] `21076ce`: api — autoriser update `references` via tool-service/tools
- [x] `bc3a112`: ui — dossiers: `organizationId/organizationName` (fix affichage/liaison)
- [x] `9be21b8`: docs — update BRANCH progress (organizations)
- [x] `73d2ead`: docs — inventaire grep + plan “no rétrocompat”
- [x] `519fefe`: cleanup — suppression des artefacts `e2e/playwright-report/**`
- [x] `a8fd061`: breaking — SSE/streams/org events passent en `organization_*` (UI réactive sur `/organisations`)
- [x] `da57c13`: fix — `tool-service` notifie `organization_events` (corrige la non-réactivité après updates via tools) + prompt `organization_info`

### À faire (lots cohérents, commits à venir)
- [x] **Lot 0**: cleanup artefacts (ex: `e2e/playwright-report/**` si versionné + `.gitignore`)
- [ ] **Lot 1 (breaking)**: suppression rétrocompat “companies/entreprises” (API + UI + SSE + tools) — en cours
- [ ] **Lot 2**: tests API/Vitest (endpoints, fixtures, seed)
- [ ] **Lot 3**: E2E Playwright (routes, assertions réseau, chat context)
- [ ] **Lot 4**: docs/spec (DATA_MODEL + SPEC + TOOLS + README)

## Validation (must pass before finishing the branch)
- `make test-api`
- `make test-ui` (or targeted UI test target if configured)
- If needed for confidence: `make build-api build-ui-image test-e2e`
- Verify CI run for the branch (per `.cursor/rules/workflow.mdc`)

## Status
- **Progress**: feature OK, reste à **supprimer la rétrocompat + migrer tests/docs**
- **Current**: Lot 1 (breaking cleanup)
- **Next**: Lots 2→4, puis `make test-api test-ui test-e2e`

