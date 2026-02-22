# SPEC EVOL - VSCode Plugin (Plan, Tools, Summary, Checkpoint)

Status: Draft for roadmap orchestration (2026-02-22)

## 1) Objective
Deliver VSCode plugin capabilities in two stages:

- Milestone W1 (deadline: 2026-03-01)
  - Plugin v1: `plan`, `tools`, `summary`, `checkpoint`.
- Milestone W2 (deadline: 2026-03-08)
  - Plugin v2: multi-agent + multi-model orchestration.

Mandatory architecture baseline for both milestones:
- The VSCode plugin reuses the shared `ChatWidget`/chat core foundation (same family as web app and Chrome plugin).
- Tools execution is local-first inside VSCode extension runtime.
- Chat and agent orchestration stays API-driven (server-side orchestration, streaming, traceability, policy).

## 2) Scope

In scope:
- VSCode extension shell and command palette integration.
- Plan/step panel synchronized with backend TODO/steering domain.
- Tool execution surface (local safe tools + remote API tools through API orchestration contracts).
- Context summarization and checkpoint lifecycle.
- Multi-agent execution UX and model selection (W2).

Out of scope:
- Full IDE replacement or complete SCM feature parity.
- Marketplace growth activities and pricing model.

## 3) Existing baseline
Relevant references:
- `spec/SPEC_CHROME_PLUGIN.md` (abstraction and runtime patterns to reuse)
- `spec/SPEC_CHATBOT.md`
- `spec/TOOLS.md`
- `spec/SPEC_EVOL_AGENTIC_WORKSPACE_TODO.md`
- `TODO.md` (`Agent de code`, `Vs code`, `Autonomous agent` items)

Current state summary:
- No production VSCode plugin baseline in repo roadmap.
- Chat/tool runtime exists in web and chrome plugin domain and is reused as the plugin foundation.

## 4) Target design

### 4.0 Host architecture (mandatory)
- Shared UI/chat core:
  - Reuse `ChatWidget` and shared chat stores/adapters as the base interaction layer.
  - Keep host-specific adapters for VSCode runtime (webview, command bridge, auth bridge).
- Local tools:
  - Executed in VSCode extension host (or controlled helper process), not in browser runtime.
  - Results are attached to orchestrated chat/agent flows via API contracts.
- Remote orchestration:
  - API remains source of truth for chat sessions, agent orchestration, multi-model routing, and traces.
  - Plugin does not implement an independent orchestration engine.

### 4.1 Plugin v1 (W1)
- Main views:
  - Plan tree view (steps + status + blockers).
  - Tool run panel.
  - Session summary panel.
  - Checkpoint list (create/restore/compare metadata).
- Core commands:
  - `TopAI: Create Plan`
  - `TopAI: Run Next Step`
  - `TopAI: Summarize Context`
  - `TopAI: Create Checkpoint`
  - `TopAI: Restore Checkpoint`

### 4.2 Plugin v2 (W2)
- Multi-agent orchestration:
  - create agent roles per task.
  - parallel execution lanes with merge checkpoints.
- Multi-model routing:
  - select model/provider by task or by agent profile.
- Decision trace:
  - track who/what changed a file and why.

### 4.3 Tooling strategy
- Local tools:
  - file read/search,
  - safe shell wrappers,
  - git checkpoint actions.
- Remote tools:
  - use existing API contracts for chat/tool/plan execution and orchestration resumption.
- Permission model:
  - explicit allow/deny per tool category.

### 4.4 Codex sign-in constraints (W1 clarification)
- Codex sign-in via ChatGPT is allowed for developer/plugin coding workflows.
- This sign-in path is **not** an end-user authentication provider for this application.
- The plugin must keep auth domains separated:
  - App/API domain: existing app auth/session contracts for API-backed features.
  - Codex domain: coding assistant auth used by Codex workflows in dev/plugin contexts.
- Product rule: do not build OpenAI OAuth login for app users from this Codex sign-in capability.
- Billing rule: Codex/ChatGPT sign-in does not imply free backend OpenAI API usage.

## 5) Branch plan

- `feat/vscode-plugin-v1`
  - extension skeleton + plan/tools/summary/checkpoint.
- `feat/vscode-plugin-v2-multi-agent`
  - multi-agent orchestration + multi-model routing.

## 6) Acceptance criteria

W1:
- Extension can create and execute a plan with visible progress.
- Users can run tools and inspect outputs in plugin UI.
- Context summary and checkpoint create/restore are functional.

W2:
- Multi-agent tasks can run in parallel with explicit merge points.
- Different models/providers can be assigned per agent/task.
- Execution trace is auditable from plugin UI.

## 7) Open questions

- `VSC-Q1`: Which publishing channel is primary (Open VSX, VS Marketplace, both)?
- `VSC-Q2`: Which shell commands are allowed in v1 by default?
- `VSC-Q3`: Are checkpoints Git-based only, or mixed with domain-level snapshots?
- `VSC-Q4`: What is the v2 UX model for multi-agent conflicts (queue, merge queue, explicit vote)?
- `VSC-Q5`: Is telemetry opt-in required before any usage analytics?

## 8) Risks

- Scope creep from v1 into v2 features.
- Conflicts between plugin checkpoint model and existing git workflows.
- Security concerns around local shell tool exposure.
