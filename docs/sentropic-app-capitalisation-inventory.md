# Sentropic-app capitalisation inventory — reconciled final

### 1. Executive summary

- The qualified worktree contains 24 local `@sentropic/*` packages: 11 deep integrations, 3 partial integrations, 2 shallow integrations, and 8 with no deployed app-runtime integration. “None” includes `build-cli`, `cli`, and `harness`, which are intentional tooling products rather than defects.
- Auth, chat routing, LLM Mesh dispatch, Flow, Comments, and Cowork Bridge are materially capitalised: each has a named live consumer in `api/src`, `ui/src`, or `apps/auth-idp`.
- LLM egress is a P1 architectural inconsistency. `@sentropic/llm-gateway` is functional in-package, including real passthrough flows when dependencies are supplied, but has no app integration. The issue is two overlapping recorded authorities plus an unexecuted integration, not route stubs or a decision vacuum.
- The demonstrated LLM overlap is limited to the application’s pool, lease, reservation, and cooldown lifecycle. Caller authentication and financial metering/quota settlement have not been shown to be duplicated.
- The API chat boundary is source-linked rather than package-governed: 9 API files make 13 relative `packages/chat-core/src/*` import expressions, and 2 files import `chat-server` source. There are zero bare `@sentropic/chat-core` or `@sentropic/chat-server` imports in `api/src`.
- `@sentropic/chat-ui` is the deepest UI coupling: `AppChatPanel.svelte` imports 16 distinct subpaths, while `ui/src` imports 31 distinct `@sentropic/chat-ui/*` subpaths as of revision `f1f3622b3`. It belongs in the existing serialized WP-CHAT lane.
- `@sentropic/events` has no direct application consumer, but this does not challenge the event-spine study. The live stream taxonomy is app/chat-core-local; any future convergence first needs a type-shape diff and is not automatically a contracts-gate change.
- The decisive P1 work is owner triage, not an immediately dispatchable build: LLM egress direction; UBO registry activate-or-park; MCP-platform activation start and its `BR-72 [track-live: TO-DO — title conflicts with spec]` label conflict; and cited-source-viewer activate-or-park. The authoritative owner/action/dependency register is §6.
- `@sentropic/mcp-platform` activation traces to `BR-42l [spec/WP-CATALOG]` and the read-only bank connector. The live label for `BR-72 [track-live: TO-DO — title conflicts with spec, see §4]` conflicts with the broker study’s benchmark-matrix definition and must be reconciled by the owner.
- The brief snapshot is stale across seven listed package versions, not just two. Qualified local versions match their npm latests; these are snapshot deltas, not qualified-worktree publish drift.

### 2. Method, definitions, and provenance

| Term | Definition used in this inventory |
|---|---|
| In production | Consumed by deployed `api/src/**`, `ui/src/**`, or `apps/auth-idp/**` runtime. Types-only, tests-only, and comment-only mentions do not establish integration. A distributed desktop binary is assessed as a separate production channel. |
| Deep | A live runtime is instantiated, mounted, rendered, or dispatches through the package on a load-bearing path. |
| Partial | A real slice or distribution channel is wired, while its principal surface is not on a live request or UI path. |
| Shallow | A narrow production slice, diagnostic endpoint, or types/constants-only use is live; the package’s broader capability is unused. |
| None | No deployed app-runtime consumer. This is a gap only when product-runtime adoption is intended. |
| Package boundary | A bare `@sentropic/*` import resolved through a declared package dependency. A relative `packages/*/src` import bypasses that boundary. |
| Version comparison | `npm latest` lower than qualified local source means published behind source. The qualified worktree has no such mismatch; the shared brief snapshot is broadly older. |

Evidence is limited to the supplied fact sheets, the cited worktree specs, package manifests, and stated runtime consumer paths. “UNQUALIFIED” is not used: each of the 24 local packages has a fact-sheet entry.

Track statuses come from the LIVE track sidecar (`track_report`), which post-dates and SUPERSEDES `track/TRACK.md` (reconciled 2026-06-09; that file’s own header declares the live sidecar was empty at the time and is now stale). Where a BR id appears only in code comments, git log, PLAN.md, or this brief — not in the live sidecar or TRACK.md forward tables — it is tagged accordingly and is NOT authoritative.

Tag convention: `[track-live]` is a sidecar bucket and status; `[PLAN/done]` is merged or historical PLAN/`plan/done` evidence; `[spec]` is a specification lineage; `[code-comment]` is a non-registry mention; `[not-in-registry]` means no authoritative live or forward-table item was found.

Facts were gathered by 5 sub-agents; assembled by Codex gpt-5.6-terra; adversarially reviewed by Codex gpt-5.6-sol (spec-grounded) and Claude Opus 4.8 (synthesis); reconciled by the conductor.

Revision basis: as of worktree revision `f1f3622b3` (origin/main + branch Lot 0).

The UI also depends on `@sentropic/design-system-svelte` and `@sentropic/design-system-themes`. They are separate-repository dependencies, out of scope, and excluded from the 24-package total.

### 3. Capitalisation inventory (master table)

| Package | Local / npm | Published | Depth | In prod | Primary consumer(s) | Track item / provenance | Priority |
|---|---:|---|---|---|---|---|---|
| `@sentropic/chat-ui` | 0.26.0 / 0.26.0 | yes | deep | yes | `ui/src/lib/components/chat/AppChatPanel.svelte` | WP-CHAT B `[track-live: DONE, acceptance stale]`; `BR-38c [track-live: AWAITED; open-PR #272 scope-violation pending]` | P1 |
| `@sentropic/auth-hono` | 0.13.0 / 0.13.0 | yes | deep | yes | auth router and `api/src/routes/auth/login.ts` | `BR-39b [PLAN/done]` | P3 |
| `@sentropic/auth-ui` | 0.7.1 / 0.7.1 | yes | deep | yes | `ui/src/routes/auth/login/+page.svelte` | `BR-39a [PLAN/done]` | P3 |
| `@sentropic/oauth-verify` | 0.1.0 / 0.1.0 | yes | deep, indirect | yes | through auth-hono and mcp-auth | none `[not-in-registry]` | P3 |
| `@sentropic/mcp-auth` | 0.2.0 / 0.2.0 | yes | deep | yes | `api/src/routes/api/mcp.ts` | `BR-39l [code-comment/brief only]` | P3 |
| `@sentropic/chat-core` | 0.1.6 / 0.1.6 | yes | deep | yes | `api/src/services/chat-service.ts` | no exact item `[not-in-registry]` | P2 |
| `@sentropic/chat-server` | 0.3.0 / 0.3.0 | yes | deep | yes | `api/src/routes/api/chat.ts` | `BR-58 [track-live: TO-DO]` adjacency, not owner | P2 |
| `@sentropic/llm-mesh` | 0.8.1 / 0.8.1 | yes | deep | yes | `api/src/services/llm-runtime/mesh-dispatch.ts` | `BR-14c [code-comment/brief only]` | P3 |
| `@sentropic/flow` | 0.1.3 / 0.1.3 | yes | deep | yes | queue manager and API startup | `BR-32 [PLAN/done]` | P3 |
| `@sentropic/comments` | 0.1.0 / 0.1.0 | yes | deep | yes | mounted comments router and `PgCommentStore` | `BR-42c [PLAN/done]`; `BR-42d [PLAN: not-started follow-on]` | P3 |
| `@sentropic/cowork-bridge` | 0.1.1 / 0.1.1 | yes | deep | yes | UI layout, API utilities, chat components | `BR-41a [PLAN/done]` family | P3 |
| `@sentropic/ubo-contracts` | 0.0.0 / not-found | private | partial | no | dormant `object-type-registry` adapter | `BR-59 [track-live: AWAITED, realization done / acceptance unknown]` | P1 |
| `@sentropic/contracts` | 0.1.1 / 0.1.1 | yes | partial | yes | comments, tools, queue services | `BR-47 [track-live: DONE]` adjacency, not owner | P3 |
| `@sentropic/cowork-desktop` | 0.2.0 / 0.2.0 | yes | partial | yes | API download/channel route and binary distribution | `BR-41a [PLAN/done]` | P3 |
| `@sentropic/auth-client` | 0.1.0 / 0.1.0 | yes | shallow | likely | `/auth/s2s/*` diagnostic path | `BR-39d [code-comment/brief only]` | P2 |
| `@sentropic/skills` | 0.1.2 / not-found | no | shallow | yes, narrow | catalog sources/types via relative source import | `BR-42b [PLAN/done]` | P2 |
| `@sentropic/llm-gateway` | 0.9.0 / 0.9.0 | yes | none | no | no app consumer | no owner `[not-in-registry]`; `BR-47 [track-live: DONE]` / `BR-55 [track-live: TO-DO]` are adjacencies | P1 |
| `@sentropic/events` | 0.1.1 / 0.1.1 | yes | none, direct | no, direct | only transitive in chat-core | `BR-48 [track-live: DONE]` study; `BR-60 [track-live: DONE]` implementation evidence | P1 |
| `@sentropic/mcp-platform` | 0.1.0 / 0.1.0 | yes, public | none | no | no real import; comment-only mentions excluded | `BR-42l [spec/WP-CATALOG]`; `BR-72 [track-live: TO-DO — title conflicts with spec]` | P1 |
| `@sentropic/cited-source-viewer` | 0.2.0 / 0.2.0 | yes | none | no | no app consumer | none `[not-in-registry]` | P1 |
| `@sentropic/focus` | 0.3.0 / 0.3.0 | yes | none, app | no | `packages/cli/src/focus.ts` only | Focus-M1 `[code-comment/brief only]` | P2 |
| `@sentropic/build-cli` | 0.2.0 / 0.2.0 | yes | none, app | no | `@sentropic/cli` only | `BR-42a1 [code-comment/brief only]` | P3 |
| `@sentropic/cli` | 0.4.0 / 0.4.0 | yes | none, app | no | standalone `stp` binary | `BR-42a1 [code-comment/brief only]` | P3 |
| `@sentropic/harness` | 0.3.0 / 0.3.0 | yes | none, app | no | advisory Makefile scope check | `BR-42h [code-comment/brief only]` | P3 |

### 4. Cluster findings

#### Auth / MCP

Auth is fully capitalised at its application boundary. Auth-hono mounts the backend surface, auth-ui renders the client surface, and mcp-auth protects the MCP route. The IdP’s relative import of API auth route modules remains a deploy-unit coupling risk, not package duplication.

##### `@sentropic/auth-client`

- OAuth2 client-credentials helper; shallow/likely production through the mounted `/auth/s2s/*` self-check.
- Its route returns `503 skipped` without OAuth client variables. Wire one genuine protected S2S call, or explicitly retain the route as a diagnostic endpoint; this is a new follow-up, not ownership by `BR-39d [code-comment/brief only]`.

##### `@sentropic/auth-hono`, `@sentropic/auth-ui`, and `@sentropic/mcp-auth`

- These are healthy deep integrations: factory routes, reusable Svelte screens, and the MCP resource-server kit respectively.
- `BR-39b [PLAN/done]` and `BR-39a [PLAN/done]` explain extraction, not new remediation. Auth-ui’s theme dependency is the named external design-system pair in §2.
- `@sentropic/mcp-auth/hono` is an exported package subpath, not a raw-source bypass.

##### `@sentropic/oauth-verify`

- It is a production indirect dependency through auth-hono and mcp-auth, with no direct API import.
- The direct declaration is present but not directly consumed; necessity is unverified. No action is implied by that observation.

##### Auth integration evidence

- Auth-hono owns route factories and middleware, while app session and email services remain host adapters rather than package copies.
- Auth-ui is rendered through Svelte routes with an injected transport. Its theme provider relies on the out-of-scope design-system packages named in §2.
- The mcp-auth route uses the package’s declared Hono subpath, preserving a real package boundary at that API entry point.
- Auth-client is intentionally much narrower: its self-check supplies useful diagnostic coverage, but does not establish general service-to-service adoption.
- The relative IdP-to-API route import is worth tracking as deployment coupling if those units later deploy independently; it is not an extraction defect today.

#### Chat

The chat runtime is load-bearing, but boundary quality is asymmetric. UI uses package specifiers while relying on many public subpaths. API uses relative package source paths. The immediate problem is governance and boundary policy, not a claim that app routes reimplement chat-server.

##### `@sentropic/chat-core`

- `ChatRuntime` is genuinely instantiated by `api/src/services/chat-service.ts`; the large host composition layer is app-specific rather than a proven runtime duplicate.
- Exactly 9 API files make 13 import expressions into relative `packages/chat-core/src/*` paths. `api/src/services/skills/catalog.ts` and `api/src/services/catalog/sources/agent-template-source.ts` are excluded because their hits are comment-only.
- No bare `@sentropic/chat-core` import occurs in `api/src`. The API boundary needs its own serialization owner in the chat-core/runtime seam, with `BR-58 [track-live: TO-DO]` and `BR-70core [track-live: TO-DO]` as overlaps rather than owners.

##### `@sentropic/chat-server`

- The canonical server router is mounted through `api/src/routes/api/chat.ts`; app-specific permission, history, and runtime-detail routes are additive.
- Two API files import relative chat-server source, not `@sentropic/chat-server`; its declared chat-core dependency has no source import. The future boundary choice is source-linked policy versus built bare imports.

##### `@sentropic/chat-ui`

- It is deeply integrated across web, VSCode, and Cowork hosts. `AppChatPanel.svelte` imports 16 distinct subpaths; `ui/src` reaches 31 distinct `@sentropic/chat-ui/*` subpaths as of `f1f3622b3`.
- Raw source exports plus `file:` linkage mean package changes are app-visible immediately. The required integration map and public-surface governance must be serialized under WP-CHAT, not moved into a new capitalisation taxonomy.
- The live collision sequence and its ambiguity are recorded in §7; actions and owner/dependency decisions remain authoritative in §6.

##### Chat boundary evidence

- Every counted chat-core and chat-server consumer is a relative `packages/*/src` import; the count excludes non-runtime comments and does not infer a dependency from them.
- The UI does use package exports, but `file:` resolution and raw source entry points mean the resulting surface is still materially coupled to the host.
- App-specific chat routes add permissions, history, and runtime details around the canonical server router. That is extension composition, not evidence of router reimplementation.
- `chat-service.ts` is a large composition layer over `ChatRuntime`; its size is a maintainability signal, not a proof that it duplicates the runtime.
- The required decision is architectural: make source-linking explicit and governed, or establish built package imports. It is not a blanket demand to rewrite chat.

#### LLM egress

##### `@sentropic/llm-mesh`

- Mesh is the live production egress layer. `mesh-dispatch.ts` constructs it, and provider branches dispatch through it using package exports.
- Application-local account transports are adjacent to gateway pooling, not a demonstrated duplicate of mesh dispatch or catalog work.

##### `@sentropic/llm-gateway`

- Gateway has no consumer in `api/src`, `ui/src`, or the IdP, yet it is functional in-package. Passthrough router flows return 200 when supplied their flow dependencies; 501 is scaffold-mode behavior only.
- `SPEC_EVOL_LLM_GATEWAY` records the gateway-routing target direction, while `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS` records the earlier app-owned coordinator direction. These are overlapping recorded authorities plus an unexecuted app integration.
- `api/src/services/llm-account-transports.ts` demonstrates overlapping pool, lease, reservation, and cooldown lifecycle ownership. It does not demonstrate duplicate gateway caller-auth, or duplicate `BR-47 [track-live: DONE]` financial metering/quota settlement.
- The independent unresolved gate is WP16 D0: cross-user account pooling needs owner ToS/legal acceptance and a fail-closed kill switch. Personal passthrough is separately described as the unblocked mode.

##### Egress boundary evidence

- The live path remains chat route → chat service → LLM runtime → mesh dispatch → `@sentropic/llm-mesh`.
- The gateway specification calls for package-plus-separate-service deployment, with an HTTP client or base-URL adapter at the chat boundary rather than in-process provider credentials.
- Gateway personal-passthrough constrains selection to the caller’s own enrolled accounts; cross-user selection is not an implied consequence of integrating the gateway.
- The corrective choice is therefore not “make a stub work.” It is to select and execute one documented boundary, then eliminate or formally supersede conflicting ownership.
- This cluster has no demonstrated basis for assigning gateway activation to deployment-plane or quota-ledger work; those remain only adjacent concerns in §6.

#### Runtime libraries

##### `@sentropic/flow`

- Flow is deep and healthy through queue startup, workflow services, and Postgres adapters. Existing re-export shims are compatibility residue.
- Extraction was `BR-32 [PLAN/done]`; `BR-26 [code-comment/brief only]` is OpenERP requirements and is not an owner for shim cleanup.

##### `@sentropic/comments`

- The mounted router and shared `PgCommentStore` are an intended port/adapter integration, not duplication.
- That delivered slice is `BR-42c [PLAN/done]`. `BR-42d [PLAN: not-started follow-on]` remains persistence/observability and SSE/NOTIFY work; “no action” applies only to the delivered slice.

##### `@sentropic/skills` and `@sentropic/contracts`

- Skills is a narrow source-linked use: API consumes constants and types through `packages/skills/src`, does not declare the dependency, and hand-duplicates registry ranking in `composite-registry.ts`.
- Contracts is a healthy shared type source for the limited shapes actually used. A contracts-mutation gate applies only if a proposal changes a governed `@sentropic/contracts` shape; Skills work instead uses ordinary package compatibility and version checks.

##### `@sentropic/events`

- There is no direct `@sentropic/events` import in API, UI, or IdP. The live stream taxonomy is app/chat-core-local, making this a separate unowned package-adoption observation.
- `BR-48 [track-live: DONE]` is an architecture study that ships neither code nor contract mutation and explicitly excludes `chat_stream_events`. `BR-60 [track-live: DONE]` is the outbox implementation whose acceptance evidence is relevant here.
- Before proposing any taxonomy migration, compare the actual type shapes. This observation alone neither reopens the study nor invokes the contracts-mutation gate.

##### `@sentropic/ubo-contracts`

- The registry port, Postgres adapter, singleton, and `object_type_definitions` table exist, but no production route or service calls the singleton.
- The correct posture is an owner triage for `BR-59 [track-live: AWAITED, realization done / acceptance unknown]`, after its `BR-50 [track-live: TO-DO]` prerequisite; it is not an automatic migration request.

##### Runtime-library evidence

- Flow’s queue, gates, workflow defaults, and Postgres port adapters are live at API startup; compatibility shims are the remaining maintenance concern.
- Comments has one shared persistence adapter and a mounted router, a useful reference for an intended package-port integration.
- Skills’ public configuration and npm absence disagree. Its first practical decision is scope, not a package publish or contracts change by default.
- Contracts supplies tenant, authorization, and related shapes at existing call sites. The inventory makes no claim that every contracts capability is adopted.
- The UBO adapter’s clean named import is preferable to the source bypasses elsewhere; its issue is missing application reachability, not import quality.
- Events can remain independently published while its taxonomy is not yet the application’s direct vocabulary. That separation is an observation, not a failed event-spine implementation.

#### Tooling, platform, cowork, and viewer

##### `@sentropic/mcp-platform`

- This is a published/tested public 0.1.0 contract with no application consumer. Comment-only tenancy references do not count, and the local resolver is an explicitly deliberate placeholder rather than a silent duplicate.
- Its spec lineage is `BR-42l [spec/WP-CATALOG]`; the named first real consumer is the read-only bank connector. The broker study defines `BR-72 [spec]` as a non-product connector benchmark matrix, while the live sidecar calls `BR-72 [track-live: TO-DO — mcp-platform PROVIDER activation]`. This is an owner conflict, not a resolved mapping.

##### `@sentropic/cited-source-viewer` and `@sentropic/focus`

- Cited-source-viewer is published/tested and has no consumer. Existing `[N]` chat links are the nearest analog, not an equivalent viewer; a decision is needed before any implementation.
- Focus is wired only through the CLI. Its stale README conflicts with its published status, and its classification remains unresolved: CLI-only tooling versus an app consumer, not flatly product-dark.

##### `@sentropic/cowork-bridge` and `@sentropic/cowork-desktop`

- Cowork Bridge is the reference deep integration: UI layout, API helpers, stores, and chat components use it through source-linked `file:` wiring.
- Cowork Desktop is partial but production through signed-binary packaging, API download/channel configuration, and UI download controls. It is distributed rather than imported; only the fallback-version literal merits a small consistency follow-up.

##### `@sentropic/build-cli`, `@sentropic/cli`, and `@sentropic/harness`

- These have no deployed application consumer because they are external scaffolding, standalone CLI, and AI-development tooling respectively. They are not capitalised-but-dark app-runtime packages.

##### Product-surface evidence

- MCP-platform’s published root is deliberately narrow and semver-governed; its `./experimental` and testing tiers do not establish a deployed consumer.
- The bank connector is the spec-named real read-only validator. It should import the frozen root rather than turn local app comments into evidence of activation.
- Cited-source-viewer’s nearest local behavior is narrow citation-link rendering in chat markdown and editable input. It lacks the package’s viewer frame and renderer capabilities.
- Focus has a real CLI path and a stale README. Whether that is a complete product role or merely an interim distribution path remains an owner classification question.
- Cowork Bridge uses package APIs across many live UI locations, while Cowork Desktop is present through download and packaging paths. The two forms of adoption should not be collapsed.
- Build CLI, CLI, and Harness should remain visible in the inventory so package investment is accounted for, while retaining their non-runtime classification.

### 5. Cross-cutting findings

| Finding | Evidence and consequence | Disposition |
|---|---|---|
| API chat boundary bypass | 9 API files / 13 import expressions access chat-core source; 2 chat-server files access chat-server source; zero bare package imports occur in `api/src`. | Source-link policy or built-package migration is an owned chat-core/runtime follow-up; see §6. |
| Chat-ui coupling | 16 AppChatPanel subpaths and 31 UI subpaths expose a broad raw-source public surface. | Serialized WP-CHAT governance and an integration map; see §6 and queue constraints in §7. |
| LLM egress authority overlap | Gateway works in-package but is unwired; app owns a demonstrated pool lifecycle. Two specs overlap. | P1 owner decision record, then execution or explicit supersession; see §6. |
| Direct events adoption gap | `@sentropic/events` has no direct app consumer; live stream types remain local. | Separate unowned observation; inspect `BR-60 [track-live: DONE]` evidence, type-shape diff first; see §6. |
| UBO registry is shelved | Adapter and table exist without a production caller. | Triage only after `BR-50 [track-live: TO-DO]`; see §6. |
| MCP-platform lineage conflict | The sidecar’s `BR-72 [track-live: TO-DO]` title conflicts with the broker spec’s benchmark definition. | Owner reconciliation before activation dispatch; see §6. |
| Skills source bypass | Narrow undeclared source import and duplicated ranking meet catalog work already in flight. | New follow-up must order with or be absorbed by `BR-70core [track-live: TO-DO]`; see §6. |
| Expected non-runtime tooling | Build CLI, CLI, and Harness are standalone/dev products. | Record as intentional, no app-integration action. |
| Distributed desktop channel | Desktop is served and configured through the app while remaining a binary. | Preserve partial-production classification; see §6 for version-literal hygiene. |

Section 6 is the sole authoritative action, owner, and dependency register. This section reports evidence only and does not create parallel lots.

### 6. Gap → ownership and remediation register

| Gap | Package(s) | Origin item (+source tag & status) | Existing owning lane | Remediation = existing item or NEW follow-up | Action |
|---|---|---|---|---|---|
| Unexecuted egress integration and overlapping authorities | llm-gateway, llm-mesh | No owning BR `[not-in-registry]`; `BR-47 [track-live: DONE]` and `BR-55 [track-live: TO-DO]` are adjacencies, not owners | NEW LLM-egress owner-decision record | **NEW follow-up required; OWNER DECISION** | Execute the recorded gateway direction, or explicitly supersede/reconcile the two specs; name one owner for pool/lease/reservation/cooldown. Keep WP16 D0 cross-user ToS/legal kill-switch separate. |
| API source bypass of chat boundaries | chat-core, chat-server | Extraction lineage `BR-14b [PLAN/done]`; no boundary owner | chat-core/runtime seam | **NEW follow-up required** | Assign a serialization owner; choose source-linked policy or a built bare-import path; clean/document the unused chat-server→chat-core edge only after the choice. |
| High-blast-radius chat-ui subpaths | chat-ui | WP-CHAT B `[track-live: DONE, acceptance stale]`; `BR-38c [track-live: AWAITED; open-PR #272]` | WP-CHAT single-owner lane | Existing lane; new scoped integration-map lot | Assign the lane owner, publish the 16/31 subpath map, and govern additions/removals. Respect the §7 sequence before any UI change. |
| Local stream taxonomy has no events-package consumer | events, chat-core, chat-server | `BR-48 [track-live: DONE]` study is origin context only; `BR-60 [track-live: DONE]` holds implementation evidence | Unowned observation; outbox acceptance evidence in `BR-60 [track-live: DONE]` | **NEW follow-up required only if type-shape diff warrants it** | Compare package and live taxonomy shapes. Do not reopen the study or schedule a migration without that evidence; use contracts gate only if a governed contracts shape would change. |
| Registry/table lack a live caller | ubo-contracts | `BR-59 [track-live: AWAITED, realization done / acceptance unknown]` | data/UBO lane | **OWNER TRIAGE** for existing item | First resolve `BR-50 [track-live: TO-DO]`, then activate one route/service consumer or park. Reserve migration calendar time only for an actual schema change, adding `api/drizzle/**` only then. |
| Public MCP contract has no real consumer | mcp-platform | `BR-42l [spec/WP-CATALOG]`; bank connector is named consumer; `BR-72 [track-live: TO-DO — title conflicts with spec]` | WP-CATALOG | **OWNER TRIAGE** to reconcile label, then existing spec lineage or a new local dogfood item | Reconcile the `BR-72 [track-live: TO-DO — title conflicts with spec]` conflict first. If activation proceeds, validate the read-only bank connector against the published root; do not declare the benchmark matrix to be implementation work. |
| Citation viewer has no first consumer | cited-source-viewer | None `[not-in-registry]` | WP-CHAT, only if activation is selected | **NEW follow-up required; OWNER TRIAGE** | Activate-or-park. If activated, the chat-ui owner assigns a slot for the narrow citation-link-to-viewer consumer after the live queue. |
| Skills bypass and duplicate ranking | skills | `BR-42b [PLAN/done]` delivered catalog extraction | WP-CATALOG / `BR-70core [track-live: TO-DO]` | **NEW follow-up required** | Order behind or absorb into the active catalog/skills work; choose package adoption versus types-only scope, converge ranking, and document npm absence with ordinary compatibility gates. |
| Flow compatibility shims | flow | `BR-32 [PLAN/done]` | Flow/runtime maintenance | **NEW follow-up required** | Rebind remaining callers directly and retire or document shims. `BR-26 [code-comment/brief only]` is OpenERP requirements, not the remediation owner. |
| Comments observability beyond delivered slice | comments | `BR-42c [PLAN/done]` delivered router and `PgCommentStore`; `BR-42d [PLAN: not-started follow-on]` | comments persistence/observability | Existing follow-on if dispatched | Keep no-action only for the delivered slice; route SSE/NOTIFY and observability work to the explicit follow-on. |
| Focus publication/intended-use mismatch | focus | Focus-M1 `[code-comment/brief only]` | Focus product owner | **NEW follow-up required** | Correct README, then decide CLI-only classification or an app consumer. |
| Desktop fallback-version literal | cowork-desktop | `BR-41a [PLAN/done]` delivered distribution | Cowork maintenance | **NEW follow-up required** | Derive the fallback version or add a CI consistency assertion. |
| Auth extraction health | auth-hono | `BR-39b [PLAN/done]` | Auth maintenance | No remediation | Preserve current integration; independent deployment composition is conditional future work, not a current gap. |

### 7. Routing and collision-aware execution order

This is a routing overlay, not a second work-package taxonomy. Every capitalisation item routes into an existing lane or the new LLM owner-decision record; §6 remains the authoritative action register.

| Existing lane | Items routed here | Sequencing / collision rule |
|---|---|---|
| NEW LLM-egress decision record | gateway direction, app pool lifecycle ownership | Decision first; its resultant build or explicit supersession is gated by the owner record. WP16 D0 remains a separate legal/ToS gate. |
| chat-core/runtime seam | API chat-core/server boundary | Give the boundary its own serialization owner. It overlaps `BR-58 [track-live: TO-DO]` and `BR-70core [track-live: TO-DO]`; do not treat either as its owner. |
| WP-CHAT | chat-ui map, cited-source-viewer if activated | Single UI owner; map and viewer work stay unscheduled until that owner assigns their slots. |
| WP-CATALOG | mcp-platform activation, Skills cleanup | Reconcile the `BR-72 [track-live: TO-DO — title conflicts with spec]` label before activation. Absorb or order Skills work with `BR-70core [track-live: TO-DO]`. |
| data/UBO lane | registry consumer | Required order is `BR-50 [track-live: TO-DO]` → `BR-59 [track-live: AWAITED, realization done / acceptance unknown]` → `BR-61 [track-live: TO-DO]`. |
| migration calendar | UBO only if schema changes | The existing `object_type_definitions` table permits a first route/service consumer without a migration. Reserve calendar scope and add `api/drizzle/**` only when an actual schema change is proposed. |
| contracts-mutation gate | only governed contracts changes | Invoke only when a proposed diff mutates a governed `@sentropic/contracts` shape. Events observation and Skills compatibility work do not automatically qualify. |

#### Chat queue and ownership constraints

- The recorded sequence says to land PR #257 (`chat-loop-guard-v2`, chat-core runtime seam) first. The live sidecar marks that fix DROPPED/cancelled, while the stale registry calls it open; verify its disposition before applying that ordering.
- Freeze `chat-core/ports.ts` under the single chat-ui owner for port changes.
- `BR-38c [track-live: AWAITED; open-PR #272]` sequences before WP-CHAT B and has an unresolved `ui/AppChatPanel.svelte` scope violation to fix or split first.
- The intended UI order is then WP-CHAT B, `BR-70viz [track-live: AWAITED]`, `BR-62 [track-live: AWAITED]`, and `BR-64 [track-live: TO-DO]`. The integration-map edit and any cited-source-viewer UI work are unscheduled until the owner assigns a slot in that order.
- The boundary policy work stays separate from UI ownership even when it shares chat files; the runtime-seam owner must serialize it against `BR-58 [track-live: TO-DO]` and `BR-70core [track-live: TO-DO]`.

#### Ordered execution

1. **P1 — OWNER-DECISION/TRIAGE:** establish the LLM-egress decision record in §6. No gateway build is dispatchable until the recorded direction is executed or superseded.
2. **P1 — DISPATCHABLE prerequisite:** complete `BR-50 [track-live: TO-DO]` before asking the owner to activate or park `BR-59 [track-live: AWAITED, realization done / acceptance unknown]`; `BR-61 [track-live: TO-DO]` remains downstream.
3. **P1 — OWNER-DECISION/TRIAGE:** resolve the mcp-platform activation start, including the `BR-72 [track-live: TO-DO — title conflicts with spec]` label conflict. Nothing is a build lot before the owner confirms the lineage.
4. **P1 — OWNER-DECISION/TRIAGE:** activate or park cited-source-viewer; activation awaits a WP-CHAT slot.
5. **P1/P2 — SERIALIZATION CHECK:** verify the dropped/cancelled disposition of PR #257, resolve the `BR-38c [track-live: AWAITED; open-PR #272]` scope violation, then let the chat owner schedule WP-CHAT B, its integration map, `BR-70viz [track-live: AWAITED]`, `BR-62 [track-live: AWAITED]`, and `BR-64 [track-live: TO-DO]`.
6. **P2 — DISPATCHABLE only after owner assignment:** take the chat-core/server boundary policy through its dedicated runtime-seam owner.
7. **P2 — ROUTED, not parallel:** order or absorb Skills cleanup into `BR-70core [track-live: TO-DO]` in WP-CATALOG.
8. **P3 — NEW maintenance follow-ups:** Flow shims, Focus documentation/classification, and Cowork Desktop version consistency follow the owner decisions and collision-prone work.

### 8. Immediate next steps

Use the §6 register as the only action record. The next coordination packet should obtain the four P1 owner decisions/triages identified in §1, then assign the relevant existing-lane owners in §7.

Before any chat dispatch, resolve the PR #257 status discrepancy and the `BR-38c [track-live: AWAITED; open-PR #272]` scope violation. Before any UBO dispatch, verify `BR-50 [track-live: TO-DO]` completion. Before any MCP dispatch, resolve the `BR-72 [track-live: TO-DO — title conflicts with spec]` title conflict.

### 9. Appendix

- Qualification evidence resides in `factsheet-A-auth.md`, `factsheet-B-chat.md`, `factsheet-C-llm.md`, `factsheet-D-libs.md`, and `factsheet-E-tooling.md` in this scratchpad.
- The 24 package rows are exhaustive for the supplied local package list. `@sentropic/design-system-svelte` and `@sentropic/design-system-themes` remain separate-repository, out-of-scope dependencies and are excluded from totals.
- The shared brief snapshot is stale across these local-version deltas: auth-hono `0.11.1 → 0.13.0`; auth-ui `0.6.0 → 0.7.1`; chat-ui `0.22.0 → 0.26.0`; llm-mesh `0.6.1 → 0.8.1`; llm-gateway `0.2.1 → 0.9.0`; mcp-platform `0.0.0 → 0.1.0`; cited-source-viewer `0.1.0 → 0.2.0`.
- These deltas mean the brief/main snapshot is stale across the board. They are not qualified-worktree npm drift: each listed qualified local version matches npm latest.
- `@sentropic/skills` is `NOT-FOUND` on npm despite public publish configuration; `@sentropic/ubo-contracts` is intentionally private/unpublished under DD6.
- `BR-44 [track-live: DONE]`, `BR-45 [track-live: DONE]`, `BR-46 [track-live: DONE]`, `BR-47 [track-live: DONE]`, `BR-48 [track-live: DONE]`, `BR-52 [track-live: DONE]`, and `BR-60 [track-live: DONE]` use live-sidecar status even where the stale registry has older wording.
- Status tags preserve the source and avoid treating historical extraction labels as current remediation ownership.
- All proposed action is therefore routed through §6 before work is dispatched.
- No closed extraction item is used to silently own new remediation.
