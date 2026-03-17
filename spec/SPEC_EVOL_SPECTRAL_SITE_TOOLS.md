# SPEC EVOL - Spectral Site Tools (API Capture + Auto-Generated Tools)

Status: Draft — SPEC_VOL (raw product intent, 2026-03-17)

## 1) Objective
Integrate Spectral-like HTTP traffic capture and LLM analysis into the platform to auto-discover site APIs and generate per-site tools that AI agents call directly via HTTP — complementary to DOM-based tab_read/tab_action.

## 2) SPEC_VOL (raw product intent)

### Architecture
- Rewrite Spectral capture+analysis logic in Node/TS (not Python dependency).
- Capture logic in shared bookmarklet/chrome plugin injected script.
- Storage: S3 bucket for traces + metadata in dedicated API table. Tool definitions in DB per site per workspace.
- Analysis: LLM analyzes captured traffic server-side.

### Admin flow
- Admin activates `tab_capture` mode (admin-only in V1, workspace-admin in V2).
- Admin uses the site while capture records all HTTP traffic.
- Traces uploaded to S3, LLM analyzes and proposes tool definitions.
- Admin reviews/validates tools in `/settings`.
- Validated tools exposed to workspace users.

### User flow
- URL matching: site tools auto-activate when user navigates to registered site.
- Tools are per-site, per-workspace, call site APIs directly via HTTP.
- User must authorize credentials (consent flow). Stored server-side, revocable.

### Auth/credentials
- Spectral-like auth detection (cookie, Bearer, OAuth, API key).
- Per-user, per-site credential enrollment.
- Revocation in user settings panel.

### Relationship with tab_read/tab_action
- tab_read/tab_action remain active (DOM-based). Spectral tools are HTTP-based. Coexist.

## 3) Branch plan
- BR-15 `feat/spectral-site-tools`. Depends on BR-06.

## 4) Open questions
- SPT-Q1: Capture mechanism (fetch/XHR monkey-patch vs service worker)?
- SPT-Q2: Typical capture session size?
- SPT-Q3: Auth pattern detection approach?
- SPT-Q4: Complex auth handling (OAuth, MFA)?
- SPT-Q5: Rate limiting for generated tools calling third-party APIs?

## 5) Risks
- Legal: storing third-party credentials requires clear consent.
- Security: encrypted, scoped, revocable credential storage.
- Reliability: generated tools may break when site APIs change.
