# Chat migration contract — P0

Date: 2026-10-28. Scope: freeze the migration inventory and contract; no implementation or custody change.
Author: Codex, requested `gpt-6.1-sol`, high. Status: author-complete contract candidate; domain acknowledgements recorded below remain explicit.

## Authority and evidence

The owner requested app adoption before DS transfer and added that he must have performed the tests himself. The execution authority is P0 of `.tmp/chat-convergence/plan-to-ds.md`, SHA-256 `daf1d8373fa0eaedc3514c452e8161cd597b9c3a749772ca94334e5cede08790`, reviewed APPROVE in `.h2a/reviews/chat_plan_to_ds_opus_r2.md`. Those local planning artifacts are provenance; this committed contract is the reviewable P0 output. It does not grant UAT GO, transfer GO or registry rights.

Sentropic baseline: `ea20bd9c026e9717d911514e763f8911b6981dde`, fetched `origin/main`, also the approved plan's implementation baseline. DS source evidence uses `0d32d10b` from the plan; current published artifacts are checked separately in the DS appendix. Source presence, registry availability, functional qualification and owner acceptance are separate facts.

## Inventory index and completeness boundary

| Appendix | Exhaustive set / purpose |
| --- | --- |
| [Sources](CHAT_MIGRATION_P0_SOURCES.md) | Every tracked `packages/chat-ui/src/**` source/declaration and destination class. |
| [Exports](CHAT_MIGRATION_P0_EXPORTS.md) | Every package export-map entry, with declaring-module symbol ownership. |
| [Symbols](CHAT_MIGRATION_P0_SYMBOLS.md) | Every TypeScript declaration module's named exports/re-export blocks, including component declarations. |
| [Dependency closure](CHAT_MIGRATION_P0_EDGES.md) | Relative imports/re-exports of all runtime and mixed TypeScript modules. |
| [Tests/support](CHAT_MIGRATION_P0_SUPPORT.md) | Every other tracked package file, including tests, fixtures, generators and publication support. |
| [Consumers](CHAT_MIGRATION_P0_CONSUMERS.md) | Every sending-repository tracked package-name/source-path match outside package/spec/plan. |
| [Hosts and siblings](CHAT_MIGRATION_P0_HOSTS.md) | Transitive app surfaces, scaffolds, external consumer evidence and release notices. |
| [Behaviors](CHAT_MIGRATION_P0_BEHAVIORS.md) | Supported behavior → accountable role → parity oracle and required lot. |
| [Snippets/styles](CHAT_MIGRATION_P0_PRESENTATION.md) | Every app ChatWidget snippet; stylesheet/override inventory and deviation budget. |
| [Spec reconciliation](CHAT_MIGRATION_P0_RECONCILIATION.md) | Five source documents, #602/UAT-1 and turnkey D1–D6 dispositions. |
| [Defaults](CHAT_MIGRATION_P0_DEFAULTS.md) | All §6 conductor-applied defaults and owner-held gates. |
| [DS contract and artifacts](CHAT_MIGRATION_P0_DS.md) | Actual theme/Drawer exports, canonical primitives and proposed C-03 amendment. |

V means reusable visual; R means Sentropic runtime; H means a justified host adapter/slot. Mixed files have a named split and two assigned responsibilities, rather than an unassigned destination. P1 resolves mixed files before any DS import. The inventory covers the pinned sending tree and checked sibling repositories; it cannot establish every private registry consumer. Release notices and installed-consumer checks remain mandatory.

## Frozen ownership and ports

| Responsibility | Accountable role | Contract |
| --- | --- | --- |
| Visual `@sentropic/chat-ui` | Sentropic chat UI maintainer until M2; DS chat maintainer after coordinated transfer | Svelte views, renderer registry, ephemeral interaction/layout, typed snapshots/commands, CSS/generator and visual fixtures. No runtime construction/disposal, transport, stream assembly or local-tool machine. |
| New `@sentropic/chat-runtime` | Sentropic chat runtime maintainer | `packages/chat-runtime/**`: session/draft/attachment/checkpoint state, history/live projection, replay/transport, tool permission/execution/result continuation; one host-created runtime above placements. |
| Host integration | Web/Chrome/VSCode/cowork and sibling maintainers | Auth/RBAC, workspace/context/document/Drive adapters, authorized executors, session selection/lifetime, platform relocation and persistence. |
| Server contracts and data | Sentropic chat-core/chat-server/API maintainers | Durable history, provider/flow orchestration, authorization, idempotency and canonical storage. No DS custody. |
| DS primitives and theme vocabulary | DS components/theming maintainer | Canonical ChatComposer, ChatMessage, ChatThread, Drawer; missing DropZone belongs to F15. |
| Contract co-freeze | Sentropic integration lead, DS maintainer and architect | Review the same source/behavior/export map and proposed C-03 wording; record explicit role acknowledgement. |

The host owns runtime lifetime and session selection independently of visible navigation. DS receives normalized snapshots plus commands; commands request host actions and do not confer permission. Runtime must not import a DS view implementation. Neutral data contracts cross the boundary through public exports only. Optional comment/document/checkpoint modules split state/retrieval from views. Product-specific copy stays with the host; generic accessible default labels stay with the visual package, overridable by host dictionaries.

The local-tool contract is deny by default. Missing adapter, denial or permission timeout yields visible pending/denied state, zero execution, zero successful result and no allowed continuation. Explicit host approval executes and posts a result once. P1 removes `isLocalToolPermissionRequired: () => false`; P0 makes no execution-policy change.

## Breaking release and sequence refinements (r2 notes 1, 3 and 4)

P1 introduces the new named runtime package and removes runtime exports from `@sentropic/chat-ui`, including root-barrel exports and mixed optional-module functions. All inventoried consumers migrate to `@sentropic/chat-runtime/...`; no forwarding aliases or source fallback. This is an explicit breaking contract release, completed and packed before P5/U0. Reserve a **major chat-ui release** above the registry version at P1 entry; do not select a stale version now. The independently versioned runtime's initial public version is chosen by its maintainer and qualified as a UI/runtime pair. Notify web, Chrome, VSCode, cowork, scaffold, DS docs, drawing-skills/graphify and immo owners before removing exports. L-A′ tab renaming remains a separate release/GO.

Registry check on 2026-10-28: `GET /@sentropic%2fchat-runtime/latest` returned **404**. No published runtime is established. M1b's runtime-backed DS docs adapter therefore adds **authorized runtime release available** as a conditional dependency. Primitive-only/normalized-fixture examples may proceed after M1 and U0; runtime-backed examples wait for that release or are explicitly deferred until after M2. Never copy runtime into DS or create an npm-authorization cycle. M2 remains blocked until the exact final UI/runtime pair has been rehearsed; publication/bootstrap remains with the npm administrator and Sentropic CI.

Re-estimate physical separation at **4–6 engineering days**, replacing P1's 2–3: 1–1.5 package/contracts/dependency closure; 1–1.5 consumer/import migration and mixed-module split; 1–1.5 Make/CI/pack/standalone qualification; 1–1.5 release-bootstrap preparation, notices and review correction. External npm approval/release-slot waiting is additional. Parity work remains 4–7 days: **P1 = 8–13 days**. This is a planning revision from the P0 inventory, not implementation evidence.

Required P0–P5/P2b effort becomes **21–36 days**; with U0 preparation **21.5–36.5**. M0–M4 remains **5–10**; total **26.5–46.5** (159–279 focused hours), approximately **34–59 days with 25% reserve**. No external wait or owner test time is included. The Drawer contract gap can add upstream lead time; it blocks P4, not P1/P2. The broader editor and follow-on features stay outside this estimate.

This is an **estimate proposal for conductor reconciliation before P1 dispatch**, not a change to the earlier plan's APPROVE. Its owner summary still states **24.5–43.5 days (31–55 with reserve)** and omits the runtime package name on line 4. The conductor owns refreshing that summary to identify `@sentropic/chat-runtime` and show the proposed revised range alongside the approved baseline; P0 does not edit the plan outside this branch's scope. Do not circulate the new totals as owner-ratified delivery commitments.

## Release and acceptance gates

P0 → P1 → P2 → P2b/P4 → P5 → U0; P3 may overlap after file ownership is agreed and must complete before P4/P5. P2 is the single L0b+L0c cutover, with no migration flag or fallback path. P2b completes reusable header handover and P3 removes competing chat styling; together leave zero `dark:` variants in the app widget. P4 consumes a qualified DS Drawer without implementing a host-local substitute; F15 later replaces the current package drop zones.

P5 proves web/mobile/Chrome/VSCode parity, no duplicate runtime/tool handling and installed UI/runtime consumption without `file:` links, app aliases or private source paths. Owner U0 then tests exact integrated main/artifact hashes in preprod and both plugins. Reuse #602's three checkboxes and present F1–F11 dispositions first. Preprod Login-A/RP-ID parity must work. Two distinct owner answers are recorded verbatim through Track CLI: UAT GO and transfer GO. A changed behavior/artifact invalidates affected U0 outcomes. No agent or CI run substitutes for personal tests.

M0 is paper inventory only before both GOs. M1 imports post-P1 visuals; M1b reconciles DS primitives; M2 qualifies/releases under authorized single-publisher custody; M3 switches consumers and deletes sending visual sources/pipeline; M4 proves clean installed consumption. Keep canonical runtime/tests/publisher in Sentropic. Makefile/CI changes need future lot-specific scope exceptions; P0 changes neither. No DS repository write is authorized by this document.

## Acknowledgement and handoff ledger

| Role | Recorded state | Observable completion |
| --- | --- | --- |
| Sentropic code author | Acknowledges the documented R/V/H split as the implementation proposal on 2026-10-28; no maintainer authority inferred. | PR supplies complete evidence for review. |
| Sentropic integration lead/conductor | Acknowledgement requested; not yet evidenced here. | Confirm boundary/default dispositions and bind runtime/consumer/release roles. |
| DS maintainer | Acknowledgement requested; no acceptance claimed from the earlier plan review. | Accept proposed C-03 owner/copy update, primitive survivor table and Drawer/F15 obligations on this contract revision. |
| Architect | No new acknowledgement evidenced; earlier UAT-1 F1/F8 conclusions remain dated evidence. | Co-freeze runtime/tool exclusions, neutral ports and C-03 wording; resolve a concrete boundary disagreement before M1. |

The author may finish inventory and submit the draft while these role acknowledgements are pending. **P0 co-freeze acceptance remains pending until the responsible roles acknowledge the same revision**; neither author review nor the plan's APPROVE manufactures those acknowledgements. The conductor records defaults and acknowledgements through Track CLI as its single writer; this author does not edit the root's already-modified Track log.
