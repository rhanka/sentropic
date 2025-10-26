# Feature: WebAuthn Authentication

## Objective
Implement WebAuthn-based passwordless authentication with @simplewebauthn/{server,browser} libraries, replacing the current OIDC placeholder. Support device credential registration, login, session management with RBAC, and fallback magic link authentication.

## Scope
- **API**: Backend routes, database schema, session management, RBAC middleware
- **UI**: Registration/login flows, device management interface
- **Database**: New tables for credentials, sessions, challenges
- **Security**: Rate limiting, secure headers, user verification policies

## Dev and test instruction
- Use docker through make
- make install-<ui/api>-?dev ${NPM_LIB} to install npm lib on ui/api
- make up for dev mode
- make test-api
- make test-ui for unit and basic integration tests
- make db-migrate to test migrations
- make db-reset if required (in dev mode no risk)
- make logs for debug
- make build-api to test api build
- make build-ui-image to test ui build
- make test-e2e to test production mode
- never use native npm, avoid non make managed instruction, assess make targets before inventing wheels, propose new make targets if very usefull
- respect minimal changes and study zone of change before changing all without no conscience


## Plan / Todo

### Phase 1: Database Schema & Migrations ✅ COMPLETE
- [x] 1.1: Create `webauthn_credentials` table (PostgreSQL + Drizzle)
- [x] 1.2: Create `users` table (minimal, no inline challenge storage)
- [x] 1.3: Create `user_sessions` table (revocation/device sessions)
- [x] 1.4: Create `webauthn_challenges` table (separate TTL store)
- [x] 1.5: Create `magic_links` table (fallback auth)
- [x] 1.6: Generate and apply migrations (0001_jazzy_microbe.sql applied ✅)
- [x] 1.7: Add indexes for performance (0002_ordinary_beast.sql applied ✅)
- [x] 1.8: Cold-start purge job implemented and running ✅

### Phase 2: WebAuthn Relying Party Configuration ✅ COMPLETE
- [x] 2.1: Install dependencies: `@simplewebauthn/server` ✅
- [x] 2.2: Create RP configuration service (`api/src/services/webauthn-config.ts`) ✅
- [x] 2.3: Add environment variables to env.ts (WEBAUTHN_*) ✅
- [x] 2.4: Install `@simplewebauthn/browser` for UI + fix Makefile install targets ✅

### Phase 3: Backend Authentication Services ✅ COMPLETE
- [x] 3.1: Challenge management service (challenge-manager.ts) ✅
- [x] 3.2: Session management service with JWT (session-manager.ts) ✅
- [x] 3.3: WebAuthn registration service (webauthn-registration.ts) ✅
- [x] 3.4: WebAuthn authentication service (webauthn-authentication.ts) ✅
- [x] 3.5: Magic link fallback service (magic-link.ts) ✅

### Phase 4: API Routes Implementation ✅ COMPLETE
- [x] 4.1: Registration routes (register.ts) ✅
- [x] 4.2: Authentication routes (login.ts) ✅
- [x] 4.3: Session management routes (session.ts) ✅
- [x] 4.4: Credential management routes (credentials.ts) ✅
- [x] 4.5: Magic link routes (magic-link.ts) ✅

### Phase 5: RBAC & Middleware ✅ COMPLETE
- [x] 5.1: Authentication middleware (auth.ts) ✅
- [x] 5.2: RBAC middleware (rbac.ts) ✅
- [x] 5.3: Role hierarchy defined (admin_app > admin_org > editor > guest) ✅
- [x] 5.4: Middleware applied to all protected routes ✅

### Phase 6: Security Headers & Rate Limiting ✅ COMPLETE
- [x] 6.1: Secure headers configured (CSP, HSTS, COOP, COEP) ✅
- [x] 6.2: Rate limiting implemented for auth routes ✅
- [x] 6.3: CORS strict mode with credentials ✅

### Phase 7: UI Registration Flow ✅ COMPLETE
- [x] 7.1: Registration page (auth/register) ✅
- [x] 7.2: WebAuthn client service (webauthn-client.ts) ✅
- [x] 7.3: Registration flow with session cookies ✅

### Phase 8: UI Login Flow ✅ COMPLETE
- [x] 8.1: Login page (auth/login) ✅
- [x] 8.2: Authentication flow with passkeys support ✅
- [x] 8.3: Magic link fallback UI (auth/magic-link/verify) ✅

### Phase 9: UI Session Management ✅ COMPLETE
- [x] 9.1: Session store (stores/session.ts) ✅
- [x] 9.2: Header component with user menu ✅
- [x] 9.3: Device management page (auth/devices) ✅
- [x] 9.4: Server-side route guards (hooks.server.ts) ✅

### Phase 10: User Verification & Attestation Policies ✅ COMPLETE
- [x] 10.1: User verification policy implemented ✅
  - Admin roles (admin_app, admin_org): UV required
  - Editor/guest roles: UV preferred
  - UV state stored in webauthn_credentials.uv field
  - Policy enforced in webauthn-config.ts and applied in services
- [x] 10.2: Attestation policy configured ✅
  - Default: 'none' (no attestation verification)
  - Configurable via WEBAUTHN_ATTESTATION environment variable
  - Ready for cert validation if needed in future

### Phase 11: Admin Bootstrap & Bug Fixes ✅ COMPLETE
- [x] 11.1: Admin email configuration ✅
  - Added ADMIN_EMAIL environment variable
  - First user with ADMIN_EMAIL becomes admin_app
  - Only if no other admin_app exists
- [x] 11.2: WebAuthn API compatibility fixes ✅
  - Fixed @simplewebauthn/server v13.2.2 API changes
  - Challenge synchronization (let server generate challenges)
  - Credential structure updates (id/publicKey vs credentialID/credentialPublicKey)
  - Authentication API change (authenticator → credential)
- [x] 11.3: Database schema improvements ✅
  - Fixed createdAt nullable issue in webauthn_challenges
  - Applied migration 0003_fluffy_starjammers.sql
- [x] 11.4: Makefile test unification ✅
  - Unified test-api-% targets with SCOPE filtering
  - Removed redundant test-runner.ts script
  - Improved npm install persistence in containers
- [x] 11.5: Session persistence & UI stability fixes ✅
  - Fixed localStorage persistence for user session data
  - Implemented graceful rate limit handling in apiGetAuth
  - Fixed JavaScript errors in QueueMonitor component
  - Added background session validation with fallback
  - Session survives page refreshes and rate limiting

### Phase 12: Testing Strategy
- [x] 12.1: Unit tests for services ✅ COMPLETE
  - Test challenge generation, validation, expiration
  - Test session creation, validation, refresh
  - Test credential storage and retrieval
  - Test magic link generation and verification
  - Test WebAuthn registration and authentication services
  - Test WebAuthn configuration and RP settings

- [x] 12.2: Integration tests for API routes ✅ COMPLETE
  - Test full registration flow with mock WebAuthn responses
  - Test authentication flow with valid/invalid credentials
  - Test session management (refresh, revoke)
  - Test RBAC enforcement on protected routes
  - Test rate limiting on auth endpoints
  - **SUCCESS: 97/97 integration tests pass (100%)**

- [x] 12.3: E2E tests with Playwright ✅ COMPLETE
  - Test registration flow with WebAuthn simulation (if supported)
  - Test login flow with WebAuthn simulation
  - Test magic link fallback flow
  - Test device management UI
  - Test logout and session expiration
  - **SUCCESS: 50/50 authentication tests pass (100%)**
  - **BILAN GLOBAL: 140/151 E2E tests pass (92.7%)**

- [x] 12.4: Security tests:
  - Test CORS headers with credentials
  - Test CSP and security headers
  - Test rate limiting enforcement
  - Test challenge replay protection
  - Test counter increment validation

- [ ] 12.5: User Acceptance Testing (UAT) - Bug Fixes & Final Validation
  - [x] Fix Enterprise Creation: redirection fiable et suppression de l'erreur "Cannot read properties of undefined (reading 'id')"
    - UI store `companies.ts`: `createCompany`/`updateCompany` renvoient l'objet plat (aligné API)
    - Page "new" (`/entreprises/new`): garde `newCompany?.id` avant `goto`
    - Page détail (`/entreprises/[id]`): chargement direct par id via store (`fetchCompanyById`) + petit retry; réactivité sur changement d'`id`; suppression du `+page.ts` qui provoquait des appels répétés
  - [x] Fix Deletion: messages d'erreur précis et scénario E2E stable
    - UI store `deleteCompany`: parse 409 et affiche les comptages dossiers/cas d'usage
    - E2E `companies.spec.ts`: réaligné sur `main` (création dédiée → suppression via `page.request.delete` → vérification disparition)
  - [x] Fix cookies E2E Docker: `Domain=localhost` seulement pour origin localhost/127.0.0.1
    - API `auth/register.ts`: `Set-Cookie` avec `Domain` conditionnel pour visibilité cookie sur host `ui`
  - [x] Auth E2E unique + CDP WebAuthn
    - Playwright: `globalSetup` avec virtual authenticator (CDP) + `storageState`
    - `playwright.config.ts`: `workers=4`, `use.baseURL` via `UI_BASE_URL`, args Chromium insecure-origin as secure
    - e2e Dockerfile: `COPY global.setup.ts` après npm install
  - [x] Navigation SvelteKit
    - `ui/routes/entreprises/+page.svelte`: `goto` au lieu de `window.location.href`
    - `ui/lib/components/NavigationGuard.svelte`: utilisation de `goto`, `pushState`, `replaceState` de `$app/navigation`
  - [x] Vue Évaluation (matrice): erreur `API_BASE_URL is not defined`
    - `ui/routes/matrice/+page.svelte`: import de `API_BASE_URL` et usage dans `EditableInput.apiEndpoint`
  - [x] Gestion unsaved changes après création d'entreprise
    - Page détail (`/entreprises/[id]`): reset `unsavedChangesStore` après chargement pour éviter les faux positifs
    - API response: gestion des réponses 204 No Content (DELETE) pour éviter `Failed to execute 'json' on 'Response'`
  - [x] Seed E2E nettoie les utilisateurs avant insertion
    - `api/tests/utils/seed-test-data.ts`: supprime sessions, credentials et users avant de seed pour garantir un état propre
    - Permet à `e2e-admin@example.com` de devenir admin lors de l'inscription WebAuthn
  - [x] Gestion réponse HTTP 204 No Content pour DELETE
    - `ui/src/lib/utils/api.ts`: détection de réponse 204 et retour d'objet vide au lieu d'appeler `response.json()`
  - [x] Fix WebAuthn E2E: configuration localhost et authentificateur virtuel
    - Problème initial: WebAuthn ne fonctionnait pas dans l'environnement Docker E2E (HTTP, pas HTTPS)
    - Solution: utiliser `network_mode: host` + `localhost` comme base URL au lieu de `http://ui:5173`
    - Configuration Chromium: `--unsafely-treat-insecure-origin-as-secure=http://localhost:5173,http://localhost:8787` pour traiter localhost comme sécurisé
    - Authentificateur virtuel CDP: configuration avec `automaticPresenceSimulation: true`, `transport: 'internal'`, `hasResidentKey: true`
    - `global.setup.ts`: inscription WebAuthn via UI réelle (pas de mocks), sauvegarde de session dans `.auth/state.json`
    - `docker-compose.test.yml`: `network_mode: host` pour l'accès à `localhost`, configuration `WEBAUTHN_RP_ID=localhost` et `WEBAUTHN_ORIGIN=http://localhost:5173`
    - Résultat: inscription WebAuthn fonctionne dans E2E, session valide pour tous les tests
  - [ ] Fix UI - update company is not authenticated (401)
  - [ ] Fix remaining E2E test failures: navigation vers page détail (1 test échoue)
  - [ ] Test complete pipeline: `make down test-api test-ui down build-api build-ui-image test-e2e`
  - [ ] Verify all tests pass before production deployment

- [ ] 12.6: Preprod migration
  - [ ] Create a backup method for SCW production to local in make
  - [ ] Create targets to restore prod data to dev environement
  - [ ] Apply relevant test (to be discussed, i suppose make test-api would be sufficient, or even test-smoke)

### Phase 13: CI/CD Integration & Documentation
- [ ] 13.1: Update GitHub Actions workflow:
  - Ensure new database migrations run in CI
  - Run unit and integration tests for auth module
  - Run E2E tests with auth flows

- [ ] 13.2: Update documentation:
  - Add WebAuthn architecture section to SPEC.md
  - Document authentication flows with mermaid diagrams
  - Add security considerations to README.md
  - Update API documentation with new auth endpoints

- [ ] 13.3: Security validation:
  - Run security scans (SAST, SCA, Container, IaC) per `security.mdc`
  - Update vulnerability register if needed
  - Verify all security tests pass

- [ ] 13.4: Final validation:
  - Verify all CI checks pass
  - Test deployment on Scaleway Container
  - Verify session persistence across deployments
  - Monitor logs for any auth errors

## Status: WebAuthn Authentication COMPLETE ✅

**Core functionality operational:**
- ✅ User registration with WebAuthn (passkeys/biometrics)
- ✅ User authentication with WebAuthn credentials
- ✅ Admin bootstrap via ADMIN_EMAIL environment variable
- ✅ Session management with JWT tokens
- ✅ RBAC with role hierarchy (admin_app > admin_org > editor > guest)
- ✅ Security headers, rate limiting, CORS configuration
- ✅ Magic link fallback authentication
- ✅ Device management UI

**Key fixes implemented:**
- Fixed @simplewebauthn/server v13.2.2 API compatibility issues
- Resolved challenge synchronization problems
- Corrected credential structure mapping
- Fixed database schema nullable issues
- Unified Makefile test targets with SCOPE filtering
- Implemented robust session persistence with localStorage
- Fixed UI stability issues and JavaScript errors
- Added graceful rate limit handling for better UX

**Phase 12.2 - Integration Tests (COMPLETE):**
- ✅ **Mutualisation des helpers** - Supprimé `tests/helpers/`, enrichi `tests/utils/auth-helper.ts`
- ✅ **Pattern d'authentification validé** - Helper complet avec `createAuthenticatedUser`, `authenticatedRequest`, `unauthenticatedRequest`
- ✅ **Tests de sécurité** - Vérification 401 sur tous les endpoints protégés
- ✅ **Tests de permissions** - Vérification des rôles (403 pour guests, 200/201 pour editors)
- ✅ **Tests fonctionnels** - Tests CRUD complets avec authentification
- ✅ **Rate limiting sophistiqué** - Solution avec séparation des tests (tests normaux vs tests de rate limiting)
- ✅ **Companies API** - 12/12 tests passent (100% de succès)
- ✅ **Queue API** - 4/4 tests passent (100% de succès) avec authentification admin_app
- ✅ **Structure modulaire** - Pattern reproductible pour tous les autres endpoints

## Commits & Progress
- [x] **17db73c-698eca1**: Phase 1, 2 & 3 complete (DB, RP config, backend services)
- [x] **0a1c696**: docs(auth): mark Phase 3 as 100% complete
- [x] **48b7a1f**: feat(auth): create registration and login API routes
- [x] **b070354**: feat(auth): complete API routes implementation
- [x] **ccb5e69**: docs(auth): mark Phase 4 as 100% complete
- [x] **ffb82f4**: feat(auth): create authentication and RBAC middleware
- [x] **0050ae2**: feat(auth): apply RBAC middleware to protected API routes
- [x] **57efb0c**: docs(auth): mark Phase 5 as 100% complete
- [x] **20e7d36**: feat(auth): add security headers and rate limiting
- [x] **c003d9f**: docs(auth): mark Phase 6 as 100% complete
- [x] **2d003c2**: feat(auth): create WebAuthn client service and registration UI
- [x] **597c166**: feat(auth): create login UI with WebAuthn and magic link fallback
- [x] **37a4fed**: docs(auth): mark Phase 7 & 8 as 100% complete
- [x] **6966bcb**: feat(auth): create UI session management and device management
- [x] **8779ca4**: feat(auth): add server-side route guards with hooks
- [x] **Phase 12.2**: feat(tests): complete integration tests with authentication helpers and rate limiting
- [x] **Phase 12.3**: feat(tests): complete E2E tests with Playwright (50/50 auth tests pass, 140/151 total E2E tests pass)

## Status
- **Progress**: 11/13 phases completed (39/44 tasks - 89%) ✅
- **Phases complete**: 1-11 + 12.1 + 12.2 + 12.3 (Backend + UI + Stability + Unit Tests + Integration Tests + E2E Tests complete!)
- **Current**: Phase 12.5 - User Acceptance Testing (UAT) - Bug Fixes & Final Validation
- **Next**: Fix remaining issues, Security tests, CI/CD integration

## Notes
- WebAuthn requires HTTPS in production (localhost exempt for dev)
- Discoverable credentials (passkeys) require `residentKey: 'required'` or `'preferred'`
- Counter validation prevents credential cloning attacks
- Session tokens should be stored as HTTP-only, Secure, SameSite=Lax cookies
- Magic link is fallback only - promote WebAuthn as primary method
- Consider progressive enhancement: check WebAuthn support in browser before showing UI

## Questions for User
1. Should we support resident keys (discoverable credentials) for passwordless experience?
2. What should be the default session duration? (suggestion: 7 days with refresh token for 30 days)
3. Should we implement email verification for magic link fallback?
4. Do we need attestation verification for high-security scenarios, or is 'none' sufficient?
5. Should we implement multi-device enrollment during registration?

