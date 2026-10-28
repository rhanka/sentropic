# Chat migration — P1 delivery sequence

Contract: `CHAT_MIGRATION_P0*.md`, merged in #816. P1 implements the approved ownership boundary in Sentropic.
No Design System repository write, registry publication, owner UAT GO or transfer GO is authorized here.
The conductor splits release sequencing: merge the runtime-only P1-0 precursor first, bootstrap
`chat-runtime` on main, then merge main into #819 again before any consumer release. #817 is superseded.

## Draft sequence

| Draft | Bounded change | Remaining P1 acceptance |
| --- | --- | --- |
| P1a, `feat/chat-convergence-p1` | Introduce runtime package; relocate transport/replay/stream assembly, loop/session/draft/attachment/projection state, local-tool store, checkpoints and persistence with existing tests; migrate active imports. | Optional-module split and injected conversation are completed by P1b. |
| P1b, `feat/chat-convergence-p1b` | Split comments/documents/context and mixed helpers; inject ChatConversation snapshots/commands; complete permission, attachment, checkpoint and optional-module bindings. | Final review, exact-head CI and retained final candidate qualification. |

Successors retain P1a ancestry; integration uses merges only. Drafts target main and remain unmerged.
P1a is a migration foundation, not a claim that the transferable UI is runtime-free yet.
P1b completes the transferable package boundary and fixture parity. The production AppChatPanel still
consumes the extracted controller through runtime imports; P2 owns its single cutover to ChatConversation.
P1 does not claim that the production application already mounts the injected conversation view.

## Candidate versions and release prerequisites

- `@sentropic/chat-ui@1.0.0`: explicit major break; registry was `0.34.1` at entry.
- `@sentropic/chat-runtime@0.1.0`: new independently versioned Sentropic package; registry lookup returned E404.
- `@sentropic/cowork-desktop@0.2.1`: runtime import migration; registry was `0.2.0` before bump.
- `@sentropic/cowork-bridge@0.1.2`: runtime SSE peer/guidance migration; registry was `0.1.1` before bump.
- All runtime implementations remain in Sentropic. The new package is never imported into DS custody.
- Runtime construction/disposal moves to hosts; the final visual view receives normalized data and commands.
- Source manifests remain workspace source form; guarded packs transform exports to compiled dist form.
- No runtime export forwarding aliases are retained in the visual root barrel or removed subpaths.
- P1b removes the remaining runtime-bearing optional-module exports and view-owned controller creation.

Before any publication, the npm administrator must authorize the runtime's one-shot bootstrap through CI,
then configure its npm OIDC trusted publisher for this repository and `ci.yml`. The final qualified
UI/runtime pair must precede consumer release. P1 does not trigger bootstrap or publication.

## Import migration notice

Web, Chrome, VSCode, cowork, scaffold, DS docs, drawing-skills/graphify and immo maintainers:
runtime consumers must migrate removed `@sentropic/chat-ui` imports to the corresponding
`@sentropic/chat-runtime` public subpaths. This committed release notice records the breaking change;
it does not claim recipient acknowledgement or external consumer qualification.

| Former import | Runtime import |
| --- | --- |
| `@sentropic/chat-ui/client/*` | `@sentropic/chat-runtime/client/*` |
| `@sentropic/chat-ui/state/chatDraft` | `@sentropic/chat-runtime/state/chatDraft` |
| `@sentropic/chat-ui/state/chatAttachments` | `@sentropic/chat-runtime/state/chatAttachments` |
| `@sentropic/chat-ui/state/chatProjection` | `@sentropic/chat-runtime/state/chatProjection` |
| `@sentropic/chat-ui/state/chatLoopController` | `@sentropic/chat-runtime/state/chatLoopController` |
| Internal session runtime/hydration modules | `@sentropic/chat-runtime/state/chatSessionRuntime`, `state/chatSessionHydration` |
| `@sentropic/chat-ui/state/agentsViewMarkers` | `@sentropic/chat-runtime/state/agentsViewMarkers` |
| `@sentropic/chat-ui/stores/localTools` | `@sentropic/chat-runtime/stores/localTools` |
| `@sentropic/chat-ui/checkpoints` | `@sentropic/chat-runtime/checkpoints` |
| Runtime `utils/chat-*`, `utils/localToolStreamSync` | Same suffix under `@sentropic/chat-runtime` |
| Model selection/hydration policy | `@sentropic/chat-runtime/utils/model-selection` |
| Neutral model keys, catalog grouping and display labels | `@sentropic/chat-ui/utils/model-selection` |
| `LocalToolsAdapter` / `DocumentHost` | `@sentropic/chat-runtime/hosts/types` / `@sentropic/chat-runtime/documents` |

Neutral visual contracts remain available through public type exports. Runtime imports neutral model
utilities, never view implementations. Conversation snapshots/commands are type-only ports exported
by `@sentropic/chat-runtime/conversation`; visual files have no runtime value imports. The UI's runtime
peer is optional. Record/task rendering helpers and the empty context fallback belong to chat-ui.
P1a temporarily retains the existing conversation wiring to preserve a green step;
P1b completes that boundary without a migration flag or fallback implementation.

## P1a qualification

- Runtime typecheck passes; 301 existing runtime tests pass after relocation.
- Visual typecheck passes; 676 unit tests and 219 DOM tests pass against the extracted runtime.
- Raw NDJSON stream fixtures move unchanged with the runtime golden/parity tests.
- Guarded runtime and visual package packs pass; these are unpublished migration candidates.
- The existing chat CI lane additionally requires runtime typecheck, tests and guarded pack.
- Candidate publication and owner acceptance remain separate from these technical checks.

## P1b acceptance matrix

The same real runtime must drive standalone and app-shaped view fixtures. Cover full send payload
(model, contexts, enabled tools and attachments), history, retry/stop/edit/feedback/steer and optional
modules. Remount the view while streaming and verify draft/attachments/checkpoints and stream progress
survive, with one active runtime and one result continuation.

Local tools require explicit host approval. Keep the owner's explicit `() => false` default
`authorize` predicate. Missing adapter, denial and timeout expose pending/denied state, execute zero
tools, post no successful result and never continue as allowed. Approval executes and posts once.

The final packed visual candidate must contain no runtime implementation or private source import;
install the exact UI/runtime candidates in a consumer without the Sentropic source tree.

## P1b implementation and observed checks

The host creates `createConversationRuntime(sessionId, options)` and injects it as `snapshots`, alongside
`runtime.commands`. View subscriptions only bind/unbind a view. Session disposal, authorization waits,
uploads/previews and history hydration remain runtime-owned. Optional comments use host-owned
`createCommentRuntime(host, presentation)`; pure formatting helpers are injected from the visual package.

The shared fixture uses the real chat-server, transport, stream hub, loop/session and chat-core history
projection. Standalone/app-shaped views exercise full payload, live markdown/plan results, IME input,
history restart, edit/retry/stop/feedback/steer, document failure/retry/preview/remove/download,
checkpoint preserve/restore ordering, comments and state continuity during remount. Platform data I/O
uses in-memory adapters; production runtime commands are never stubbed.

Observed gates: runtime typecheck and 451 tests; UI typecheck, 524 unit tests and 206 DOM tests;
cowork-bridge typecheck and 27 tests; 201 publication-wiring/manifest tests. App typecheck reports
0 errors, lint passes, all 489 app tests pass, and the production image
build completes for web/Chrome/VSCode. The app typecheck also reports 6 warnings in 5 files.

Guarded candidate packs pass. The clean installed-pair probe mounts only the archives and its probe:
Svelte typecheck has 0 errors/warnings, Vite production bundling succeeds, and the visual archive has
no runtime implementation paths. Final archive hashes/head are retained in its report after final review.
Native allow/deny/timeout/disposal is additionally covered through the real runtime/controller.
Native and domain replays retain exactly one resolved denied row, with zero execution or duplicate result.
The exact archive scan rejects runtime imports in every executable JS/Svelte visual file.
After review corrections, runtime 440, UI 533 unit and 206 DOM tests pass; both package typechecks pass.
Two complementary r2 source reviews approved the earlier implementation; the current corrections need review.
These checks are technical evidence; GitHub CI completion and owner U0 remain separately recorded gates.

Final unpublished candidate qualification at source head `2da73456f44a069905d7e2736ffd211b4a1b6e2d`:

| Candidate | SHA-256 |
| --- | --- |
| `@sentropic/chat-ui@1.0.0` | `53b90e3259ee569194aba079090b2663db9f3c5d95ceac9e8973e44e2c29bde4` |
| `@sentropic/chat-runtime@0.1.0` | `f3d1794b0dd95b781e3c12edf0d37e6b3e3b14583ff63e8c88be4bc10ff83228` |

The clean probe verifies installed public contracts, Svelte typecheck, production bundle, real HTTP
payload/commands, subscription remount, all four authorization paths and visual archive ownership.
Its retained local report is `tmp/chat-p1b-final-r2/installed/chat-pair.json`; CI retains the same report shape.

Runtime release preparation includes guarded OIDC/bootstrap targets and one explicit bootstrap choice.
Only package paths select publication; UI publication waits for a selected runtime publisher. No publish
target or workflow dispatch is executed by P1. The npm administrator still owns initial registry/OIDC setup.
