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
- [ ] E2E tests for tenancy boundaries + approval expiry downgrade (guest) + blocking if email not verified.

## Commits & Progress
- [ ] **Commit set**: docs + tooling + db + auth + api + tests (see `git log`)

## Status
- **Progress**: backend ✅ / UI ✅ / E2E ⏳
- **Current**: Workspaces + approval + queue tenancy implemented, including `/api/v1/admin/users/*`, `/api/v1/me/*`, `/api/v1/queue/*` (workspace-scoped) + UI surfaces.
- **Next**:
  - Fixes & evols (see TODOs / issues list in chat)
  - E2E tests for tenancy boundaries + onboarding edge-cases

## Recent fixes
- `make db-backup` fixed in dev (runs `pg_dump` via TCP as `app/app`, avoids peer/root role issues).

- **Major chat bugfix (tool loops + missing final response)**:
  - **Root cause**: Responses API tool outputs were being re-injected as pseudo “user JSON messages”, losing the tool-output semantics and causing repeated `read_usecase` loops and sometimes no actionable final response.
  - **Fix**:
    - **Responses API orchestration**: switch to proper continuation using `previous_response_id` + `function_call_output` with correct `call_id` mapping (fixes 400 `No tool output found for function call call_...`).
    - **Tracing**: add OpenAI payload tracing (`chat_generation_traces`) including full tool definitions (description + schema), tool calls (args/results), and call-sites to debug orchestrator behavior.
    - **read_usecase**: add `select` option to scope returned fields (reduce tokens/noise and help prevent tool-call loops).
    - **Docs**: documented in `spec/SPEC_CHATBOT.md` (Chat tracing section).


