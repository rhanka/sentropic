# SPEC EVOL - VSCode Plugin (ChatWidget host + shared Summary/Checkpoint runtime)

Status: Draft updated (2026-03-02)

## 1) Objective
Refocus VSCode scope on a robust plugin host for the shared chat runtime, and remove the old plugin-only checkpoint/summary design.

Primary goals:
- Keep VSCode plugin v1 as a host for shared `ChatWidget` + runtime bridge.
- Align summary/checkpoint behavior with shared chat runtime (web/chrome/vscode parity).
- Define a deterministic checkpoint + restore model usable beyond Git-only flows.

## 2) Scope

In scope:
- VSCode extension shell and packaging (`.vsix`) for local install/UAT.
- Embedded shared chat surface (same core runtime family as web/chrome).
- Shared summary/checkpoint runtime contracts and policies.
- Command bridge for runtime actions (including restore).

Out of scope:
- Legacy plugin tabs/views (`Plan`, `Tools`, `Summary`, `Checkpoint`) as standalone plugin UI features.
- Plugin-local bespoke checkpoint logic disconnected from shared chat runtime.
- Multi-agent orchestration UI (deferred to BR-10).

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
- Auto-summary trigger at **85%** projected usage of usable context budget.
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

## 5) Industry alignment snapshot (for implementation framing)
- Cursor: checkpoint/rewind conversation flow + strong context controls.
- Claude Code: auto compact near context limits + explicit manual compaction command.
- OpenCode: configurable auto compaction (`auto`, `reserved`, `prune`) and explicit revert flows.
- Codex protocol: compaction and rollback are first-class runtime events; history rollback is distinct from local file revert.

Implication for this repo:
- Keep summary/checkpoint as runtime concerns first.
- VSCode remains a host surface, not a divergent runtime implementation.

## 6) v1 functional target (BR-05)
- Plugin provides installable shell + shared chat surface.
- Runtime emits turn checkpoints automatically.
- Restore can target files and objects (when adapters exist).
- Summary policy follows 85% trigger with reserved headroom.
- No legacy plugin-only summary/checkpoint tabs.

## 7) Future branch boundary
- BR-05: deliver host/runtime parity and v1 restore/summary policy behavior.
- BR-10: extend to multi-agent/multi-model orchestration UI and advanced workflow composition.

## 8) Risks
- Missing object adapters can cause partial restores in v1; this must be explicit in UI/API responses.
- Over-aggressive compaction can degrade context quality; threshold and hysteresis tuning should remain observable.
- Divergence risk if any surface (web/chrome/vscode) bypasses shared runtime contracts.
