# SPEC - VSCode Plugin

Status: Delivered BR-05 baseline (2026-03-11)
Backlog reference: `spec/SPEC_EVOL_VSCODE_PLUGIN.md`

## 1) Objective
Define the delivered VSCode host contract for BR-05 without mixing it with future backlog work.

This document is canonical for what is shipped in the VSCode/OpenVSCode host:
- host surface and bootstrap,
- workspace/project resolution,
- code-agent prompt profile,
- settings split,
- shared runtime usage constraints,
- admin-managed provider ownership expectations as consumed by VSCode.

Future iterations stay in `spec/SPEC_EVOL_VSCODE_PLUGIN.md`.

## 2) Host surface and bootstrap

### 2.1 Primary host surface
- The primary VSCode surface is a dockable `WebviewView` side panel.
- `TopAI: Open Chat Panel` remains the canonical reveal/focus command.
- Editor-tab `WebviewPanel` mode is not the primary delivered UX.

### 2.2 Token bootstrap v1
- VSCode connectivity uses a backend-issued extension token.
- Token lifecycle:
  - created/revoked from web app admin settings,
  - copied once by the operator,
  - stored in VSCode secure storage (`ExtensionContext.secrets`),
  - validated through explicit API connectivity checks.
- The extension must not persist this token in workspace settings or browser local storage.

### 2.3 Provider ownership split
- Provider enrollment is owned by web app admin settings only.
- The VSCode host consumes backend provider readiness and effective runtime availability.
- BR-05 does not expose provider OAuth/login initiation inside the extension.

### 2.4 Theme behavior
- The VSCode host follows VSCode theme tokens automatically.
- Theming must not fork chat/runtime behavior between hosts.

### 2.5 Host bridge transport
- The webview relies on the extension host bridge for runtime HTTP calls.
- The host attaches token/session/workspace context consistently.
- SSE remains the source of truth for live updates; the host only proxies the transport.

## 3) Live updates and shared runtime boundary

### 3.1 Streaming contract
- The VSCode host reuses the same product streaming contract as web and Chrome:
  - historical reads come from the shared chat history contract,
  - live updates come from `/api/v1/streams/sse`,
  - persisted `chat_stream_events` remain an internal runtime journal.
- The host-side proxy must be pass-through only:
  - no alternate runtime contract,
  - no host-specific batching semantics,
  - no second projection model for VSCode.

### 3.2 Foreground-only tool execution
- BR-05 keeps tool execution foreground-only.
- Detached/background tool execution is out of scope and remains deferred to BR-10.

### 3.3 Shared chat/runtime rule
- VSCode is a host surface, not a divergent runtime implementation.
- The chat UI and runtime behavior must stay aligned with the shared product contracts documented in:
  - `spec/SPEC_CHATBOT.md`
  - `spec/TOOLS.md`

## 4) Workspace-per-project mapping
- VSCode resolves a project fingerprint server-side to a `code` workspace.
- Mapping persistence is settings-based for BR-05 (no new DB table).
- Resolution order:
  - mapped `code` workspace when available and still accessible,
  - onboarding flow when no valid mapping exists.
- If no `code` workspace exists for the operator, creation is mandatory before chat usage continues.
- `Not now` is allowed only when at least one `code` workspace already exists.
- VSCode workspace selectors list `code` workspaces only.

## 5) Code-agent prompt profile

### 5.1 Prompt model
- BR-05 uses one monolithic `agent_code` prompt profile for VSCode code tasks.
- Resolution order:
  - workspace override,
  - server/global override,
  - default monolithic prompt.

### 5.2 Instruction ingestion
- The prompt may ingest project instruction files such as:
  - `AGENTS.md`,
  - `CLAUDE.md`,
  - `GEMINI.md`,
  - `.cursor/rules/*.mdc`,
  - `.github/copilot-instructions.md`,
  - `.github/instructions/*.instructions.md`.
- Custom include patterns may extend or narrow discovery.

### 5.3 Routing
- `code` workspaces use the `agent_code` profile by default.
- Non-code workspaces stay on the generic chat profile.
- BR-05 does not introduce a multi-agent selector UI.

## 6) Settings split and prompt editor

### 6.1 Settings tabs
- `Server`:
  - endpoint fields,
  - extension token,
  - connectivity statuses.
- `Workspace`:
  - detected project fingerprint,
  - mapped `code` workspace,
  - workspace prompt editor.
- `Tools`:
  - local tool permission and active policy visibility.

### 6.2 Save model
- Each tab owns its own save action and validation lifecycle.
- Workspace remapping requires explicit confirmation before apply.

### 6.3 Prompt editor UX
- The prompt editor lives in the `Workspace` tab.
- The effective prompt is shown with a mandatory source badge:
  - `Workspace override`,
  - `Server override`,
  - `Default`.
- Editing an inherited prompt creates a workspace override.
- `Revenir à l’héritage` removes the workspace override and restores inheritance.

## 7) Local tool baseline
- The delivered BR-05 local tool and policy baseline is canonical in `spec/TOOLS.md`.
- Reuse rules also live there:
  - reuse shared permission banners,
  - reuse one analysis engine where applicable,
  - do not create plugin-only tool orchestration paths.

## 8) Admin-managed provider readiness
- The VSCode host reads provider readiness from backend settings/admin state.
- For OpenAI-family runtime selection, BR-05 supports the shared backend source choice:
  - standard OpenAI key path,
  - connected Codex token path.
- This transport/source selection is documented in `spec/SPEC_CHATBOT.md` and the remaining auth backlog in `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`.

## 9) Explicit non-goals for BR-05
- No provider OAuth flow inside the extension.
- No background tool lifecycle.
- No plugin-only chat/runtime contract.
- No fake shell tabs or workflow-summary/checkpoint-only shells.
