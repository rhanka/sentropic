# P0 — DS artifact qualification and proposed C-03 amendment

Date: 2026-10-28. [Migration contract](CHAT_MIGRATION_P0.md). DS repository remains read-only. This document proposes text for the DS-owned contract; it neither edits nor ratifies that contract.

## Registry artifacts inspected

Metadata was fetched from the public npm registry's version endpoint selected by `latest`, followed by the exact `dist.tarball` URL. Downloaded bytes were checked against the metadata's SHA-512 integrity using an independent digest calculation. Package export maps, emitted index files and component/CSS sources inside those tarballs were inspected. This proves packaged presence and the API gaps below; it is not browser/runtime installation or P4 qualification.

| Artifact | Tarball URL | Verified SHA-256 |
| --- | --- | --- |
| `@sentropic/design-system-svelte@0.36.0` | `https://registry.npmjs.org/@sentropic/design-system-svelte/-/design-system-svelte-0.36.0.tgz` | `7b37830dbf168ae4057949925b0b8ecc9aa155827d55eebeda4c2e731a1a6880` |
| `@sentropic/design-system-themes@0.11.0` | `https://registry.npmjs.org/@sentropic/design-system-themes/-/design-system-themes-0.11.0.tgz` | `702f94939d13977666ad16e606d91c9363e2edf0499a6801cffea38f1e220d40` |

Registry SHA-512 values: Svelte `LknP64Ra3SdIITE985AoH/8Ap26NlNAfDguwixF7KO5S8vUbgKmmdhl5B6fnJ8VzW2PjsWPstVwmGvDJTcalNQ==`; themes `NrwIkPLx1sktkXgcVaIM/K7H/vbYbYoCZFmfKa4V9a37BPAUysb+2IAvxoEh7ko7veteMCqkOsIMKNf/tsQOwg==` (each prefixed `sha512-` in registry metadata).

| Checked public surface | Result / owner and next gate |
| --- | --- |
| Svelte root export | `package/package.json` maps `.` to `dist/index.js`/`index.d.ts`; index lines 51–53 export ChatMessage/ChatComposer/ChatThread; line 73 exports Drawer. Import from the package root, not an assumed component subpath. |
| Theme exports | Root exports `entropicTheme`, `sentTechTheme`, `forgeTheme`, compiler and token re-exports; CSS subpaths `./css/entropic.css`, `./css/sent-tech.css`, `./css/forge.css` exist in archive. |
| Entropic CSS | Scoped by `[data-st-theme="entropic"]`; includes chat role/composer/tool surface tokens, `sm/md/lg` density vocabulary and control hover/disabled tokens. No automatic dark-mode branch appears in that CSS: P3 must qualify an explicit DS color-mode mechanism against the user's preference, including OS disagreement. |
| Published Drawer | Props are `open`, `title`, `description`, `side: left/right/bottom`, close label/class, children/footer and `onclose`. It uses `{#if open}` around the body, has an `overflow:auto` body, and lacks controlled `width/onResize`, `collapsed/onToggleCollapse` and dedicated ref/anchor API. **Present but not qualified for #32/P4.** |
| Drawer gap disposition | Accountable DS primitive maintainer; bounded work: publish the controlled persistent-content/focus/ref/scroll contract required by SURFACES D10/#32. Acceptance: collapse uses hidden/inert without disposal, controlled size/collapse, one scroll owner, keyboard/focus/reduced-motion and installed-export tests. P4 waits for that immutable artifact; P1/P2 proceed. No app-local replacement. |
| DropZone | No `DropZone` export or file in this Svelte archive. Accountable DS primitive owner in **F15** (1–2 d primitive, 1 d consumption). Existing package `ChatPlacementDropZones` remains canonical until delivery. No assumed export or host copy. |
| Runtime availability | Public `@sentropic/chat-runtime/latest` returns HTTP **404**. M1b runtime-backed examples require authorized runtime release or explicit deferral after M2; primitive-only examples can use neutral fixtures. |

## Canonical survivor and API-gap table

Source baseline for the approved contract/primitives: DS `0d32d10b`; current DS HEAD inspected for consumers is `22421ed82f69737825b962e5a0e448482733eaca`. Published APIs above, rather than either checkout's working tree, determine availability.

| Canonical implementation | Accountable owner / adaptation in M1b | Delete / qualify |
| --- | --- | --- |
| DS `packages/components-svelte/src/lib/ChatComposer.svelte` | DS component maintainer; chat-ui composes it with model/context/attachment controls. Published primitive already handles IME-aware Enter/Shift-Enter, autosize, submit and stop, with attachment/action slots. | Remove the second input/keyboard/submit/autosize implementation in chat-ui. Close attachment-only sending and controlled clear/focus/ref/steer gaps on evidence: current primitive requires nonempty trimmed text, defaults `clearOnSubmit=true`, and owns submitting state. Preserve existing app payload/IME behavior in composition tests. |
| DS `ChatMessage.svelte` | DS component maintainer; chat-ui StreamMessage supplies normalized blocks through body/actions/footer slots. | Delete duplicate role/bubble/status/a11y markup/CSS; preserve specialized markdown/tool/renderers. Runtime event assembly stays Sentropic. |
| DS `ChatThread.svelte` | DS component maintainer; chat-ui ChatTimeline composes its log/scroll surface. Published `autoScroll` defaults true with MutationObserver. | Add controlled anchor/ref semantics for reading position and virtualization; disable competing auto-scroll; delete duplicate scroller/observer. One scroll owner and message-ID-plus-offset restore, not unconditional bottom scrolling. |
| DS docs `apps/docs/src/lib/chat/ChatWidget.svelte` | DS docs-app maintainer owns endpoint/auth/locale/quota/navigation host adapter, consuming transferred package Widget/Conversation. | Delete independent shell/dialogue. Keep only named host data/actions. Runtime-backed samples follow the release dependency above. |

Two concrete consumer roles satisfy the promotion use case: Sentropic's app/extension hosts and the DS docs app. This is evidence of need, not a claim of completed shared consumption. `ChatComposer/Message/Thread` remain primitives in DS; chat-ui supplies specialized composition. Dependency direction is chat-ui → DS primitives, never primitives → chat-ui and never DS → runtime implementation for rendering.

## C-03 amendment proposal (r2 note 2)

Proposed receiving destination: DS `docs/chat-ui-contract.md`, **Ownership Split lines 31–34**, plus the promotion rule currently at line 48. The DS maintainer owns that file and applies the amendment in its own reviewed change after co-freeze. The text produced here remains in this Sentropic proposal until then; once adopted, replace the proposal's normative copy with a versioned link to the DS commit. P0 performs no receiving-repository write.

Replace the current line 32 owner, **“Sentropic/chat-ui owns runtime state, streaming assembly, provider adapters, message persistence, tool execution, permission decisions, checkpoints, and product copy.”**, with these proposed clauses:

> Sentropic's `@sentropic/chat-runtime` owns client session/draft/attachment state, stream assembly/projection/replay, checkpoint state and local-tool lifecycle. Sentropic hosts supply authorization, platform executors, permission policy, session lifetime/selection, transport configuration and domain adapters. Provider orchestration, durable message persistence and canonical data remain with Sentropic chat-core/chat-server/API and their data owners. Absence, denial or timeout of local-tool permission never grants execution.
>
> `@sentropic/chat-ui` owns reusable visual composition, normalized snapshot/command interfaces, renderer presentation, ephemeral interaction/layout state and its visual fixtures. Following the owner's recorded UAT GO and distinct transfer GO, DS receives this visual package, its normative visual contract and its release authority. Runtime implementations and local-tool machinery are excluded from DS custody. DS views receive data and callbacks; they do not create/dispose session runtimes or decide permissions.
>
> Sentropic and sibling hosts own product-specific wording, domain names, error mapping and translation dictionaries. The visual package owns generic accessible default labels and their documented override interface. A DS example owns its example-specific copy. Produced user/assistant/tool text is host/runtime-supplied content: DS renders it under the agreed safe rendering contract and does not author, retrieve, persist or reinterpret it.
>
> DS ChatComposer, ChatMessage and ChatThread remain the canonical generic input/message/log primitives. The promoted chat-ui composes them, removes replaced implementations and keeps one scroll owner. Generic promotion requires two concrete consumers and explicit interface acknowledgement by the sending and receiving owners. This amendment does not authorize import, source deletion, publication or publisher changes by itself.

The existing exclusions of provider-specific models, tool names, workspace orchestration and agent lifecycle remain. Also reconcile the old `^0.7.0` package recommendation against qualified immutable artifacts at P3/M2; it is not evidence that the historical range exposes today's required APIs. Acknowledgement of this proposal is distinct from the owner's transfer GO and the npm administrator's publication grant.
