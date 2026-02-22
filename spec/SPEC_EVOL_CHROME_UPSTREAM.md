# SPEC EVOL - Chrome Upstream Control, Multi-Tab, Voice

Status: Draft for roadmap orchestration (2026-02-22)

## 1) Objective
Extend the Chrome plugin from local tool execution to upstream-oriented remote control in two milestones:

- Milestone W1 (deadline: 2026-03-01)
  - Upstream control foundation (remote control + upstream sync, single-tab).
- Milestone W2 (deadline: 2026-03-08)
  - Multi-tab orchestration and voice interaction.

## 2) Scope

In scope:
- Upstream protocol for delegated control sessions.
- Single-tab remote control baseline in W1.
- Multi-tab coordination in W2.
- Voice capture/command pipeline in W2.
- Compatibility with existing local tools (`tab_read`, `tab_action`).

Out of scope:
- Native desktop capture outside browser context.
- Non-Chromium browser support in this wave.

## 3) Existing baseline
Relevant references:
- `spec/SPEC_CHROME_PLUGIN.md`
- `spec/SPEC.md` (Chrome extension section)
- `spec/TOOLS.md`
- `spec/SPEC_CHATBOT.md` (streaming/event contracts)
- `TODO.md` (`Plugin Chrome (suite)`, `upstream`, `voice` items)

Current state summary:
- Local tools and runtime permission model are in place.
- Overlay/sidepanel architecture is available.
- No upstream multi-tab/voice orchestration yet.

## 4) Target design

### 4.1 Upstream control foundation (W1)
- Introduce a dedicated upstream session channel:
  - handshake with extension auth token,
  - capability exchange,
  - command/ack protocol.
- Support controlled execution for single active tab:
  - read state,
  - navigation,
  - action replay,
  - result/event streaming.

### 4.2 Multi-tab orchestration (W2)
- Add tab registry and tab-scoped execution contexts.
- Add arbitration rules for active vs background tabs.
- Add batch/tab-sequence command support with rollback-safe checkpoints.

### 4.3 Voice controls (W2)
- Add voice command ingestion pipeline:
  - capture -> transcription -> intent/tool mapping.
- Integrate voice events in existing stream timeline.
- Add explicit privacy UX (recording indicator, consent, stop control).

## 5) Branch plan

- `feat/chrome-upstream-v1`
  - upstream protocol + single-tab remote control baseline.
- `feat/chrome-upstream-multitab-voice`
  - multi-tab orchestration + voice controls.

## 6) Acceptance criteria

W1:
- Remote upstream session can control one tab safely.
- Session lifecycle is observable and auditable.
- Existing local tools remain functional.

W2:
- Multi-tab execution works with explicit tab targeting.
- Voice command flow can trigger safe tool actions.
- Permission/consent checks are enforced for sensitive actions.

## 7) Open questions

- `CHU-Q1`: Should upstream transport be WebSocket-only, SSE+REST hybrid, or pluggable?
- `CHU-Q2`: What is the minimum domain-level permission granularity for upstream control?
- `CHU-Q3`: How should command conflicts be resolved when two tabs match the same intent?
- `CHU-Q4`: Which voice provider/runtime is acceptable for W2 privacy constraints?
- `CHU-Q5`: Do we require hard session timeouts and forced re-approval for upstream sessions?

## 8) Risks

- Security risk if upstream command scope is too broad.
- Race conditions in multi-tab orchestration.
- Voice UX reliability and false positive commands.
