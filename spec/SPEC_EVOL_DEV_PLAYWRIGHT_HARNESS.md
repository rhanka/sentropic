# SPEC_EVOL_DEV_PLAYWRIGHT_HARNESS

## Intent

Provide a non-destructive Playwright navigation/debug lane on top of the existing `ENV=dev` stack, while consolidating OpenVSCode development helpers into `docker-compose.dev.yml`.

This evolution must not change:

- `make dev`
- CI/test/e2e lanes
- existing production/test compose overlays

It only affects local developer ergonomics for BR05 debugging and future UI/runtime investigations.

## Scope

### 1. Compose consolidation

`docker-compose.dev.yml` becomes the single dev overlay.

It must host:

- the existing API/UI/dev services
- `openvscode-dev` under profile `vscode`
- `playwright-dev` under profile `playwright`

`docker-compose.dev-vscode.yml` is transitional only during implementation. The target state is that dev helper services live in `docker-compose.dev.yml`, and `Makefile` targets stop depending on `docker-compose.dev-vscode.yml`.

### 2. OpenVSCode compatibility

`up-dev-vscode`, `down-dev-vscode`, `ps-dev-vscode`, `logs-dev-vscode` must keep the same names and semantics for operators.

Internally they must switch to:

- `docker-compose.yml`
- `docker-compose.dev.yml`
- profile `vscode`

`make dev` must not activate the `vscode` profile.

### 3. Playwright dev lane

Add `playwright-dev` as a local debug/navigation service:

- reuses `e2e/Dockerfile`
- same dev network as API/UI
- no seeding
- no global setup
- no auth bootstrap automation
- no queue setup
- no test data reset

It is explicitly for:

- DOM/network inspection
- scoped dev navigation specs
- reproducing reload/runtime bugs without touching seeded E2E lanes

It is not a CI lane.

### 4. Dedicated Playwright dev config

Add a dedicated config for dev navigation:

- `e2e/playwright.dev.config.ts`
- `globalSetup` disabled
- uses a manual `storageState` (for example `.auth/dev-state.json`)
- fails fast with an actionable error if the state file is missing

Specs for this lane live under:

- `e2e/tests/dev/*.spec.ts`

These specs are expected to be scoped, observational, and non-destructive.

### 5. Makefile contract

Keep current targets unchanged:

- `dev`
- `build-ext-vscode`
- `dev-ext-vscode`
- existing E2E/CI targets

Add or refactor the following targets:

- `up-dev-vscode`
- `down-dev-vscode`
- `ps-dev-vscode`
- `logs-dev-vscode`
- `up-dev-playwright`
- `down-dev-playwright`
- `ps-dev-playwright`
- `logs-dev-playwright`
- `shell-dev-playwright`
- `test-e2e-dev` with mandatory `E2E_SPEC=...`

`test-e2e-dev` must:

- target the `playwright-dev` service only
- use the dedicated dev Playwright config
- not seed/reset data
- not modify queue settings

### 6. Impact analysis

Expected non-impacts:

- `make dev` continues to start only the standard dev stack
- CI remains on existing `test`/`e2e` lanes
- VSCode E2E lane remains on `docker-compose.e2e-vscode.yml`
- no changes to production runtime contracts

Expected local impacts:

- OpenVSCode helper service moves into `docker-compose.dev.yml`
- new optional dev-only Playwright service becomes available
- local dev operators gain a reproducible browser automation harness against `ENV=dev`

### 7. Validation

Required validation after implementation:

- `make dev` behavior unchanged
- `make up-dev-vscode` works with the new profile-based compose path
- `make up-dev-playwright` works without seeding
- `make test-e2e-dev E2E_SPEC=...` runs a scoped dev navigation spec
- reload/debug work can use the harness without calling legacy `stream-events` routes
