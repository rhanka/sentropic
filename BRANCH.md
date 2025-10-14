# Feature: WebAuthn Authentication

## Objective
Implement WebAuthn-based passwordless authentication with @simplewebauthn/{server,browser} libraries, replacing the current OIDC placeholder. Support device credential registration, login, session management with RBAC, and fallback magic link authentication.

## Scope
- **API**: Backend routes, database schema, session management, RBAC middleware
- **UI**: Registration/login flows, device management interface
- **Database**: New tables for credentials, sessions, challenges
- **Security**: Rate limiting, secure headers, user verification policies

## Plan / Todo

### Phase 1: Database Schema & Migrations
- [ ] 1.1: Create `webauthn_credentials` table with fields:
  - `id` (uuid, pk)
  - `credential_id` (text, unique, base64url-encoded)
  - `public_key` (text, PEM or COSE base64-encoded)
  - `counter` (integer, for replay protection)
  - `user_id` (uuid, fk → users.id)
  - `device_name` (text, user-friendly name)
  - `transports` (json, array of authenticator transports)
  - `backup_eligible` (boolean)
  - `backup_state` (boolean)
  - `uv_initialized` (boolean, user verification flag)
  - `created_at` (timestamptz)
  - `last_used_at` (timestamptz)

- [ ] 1.2: Create `users` table (if not exists) with fields:
  - `id` (uuid, pk)
  - `email` (text, unique, nullable for anonymous WebAuthn)
  - `display_name` (text)
  - `role` (text, enum: 'admin_app', 'admin_org', 'editor', 'guest')
  - `current_challenge` (text, nullable, temporary storage)
  - `challenge_expires_at` (timestamptz, nullable)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

- [ ] 1.3: Create `user_sessions` table for device session management:
  - `id` (uuid, pk)
  - `user_id` (uuid, fk → users.id)
  - `session_token` (text, unique, hashed)
  - `refresh_token` (text, unique, hashed, nullable)
  - `device_name` (text)
  - `ip_address` (text)
  - `user_agent` (text)
  - `mfa_verified` (boolean)
  - `expires_at` (timestamptz)
  - `created_at` (timestamptz)
  - `last_activity_at` (timestamptz)

- [ ] 1.4: Create `webauthn_challenges` table for challenge storage:
  - `id` (uuid, pk)
  - `challenge` (text, unique, base64url-encoded)
  - `user_id` (uuid, fk → users.id, nullable for registration)
  - `type` (text, enum: 'registration', 'authentication')
  - `expires_at` (timestamptz, TTL 60-300s)
  - `used` (boolean, default false)
  - `created_at` (timestamptz)

- [ ] 1.5: Create `magic_links` table for fallback authentication:
  - `id` (uuid, pk)
  - `token` (text, unique, hashed)
  - `email` (text)
  - `user_id` (uuid, fk → users.id, nullable)
  - `expires_at` (timestamptz, TTL 15min)
  - `used` (boolean, default false)
  - `created_at` (timestamptz)

- [ ] 1.6: Generate and apply migrations with `make db-generate` and `make db-migrate`
- [ ] 1.7: Add database indexes for performance (credential_id, user_id, session_token, challenge)

### Phase 2: WebAuthn Relying Party Configuration
- [ ] 2.1: Install dependencies: `@simplewebauthn/server`, `@simplewebauthn/browser`
- [ ] 2.2: Create RP configuration service (`api/src/services/webauthn-config.ts`):
  - Define RP ID (domain without protocol/port)
  - Define RP name (e.g., "Top AI Ideas")
  - Configure origin(s) for validation
  - Set timeout (60s for registration, 300s for authentication)
  - Configure attestation preference (default: 'none')
  - Configure user verification requirements (required for admin, preferred for others)

- [ ] 2.3: Create environment variables in `.env`:
  - `WEBAUTHN_RP_ID` (e.g., "top-ai-ideas.sent-tech.ca")
  - `WEBAUTHN_RP_NAME` (e.g., "Top AI Ideas")
  - `WEBAUTHN_ORIGIN` (e.g., "https://top-ai-ideas.sent-tech.ca")
  - `WEBAUTHN_TIMEOUT_REGISTRATION` (default: 60000)
  - `WEBAUTHN_TIMEOUT_AUTHENTICATION` (default: 300000)

### Phase 3: Backend Authentication Services
- [ ] 3.1: Create challenge management service (`api/src/services/challenge-manager.ts`):
  - `generateChallenge(userId?, type)`: Create and store challenge with expiration
  - `verifyChallenge(challenge, userId?, type)`: Validate challenge not expired/used
  - `markChallengeUsed(challenge)`: Mark challenge as consumed
  - `purgeExpiredChallenges()`: Cleanup expired challenges (cold start job)

- [ ] 3.2: Create session management service (`api/src/services/session-manager.ts`):
  - `createSession(userId, deviceInfo)`: Generate session + refresh tokens (JWT via jose)
  - `validateSession(sessionToken)`: Verify session validity and expiration
  - `refreshSession(refreshToken)`: Issue new session token
  - `revokeSession(sessionId)`: Invalidate specific session
  - `listUserSessions(userId)`: Get all active sessions for user
  - `revokeAllSessions(userId)`: Invalidate all user sessions

- [ ] 3.3: Create WebAuthn registration service (`api/src/services/webauthn-registration.ts`):
  - `generateRegistrationOptions(userId, userName, userDisplayName)`: Generate options with challenge
  - `verifyRegistrationResponse(userId, credential, expectedChallenge)`: Validate credential and store

- [ ] 3.4: Create WebAuthn authentication service (`api/src/services/webauthn-authentication.ts`):
  - `generateAuthenticationOptions(userId?)`: Generate options with challenge (allow credential discovery)
  - `verifyAuthenticationResponse(credential, expectedChallenge)`: Validate credential and counter

- [ ] 3.5: Create magic link service (`api/src/services/magic-link.ts`):
  - `generateMagicLink(email)`: Create token, send email, store hashed token
  - `verifyMagicLink(token)`: Validate token not expired/used, create or find user
  - `sendMagicLinkEmail(email, link)`: Integration with email service (future: SendGrid/Resend)

### Phase 4: API Routes Implementation
- [ ] 4.1: Create registration routes (`api/src/routes/auth/register.ts`):
  - `POST /api/v1/auth/register/options`: Generate registration options
    - Request: `{ userName: string, userDisplayName: string, email?: string }`
    - Response: `{ options: PublicKeyCredentialCreationOptions }`
  - `POST /api/v1/auth/register/verify`: Verify registration response
    - Request: `{ userName: string, credential: RegistrationResponseJSON }`
    - Response: `{ user: User, session: Session }`

- [ ] 4.2: Create authentication routes (`api/src/routes/auth/login.ts`):
  - `POST /api/v1/auth/login/options`: Generate authentication options
    - Request: `{ userName?: string }` (optional for discoverable credentials)
    - Response: `{ options: PublicKeyCredentialRequestOptions }`
  - `POST /api/v1/auth/login/verify`: Verify authentication response
    - Request: `{ credential: AuthenticationResponseJSON }`
    - Response: `{ user: User, session: Session }`

- [ ] 4.3: Create session routes (`api/src/routes/auth/session.ts`):
  - `GET /api/v1/auth/session`: Get current session info (authenticated)
  - `POST /api/v1/auth/session/refresh`: Refresh session token
  - `DELETE /api/v1/auth/session`: Logout current session
  - `DELETE /api/v1/auth/session/all`: Logout all sessions

- [ ] 4.4: Create credential management routes (`api/src/routes/auth/credentials.ts`):
  - `GET /api/v1/auth/credentials`: List user's registered devices (authenticated)
  - `PUT /api/v1/auth/credentials/:id`: Update device name (authenticated)
  - `DELETE /api/v1/auth/credentials/:id`: Revoke credential (authenticated)

- [ ] 4.5: Create magic link routes (`api/src/routes/auth/magic-link.ts`):
  - `POST /api/v1/auth/magic-link/request`: Request magic link
    - Request: `{ email: string }`
    - Response: `{ message: "Magic link sent" }`
  - `POST /api/v1/auth/magic-link/verify`: Verify magic link token
    - Request: `{ token: string }`
    - Response: `{ user: User, session: Session }`

### Phase 5: RBAC & Middleware
- [ ] 5.1: Create authentication middleware (`api/src/middleware/auth.ts`):
  - Extract and validate session token from cookie
  - Attach `user` object to request context
  - Return 401 if invalid/expired

- [ ] 5.2: Create RBAC middleware (`api/src/middleware/rbac.ts`):
  - `requireRole(role)`: Check user role matches required role
  - `requireAnyRole(roles)`: Check user has any of specified roles
  - Return 403 if unauthorized

- [ ] 5.3: Define role hierarchy:
  - `admin_app`: Full system access, user management
  - `admin_org`: Organization-level admin, manage folders/users in org
  - `editor`: Edit use cases, folders, companies
  - `guest`: Read-only access

- [ ] 5.4: Apply middleware to existing protected routes:
  - Companies, Folders, UseCases: require `editor` or higher
  - Settings, BusinessConfig: require `admin_org` or higher
  - Admin endpoints: require `admin_app`

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
(To be filled as commits are made)

## Status
- **Progress**: 0/12 phases completed (0/94 tasks)
- **Current**: Phase 1 - Database Schema & Migrations
- **Next**: Create database tables and generate migrations

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

