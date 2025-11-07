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
- [x] 11.2: WebAuthn API compatibility fixes ✅
- [x] 11.3: Database schema improvements ✅
- [x] 11.4: Makefile test unification ✅
- [x] 11.5: Session persistence & UI stability fixes ✅

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

- [x] 12.3: E2E tests with Playwright ✅ IN PROGRESS
  - Test registration flow with WebAuthn simulation (if supported)
  - Test login flow with WebAuthn simulation
  - Test magic link fallback flow
  - Test device management UI
  - Test logout and session expiration
  - **SUCCESS: 50/50 authentication tests pass (100%)**
  - **BILAN GLOBAL**: 121/164 E2E tests pass (73.8%), 9 failed, 7 flaky, 10 skipped
  - **Progrès**: Ajout de sélecteurs robustes pour détails entreprises/dossiers, corrections des violations strict mode

- [x] 12.4: Security tests:
  - Test CORS headers with credentials
  - Test CSP and security headers
  - Test rate limiting enforcement
  - Test challenge replay protection
  - Test counter increment validation

- [x] 12.5: User Acceptance Testing (UAT) - Bug Fixes & Final Validation
  - [x] Fix Enterprise Creation: redirection fiable et suppression de l'erreur "Cannot read properties of undefined (reading 'id')"
  - [x] Fix Deletion: messages d'erreur précis et scénario E2E stable
  - [x] Fix cookies E2E Docker: `Domain=localhost` seulement pour origin localhost/127.0.0.1
  - [x] Auth E2E unique + CDP WebAuthn
  - [x] Utiliser la Navigation SvelteKit
  - [x] Vue Évaluation (matrice): erreur `API_BASE_URL is not defined`
  - [x] Gestion unsaved changes après création d'entreprise
  - [x] Seed E2E nettoie les utilisateurs avant insertion
  - [x] Gestion réponse HTTP 204 No Content pour DELETE
  - [x] Fix WebAuthn E2E: configuration localhost et authentificateur virtuel
  - [x] Fix UI - update company is not authenticated (401)
  - [x] Fix UI tests regressions (deleteCompany error messages)
  - [x] Fix E2E auth-* tests: tests obsolètes ne correspondent plus à l'UI actuelle
    - [x] Tests API directs à supprimer (hors scope E2E) (auth-*)
    - [x] Tests WebAuthn vs magic link - UI adaptative non gérée (auth-*)
    - [x] Navigation et affichage quand utilisateur authentifié (auth-*)
    - [x] Test inscription recherche texte qui n'existe plus (compatibilité navigateur webauthn)
    - [x] Pages de détails retournent à la liste au lieu d'afficher les détails
    - [x] Détails dossiers - clics non fonctionnels et violations strict mode - Fusion du test utile tests de `folders-detail.spec.ts` dans `folders.spec.ts` 
    - [x] Tests flaky - Labels et tentatives multiples
    - [x] Génération IA tests failing (nb of retry + changement lié à parallélisation)
    - [x] Nettoyage incomplet de la DB avant tests E2E
    - [x] Complete all test pipeline in one pass without flaky: `make down test-api test-ui down build-api build-ui-image build-e2e test-e2e`
    - [x] All tests successfull in CI

- [x] 12.6: Preprod migration - Restore production data to CI local environment ✅ COMPLETE
  - [x] Improve Make target `db-backup` for local database backup ✅
  - [x] Create Make target `db-backup-prod` for production backup ✅
  - [x] Improve Make target `db-restore` for generic restoration to local ✅
  - [x] Use `up-api-test` for development test environment ✅
  - [x] Create Make target `test-api-smoke-restore` for restore validation tests ✅
  - [x] Create `restore-validation.test.ts` smoke test for post-restore validation ✅
  - [x] CI workflow integration ✅
  - [x] Test complete workflow end-to-end ✅

- [ ] 12.7 Minimal Viable Evolutions - pour rendre l'auth viable
    - [x] Authentification email-only côté API & UI (suppression userName/displayName, deriveDisplayName, session enrichie)
    - [x] MailDev intégré (service docker-compose, cibles make up/down/logs) — reste à vérifier le démarrage healthy
    - [x] Magic link sécurisé (TTL 10 min, usage unique, envoi via nodemailer, normalisation email)
    - [x] Redirections 401 + masquage du header sur les routes d’auth, fetch helper mis à jour
    - [x] Workflow secure: register = mail + device webauthn validé obligatoire. Connexion: mail doit être validé, et même device webauthn. fall back nécessite nouvelle validation de mail et aussi device webauthn
    - [x] Tests & CI : 
        - [x] adapter les tests unitaires, relancer `make test-ui test-api`, 
        - [x] adapter les tests e2e, relancer `make test-e2e`, 
        - [x] adapter workflows CI (MailDev, smoke restore)
        - [x] préparer le deploy-api (sur SCW)

### Phase 13: CI/CD Security

- [x] 13.1: Update documentation: ✅ COMPLETE
  - [x] Add WebAuthn architecture section to SPEC.md with ref to WORKFLOW_AUTH.md
  - [x] Add authentication flows with mermaid diagrams in WORKFLOW_AUTH.md
  - [x] Add security considerations to README.md
  - [x] Update API documentation with new auth endpoints

- [x] 13.2: Security validation: ✅ COMPLETE
  - [x] Import & adapt security targets (SAST, SCA, Container, IaC - Makefile targets and CI) and `security.mdc` from https://github.com/rhanka/assistant
  - [x] Create vulnerability scanning infrastructure (security-parser.sh, security-compliance.sh, vulnerability-register.yaml)
  - [x] Implement Makefile security targets (test-%-security-sast, test-%-security-sca, test-%-security-container, test-security-iac)
  - [x] Add npm audit to Dockerfiles (blocks builds with HIGH/CRITICAL vulnerabilities)
  - [x] Integrate security scans into GitHub Actions CI (security-sast-sca, security-iac, security-container jobs)
  - [x] Security scans block pipeline if unaccepted vulnerabilities are found
  - [x] Create component auditing infrastructure (components.mdc, tech-debt-*.md files)
  - [x] Update workflow.mdc with tech-debt and vulnerability management lifecycle
  - [x] Initialize vulnerability register with CVE-2025-62610 (Hono JWT Auth Middleware)
  - [x] Verify all security targets work correctly

- [ ] 13.4: Final validation:
  - [x] Verify all CI checks pass
  - [x] Test deployment on Scaleway Container

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

