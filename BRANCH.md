# Feature: Admin approval + user workspaces (private-by-default)

## Objective
Define and implement an onboarding and authorization model where:
- new users can use the app immediately (trial window),
- an admin must approve their rights within 48h, otherwise access becomes invalid,
- each user has an isolated workspace/namespace (private-by-default),
- admins cannot access user objects unless explicitly shared by the user,
- users can deactivate or permanently delete their account (immediate data deletion).

## Plan / Todo
- [x] Write spec: `spec/SPEC_ADMIN_USERS.md` (source of truth for this feature).
- [x] Align RBAC with account-status rules (trial + approval window).
- [x] Data model: `workspaces` + `workspace_id` scoping (private-by-default).
- [x] Migrations: add workspaces + backfill via default Admin Workspace.
- [x] API enforcement: systematic workspace scoping (anti-IDOR) across main resources.
- [x] Admin approval APIs (approve/reactivate/disable/list users) + audit fields.
- [x] User self-service APIs (`/me`: workspace privacy, deactivate, delete account).
- [x] Test updates: unit/api/ai tests adjusted to tenancy + new onboarding rules.
- [x] UI: Settings (workspace privacy, account deactivate/delete), Admin panel (approvals).
- [x] UI: ChatWidget "Jobs IA" (queue monitor in user environment) + purge "mes jobs".

## Tests — plan d’action (API / UI / E2E)
### API (Vitest)
- **Mettre à jour**:
  - `api/tests/api/me.test.ts`: couvrir `DELETE /me` quand le workspace est référencé par:
    - `chat_sessions.workspace_id` (sessions admin scopées sur le workspace user)
    - `chat_generation_traces.workspace_id`
  - `api/tests/api/admin-users.test.ts`: mutualisé (1 test) pour `GET /admin/users`, approve/disable/reactivate + `DELETE /admin/users/:id` (incluant la régression 500 FK).
  - `api/tests/api/streams.test.ts`: inclut le test “SSE tenancy” (pas de leak cross-workspace).
- **Créer**:
  - (fait) `api/tests/api/admin-users.test.ts` (remplace `admin-approval` + `admin-user-delete` en un seul test).

### UI (Vitest)
- **Pas de tests composants Svelte en place** (on a surtout stores/utils). Donc pas de “unit tests UI” à ajouter pour les confirmations `confirm()`.

### E2E (Playwright)
- **Mettre à jour**:
  - `e2e/tests/settings.spec.ts`: scénarios admin dans Paramètres (disable + delete user, confirmations).
- **Créer (optionnel si tu veux isoler)**:
  - `e2e/tests/admin-users.spec.ts`: suite dédiée “admin users” (disable/delete + garde-fous: self/admin non supprimables).
- **Stabilisé**:
  - `e2e/tests/chat.spec.ts`: exécution séquentielle + attentes API déterministes (anti-flaky).
  - `e2e/tests/ai-generation.spec.ts`: polling déterministe via `GET /queue/jobs/:id` + `GET /use-cases?folder_id=...` (anti-flaky SSE/UI).

## Commits & Progress
- [x] `3e06bc7` fix(chat): fallback polling queue quand SSE rate un message + e2e stable
- [x] `9e9b6c1` test(e2e): stabilise ai-generation via polling queue/api (anti-SSE flake)

## Status
- **Progress**: backend ✅ / UI ✅ / E2E ✅ (chat + ai-generation)
- **Current**: Workspaces + approval + queue tenancy implemented, including `/api/v1/admin/users/*`, `/api/v1/me/*`, `/api/v1/queue/*` (workspace-scoped) + UI surfaces.
- **Next**:
  - Fixes & evols (see TODOs / issues list in chat)
  - E2E tenancy boundaries + onboarding edge-cases (approval expiry downgrade, email not verified, etc.)

## Recent fixes
- `make db-backup` fixed in dev (runs `pg_dump` via TCP as `app/app`, avoids peer/root role issues).

- **Queue scheduling (anti-starvation)**:
  - `QueueManager.processJobs()` ne traite plus par “batch bloquant”: la concurrence est remplie **au fil de l’eau** (on attend la fin d’un job, puis on reprend un autre).
  - Priorité: `chat_message` puis `usecase_list`, puis le reste (FIFO), pour éviter que des gros jobs (`company_enrich`, `usecase_detail`, …) ne bloquent le chat.

- **Qualité (Make targets)**:
  - `make typecheck` ✅ (UI + API)
  - `make lint` ✅ (UI + API)

- **UI: suppression des routes admin (doublon)**:
  - Suppression du lien **Admin** dans le header.
  - Suppression complète de `ui/src/routes/admin/` (la gestion users admin est dans **Paramètres**).

- **Admin UI confirmations**:
  - Disable user: simple confirmation (no "reason" input).
  - Delete user: simple confirmation (no typed "DELETE").

- **Fix 500 on user deletion (FK chat_sessions.workspace_id)**:
  - Detach `chat_sessions.workspace_id` and `chat_generation_traces.workspace_id` (set to `NULL`) before deleting a workspace in:
    - `DELETE /api/v1/admin/users/:id`
    - `DELETE /api/v1/me`

- **Major chat bugfix (tool loops + missing final response)**:
  - **Root cause**: Responses API tool outputs were being re-injected as pseudo “user JSON messages”, losing the tool-output semantics and causing repeated `read_usecase` loops and sometimes no actionable final response.
  - **Fix**:
    - **Responses API orchestration**: switch to proper continuation using `previous_response_id` + `function_call_output` with correct `call_id` mapping (fixes 400 `No tool output found for function call call_...`).
    - **Tracing**: add OpenAI payload tracing (`chat_generation_traces`) including full tool definitions (description + schema), tool calls (args/results), and call-sites to debug orchestrator behavior.
    - **read_usecase**: add `select` option to scope returned fields (reduce tokens/noise and help prevent tool-call loops).
    - **Docs**: documented in `spec/SPEC_CHATBOT.md` (Chat tracing section).

## Reste à faire (court)
- UAT manuel: valider les flows Chat + Génération IA avec `gpt-4.1-nano` (focus “workspace + chat”).
- Re-run E2E complet quand tu valides côté UAT (objectif: zéro fail/flaky).


