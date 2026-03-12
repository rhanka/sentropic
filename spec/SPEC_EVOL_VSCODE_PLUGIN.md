# SPEC EVOL - VSCode Plugin

Status: Active backlog after BR-05 consolidation (2026-03-11)
Delivered canon: `spec/SPEC_VSCODE_PLUGIN.md`

## 1) Objective
Track only the remaining VSCode-specific backlog after BR-05 delivered contracts have been consolidated into durable specs.

## 2) Scope

In scope for this backlog:
- future VSCode-only deltas not delivered in BR-05,
- BR-10+ workflow/orchestration UX,
- explicit backlog around background execution and multi-agent behavior.

Out of scope for this file:
- delivered BR-05 host/auth/runtime/tool contracts,
- shared chat history/live-update contracts,
- delivered local tool baseline.

Canonical delivered references:
- `spec/SPEC_VSCODE_PLUGIN.md`
- `spec/SPEC_CHATBOT.md`
- `spec/TOOLS.md`
- `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`

## 3) Baseline references
- `spec/SPEC.md`
- `spec/SPEC_VSCODE_PLUGIN.md`
- `spec/SPEC_CHATBOT.md`
- `spec/TOOLS.md`
- `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`

## 4) Delivered BR-05 reference map

### 4.13 VSCode host/auth/theming decisions (delivered)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` sections `2` and `8`.

### 4.14 Lot-1 increment contract (delivered)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` sections `2`, `3`, and `6`.

### 4.15 Lot 6 - Subject 1 (streaming parity in VSCode host) (delivered)
Canonical content moved to:
- `spec/SPEC_VSCODE_PLUGIN.md` section `3`,
- `spec/SPEC_CHATBOT.md` session history/live update contract.

### 4.16 Lot 6 - Subject 3 (checkpoint UX strict contract) (delivered)
Canonical product/runtime behavior remains in `spec/SPEC_CHATBOT.md`.

### 4.17 Lot 6 - Subject 4 (workspace-per-project in VSCode) (delivered)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` section `4`.

### 4.18 Lot 6 - Subject 5 (VSCode code-agent prompt profile) (delivered)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` section `5`.

### 4.19 Lot 6 - Subject 6 (settings split: `Server | Workspace | Tools`) (delivered)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` section `6`.

### 4.20 Lot 6 - Subject 7 (prompt editor UX in split settings) (delivered)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` section `6`.

### 4.21 Lot 6 - Subject 8 (VSCode E2E runtime lane, naming cutover, CI contract) (delivered baseline)
Canonical content moved to `spec/SPEC_VSCODE_PLUGIN.md` sections `2` and `6`.
Future expansion stays in this backlog when new VSCode lanes are opened.

### 4.22 Lot 6 - UAT bug-fix backlog (delivered BR-05 subset)
Delivered BR-05 behavior has been consolidated as follows:
- host/runtime/tool UX and policy behavior: `spec/SPEC_VSCODE_PLUGIN.md`
- local tool contracts and reuse rules: `spec/TOOLS.md`
- Codex/OpenAI admin/runtime behavior: `spec/SPEC_CHATBOT.md`

### 4.23 Lot 6 - Multi-step assistant-run projection in the chat timeline (delivered shared contract)
Canonical content moved to `spec/SPEC_CHATBOT.md`.

### 4.24 Lot 6 - Session bootstrap cutover (`stream-events` removed from frontend contract) (delivered shared contract)
Canonical content moved to `spec/SPEC_CHATBOT.md`.

### 4.25 Lot 6 - Session history NDJSON stable read contract (delivered shared contract)
Canonical content moved to `spec/SPEC_CHATBOT.md`.

### 4.26 Lot 6 - Converged runtime-details history with one shared panel presentation (delivered shared contract)
Canonical content moved to `spec/SPEC_CHATBOT.md`.

## 5) Future branch boundary
- BR-10: extend VSCode toward multi-agent and multi-model orchestration UX.
- BR-05 delivered host/runtime parity remains frozen in `spec/SPEC_VSCODE_PLUGIN.md`.

### 5.1 Background tool execution deferral (explicit)
- Background tool lifecycle remains deferred beyond BR-05.
- Target future lifecycle:
  - `start`,
  - `status`,
  - `cancel`,
  - `resume`,
  - `result`.

## 6) Remaining backlog themes
- OpenVSCode/VSCode-specific multi-agent experience,
- advanced workflow composition and background execution,
- future host-only UX deltas that must not re-open shared chat/runtime contracts.

## 7) Historical anchor kept for BRANCH references

### 7.1 Background tool execution deferral (explicit)
- BR-05 constraint remains unchanged:
  - tools are foreground/interactive only,
  - no detached/background tool lifecycle in BR-05.
- Future work stays under section `5.1`.

## 8) Rapid v1 tool contracts (delivered)
Canonical content moved to `spec/TOOLS.md`.

## 9) Risks
- Future VSCode work must not recreate a host-specific chat/runtime contract.
- Multi-agent additions must build on the delivered BR-05 host surface instead of reintroducing parallel shells.
