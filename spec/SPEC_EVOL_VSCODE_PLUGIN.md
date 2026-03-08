# SPEC EVOL - VSCode Plugin (ChatWidget host + shared Summary/Checkpoint runtime)

Status: Draft updated (2026-03-02)

## 1) Objective
Refocus VSCode scope on a robust plugin host for the shared chat runtime, and remove the old plugin-only checkpoint/summary design.

Primary goals:
- Keep VSCode plugin v1 as a host for shared `ChatWidget` + runtime bridge.
- Make VSCode host truly dockable (side panel container), not editor-tab only.
- Ship a simple and testable auth bootstrap in v1 using admin-issued token.
- Align summary/checkpoint behavior with shared chat runtime (web/chrome/vscode parity).
- Define a deterministic checkpoint + restore model usable beyond Git-only flows.

## 2) Scope

In scope:
- VSCode extension shell and packaging (`.vsix`) for local install/UAT.
- Embedded shared chat surface (same core runtime family as web/chrome).
- Shared summary/checkpoint runtime contracts and policies.
- Command bridge for runtime actions (including restore).
- Admin-managed token onboarding for VSCode extension v1.
- Theme parity requirements for VSCode host (dark/light/high-contrast) and web app theme preference (`system|light|dark`).
- Provider connection centralization in web app admin (Codex first), consumed by VSCode host.

Out of scope:
- Legacy plugin tabs/views (`Plan`, `Tools`, `Summary`, `Checkpoint`) as standalone plugin UI features.
- Plugin-local bespoke checkpoint logic disconnected from shared chat runtime.
- Multi-agent orchestration UI (deferred to BR-10).
- Per-user provider OAuth flow inside VSCode extension for v1.

## 3) Baseline references
- `spec/SPEC_CHATBOT.md`
- `spec/SPEC_EVOL_AGENTIC_WORKSPACE_TODO.md`
- `spec/SPEC_EVOL_RELEASE_QA_PIPELINE.md`
- `PLAN.md` (BR-05 / BR-10 dependencies)

## 4) Lot-0 decisions (locked)

### 4.1 Checkpoint granularity
- Granularity: **one checkpoint per conversation turn** (`every turn`).
- Each turn checkpoint captures:
  - turn identifiers (chat/session/message boundaries),
  - runtime context digest,
  - artifact delta references (files/objects changed in the turn),
  - optional provider metadata for traceability.

### 4.2 Restore mode v1
- Locked mode: **C** = restore by selected artifacts.
- v1 behavior:
  - restore files when file adapters are available,
  - restore domain objects when object adapters are available,
  - support mixed restore set (files + objects) in one restore request,
  - run `dry-run` first (preview impact + conflicts),
  - then apply restore with explicit result per artifact,
  - do not offer restore action when there is no effective delta to apply.

### 4.3 Artifact version tracking (not Git-only)
Checkpoint restore must not depend exclusively on Git.

Required tracking model:
- Shared artifact ledger per turn with:
  - `artifact_type` (`file`, `object`, ...),
  - stable artifact key (path or object identifier),
  - `before_version`, `after_version`,
  - minimal payload reference for restore.
- `version` source is adapter-driven:
  - file adapter: content hash + optional git blob/commit metadata when available,
  - object adapter: object revision/version field from domain store.
- Git metadata is **optional enrichment**, not the sole restore substrate.

### 4.4 Conflict policy (restore)
- Locked conflict policy: **B** = stop and require explicit user decision when current state diverges from checkpoint baseline.
- v1 rules:
  - no silent overwrite on conflict,
  - `dry-run` must expose conflicts before apply,
  - apply path proceeds only for non-conflicting artifacts or after explicit user confirmation.

### 4.5 Object scope for restore v1 (precise B definition)
Object restore in v1 is whitelist-based (not global-all-objects by default).

`B` is defined as:
- Restorable objects must be explicitly registered with an object adapter implementing:
  - version read (`before_version` / `after_version`),
  - snapshot read at checkpoint boundary,
  - restore apply with validation,
  - conflict detection.
- Default v1 whitelist:
  - session runtime objects (`plan`, `todo`, `task`, session summary/checkpoint metadata),
  - chat-editable domain objects already supporting revisioned updates in current runtime,
  - code-session domain objects when an adapter exists (tracked in artifact ledger like files).
- Non-registered objects are excluded from restore and reported as unsupported.

### 4.6 Summary policy (state-of-the-art aligned)
Default policy proposal:
- Double threshold policy (automatic):
  - `soft` trigger at **85%** projected usage of usable context budget,
  - `hard` trigger at **92%** projected usage (compaction mandatory before continuing model progression).
- Preserve reserved headroom for continuation:
  - ~10% answer generation,
  - ~5% steering/tool/system overhead.
- Hysteresis after compaction:
  - compact down to ~60% effective usage target to avoid immediate re-compaction loops.
- Additional trigger:
  - if next-turn projection would exceed budget, compact before next model call.
- Manual compaction command remains available.

Rationale:
- Aligns with modern agent clients using near-limit auto compaction + reserve windows.
- Avoids late hard-fail behavior while preserving answer quality.

### 4.6.1 User-facing summary UX (locked)
- Visual pattern:
  - show a transverse light-gray system strip in timeline (not an assistant message bubble).
  - states:
    - running: `Résumé du contexte en cours…`
    - done: `Contexte compacté.`
- Messaging:
  - default message stays metric-free (clean UX).
  - metrics are available on hover/tooltip only (example: turns compacted, estimated token delta).
- Persistent context occupancy indicator:
  - show a very lightweight occupancy indicator at all times in chat UI (web + VSCode host parity),
  - indicator must stay subtle (small bar/dot + tooltip), never blocking composition.
- No-op rule:
  - if compaction runs but no effective delta is produced, do not show a completed compaction strip.

### 4.6.2 Overflow during reasoning / tool execution (locked)
Goal: avoid context crashes even when overflow happens mid-reasoning or around heavy tool calls.

Execution policy:
- Preferred path:
  - if provider/runtime supports in-flight compaction continuation, compact and continue same run.
- Fallback path:
  - otherwise compact at next safe boundary (end of current reasoning/tool step), then resume automatically.
- Never silently drop user intent:
  - pending user request and steer context must be preserved across compaction boundary.

Heavy tool-call guardrails (locked options: `1B 2A 3A 4A 5A`):
- Threshold model:
  - soft threshold = 85% (preventive),
  - hard threshold = 92% (mandatory compaction boundary).
- Pre-dispatch budget check for each tool call:
  - estimate tool input + expected output contribution to context usage,
  - compute projected occupancy before executing the call.
- Soft-zone behavior (`>=85%` and `<92%`):
  - do not dispatch immediately,
  - return a structured `context_budget_risk` signal to the LLM,
  - LLM must replan the next action before execution.
- Hard-zone behavior (`>=92%`):
  - compaction is forced first,
  - then return control to LLM for replan,
  - no direct oversized call dispatch before compaction.
- Replan attempts:
  - one attempt only before explicit user escalation.
- Mandatory alternative set offered to LLM on risk:
  - narrow tool scope,
  - request targeted summary,
  - use `history_analyze` to extract only required evidence/context,
  - ask user narrowing question when required.
- Runtime protections:
  - max payload guard for tool outputs,
  - per-turn tool-call ceiling to prevent runaway loops,
  - explicit reason codes when deferring/blocking:
    - `context_budget_risk`,
    - `context_compaction_required`,
    - `tool_payload_too_large`,
    - `tool_call_deferred_for_compaction`,
    - `context_replan_required`.

### 4.7 Retention policy
- Session retention default: unlimited checkpoints per session.
- Admin-configurable policy:
  - optional cap per session,
  - dedicated TTL for code sessions, default **15 days**, configurable by admin.
- Retention changes must be non-destructive by default (dry-run preview before cleanup jobs in admin tooling).

### 4.8 Permissions
- Restore permission baseline: any user with `editor` rights (and above) can execute restore.
- `viewer` cannot restore because restore mutates files/objects.
- Permission evaluation must be workspace-scoped and auditable.

### 4.9 UI proposal contract (web app + VSCode host)
Restore UX must be explicit and parity-driven across host surfaces.

Required behavior:
- Surfaces:
  - web app chat UI,
  - VSCode plugin embedded ChatWidget host.
- Proposal timing:
  - show restore proposal only when at least one checkpoint exists and current state diverges from a restorable checkpoint.
  - if no effective delta exists, do not present a restore CTA.
- Banner pattern (mandatory):
  - reuse the same visual pattern as the current Chrome-extension permission validation banner in chat (`ChatPanel.svelte` permission prompt block): rounded light panel, compact title/description, primary and secondary compact actions.
  - CTA set: primary `Oui, restaurer`, secondary `Non`.
  - `Oui, restaurer` is the highlighted default action (primary button style).
- Trigger points (mandatory):
  - **A. After user edit + send**:
    - when a user edits a previous message and presses send, show restore banner before executing the new run if a rollback is possible.
  - **B. From user message actions**:
    - add a restore action button (`lucide undo-dot`) in the user-message action row,
    - placement: immediately left of existing copy action,
    - style: same icon button style as other message actions.
  - **C. From assistant retry path**:
    - when user clicks retry under an assistant message and rollback is possible, show restore banner before rerun.
- Legacy behavior eradication (mandatory):
  - global checkpoint controls in composer/footer are forbidden (`Create checkpoint`, `Restore latest checkpoint`).
  - restore action must not be exposed as a session-global "latest" shortcut.
  - restore action is message-scoped only (anchored to a specific user message/checkpoint pair).
- Message binding and visibility (mandatory):
  - restore affordance is rendered only in the user message action row (same action cluster as edit/copy).
  - affordance is visible only when the bound checkpoint has an effective restorable code/object delta.
  - no code delta => no restore affordance and no restore banner.
- Banner behavior (mandatory):
  - clicking the restore affordance opens the restore banner (same Chrome-style prompt pattern), not a native `confirm()` modal.
  - clicking assistant `retry` must use the same restore banner flow first when rollback is available.
  - when rollback is not available, `retry` proceeds directly with no restore prompt.
- Proposal content:
  - checkpoint label/time,
  - impacted artifact counts (`files`, `objects`),
  - conflict count from `dry-run`,
  - explicit note when unsupported artifacts are present.
- Action flow:
  - `Oui, restaurer` triggers restore preview/apply flow (`dry-run` then explicit apply),
  - `Non` continues without restore and proceeds with requested action,
  - result panel shows per-artifact outcomes and reason codes.

### 4.10 Observability and audit
- Mandatory v1 observability:
  - structured logs for checkpoint create/list/restore,
  - restore audit trail table (actor, timestamp, artifacts, outcome),
  - metrics for success/failure/conflict rates and unsupported artifact counts,
  - stable reason codes in API responses.

### 4.11 Test strategy (v1 mandatory)
- Mandatory test layers:
  - unit tests (adapters, versioning, conflict detection, retention),
  - integration tests (checkpoint lifecycle + permission + audit),
  - e2e tests (restore success path + conflict path + unsupported artifact path).
- Reliability expectation:
  - deterministic restore behavior under conflict/no-conflict scenarios,
  - explicit partial result reporting when mixed artifact sets include unsupported types.
- Surface coverage requirement:
  - web app flow coverage (checkpoint proposal visibility + preview/apply + no-delta behavior),
  - VSCode plugin host flow coverage with parity assertions against web app behavior.
- Summary/overflow mandatory coverage:
  - summary strip lifecycle (`running` -> `done`) on both surfaces,
  - occupancy indicator visibility/parity on both surfaces,
  - overflow during reasoning/tool step with automatic resume behavior,
  - heavy tool-call guardrails (pre-dispatch budget check + explicit defer/block reason codes).

### 4.12 Conversation history QA tool (Lot 3 addition)
Add a dedicated tool for targeted questions over conversation history.

Tool intent:
- Provide a precise answer about prior conversation content without forcing the main model to re-scan a very long timeline in-context.
- Reuse the same pattern as document QA tooling currently in code (`documents.analyze` + merge prompt `documents_analyze_merge`): dedicated AI sub-agent call with optional chunking + merge.

Implementation constraint (mandatory):
- Do not duplicate orchestration code between `documents.analyze` and `history_analyze`.
- Both tools must share the same internal chunk/analyze/merge execution engine (single reusable service/function), with adapter-level differences only:
  - source adapter (`document` vs `chat history`),
  - prompt ids (`documents_*` vs `history_*`),
  - security/scope filters.

Proposed tool contract:
- Name: `history_analyze`.
- Scope: read-only over the active chat session history.
- Input:
  - `question` (required),
  - optional range selectors (`from_message_id`, `to_message_id`, `max_turns`),
  - optional tool-target selectors (`target_tool_call_id`, `target_tool_result_message_id`) to analyze one specific tool output when overflow risk comes from that call,
  - optional flags (`include_tool_results`, `include_system_messages`) with safe defaults.
- Output:
  - `answer`,
  - `evidence` list (message ids / turn references used),
  - `coverage` metadata (scanned turns, truncated/chunked indicator),
  - optional `confidence` bucket.

Execution strategy:
- If history is short: single-pass targeted analysis.
- If history is long: split into chunks, run targeted analysis per chunk, then merge with a final synthesis prompt, mirroring document flow semantics:
  - analysis prompt: `history_analyze` (equivalent role to `documents_analyze`),
  - merge prompt: `history_analyze_merge` (equivalent role to `documents_analyze_merge`).
- The tool must never expose hidden reasoning internals; it can only rely on stored conversation artifacts/events allowed by policy.

Safety and UX:
- No mutation side effects (strictly read-only).
- Must return explicit `insufficient_coverage` when the selected range cannot support a confident answer.
- Designed for parity on both surfaces:
  - web app chat,
  - VSCode ChatWidget host.

### 4.13 VSCode host/auth/theming decisions (locked)
Host placement:
- Primary VSCode surface must be a dockable `WebviewView` (side panel container), not an editor-tab `WebviewPanel`.
- `TopAI: Open Chat Panel` remains a focus/open command for the view container.
- Editor-tab fallback is not the target UX for v1 delivery.

Auth bootstrap v1:
- v1 extension onboarding uses an admin-issued personal access token (PAT-like), not provider OAuth in extension.
- Required flow:
  - admin creates/revokes token in web app settings,
  - operator copies token and pastes it in extension settings,
  - extension stores token in secure VSCode storage (`context.secrets`) and validates via API.
- UX rule:
  - remove ambiguous provider login CTA in extension settings for v1 bootstrap,
  - show explicit guidance to obtain token from web app admin settings.

Provider auth centralization (Lot 2 target):
- Provider connections are configured in web app admin only, then shared at backend scope (app/workspace policy).
- VSCode/web chat surfaces consume provider readiness from backend; they do not own provider auth lifecycle in v1.
- Delivery order:
  - Codex provider first,
  - Gemini Code Assist and other providers follow the same admin-managed pattern.

Theming:
- VSCode host UI follows VSCode theme tokens (light/dark/high contrast) automatically.
- Web app exposes a standard theme preference (`system`, `light`, `dark`) in settings/admin.
- Theme policy keeps component parity without forking chat runtime behavior.

### 4.14 Lot-1 increment contract (precise)
This section locks the implementation contract for the immediate Lot-1 increment.

#### 4.14.1 Host surface contract
- Extension primary surface is `WebviewViewProvider` in a dockable side panel container.
- `WebviewPanel` editor-tab mode is not a valid primary path for BR-05 delivery.
- `TopAI: Open Chat Panel` command must:
  - reveal/focus the side container,
  - focus/reveal the `Top AI Ideas` view if already resolved.

#### 4.14.2 Token bootstrap contract (v1)
- Authentication bootstrap for VSCode uses a backend-issued extension token (admin-created).
- Token lifecycle:
  - create/revoke from web app admin settings,
  - copy once for operator use,
  - paste in extension settings flow.
- Storage:
  - extension token is stored in VSCode secure storage (`ExtensionContext.secrets`),
  - token must not be persisted in plain workspace settings or browser localStorage.
- Runtime use:
  - token is attached as `Authorization: Bearer <token>` on extension API calls,
  - token validity is checked via explicit connectivity test endpoint flow.

#### 4.14.3 Extension settings UX contract (Lot 1)
- Bootstrap fields:
  - API endpoint,
  - extension token input/update action,
  - `Test API` action with explicit error classification.
- Error taxonomy must be actionable:
  - endpoint unreachable/network,
  - token missing,
  - token invalid/expired,
  - server error.
- Extension UI must not expose provider-login actions in this bootstrap path.

#### 4.14.4 Provider ownership split (applies from Lot 1 onward)
- Provider connections (Codex first) are owned by web app admin settings only.
- Extension consumes read-only provider readiness status from backend.
- No provider OAuth/session flow is initiated from extension UI in BR-05 Lot 1.

#### 4.14.5 Minimal API contract additions
- Admin web app:
  - endpoint(s) to create/revoke/read extension tokens (admin-only).
- Runtime read:
  - endpoint exposing provider readiness metadata for clients (web/vscode).
- Audit:
  - token create/revoke and provider-connection changes are auditable.

#### 4.14.6 Lot 1.1 API transport hardening contract (planned)
- Goal: remove direct API fetch dependency from the VSCode webview and route chat/runtime API calls through the extension host bridge.
- Contract:
  - webview issues host commands (bridge) for HTTP calls instead of direct cross-origin `fetch`,
  - host executes HTTP requests and returns normalized payload/error envelopes to webview,
  - host attaches token/session/workspace context consistently,
  - webview CSP/CORS remain permissive fallback, but are no longer a primary runtime dependency for chat flow.
- Scope:
  - applies first to chat bootstrap/runtime endpoints (`models/catalog`, sessions, messages, stream entrypoint),
  - preserves current token bootstrap UX from Lot 1.

### 4.15 Lot 6 - Subject 1 (streaming parity in VSCode host)
- Decision locked: use host-side chained proxy for streaming, with no API SSE rewrite.
- Source of truth for streaming remains API SSE (`/streams/sse`); no duplicate server-side streaming path.
- Host bridge behavior:
  - extension host consumes upstream SSE events as-is,
  - forwards each event immediately to webview (no app-level buffering/batching),
  - preserves event ordering and event types expected by `streamHub`.
- Webview behavior:
  - reuses existing `streamHub` pipeline and `StreamMessage` rendering path unchanged,
  - keeps existing Gemini smooth-stream handling (delta smoothing) untouched.
- Performance constraint:
  - proxy mode is pass-through chained transport only (no persistent tracing/log instrumentation in nominal mode).
- Degradation mode:
  - if host-stream channel fails, existing scoped polling fallback stays available.

### 4.16 Lot 6 - Subject 3 (checkpoint UX strict contract)
- Decision locked: eradicate legacy composer-level checkpoint UX.
- Forbidden:
  - composer/footer checkpoint buttons (`create`, `restore latest`),
  - global session-level restore shortcut detached from message anchor.
- Required:
  - restore entrypoint sits on user-message actions only (`undo-dot` near edit/copy),
  - restore always targets the checkpoint bound to that user message,
  - visibility requires effective code/object delta (`hasCodeDelta=true` on bound checkpoint),
  - when `hasCodeDelta=false`, no button, no banner, no restore prompt.

### 4.17 Lot 6 - Subject 4 (workspace-per-project in VSCode, with validated UI flow)
- Decision locked: option B (`project_fingerprint -> workspaceId`) stored server-side in user-scoped settings (no new DB table in BR-05).

- Fingerprint contract:
  - preferred source: git root + normalized remote URL,
  - fallback source: normalized workspace folder URI/path hash.

- Workspace typing constraint:
  - VSCode mapping only targets workspaces typed as `code`.
  - if no `code` workspace exists for the user, creation of a `code` workspace is mandatory before chat usage continues.

- Token-first sequencing (mandatory):
  - when token is missing/invalid, show existing blocking screen (`An extension token is required before...`) and route operator to settings.
  - after successful token connection, immediately fetch `code` workspaces + mapping state and resolve project association.

- Resolution contract (post-token):
  - extension computes `project_fingerprint` and requests mapping resolution,
  - if mapping exists and user still has access, auto-select mapped workspace,
  - if mapping missing, enter project-onboarding prompt flow,
  - if mapped workspace is no longer accessible, invalidate mapping and enter project-onboarding prompt flow.

- UI contract (mandatory, locked):
  - reuse the same blocking card pattern as token-required screen for project onboarding prompt.
  - onboarding message:
    - title: `New code base detected`,
    - body: `A workspace creation is recommended.`
  - actions:
    - `Create code workspace`,
    - `Use existing code workspace` (only if at least one `code` workspace exists),
    - `Not now` (only if at least one `code` workspace exists).
  - `Not now` behavior:
    - fallback to last used `code` workspace,
    - open settings workspace section for explicit operator choice.
  - if zero `code` workspace:
    - onboarding is blocking,
    - only creation path is allowed.
  - settings behavior:
    - workspace selector for VSCode mode lists only `code` workspaces.

- API/behavior constraints:
  - no schema migration for BR-05 (settings-based persistence),
  - workspace selection for VSCode requests must prefer resolved project mapping over generic default workspace fallback.

### 4.18 Lot 6 - Subject 5 (VSCode code-agent prompt profile, monolithic)
- Decision locked from interactive option review:
  - `1A`: monolithic prompt model,
  - `2C`: global + workspace override,
  - `3`: instruction files auto-load + user regex extension,
  - `4`: keep existing tool-permission/runtime policy unchanged,
  - `5B`: explicit dual-agent routing (`agent_code` / `agent_chat`) with deterministic defaults,
  - `6`: raw textarea settings editing,
  - `7A`: invalid prompt blocks execution,
  - `8A`: direct cutover (no feature-flag rollout).

- Baseline source for prompt style (to adapt for our runtime):
  - Cursor prompt corpus reference:
    - `https://github.com/rhanka/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Chat%20Prompt.txt`

- Prompt model contract (monolithic):
  - VSCode mode uses one effective prompt body dedicated to code tasks (`agent code` semantics).
  - No runtime multi-layer prompt chaining (`base -> vscode -> agent`) in BR-05.
  - The monolithic prompt must explicitly include:
    - coding-task behavior (analyze/plan/edit/test),
    - existing tool usage guidance,
    - current repo workflow constraints.

- Override contract (`2C`):
  - Resolution order: `workspace override` -> `global override` -> `default monolithic prompt`.
  - Workspace override is optional and full-text (not fragment patching).
  - Global and workspace prompt values are editable in settings as raw textarea fields.

- Project instruction ingestion contract (`3`):
  - Auto-load default patterns when present:
    - `AGENTS.md`
    - `CLAUDE.md`
    - `GEMINI.md`
    - `.cursor/rules/*.mdc`
    - `.github/copilot-instructions.md`
    - `.github/instructions/*.instructions.md`
  - Add settings input for custom include patterns (regex/pattern list) to extend/restrict discovery.
  - Ingested instruction content is injected as contextual block into the monolithic code-agent prompt payload.

- Tool policy contract (`4`):
  - No change to current runtime tool authorization/permission model.
  - No new tool policy layer introduced by S6-5.
  - The prompt can describe tool usage expectations, but cannot bypass policy enforcement.

- Agent routing contract (`5B`):
  - Canonical names:
    - `agent_code`: coding-oriented runtime prompt profile,
    - `agent_chat`: generic chat-oriented profile.
  - Routing matrix:
    - VSCode source + `code` workspace -> default `agent_code` on new sessions.
    - Web/Chrome source + `code` workspace -> `agent_code`.
    - non-`code` workspace (all sources) -> `agent_chat` (existing classic behavior).
  - BR-05 does not require a multi-agent selector UI.
    - Session routing must still be explicit in request contract (no implicit “always inject code-agent payload” behavior).
  - Settings ownership:
    - VSCode `Workspace` prompt editor modifies `agent_code` override only.
    - `agent_chat` remains managed by standard workspace chat prompt settings.

- Validation/failure contract (`7A`):
  - If resolved prompt is invalid (empty/parse-invalid), message execution is blocked.
  - UI must surface explicit actionable validation error in settings/runtime.

- Activation contract (`8A`):
  - Direct cutover once merged: VSCode runtime uses this S6-5 prompt pipeline by default.
  - Web app and Chrome extension behavior stay unchanged unless explicitly wired elsewhere.

- Test contract (scoped):
  - API:
    - prompt resolution order (`workspace > global > default`),
    - invalid prompt blocks execution with explicit error.
  - UI:
    - global/workspace textarea save/reload behavior,
    - custom pattern input persistence.
  - Integration:
    - instruction discovery from default files + custom patterns,
    - VSCode chat path uses resolved monolithic prompt.

### 4.19 Lot 6 - Subject 6 (settings split: `Server | Workspace | Tools`)
- Decision locked from interactive review:
  - `1B`: default tab behavior is context-driven,
  - `2B`: save model is per-tab actions,
  - `3B`: workspace creation goes through web app flow (no inline create in plugin),
  - `4A`: workspace switch requires explicit confirmation before apply.

- Tab contract:
  - `Server` tab:
    - endpoint fields (`apiBaseUrl`, `appBaseUrl`, `wsBaseUrl`), extension token, connectivity statuses,
    - server save/test actions stay scoped to server data only.
  - `Workspace` tab:
    - shows detected project scope/fingerprint and current mapped `code` workspace,
    - contains workspace selection/change actions and workspace creation entrypoint,
    - no silent workspace creation is allowed.
  - `Tools` tab:
    - contains VSCode runtime tool permission controls and visibility for active policy.

- Default tab behavior (`1B`):
  - if current project is unmapped, open `Workspace` tab first,
  - otherwise open `Server` tab by default.

- Save model (`2B`):
  - each tab owns its own save action and validation lifecycle,
  - avoid cross-tab overwrite/collision from global save.

- Workspace creation flow (`3B`):
  - plugin opens targeted web app flow for creating `code` workspace,
  - on return/refresh, plugin re-fetches mappings and resumes onboarding decision.

- Workspace switch flow (`4A`):
  - selection does not apply silently,
  - explicit confirmation step is mandatory before remapping/apply.

### 4.20 Lot 6 - Subject 7 (prompt editor UX in split settings)
- Decision locked from interactive review:
  - `5A`: prompt editor lives in `Workspace` tab (workspace-scope first-class UX).

- Prompt editor contract:
  - single editable field for effective code-agent prompt (no dual global/workspace textareas in plugin settings UI),
  - field is prefilled with resolved effective prompt (`workspace override > server override > default`),
  - source badge is mandatory (`Workspace override`, `Server override`, `Default`),
  - editing an inherited prompt must trigger explicit creation of workspace override,
  - reset action (`Revenir à l’héritage`) removes workspace override and rehydrates inherited value.

### 4.21 Lot 6 - Subject 8 (VSCode E2E runtime lane, naming cutover, CI contract)
- Decision locked from interactive review:
  - no backward-compatibility aliases for renamed targets,
  - CI primary mode = real stack (`api + ui`), mock mode reserved for targeted local/debug scenarios,
  - dedicated VSCode E2E environment lane (`e2e-vscode-*`),
  - strict path-based CI trigger, required status check, 7-day artifact retention,
  - scoped execution required (`E2E_SPEC` file-level), no grouped/global runs.

- Naming cutover contract (direct migration, no alias):
  - canonical build targets:
    - `build-ext-vscode` (replaces `vscode-ext`),
    - `build-ext-chrome` (replaces `build-ext`).
  - canonical VSCode E2E targets:
    - `up-e2e-vscode`,
    - `down-e2e-vscode`,
    - `ps-e2e-vscode`,
    - `logs-e2e-vscode`,
    - `test-e2e-vscode`.
  - removed targets must fail fast with explicit guidance in release notes/docs (no silent fallback path).

- Environment lane contract:
  - new lane naming: `ENV=e2e-vscode-<branch>`.
  - default dedicated ports for this lane:
    - `API_PORT=8788`,
    - `UI_PORT=5174`,
    - `OPENVSCODE_PORT=3115`.
  - lane isolation goal:
    - avoid collisions with `dev` and regular `e2e` lanes,
    - keep VSCode runtime diagnostics independent from web E2E diagnostics.

- Docker compose contract:
  - add dedicated file `docker-compose.e2e-vscode.yml`.
  - service set:
    - `openvscode` (OpenVSCode server host),
    - `e2e-vscode` (Playwright runner),
    - optional `mock-api-vscode` (targeted deterministic stream debugging),
    - reuse base `api`, `ui`, `postgres` from existing compose stack.
  - `openvscode` is mandatory host for VSCode runtime tests (no `code-server` variant in BR-05).

- CI contract (`e2e-vscode` workflow/job):
  - strict path trigger:
    - `ui/vscode-ext/**`,
    - `ui/src/lib/components/ChatWidget.svelte`,
    - `ui/src/lib/components/ChatPanel.svelte`,
    - `ui/src/lib/stores/streamHub.ts`,
    - `ui/src/lib/utils/api.ts`,
    - `api/src/routes/api/chat.ts`,
    - `api/src/routes/api/streams.ts`,
    - `Makefile`,
    - `docker-compose*.yml`,
    - `e2e/tests/vscode/**`.
  - required check policy:
    - `e2e-vscode` is blocking for impacted PRs.
  - execution mode:
    - primary = real mode (`api + ui`),
    - mock mode not part of required default CI path.
  - artifact retention:
    - traces, screenshots, videos, and OpenVSCode logs retained for 7 days.

- Test contract:
  - `test-e2e-vscode` requires `E2E_SPEC` and runs file-scoped VSCode specs only.
  - pass criteria for streaming parity:
    - incremental rendering observed in VSCode host timeline,
    - ordered stream consumption without full-message-only flush behavior,
    - no persistent auth/CORS regression in VSCode path.

- Non-regression contract (mandatory):
  - when touching VSCode bridge/stream/auth code, execute:
    - at least one VSCode scoped E2E (`test-e2e-vscode`),
    - at least one web scoped E2E (`test-e2e`) on impacted chat/stream area,
    - scoped API/UI tests tied to modified files.

### 4.22 Lot 6 - UAT bug-fix backlog (post-style pass)

#### 4.22.1 BUG-L6-3 (`allow_always` permission behavior)
- User contract:
  - clicking `Always` in permission banner must:
    - persist allow policy,
    - close banner immediately,
    - prevent immediate re-prompt for equivalent tool call scope.
- Policy merge contract:
  - workspace `deny` remains hard upper bound,
  - persisted user `allow` must override workspace `ask`,
  - fallback to `ask` only when no explicit user allow/deny policy is resolved.
- Test contract:
  - runtime unit: precedence matrix (`deny > user allow/deny > ask` fallback),
  - UI/store bridge: `allow_always` closes banner and next equivalent execution does not reopen prompt.

#### 4.22.2 BUG-L6-4 (default `code` workspace naming)
- Creation default when no explicit user name:
  - primary: repository name extracted from git `origin` URL,
  - fallback-1: active workspace folder name,
  - fallback-2: deterministic fingerprint suffix.
- Naming normalization:
  - trim + sanitize unsafe characters for workspace label,
  - preserve deterministic suffixing for collisions (`name`, `name (2)`, ...).
- Goal:
  - avoid opaque default names such as raw fingerprint-only labels when origin/folder context exists.

#### 4.22.3 BUG-L6-5 (Codex enrollment semantics in web app admin settings)
- Current mismatch to fix:
  - manual toggle (`Marquer connecté` / `Marquer déconnecté`) is not a real provider enrollment lifecycle.
- Required contract:
  - admin settings expose real Codex enrollment flow (`start/status/complete/disconnect`) with verifiable backend state.
  - readiness exposed to clients must derive from verified enrollment state, not from manual boolean toggles.
  - VSCode plugin consumes this backend readiness as source of truth.
- Compatibility requirement:
  - preserve RBAC (`admin` mutates; non-admin read-only).
  - align with federation roadmap intent in `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md` (provider SSO lifecycle).

#### 4.22.4 BUG-L6-8 (permission prompt readability in VSCode runtime)
- Current mismatch:
  - prompt origin `vscode://workspace` is technical and not operator-readable.
- Required contract:
  - permission banner must not expose raw/technical origin labels (`vscode://workspace`).
  - origin label is optional and non-blocking; the decision UX must stay actionable without origin semantics.
  - permission banner must display actionable request details:
    - tool intent (operation),
    - target path/scope when relevant,
    - command preview for shell/git operations.
- UX objective:
  - operator can understand exactly what is being authorized from action details only (no origin decoding needed).

#### 4.22.5 BUG-L6-9 (file path-scope authorization contract)
- Read tools (`file_read`, `ls`, `rg`) default behavior:
  - allowed by default only inside current workspace scope,
  - sensitive paths policy:
    - `.env*` is strict `deny` (no interactive override in v1),
    - other sensitive paths remain `ask` (explicit user decision required).
- Outside-workspace access:
  - requests targeting `../` or absolute paths outside workspace must not execute silently,
  - runtime must emit explicit permission request allowing user `once` / `always` decision for that path scope.
- Write tool (`file_edit`) scope contract:
  - first authorization request in workspace mode must propose workspace-global scope (`*`) to avoid per-file prompt spam,
  - `allow_always` must persist a reusable workspace-scoped grant and avoid repeated prompts for equivalent writes.

#### 4.22.6 BUG-L6-10 (git tool model simplification)
- Replace split read-only git tools contract (`git_status`, `git_diff`) with one unified `git` tool contract.
- Default policy:
  - allow by default: `git status`, `git diff`, `git ls-files` (read-only baseline),
  - ask-by-default: mutating commands (`commit`, `push`, `rebase`, `reset`, `checkout`, and other non-baseline actions), including first-time `commit` authorization.
- `-C` scoping contract:
  - default allow only when target stays within current workspace (including subfolders),
  - outside-workspace `-C` requires explicit permission prompt.
- Migration note:
  - existing policy entries and tool toggles must be migrated to unified `git` semantics without silent privilege widening.

#### 4.22.7 BUG-L6-11 (bash permission key normalization UX)
- Permission keys for `bash` must stay human-readable and action-readable.
- Contract:
  - use canonical `bash:<mono|bigram>` labels without underscore substitution,
  - preserve deterministic matching for policy evaluation while keeping UI strings readable.
- Objective:
  - operator-facing policy table remains understandable and editable.

#### 4.22.8 BUG-L6-15 (`plan` tool accessibility in VSCode runtime)
- Current mismatch:
  - VSCode restricted/new-session toolset excludes `plan`, so session plan progression is unavailable from plugin runtime.
- Required contract:
  - include `plan` in VSCode restricted/new-session allowed toolset defaults.
  - keep `plan` visible/controllable in VSCode tool toggle surface under the same policy model as other VSCode tools.
  - ensure outbound chat payload includes `plan` when enabled, so backend runtime can expose the tool in generation.
- Non-regression constraints:
  - no privilege widening for non-VSCode surfaces,
  - keep existing permission/runtime rules for local tools unchanged.
- Test contract:
  - scoped UI test: VSCode settings/chat tool toggles include `plan`,
  - scoped runtime test: new VSCode session sends `plan` in enabled tool list,
  - scoped chat test: `plan` tool call is reachable from VSCode conversation flow.

#### 4.22.9 BUG-L6-17 (outside-workspace read paths must be ask-authorizable, not hard fail)
- Current mismatch:
  - read-path requests outside workspace (`../`, absolute outside root) can fail directly in execution path instead of entering explicit permission flow.
- Required contract:
  - for `ls` / `rg` / `file_read`, in-workspace path remains default allow.
  - outside-workspace path must enter permission prompt (`ask`) with actionable target details.
  - outside-workspace grant/reject decisions (`allow_once`, `allow_always`, `deny_once`, `deny_always`) must persist and be reused consistently for equivalent scope.
- Guardrails:
  - `.env*` remains hard-deny regardless of location.
  - no silent privilege widening to unrestricted filesystem access.
- Test contract:
  - scoped runtime tests covering:
    - `../` request => prompt => allow resumes execution,
    - absolute outside path => prompt => deny blocks execution,
    - `allow_always` outside-path scope suppresses repeated equivalent prompts.

#### 4.22.10 BUG-L6-18 (`rm -rf` policy must be ask-only, not hard deny)
- Current mismatch:
  - bash policy currently hard-denies `rm -rf`, preventing explicit user authorization in cases where destructive cleanup is intentionally required.
- Required contract:
  - remove hard deny decision for `rm -rf` from default workspace bash decision matrix.
  - keep `rm -rf` in mandatory confirmation path (`ask`) by default.
  - user decisions (`allow_once` / `allow_always` / deny variants) must flow through the same persisted policy engine as other bash selectors.
- Safety constraints:
  - still no silent default allow for `rm -rf`.
  - workspace/user `deny` policy remains absolute upper bound.
- Test contract:
  - scoped runtime tests verify:
    - `rm -rf` triggers prompt (not immediate deny),
    - `allow_once` executes pending command,
    - `allow_always` persists and suppresses equivalent re-prompts.

#### 4.22.11 BUG-L6-19 (bash policy configuration UX supports only path-centric input)
- Current mismatch:
  - current tools-policy UI is path-pattern centric and does not expose explicit bash selector authoring for mono/bigram command rules.
- Required contract:
  - add a dedicated `Bash rules` editor in VSCode `Tools` settings (separate from path-pattern controls).
  - support manual readable selectors for mono/bigram commands:
    - `bash:git add`,
    - `bash:git push`,
    - `bash:rm -rf`,
    - and additional operator-entered selectors.
  - provide quick presets for common selectors (e.g. `git add`, `git push`, `rm -rf`) to reduce manual typing.
  - each rule row exposes:
    - `selector`,
    - `policy` (`allow` / `deny`),
    - optional `scope` / `origin` fields when relevant.
  - keep runtime decision engine unchanged:
    - same precedence (`deny > ask > allow`),
    - same persistence model,
    - no privilege widening.
  - add an effective-match preview before save so operator can validate normalization/matching deterministically.

### 4.23 Lot 6 - Multi-step assistant-run projection in the chat timeline
- Goal:
  - keep `1 backend run = 1 backend run`,
  - project that single run in the UI as a linear sequence of visible assistant steps and reasoning/tool steps, as if several assistant turns had happened consecutively.

- Scope:
  - shared chat rendering on web app, Chrome extension, and VSCode host,
  - no DB migration,
  - no provider/runtime transport contract change,
  - no redesign of the current reasoning/tools expandable block.

- Terminology:
  - `assistant-visible step` = one continuous span of assistant text visible to the user,
  - `runtime-hidden step` = one continuous span of non-visible runtime activity (`reasoning`, tool calls, `awaiting_*`, status churn, etc.),
  - `projected timeline` = ordered alternation of those steps as rendered in chat.

- Projection contract:
  - one assistant bubble maps to one `assistant-visible step`,
  - one reasoning/tools block maps to one `runtime-hidden step`,
  - the rendered order stays strictly linear:
    - assistant bubble,
    - reasoning/tools block,
    - assistant bubble,
    - reasoning/tools block,
    - ...
  - if a run starts with reasoning/tools before any assistant text, the projected timeline may start with a reasoning/tools block,
  - no empty assistant bubble is ever created for a pure runtime-hidden step.

- Segmentation algorithm:
  - segment on transitions between:
    - visible assistant output,
    - hidden runtime activity,
  - do not segment on paragraphs, sentence boundaries, markdown structure, or token cadence,
  - when visible assistant output resumes after a hidden runtime step, start a new assistant bubble,
  - while the run is still active, the last incomplete reasoning/tools step remains attached at the bottom of the current projected timeline,
  - once the run is finished, all projected steps become immutable and must not be merged back together on reload.

- Reasoning/tools rendering:
  - reuse the exact current reasoning/tools expandable UI,
  - split it per projected runtime-hidden step only,
  - do not introduce a second display mode,
  - do not summarize or collapse earlier steps differently from the current single-step contract.

- Steering linearization:
  - steering is not a side channel,
  - each steering user message must be inserted into the same linear conversation timeline:
    - after the last assistant bubble already emitted by the active run,
    - before the runtime-hidden step that resumes with that steering context,
  - if several steering messages occur during one active run, each one is inserted in chronological order before the next resumed runtime-hidden step.

- Retry contract:
  - retry remains available only on the last assistant bubble of the active/completed run,
  - retry scope = regenerate the current run from the last effective user intent,
  - the last effective user intent includes the latest applicable steering message,
  - when retry is triggered:
    - all projected assistant-visible and runtime-hidden steps belonging to the current run are discarded,
    - the conversation restarts from the preserved user-side history ending with the latest effective steering/user message,
  - if a run has not emitted any assistant-visible step yet, there is no retry affordance for that run.

- Reconstruction and persistence:
  - projected segmentation must be deterministic from persisted stream/chat events,
  - the same run must reconstruct to the same projected timeline:
    - during live streaming,
    - after page reload,
    - when reopening an existing session/history,
  - no projected sub-step is stored as a first-class database entity; projection is derived at render time.

- Session preview contract:
  - session preview/excerpt uses the last visible message only,
  - never use reasoning/tools content in the session preview,
  - fallback order:
    - last assistant-visible step if one exists,
    - otherwise last user message.

- Non-goals:
  - no per-sub-step retry,
  - no backend split of one run into multiple runs,
  - no new reasoning/tools visual language,
  - no migration of historical data.

### 4.24 Lot 6 - Session bootstrap cutover (`stream-events` removed from frontend contract)
- Goal:
  - replace the fragmented chat-session reload flow (`messages` + `checkpoints` + `documents` + `stream-events`) with one coherent bootstrap payload,
  - remove all direct frontend reads of `stream-events`,
  - keep SSE live transport and persisted `chat_stream_events` as internal runtime mechanisms.

- Problem statement:
  - current session reload is split across several APIs, which introduces:
    - visible latency,
    - synchronization races,
    - inconsistent partial UI states,
    - duplicated reconstruction logic in the frontend,
    - fragile replay behavior for reasoning/tools history.
  - `stream-events` are a technical journal, not a stable frontend read model.

- Decision locked:
  - frontend must no longer call:
    - `GET /api/v1/chat/sessions/:id/stream-events`,
    - `GET /api/v1/chat/messages/:id/stream-events`,
    - `GET /api/v1/streams/events/:streamId`
    for normal chat/session history rendering.
  - SSE live stays unchanged for active runs.
  - persisted `chat_stream_events` stay unchanged and continue to power backend runtime recovery/replay logic.

- New frontend contract:
  - introduce one bootstrap endpoint for chat session loading:
    - `GET /api/v1/chat/sessions/:id/bootstrap`
  - this endpoint must return a coherent snapshot for one session, including:
    - `messages`,
    - `todoRuntime`,
    - `checkpoints`,
    - `documents`,
    - `assistantDetailsByMessageId` (or equivalent name) for finalized assistant messages.

- Assistant details contract:
  - the bootstrap payload must provide the historical assistant runtime details needed by the chat UI without any extra `stream-events` call.
  - for BR-05, the acceptable payload shape is:
    - one entry per assistant message id,
    - each entry contains the full ordered persisted event list required to reconstruct reasoning/tool segments.
  - the frontend may still project multi-step assistant runs from that embedded snapshot in BR-05,
    but it must no longer fetch raw event journals directly through dedicated `stream-events` endpoints.
  - later optimization may replace embedded event lists with already projected backend segments, but that is not required for this cutover.

- Live/runtime split:
  - historical reconstruction:
    - comes exclusively from the session bootstrap payload.
  - live continuation for the currently active run:
    - still comes from SSE / host stream bridge.
  - once bootstrap is loaded, reload/open-in-new-tab must not require any extra historical replay endpoint.

- Frontend scope:
  - `ChatPanel` must load a session through the bootstrap endpoint only.
  - `StreamMessage` chat-mode history hydration must not call `stream-events` anymore.
  - `streamHub` must stop using `GET /streams/events/:streamId` for product chat history replay.
  - Queue/job/productive non-chat stream consumers may remain separate if they are not part of chat session bootstrap.

- Backend scope:
  - keep `chat_stream_events` persistence unchanged.
  - keep internal backend reads of stream events where runtime logic still depends on them:
    - local-tool resume,
    - steer consumption,
    - interrupted/finalized run recovery.
  - remove frontend-facing dependence on raw event replay routes from the chat/session contract.

- API cutover constraints:
  - direct cutover only; no dual frontend path.
  - once bootstrap is adopted in chat session UI, the old frontend codepaths to `stream-events` must be removed, not feature-flagged.
  - API routes may temporarily remain present until all frontend consumers are removed, but they are no longer part of the supported chat/session UI contract.

- Performance contract:
  - one session load = one bootstrap request for chat data (plus live SSE only if a run is active).
  - no extra round-trips for checkpoints/documents/reasoning replay during normal session open.
  - bootstrap must be fast enough for coding sessions where assistant histories can be large.

- Tests impact:
  - update UI tests to assert bootstrap-driven hydration instead of `stream-events` replay calls.
  - update API tests to cover:
    - `GET /api/v1/chat/sessions/:id/bootstrap`,
    - payload completeness/coherence,
    - historical reasoning/tools presence in bootstrap.
  - update E2E tests to validate:
    - reload/open-new-tab preserves reasoning/tools history,
    - no extra chat-history replay request to `stream-events` is needed.
  - remove or rewrite frontend-facing tests whose only purpose was the old `stream-events` contract.

- Docs cutover:
  - documentation must stop describing `stream-events` endpoints as part of the normal chat UI rehydration path.
  - durable docs must describe:
    - `session bootstrap` as the session-read contract,
    - SSE as the live-update contract,
    - persisted stream events as an internal runtime journal.

### 4.25 Lot 6 - Session history NDJSON cutover (paged reverse-order hydration)
- Goal:
  - replace the monolithic `bootstrap` JSON payload with one progressive history API,
  - keep one single session-thread read model for reload/open-new-tab,
  - preserve SSE as the live-update contract for the active run only.

- Problem statement:
  - the bootstrap snapshot is coherent, but it becomes too heavy as soon as assistant runtime history grows:
    - `assistantDetailsByMessageId` dominates payload size,
    - reload latency becomes visible on long coding/research sessions,
    - the frontend still waits on a large session-wide JSON before showing the thread.
  - the product now needs:
    - one single session-history transport,
    - progressive rendering,
    - reverse-order paging so the newest conversation state appears first.

- Decision locked:
  - the session-read contract becomes:
    - `GET /api/v1/chat/sessions/:id/history`
  - response format:
    - `application/x-ndjson`
  - order:
    - the full session history is streamed in reverse conversational order (`newest -> oldest`),
    - no pagination contract is exposed in BR-05.
  - `bootstrap` must leave the supported frontend contract once this cutover is done.

- NDJSON contract:
  - first line of the stream:
    - `type: "session_meta"`
    - includes the current session-level metadata needed to render the thread shell:
      - session identity/title,
      - `todoRuntime`,
      - `documents`,
      - `checkpoints`,
      - hydration metadata only (no paging cursor required).
  - following lines:
    - `type: "timeline_item"`
    - each item is already reconstructed backend-side, not a raw SQL message row and not raw `stream-events`.
  - acceptable item kinds for BR-05:
    - `user-message`
    - `assistant-segment`
    - `runtime-segment`

- Reconstruction contract:
  - the backend must reconstruct the same logical timeline already used in the frontend:
    - one assistant run can yield multiple `assistant-segment` and `runtime-segment` items,
    - steering user messages stay linear in the same thread,
    - no raw `stream-events` endpoint is exposed to the frontend.
  - every emitted timeline item must be renderable on its own:
    - no item may depend on a future line to become displayable.

- Frontend contract:
  - the frontend must render progressively as NDJSON lines arrive.
  - the first visible item during hydration is therefore the newest item of the session.
  - each received `timeline_item` must be staged off-DOM first.
  - the UI must flush the staged items as a block:
    - when the staged block now overflows the viewport, or
    - when the NDJSON stream ends.
  - block flush must prepend the staged items above the already rendered items so reading order stays chronological while hydration still starts from the newest message.
  - the frontend must treat emitted `timeline_item` objects as the canonical historical read model.
  - the frontend must not rebuild the whole historical projected timeline from `messages` while hydrating `history`.
  - local projection logic remains only for the active live run fed by SSE.
  - for non-code workspaces, `history` must not eagerly embed the heavy reasoning/tools body needed only for expanded runtime inspection.
  - for non-code workspaces, each `timeline_item` carries only the lightweight summary needed to render the collapsed thread.
  - the first expand of one assistant turn must trigger a targeted fetch for that message runtime detail payload only.
  - once fetched, that per-message runtime detail payload is cached locally for subsequent collapse/expand cycles in the same session view.

- Live/runtime split:
  - historical session open / reopen / tab switch:
    - `history` NDJSON only.
  - active run continuation:
    - SSE only.
  - persisted `chat_stream_events` remain internal backend runtime data.

- API cutover constraints:
  - direct cutover only; no dual frontend path kept long-term.
  - `bootstrap` becomes unsupported for the chat UI once the new contract is adopted.
  - old frontend-facing `stream-events` routes stay deleted.

- Performance contract:
  - session open must not require a monolithic full-session JSON blob.
  - the first visible thread items must appear before the full history has finished streaming.
  - the first visible history item must be the newest item of the session.
  - the UI must avoid per-item layout thrash; visible insertion happens by staged block flush, not by immediate DOM mount of every single line.
  - in non-code workspaces, expensive runtime body markdown must never be part of the initial history hydration cost.
  - no pagination is required for BR-05.

- Tests impact:
  - replace bootstrap-specific UI assertions with `history` NDJSON hydration assertions.
  - add API tests covering:
    - `GET /api/v1/chat/sessions/:id/history`,
    - first-line `session_meta`,
    - reverse-order item emission.
  - add UI/E2E tests covering:
    - progressive display of the newest items,
    - staged block flush on overflow / end-of-stream,
    - reload/open-new-tab preserves reasoning/tools through `history` + live SSE split.

- Docs cutover:
  - durable docs must describe:
    - `history` NDJSON as the session-read contract,
    - SSE as the live-update contract,
    - persisted stream events as an internal runtime journal only.

### 4.26 Lot 6 - Converged runtime-details history with workspace-specific live presentation
- Goal:
  - keep large-history hydration perceptibly progressive,
  - avoid a permanent code/non-code fork in the historical chat contract,
  - keep the only workspace-specific difference on the active run presentation.

- Decision locked:
  - history/runtime-details transport is identical for code and non-code workspaces,
  - the same projected timeline structure is used everywhere,
  - workspace type differences are limited to the live active run presentation,
  - host (`web`, `chrome`, `vscode`) must not create a second historical chat contract.

- Shared history policy:
  - `history` must use the same `summary + on-demand per-message runtime details` contract for every workspace type,
  - reloading a code-workspace session must therefore rehydrate collapsed runtime summaries first, exactly like a non-code session,
  - the first expand of one assistant turn must call a dedicated per-message details route (message-scoped, not session-wide),
  - once fetched, that body is cached locally for subsequent collapse/expand cycles in the same session view,
  - collapsed runtime blocks must stay cheap to mount even when reasoning/tool payloads are large,
  - a collapsed block may show only summary metadata that is already present in the `history` item payload.

- Code workspace live policy:
  - only the active run differs from non-code behavior,
  - reasoning/tools for the active run are expanded by default,
  - while an assistant-visible content segment is actively streaming, the same active step must not also render as a duplicated runtime-inline stream,
  - one active step = one visible stream source.

- Session scoping policy:
  - chat sessions listed in the UI must be scoped to the active workspace only,
  - switching workspace changes the conversation list as well as the runtime/tool policy for any newly opened session,
  - if the chat panel is already open when the workspace changes, the client must immediately reload the scoped session list, reset the active session, and auto-select the latest session available in the new workspace (or stay on a fresh empty session if none exists),
  - no mixed cross-workspace conversation list is allowed in VSCode, Chrome, or web hosts,
  - workspace type/template is derived from the active scoped workspace, not from the host runtime.
  - host runtime still controls only local host capabilities (VSCode local tools, Chrome local tools, or none on web),
  - a code-workspace conversation opened on web keeps code-workspace behavior but must not gain VSCode local tools,
  - a non-code workspace opened in VSCode keeps non-code conversation behavior but may still expose VSCode local tool capabilities separately.

- Non-code live policy:
  - the active run keeps the compact inline runtime preview behavior,
  - active reasoning/tools blocks remain collapsed by default while the run is in flight.

- Shared constraints:
  - reload/open-new-tab preserve the same projected step order in every workspace type,
  - history must not diverge between code and non-code sessions,
  - no duplicate runtime step may remain visible once assistant-visible streaming has taken over the same active step,
  - performance work must not create a second alternate timeline contract,
  - terminalization must not trigger a session-wide silent history reload,
  - once the run reaches `done`/`error`, the UI finalizes the turn from the already received SSE-backed local state only,
  - no extra terminal API read is allowed just to "confirm" the final assistant message.

- Performance expectation:
  - large-history session open must visibly progress item by item,
  - all workspaces must avoid eager runtime-body transport and eager markdown/runtime-body mounting for collapsed historical runtime steps,
  - code-workspace observability must come from the active run presentation, not from a heavier historical hydration contract.
  - terminal completion must therefore be O(1) on the client timeline: no full-session reread, no silent swap, no blink.


## 5) Industry alignment snapshot (for implementation framing)
- Cursor: checkpoint/rewind conversation flow + strong context controls.
- Claude Code: auto compact near context limits + explicit manual compaction command.
- OpenCode: configurable auto compaction (`auto`, `reserved`, `prune`) and explicit revert flows.
- Codex protocol: compaction and rollback are first-class runtime events; history rollback is distinct from local file revert.

Implication for this repo:
- Keep summary/checkpoint as runtime concerns first.
- VSCode remains a host surface, not a divergent runtime implementation.

## 6) v1 functional target (BR-05)
- Plugin provides installable shell + shared chat surface in a dockable side panel container.
- Runtime emits turn checkpoints automatically.
- Restore can target files and objects (when adapters exist).
- Summary policy follows soft/hard thresholds (85% / 92%) with reserved headroom.
- No legacy plugin-only summary/checkpoint tabs.
- v1 auth bootstrap uses admin-issued token path for extension connectivity.
- Provider auth ownership is centralized in web app admin (extension consumes backend readiness only).

## 7) Future branch boundary
- BR-05: deliver host/runtime parity and v1 restore/summary policy behavior.
- BR-10: extend to multi-agent/multi-model orchestration UI and advanced workflow composition.

### 7.1 Background tool execution deferral (explicit)
- Current state: no explicit contract yet for launching long-running tools in background without explicit agent lane UX.
- Decision: defer this capability to **BR-10**.
- BR-05 constraint:
  - tools are executed in foreground/interactive mode only (single request-response lifecycle).
  - no detached/background tool-run lifecycle in BR-05.
- BR-10 target:
  - add background tool run lifecycle (`start`, `status`, `cancel`, `resume`, `result`),
  - queue-backed execution with audit trail,
  - explicit UI state for running background tasks without forcing user-visible agent lane creation.

## 8) Rapid v1 tool contracts (BR-05 baseline)
This section provides a concise contract per tool for implementation alignment.

### 8.1 `bash` (safe shell wrapper)
- Intent: run bounded shell commands for coding workflows.
- Input: `command`, optional `cwd`, optional timeout profile.
- Output: `stdout`, `stderr`, `exit_code`, `duration_ms`, truncation flag.
- Guards: command allow/deny policy, output size cap, timeout cap, explicit permission policy.

Policy model (locked from options):
- Matching model: **hybrid mono+bigrame** with shell-segment awareness.
  - evaluate both first token (`mono`) and first two tokens (`bigram`) for each command segment.
  - examples:
    - `git add` can be `allow`,
    - `git push` can be `ask` or `deny`.
- Parser model:
  - normalize and tokenize command,
  - split shell into independent segments (`&&`, `||`, `|`, `;`, subshell boundaries) before rule evaluation.
- Decision model:
  - decisions are `deny`, `ask`, `allow`,
  - precedence is strict: `deny > ask > allow`,
  - default decision when no rule matches: `ask`.
- Scope model:
  - policy sources: user defaults + workspace override.
  - workspace override direction: workspace defines an upper safety bound (cannot be weakened by user).
  - effective merge:
    - if either scope resolves `deny` => `deny`,
    - else if either scope resolves `ask` => `ask`,
    - else `allow` only when both scopes resolve `allow`,
    - else fallback to default `ask`.
- UX confirmation model (`ask` decisions):
  - reuse the same banner interaction pattern as Chrome tool permission confirmation (`Yes once` / `No once` / `Always` / `Never`).
  - no dedicated custom modal for v1.
- Config editability:
  - provide an editable rule list for mono and bigram entries (decision + optional scope/filter),
  - quick operator edits should not require raw JSON editing.
- Key normalization contract:
  - store/display bash policy selectors in readable format (`bash:git add`, `bash:npm run`, etc.),
  - no underscore placeholder format in operator-facing identifiers.

### 8.2 `ls`
- Intent: list directory entries quickly.
- Input: `path`, optional depth, optional `include_hidden`.
- Output: normalized entry list (name, type, size, mtime).
- Guards:
  - workspace/path scope restrictions with explicit outside-workspace permission prompt,
  - bounded recursion depth (default bounded mode, no unbounded recursion),
  - hidden entries excluded by default unless explicitly requested.

### 8.3 `grep_rg`
- Intent: text search over workspace files.
- Input: `pattern`, optional `path`, optional glob filters.
- Output: matches with file path + line references.
- Guards:
  - use `rg` by default, fallback to `grep` only when needed,
  - bounded result volume (max matches/files/snippet size),
  - continuation/pagination contract for long result sets,
  - path scope restrictions with explicit outside-workspace permission prompt.

### 8.4 `file_read`
- Intent: read file content for analysis.
- Input:
  - default: `path` + window parameters (line/range/offset),
  - optional explicit full-read request.
- Output: text excerpt (or full content when explicitly requested) + file metadata.
- Guards:
  - windowed bounded reads are default,
  - full-read allowed only when explicitly requested and still bounded by caps,
  - sensitive-path policy:
    - `.env*` => hard deny,
    - other sensitive paths => explicit permission prompt (no silent allow),
  - binary-file rejection path.

### 8.5 `file_edit` (multi-mode)
- Intent: apply deterministic file changes with one unified tool entrypoint.
- Input: `path` + `mode` + structured payload.
  - `mode=edit` (targeted line/range edits),
  - `mode=write` (controlled overwrite),
  - `mode=apply_patch` (diff/patch apply).
- Output: edit summary + affected ranges/checksum + patch diagnostics.
- Guards:
  - default decision = `ask` (Chrome-style confirmation banner),
  - protected-path denylist + validation guards,
  - first write-authorization request should propose workspace-global scope (`*`) to reduce repeated prompts,
  - path-pattern authorization profile to reduce repeated prompts (e.g. allow `api/*` scope),
  - explicit path-pattern grants are policy-governed and auditable.

### 8.6 `git` (unified contract)
- Intent: execute bounded git operations through one tool surface.
- Input:
  - command/action (`status`, `diff`, `ls-files`, `commit`, `push`, ...),
  - optional refs/paths/options (including optional `-C`).
- Output:
  - operation-specific payload (status summary, diff, command output, diagnostics),
  - bounded text output with truncation metadata when needed.
- Guards:
  - default allow: read-only baseline actions (`status`, `diff`, `ls-files`),
  - default ask: mutating/high-impact actions (`commit`, `push`, `rebase`, `reset`, `checkout`, others), with first-time `commit` authorization required,
  - `-C` target must remain in current workspace for default allow; otherwise explicit permission prompt,
  - no silent widening from legacy `git_status`/`git_diff` migration.

### 8.7 `history_analyze`
- Intent: targeted question-answering on conversation history.
- Input: `question`, optional range selectors, optional tool-target selectors.
- Output:
  - default: free-form answer optimized for operator readability,
  - optional structured mode: `answer`, `evidence`, `coverage`, optional `confidence`.
- Guards: read-only, no hidden-reasoning leakage, explicit `insufficient_coverage` signaling.

### 8.8 Non-shell policy engine (shared)
- Apply a unified `deny/ask/allow` policy engine across non-shell tools where relevant.
- Precedence: `deny > ask > allow`.
- Scope merge: user defaults + workspace safety override.
  - workspace policy is an upper safety bound and cannot be weakened by user-level rules.
- Prompt UX contract:
  - permission prompts must expose human-readable origin + actionable details (operation + target scope),
  - technical identifiers remain internal and should not be the only visible context.

## 9) Risks
- Missing object adapters can cause partial restores in v1; this must be explicit in UI/API responses.
- Over-aggressive compaction can degrade context quality; threshold and hysteresis tuning should remain observable.
- Divergence risk if any surface (web/chrome/vscode) bypasses shared runtime contracts.
