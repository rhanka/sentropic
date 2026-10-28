# Chat migration — P1 delivery sequence

Contract: `CHAT_MIGRATION_P0*.md`, merged in #816. P1 implements the approved ownership boundary in Sentropic.
No Design System repository write, registry publication, owner UAT GO or transfer GO is authorized here.

## Draft sequence

| Draft | Bounded change | Remaining P1 acceptance |
| --- | --- | --- |
| P1a, `feat/chat-convergence-p1` | Introduce runtime package; relocate transport/replay/stream assembly, loop/session/draft/attachment/projection state, local-tool store, checkpoints and persistence with existing tests; migrate active imports. | Optional-module split and injected conversation are completed by P1b. |
| P1b, successor branch | Split comments/documents/context and mixed helpers; complete injected ChatConversation commands and deny-by-default permission continuation. | Full standalone/app-shaped parity and packed boundary qualification. |

Successors retain P1a ancestry; integration uses merges only. Drafts target main and remain unmerged.
P1a is a migration foundation, not a claim that the transferable UI is runtime-free yet.

## Candidate versions and release prerequisites

- `@sentropic/chat-ui@1.0.0`: explicit major break; registry was `0.34.1` at entry.
- `@sentropic/chat-runtime@0.1.0`: new independently versioned Sentropic package; registry lookup returned E404.
- `@sentropic/cowork-desktop@0.2.1`: runtime import migration; registry was `0.2.0` before bump.
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
| Runtime `utils/chat-*`, `utils/localToolStreamSync`, `utils/model-selection` | Same suffix under `@sentropic/chat-runtime` |

Neutral visual contracts remain available through public type exports. Runtime imports no visual
implementation. P1a temporarily retains the existing conversation wiring to preserve a green step;
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
authorization predicate. Missing adapter, denial and timeout expose pending/denied state, execute zero
tools, post no successful result and never continue as allowed. Approval executes and posts once.

The final packed visual candidate must contain no runtime implementation or private source import;
install the exact UI/runtime candidates in a consumer without the Sentropic source tree.
