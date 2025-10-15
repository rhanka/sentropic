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

### Phase 6: Security Headers & Rate Limiting
- [ ] 6.1: Install and configure secure headers middleware:
  - Use Hono's `secureHeaders()` middleware (equivalent to Helmet)
  - Configure CSP: `default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.sent-tech.ca`
  - HSTS: `max-age=31536000; includeSubDomains; preload`
  - COOP: `same-origin`
  - COEP: `require-corp`

- [ ] 6.2: Implement rate limiting for WebAuthn routes:
  - Install rate limiting library (e.g., `hono-rate-limiter`)
  - Apply to `/api/v1/auth/*`: 10 requests per 15 minutes per IP
  - Apply to `/api/v1/auth/register/*`: 3 requests per hour per IP
  - Apply to `/api/v1/auth/magic-link/*`: 3 requests per 15 minutes per email

- [ ] 6.3: Configure CORS for authentication routes:
  - Update existing CORS config to allow credentials: `credentials: true`
  - Ensure `Access-Control-Allow-Credentials: true` header
  - Strict origin validation (no wildcards when credentials enabled)

### Phase 7: UI Registration Flow
- [ ] 7.1: Create registration page (`ui/src/routes/auth/register/+page.svelte`):
  - Form with username, display name, optional email
  - Trigger WebAuthn registration on submit
  - Show device name input after successful registration

- [ ] 7.2: Create WebAuthn client service (`ui/src/lib/services/webauthn-client.ts`):
  - `startRegistration()`: Call `@simplewebauthn/browser` startRegistration
  - `startAuthentication()`: Call `@simplewebauthn/browser` startAuthentication
  - Handle browser compatibility checks
  - Handle user cancellation and errors

- [ ] 7.3: Implement registration flow:
  - Call `POST /api/v1/auth/register/options` to get options
  - Call `startRegistration(options)` from browser library
  - Send credential to `POST /api/v1/auth/register/verify`
  - Store session token in HTTP-only cookie (server-set)
  - Redirect to dashboard on success

### Phase 8: UI Login Flow
- [ ] 8.1: Create login page (`ui/src/routes/auth/login/+page.svelte`):
  - Button to trigger WebAuthn authentication
  - Optional username input (if no discoverable credentials)
  - Link to magic link fallback

- [ ] 8.2: Implement authentication flow:
  - Call `POST /api/v1/auth/login/options` to get options
  - Call `startAuthentication(options)` from browser library
  - Send credential to `POST /api/v1/auth/login/verify`
  - Store session token in HTTP-only cookie (server-set)
  - Redirect to previous page or dashboard

- [ ] 8.3: Create magic link fallback UI:
  - Email input form on login page
  - Request magic link via `POST /api/v1/auth/magic-link/request`
  - Show "Check your email" message
  - Magic link handler page (`/auth/magic-link/verify?token=...`)
  - Verify token and redirect to dashboard

### Phase 9: UI Session Management
- [ ] 9.1: Create session store (`ui/src/lib/stores/session.ts`):
  - `currentUser`: writable store with user info
  - `isAuthenticated`: derived store
  - `hasRole(role)`: helper function
  - `logout()`: call logout endpoint and clear store

- [ ] 9.2: Update Header component:
  - Show user display name and avatar when authenticated
  - Add dropdown menu with:
    - "My Devices" (link to credential management)
    - "Settings" (link to user settings)
    - "Logout" (trigger logout)
  - Show "Login" button when not authenticated

- [ ] 9.3: Create credential management page (`ui/src/routes/auth/devices/+page.svelte`):
  - List all registered devices with last used timestamp
  - Option to rename devices
  - Option to revoke devices (with confirmation)
  - Show current device indicator

- [ ] 9.4: Add route guards (`ui/src/hooks.server.ts`):
  - Check session validity on protected routes
  - Redirect to login if not authenticated
  - Redirect to error page if insufficient permissions

### Phase 10: User Verification & Attestation Policies
- [ ] 10.1: Implement user verification policy:
  - For `admin_app` and `admin_org`: require UV (`userVerification: 'required'`)
  - For `editor` and `guest`: prefer UV (`userVerification: 'preferred'`)
  - Store UV state in `webauthn_credentials.uv_initialized`
  - Validate UV during authentication for admin roles

- [ ] 10.2: Implement attestation policy (optional for now):
  - Default: `attestation: 'none'` (no attestation verification)
  - If needed: implement certificate chain validation
  - Document attestation types supported (packed, fido-u2f, apple, android-safetynet)
  - Add configuration flag to enable/disable attestation validation

### Phase 11: Testing Strategy
- [ ] 11.1: Unit tests for services:
  - Test challenge generation, validation, expiration
  - Test session creation, validation, refresh
  - Test credential storage and retrieval
  - Test magic link generation and verification

- [ ] 11.2: Integration tests for API routes:
  - Test full registration flow with mock WebAuthn responses
  - Test authentication flow with valid/invalid credentials
  - Test session management (refresh, revoke)
  - Test RBAC enforcement on protected routes
  - Test rate limiting on auth endpoints

- [ ] 11.3: E2E tests with Playwright:
  - Test registration flow with WebAuthn simulation (if supported)
  - Test login flow with WebAuthn simulation
  - Test magic link fallback flow
  - Test device management UI
  - Test logout and session expiration

- [ ] 11.4: Security tests:
  - Test CORS headers with credentials
  - Test CSP and security headers
  - Test rate limiting enforcement
  - Test challenge replay protection
  - Test counter increment validation

### Phase 12: CI/CD Integration & Documentation
- [ ] 12.1: Update GitHub Actions workflow:
  - Ensure new database migrations run in CI
  - Run unit and integration tests for auth module
  - Run E2E tests with auth flows

- [ ] 12.2: Update documentation:
  - Add WebAuthn architecture section to SPEC.md
  - Document authentication flows with mermaid diagrams
  - Add security considerations to README.md
  - Update API documentation with new auth endpoints

- [ ] 12.3: Security validation:
  - Run security scans (SAST, SCA, Container, IaC) per `security.mdc`
  - Update vulnerability register if needed
  - Verify all security tests pass

- [ ] 12.4: Final validation:
  - Verify all CI checks pass
  - Test deployment on Scaleway Container
  - Verify session persistence across deployments
  - Monitor logs for any auth errors

## Commits & Progress
- [x] **17db73c-698eca1**: Phase 1, 2 & 3 complete (DB, RP config, backend services)
- [x] **0a1c696**: docs(auth): mark Phase 3 as 100% complete
- [x] **48b7a1f**: feat(auth): create registration and login API routes
- [x] **b070354**: feat(auth): complete API routes implementation
- [x] **ccb5e69**: docs(auth): mark Phase 4 as 100% complete
- [x] **ffb82f4**: feat(auth): create authentication and RBAC middleware
- [x] **0050ae2**: feat(auth): apply RBAC middleware to protected API routes

## Status
- **Progress**: 5/12 phases completed (30/94 tasks - 32%) ✅
- **Phases complete**: 1 (DB), 2 (RP Config), 3 (Services), 4 (Routes), 5 (RBAC)
- **Current**: Ready for Phase 6 - Security Headers & Rate Limiting
- **Next**: Secure headers, rate limiting, CORS strict mode

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

