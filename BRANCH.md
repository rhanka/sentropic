# Feature: API URL Configuration with Environment Variables

## Objective
Replace all hardcoded `http://localhost:8787/api/v1` URLs in the UI with dynamic configuration using `VITE_API_BASE_URL` environment variable. This enables proper deployment to production (GitHub Pages) while maintaining local development workflow.

## Problem Analysis
Currently, 39 occurrences of hardcoded API URL in 11 files:
- **4 stores**: `useCases.ts`, `companies.ts` (partially done), `folders.ts`, `queue.ts`
- **7 pages**: `entreprises/[id]`, `dossiers`, `cas-usage`, `cas-usage/[id]`, `parametres`, `matrice`, `dashboard`
- **1 component**: `QueueMonitor.svelte`

This prevents proper deployment as the UI tries to call localhost instead of the production API (https://top-ai-ideas-api.sent-tech.ca/api/v1).

## Plan / Todo

### Phase 1: Configuration Setup
- [x] **Task 1**: Create centralized config file `ui/src/lib/config.ts`
  - Export `API_BASE_URL` constant
  - Use `import.meta.env.VITE_API_BASE_URL` with fallback to `http://localhost:8787/api/v1`
  - Add JSDoc documentation

- [x] **Task 2**: Create `.env.example` file (SKIPPED - blocked by .gitignore)
  - Document `VITE_API_BASE_URL` variable
  - Provide examples for dev and prod

- [x] **Task 3**: Update documentation
  - Update README.md with environment variable section
  - Document local development setup
  - Document deployment configuration

### Phase 2: Store Updates (4 files)
- [x] **Task 4**: Update `ui/src/lib/stores/useCases.ts`
  - Import config from `lib/config.ts`
  - Replace hardcoded URL with `API_BASE_URL`

- [x] **Task 5**: Update `ui/src/lib/stores/companies.ts`
  - Import config from `lib/config.ts`
  - Replace inline env check with centralized config

- [x] **Task 6**: Update `ui/src/lib/stores/folders.ts`
  - Import config from `lib/config.ts`
  - Replace hardcoded URL with `API_BASE_URL`

- [x] **Task 7**: Update `ui/src/lib/stores/queue.ts`
  - Import config from `lib/config.ts`
  - Replace hardcoded URL with `API_BASE_URL`

### Phase 3: Page Updates (7 files)
- [x] **Task 8**: Update `ui/src/routes/entreprises/[id]/+page.svelte`
  - Import config
  - Replace 8 occurrences of hardcoded URL

- [x] **Task 9**: Update `ui/src/routes/dossiers/+page.svelte`
  - Import config
  - Replace 2 occurrences of hardcoded URL

- [x] **Task 10**: Update `ui/src/routes/cas-usage/+page.svelte`
  - Import config
  - Replace 3 occurrences of hardcoded URL

- [x] **Task 11**: Update `ui/src/routes/cas-usage/[id]/+page.svelte`
  - Import config
  - Replace 3 occurrences of hardcoded URL

- [x] **Task 12**: Update `ui/src/routes/parametres/+page.svelte`
  - Import config
  - Replace 8 occurrences of hardcoded URL

- [x] **Task 13**: Update `ui/src/routes/matrice/+page.svelte`
  - Import config
  - Replace 10 occurrences of hardcoded URL

- [x] **Task 14**: Update `ui/src/routes/dashboard/+page.svelte`
  - Import config
  - Replace 1 occurrence of hardcoded URL

### Phase 4: Component Updates (1 file)
- [x] **Task 15**: Update `ui/src/lib/components/QueueMonitor.svelte`
  - Import config
  - Replace 1 occurrence of hardcoded URL

### Phase 5: Docker & Environment Configuration
- [x] **Task 16**: Update `docker-compose.yml`
  - Already configured with `VITE_API_BASE_URL=http://api:8787/api/v1`
  - No changes needed

- [ ] **Task 17**: Verify Makefile build commands
  - Check `make build-ui` passes VITE_API_BASE_URL correctly using `https://top-ai-ideas-api.sent-tech.ca`
  - Test with `grep -r` that no more `localhost:8787` remain hardcoded in ui/build and that all API calls are based on the right var or value.
  - Ensure local dev workflow unchanged: `make up wait-ready logs` 

### Phase 6: Testing & Validation
- [ ] **Task 18**: Test unit & integration tests
  - Run `make test-api test-ui` to check unit/integration tests still is working
  - check with `make logs`
  - Test all pages with API calls

- [ ] **Task 19**: Test E2E tests
  - Run `make build-api build-ui-image test-e2e` to verify global integration
  - Ensure all workflows still pass

- [ ] **Task 20**: Verify CI heath
  - Create PR, commit all and push
  - Check with gh until success


## Commits & Progress
- [ ] **Commit 1**: Create centralized config and documentation (Tasks 1-3)
- [ ] **Commit 2**: Update all stores (Tasks 4-7)
- [ ] **Commit 3**: Update entreprises, dossiers, cas-usage pages (Tasks 8-11)
- [ ] **Commit 4**: Update parametres, matrice, dashboard pages (Tasks 12-14)
- [ ] **Commit 5**: Update QueueMonitor component (Task 15)
- [ ] **Commit 6**: Final testing and CI validation (Tasks 17-20)

## Status
- **Progress**: 16/20 tasks completed (80%)
- **Current**: Ready for commits 1-5
- **Next**: Create commits for completed work, then proceed to Task 17

## Technical Notes
- Current CI already sets `VITE_API_BASE_URL: https://top-ai-ideas-api.sent-tech.ca/api/v1` (line 109 in ci.yml)
- For local dev, fallback to `http://localhost:8787/api/v1` is sufficient
- Tests should continue to work as they mock fetch calls
- Docker compose should use internal network: `http://api:8787/api/v1`

## Expected Impact
- ✅ Production deployment will work correctly
- ✅ Local development unchanged
- ✅ Docker compose development unchanged
- ✅ All tests continue to pass
- ✅ Centralized configuration for future maintenance

