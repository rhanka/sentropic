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

### 8.2 `ls`
- Intent: list directory entries quickly.
- Input: `path`, optional depth, optional `include_hidden`.
- Output: normalized entry list (name, type, size, mtime).
- Guards:
  - workspace/path scope restrictions,
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
  - path scope restrictions.

### 8.4 `file_read`
- Intent: read file content for analysis.
- Input:
  - default: `path` + window parameters (line/range/offset),
  - optional explicit full-read request.
- Output: text excerpt (or full content when explicitly requested) + file metadata.
- Guards:
  - windowed bounded reads are default,
  - full-read allowed only when explicitly requested and still bounded by caps,
  - sensitive-path policy (deny/mask for secrets-configured paths),
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
  - path-pattern authorization profile to reduce repeated prompts (e.g. allow `api/*` scope),
  - explicit path-pattern grants are policy-governed and auditable.

### 8.6 `git_status`
- Intent: inspect working tree status.
- Input: optional path filter.
- Output: staged/unstaged/untracked summary.
- Guards:
  - read-only git interaction only,
  - default decision = allow.

### 8.7 `git_diff`
- Intent: inspect content changes.
- Input: optional path + ref range.
- Output: bounded diff payload.
- Guards:
  - bounded diff payload (size/hunks/files),
  - scope restrictions to allowed workspace refs/paths,
  - read-only git interaction.

### 8.8 `history_analyze`
- Intent: targeted question-answering on conversation history.
- Input: `question`, optional range selectors, optional tool-target selectors.
- Output:
  - default: free-form answer optimized for operator readability,
  - optional structured mode: `answer`, `evidence`, `coverage`, optional `confidence`.
- Guards: read-only, no hidden-reasoning leakage, explicit `insufficient_coverage` signaling.

### 8.9 Non-shell policy engine (shared)
- Apply a unified `deny/ask/allow` policy engine across non-shell tools where relevant.
- Precedence: `deny > ask > allow`.
- Scope merge: user defaults + workspace safety override.
  - workspace policy is an upper safety bound and cannot be weakened by user-level rules.

## 9) Risks
- Missing object adapters can cause partial restores in v1; this must be explicit in UI/API responses.
- Over-aggressive compaction can degrade context quality; threshold and hysteresis tuning should remain observable.
- Divergence risk if any surface (web/chrome/vscode) bypasses shared runtime contracts.
