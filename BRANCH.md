# Feature: F1 — cross-workspace agents list (all-workspaces session scope)

## Objective
- [ ] Make the agents-surface "Tous les espaces de travail" toggle WORK (UAT-1 F1): list the user's own sessions across ALL their workspaces, via an additive own-principal API scope.
- [ ] Restore the interim-hidden toggle: functional, on a DS control, no dev message.

## Scope / Guardrails
- [ ] Additive-minor, own-principal, backward-compatible. `GET /sessions` current behaviour unchanged; a new `?scope=all` path lists all-workspaces.
- [ ] Own-principal STRICT: `scope=all` filters `user_id = self` only — it can NEVER list another user's sessions (already true in `listForUser`'s `WHERE userId`).
- [ ] Bounded default APPLIED in the all-ws variant (the current list is unbounded — pre-existing; the variant must not inherit it): a sensible default limit, ordering preserved.
- [ ] Workspace labels are client-side: each session carries `workspaceId`; map to name via `$workspaceScope.items`. NO per-workspace labels API.
- [ ] Every UI element on a DS component. i18n FR+EN. Make-only, Docker-first, `ENV` last, never `ENV=dev`.
- [ ] Architect (`s-archi`) CO-SIGNS the PR on 3 criteria: own-principal strict / bounded-default-applied / dev-message fully removed.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `api/src/routes/api/chat.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/services/chat/postgres-chat-session-store.ts`
  - `api/tests/**`
  - `ui/src/lib/components/ChatWidget.svelte`
  - `ui/src/lib/chat/agents-feed-adapter.ts`
  - `ui/src/lib/stores/**`
  - `ui/src/lib/api/**`
  - `ui/src/locales/en.json`, `ui/src/locales/fr.json`
  - `ui/tests/**`
  - `packages/chat-ui/src/components/AgentsList.svelte`, `packages/chat-ui/package.json`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `.github/workflows/**` (none expected)

## Feedback Loop
- `attention` — the current `listForUser` (current-workspace path) is UNBOUNDED (pre-existing). This branch bounds only the new all-ws path; do not change the current-ws behaviour.

## Plan / Todo (lot-based)
- [x] **Lot 1 — server: additive own-principal all-ws scope**
  - [x] `listForUser(userId, workspaceId?, limit?)`: apply `.limit(limit)` when provided; keep `desc(updatedAt), desc(createdAt)`.
  - [x] `listSessions(userId, workspaceId?, limit?)`: passthrough.
  - [x] `GET /sessions`: read `scope` query. `scope=all` -> `listSessions(user.userId, null, DEFAULT_ALL_WS_LIMIT)`. Else unchanged.
  - [x] `api/tests`: `scope=all` returns cross-workspace own sessions; NEVER another user's; bounded default applied (seed > limit, get limit).
- [ ] **Lot 2 — client: functional toggle + per-session labels**
  - [ ] Restore the toggle in `ChatWidget.svelte` (DS control), no dev message. On -> fetch `/sessions?scope=all`; off -> current workspace.
  - [ ] Adapter: for all-ws, resolve each session label from its `workspaceId` via `$workspaceScope.items` (id->name), not the single current label.
  - [ ] `ui/tests`: adapter per-session label; toggle->fetch wiring.
- [ ] **Lot 3 — gates + PR**
  - [ ] `make test-api` + `make test-ui` green; typecheck + lint.
  - [ ] PR; ping `s-archi` for co-sign against the 3 criteria.
