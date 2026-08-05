# TRACK — branch / scope / dependency registry

Purpose: the authoritative coherence registry of Sentropic's in-progress and
upcoming branches, with a **scope** (the packages/app-trees each element
touches) and **dependencies** (internal BRs + external lanes) per element.
Reconciled 2026-06-09 from a double coherence audit (Codex 5.5 xhigh + Opus
4.8) against `PLAN.md` and the three merged governing specs
(`SPEC_EVOL_ARCHITECTURE.md` D1-D11, `SPEC_EVOL_DATA_ARCHITECTURE.md`
DD1-DD11, `SPEC_EVOL_RESOURCE_FS.md` RF1-RF11).

Note on the live track sidecar: the `track` MCP sidecar is currently EMPTY
(`track_report` returns no buckets) — the harness-fed track (BRANCH.md
ingestion) has no entries yet, so PLAN.md + this registry are the de-facto
source of truth. Ingesting per-branch BRANCH.md into the harness track is a
follow-up (see Open items).

Scope vocabulary (verified `git ls-tree origin/main packages/`): `auth-client`,
`auth-hono`, `auth-ui`, `build-cli`, `chat-core`, `chat-server`, `chat-ui`,
`cli`, `comments`, `contracts`, `cowork-bridge`, `cowork-desktop`, `events`,
`flow`, `harness`, `llm-mesh`, `skills` + `api/`, `ui/`, `apps/auth-idp/`.
Studies (`chore/arch*`) are docs-only (touch `spec/`); their *frame* (the
eventual blast-radius packages) is listed in italics so the registry carries
the future scope.

Status legend: `done` (merged) · `open-PR` · `in-progress` · `dispatchable`
(gates clear, not started) · `gated` (blocked on a dependency) · `plan`
(backlog) · `deferred` · `study`.

## 1. Coherence findings (fixed in this PR / open for the owner)

Fixed here (PLAN was stale / self-contradictory — both auditors HIGH):
- BR-38a marked done (MERGED PR #203, 2026-06-02) — PLAN listed "in progress".
- BR-42b marked done (MERGED PR #247, 2026-06-04) — PLAN §3 said `plan`.
- BR-39a/BR-39b marked done — PLAN listed `plan` despite `plan/done/`.
- BR-42c (`@sentropic/comments`) done; `@sentropic/build-cli@0.2.0` LANDED
  (src + templates/chat-app + tests) — BR-42a1 is largely landed, not `plan`.
- Open PRs registered as gates: #272 (BR-38c documents) and #257
  (chat-loop-guard, chat-core runtime) — both sit on seams the ARCH program
  edits.
- Gate edges added: BR-57 → BR-49 (run model) + BR-34 Lot 0 (graphify);
  BR-65 → BR-60 (outbox) + DD4 committed consumer; BR-71 → BR-45/ARCH-01
  (`/apps`); BR-59 BR-46 gate relaxed to soft (DD6=A unpublished package is
  not a `contracts` mutation).

Open blocking decisions (owner — see §5).

## 2. Completed / active (old backlog + open PRs)

| ID | Title | Status | Scope | Depends-on | External lanes |
|---|---|---|---|---|---|
| BR-38a | multimodal-image-input | done #203 | llm-mesh, chat-core, chat-ui, events, api, ui | BR-14a/b/c/g, BR-16a | gdrive image import |
| BR-42b | catalog-agents-canvas | done #247 | api/services/catalog, skills | BR-19, BR-33 | MCP/google sources |
| BR-42c | comments-package | done | comments, contracts, api | — | npm publish |
| BR-39a | auth-ui-sdk | done | auth-ui, ui | BR-14f | spa-transpose-cv |
| BR-39b | auth-hono-kit | done | auth-hono, api | BR-39a | auth route consumers |
| BR-42a1 | build-app-cli | largely landed (build-cli@0.2.0) | build-cli, cli, chat-server, chat-ui, api/ui templates | BR-42a0 | GitHub repo creation |
| BR-38c | documents-rendering fold | **open-PR #272** | **chat-ui/src/documents**, ui (AppChatPanel — SCOPE-VIOLATION, its BRANCH forbids ui/**) | BR-38a, WP-CHAT A | chat lane |
| (fix) | chat-loop-guard-v2 | **open-PR #257** | **chat-core/runtime-tool-dispatch, runtime, runtime-run-prepare**, api/chat-service | — | — |
| BR-25 | rules-skills-audit | study 17/46 | harness, skills, rules/docs | BR-04B | harness CLI |
| BR-33 | managed-marketplace | plan | new `@sentropic/marketplace`, skills, api | BR-19 | governance policy |
| BR-34 | graphify-fusion | plan (NOT standalone — gates BR-57) | new `@sentropic/graphify`, harness (peerDep), cli | — | graphify npm-transfer fork |
| BR-35 | persistence-git-adapter | plan | new `@sentropic/persistence-git`, chat-core (CheckpointStore) | BR-14b | git checkpoint |
| BR-36 | external-triggers | plan | flow, api | BR-32 | webhook/schedule/email/file-watch |
| BR-38b | image-generation-tool | plan | llm-mesh, chat-core, chat-ui, events, api, ui | BR-38a | image providers |
| BR-41b | cowork-local-webview | plan | cowork-desktop, cowork-bridge, chat-ui | BR-41a | desktop/webview |
| BR-42d | comments persistence/observability | plan | api, comments, events | BR-42c, BR-39 | comment SSE/NOTIFY |
| BR-42e | flow-queue-streaming | plan | flow (JobQueue), api, chat-server | BR-32 | chat queue extraction |
| BR-42g | events-bigquery-sink | plan (re-gate DD4=B) | events, api | events | BigQuery |
| BR-43 | llm-mesh-gcp | plan | **llm-mesh**, api | BR-14c | GCP/Vertex |
| BR-40b/c | xlsx-multitab-query / folder-xlsx-export | plan | api, skills, ui | unresolved `feat/xlsx-gsheet-indexing` (40b) | document query / export |
| BR-07/10/11/12/15/16b/16c/17/18/20/21a/22 | product backlog | plan | api, ui (most); chat-ui (11); skills (15); llm-mesh (17 via Cohere) | per PLAN §3 | gdrive/chrome/voice. NB BR-17 RAG must honor DD5 (graphify/KnowledgeQueryPort first, pgvector later) |
| BR-09 | sso-google | deferred | api, ui, auth-* | BR-00 | Google OAuth |
| BR-21 | cv-transpose-profiles | parked | api, ui | BR-04, opt BR-21a | CV/proposal |

## 3. Architecture program (BR-44..BR-67) — studies docs-only, impls scoped

| ID | Title | Status | Wave | Scope (frame → packages) | Depends-on | External lanes |
|---|---|---|---|---|---|---|
| BR-44 | data-hardening | **dispatchable** | H | **flow/job-queue.ts** (lease/reaper), api (chat_stream_events sweep + created_at index), api/drizzle (drop task_io_contracts) | none | precedes BR-60/61/70 |
| BR-45 | arch01-app-control-plane study | **dispatchable** | 1a | *spec; frames api control-plane, build-cli manifest, catalog* | D1/D2/D7 | IdP seam |
| BR-46 | arch12-contract-compat study | **dispatchable** | 1a | *spec; frames contracts, comments, chat-*, flow* | D11 | blocks contract mutations |
| BR-47 | arch13-quota-ledger study | **dispatchable** | 1a | *spec; frames api (CostContext), api/drizzle ledger* | D6 | **owner: anon budget owner/cap/kill-switch** |
| BR-48 | arch14-event-spine study | **dispatchable** | 1a | *spec; frames events (EventBusPort over 10 NOTIFY), api outbox* | ARCH-14 baseline | NOTIFY audit |
| BR-49 | arch07-background-runs study | gated | 1b | *spec; frames flow, chat-core (tool loop), api* | BR-47 budget hook; **+ PR #257** | — |
| BR-50 | arch19-ubo-inventory study | dispatchable | 1b | *spec; frames future UBO package + api `.data`* | DD3 | **h2a claude:openerp** (DD3 doc chain) |
| BR-51 | arch10-portability annex | dispatchable | 1b | *spec; constrains Wave-1+ defaults* | none | self-host |
| BR-52 | artifact-store-port | dispatchable (impl) | 1b | **api/services/storage-s3.ts** (ArtifactStorePort + local-FS) | none | storage |
| BR-53 | arch02-public-app-auth study | gated | 2 | *spec; frames api (guest rows, factory routers), chat-server DTO* | BR-45; **BR-39n** | IdP claim-set |
| BR-54 | arch05-code-workspace-remote study | gated | 2 | *spec; frames cowork-bridge, api, edge proxy* | BR-45; **cowork backend split**; +BR-55 coord | cowork lane; **owner: D5 preview-domain name** |
| BR-55 | arch17-deployment-plane study | dispatchable | 2 | *spec; frames deploy/k8s, k8s-ops contract* | none | claude:poc-k8s |
| BR-56 | arch15-data-lifecycle study | dispatchable | 2 | *spec; frames api, api/drizzle (retention/GDPR)* | none | — |
| BR-57 | arch06-knowledge study | gated | 2 | *spec; frames graphify, api indexer, events* | **BR-34 Lot 0 + BR-49** | graphify fusion |
| BR-58 | arch08-h2a-chat study | gated | 2 | *spec; frames api (h2a transport), chat-core* | BR-49 | h2a (a2a-cli) |
| BR-59 | arch19-registry-v0 | gated | 2 | new **unpublished UBO package** (object_type_definitions + envelope), api; NO storage | **BR-50 done**; BR-44; BR-46 soft | **owner: DD6 package name** |
| BR-60 | arch14-outbox-v0 | gated | 2 | **api** (outbox table + producers), **comments** (replace bespoke NOTIFY), events | **BR-44 landed**; BR-48 | — |
| BR-61 | arch19-ubo-storage | gated | 3 | **api/drizzle** (business_objects, ObjectResolverPort, union view, validation ladders), UBO package, skills | BR-59; BR-60 (or event-less); DD9 re-key | — |
| BR-62 | arch03-diag-app | gated | 3 | **apps/** (diag), **chat-ui** (mermaid seam, host-tool ext), comments (contextType), chat-server, api/S3, ui | **BR-53 + BR-56 + BR-70** renderer; D9; D4 | IdP A1; chat-ui host-tool ext |
| BR-63 | arch04-immo-app | gated | 3 | **SEPARATE REPO** via published build-cli/chat-ui/chat-server/auth-* | **BR-54**; **BR-39e** | IdP memberships; app-foundry |
| BR-64 | arch16-canvas study | dispatchable | 3 | *spec; frames chat-ui (canvas), chat-core (LiveDocumentStore)* | none | canvas lane |
| BR-65 | analytics-export-v0 | gated | 3 | **api, events** (outbox→Parquet + DuckDB reader) | **BR-60 + DD4 consumer committed** (BR-47 ledger-reporting OR BR-66) | — |
| BR-66 | arch09-track-dossiers study | gated | Last | *spec; frames harness/track, events* | **BR-48 + BR-60** (real event sources) | track lane |
| BR-67 | arch10-self-hosting study | gated | Last | *spec; frames whole platform* | BR-45 + **BR-63 proof** | **owner: D10 licensing** |

BR-68 / BR-69: RESERVED (numbering gap — do not assign without updating this
registry). BR-27..BR-30: RESERVED (OpenERP impl follow-ups of BR-26).

## 4. Resource Plane (ARCH-21) — registered via PR #276 (SPEC_EVOL_RESOURCE_FS, RF1-RF11)

| ID | Title | Status | Scope | Depends-on | External lanes |
|---|---|---|---|---|---|
| BR-70 | resource-plane-v0 (ARCH-21a) | dispatchable after BR-44 | **chat-core** (ResourceProvider PORT, ToolRegistry.resolve reuse, async resume), api/services/catalog (PROJECTS the catalog — consumes, does NOT own sources), **chat-ui** (RF11 tree, file chips, terminal pane, custom-renderer slot), skills (`accessMethods`), chat-server, flow, events, llm-mesh (tool family), ui | **BR-44**; **+ PR #257** (runtime) + catalog-authz; **+ BR-42j (catalog→ResourceProvider adapter) + BR-42i (MCP resources)**; chat-ui lane settled | chat-ui host-tool ext |
| BR-71 | resource-plane-21b (ARCH-21b) | gated (SPLIT recommended) | api (`/workspace`, `query`), graphify/events (`/knowledge`, watch), chat-ui (watch UI), apps (`/apps`), cowork-* (remote bash), build-cli | **BR-61 + BR-60 + BR-57 + BR-45** (apps) + ARCH-05/16/17 | graphify fusion; cowork remote |

**WP-CATALOG (added 2026-06-11, owner correction): Capability catalog & MCP**
(ARCH-01/BR-42b lineage; accountable=architect). The MCP work belongs to the
catalog lineage (BR-19 → BR-19b → BR-42b), NOT the Resource Plane (BR-70).
Items: BR-42b (unified catalog, MCP TOOLS — DONE #247); **BR-42i**
(mcp-resources-mapping: extend `McpCatalogSource` with `resources/list`+`read`,
URI-preserving, allowlist+MIME/size/secret); **BR-42j** (catalog→ResourceProvider
adapter so the catalog mounts under the Resource Plane port); BR-33
(managed-marketplace). Scope: `api/services/catalog`, `packages/skills`. BR-70
(Resource Plane) DEPENDS on BR-42i + BR-42j and PROJECTS the catalog.

**Owner DECIDED 2026-06-09 (Q2=A): SPLIT both.** BR-70 → BR-70core
(ResourceProvider + verb dispatch + async resume; gated BR-44) + BR-70viz
(RF11 trace/chips/terminal/custom-renderer; runs INSIDE the serialized chat-ui
lane, §5 Q1). BR-71 → five gated sub-branches: `/workspace`+query (ARCH-19
resolver), `/knowledge`+watch (ARCH-14 outbox + ARCH-06 + graphify fusion),
`/apps` mount (ARCH-01/BR-45), real bash + `remote-fs` (ARCH-05/17), canvas
edit-back (ARCH-16). Sub-branch numbering reserved at the BR-70/71 split point
(do not reuse BR-68/69).

## 5. Scope-collision / merge-risk (the dominant coherence risk)

| Hotspot | Concurrent BRs/PRs | Risk | Recommendation |
|---|---|---|---|
| `chat-ui/src/documents` + ui chat surfaces | #272/BR-38c, BR-38b, WP-CHAT B, BR-41b, BR-62, BR-70 RF11, BR-10/11/21a/22 | HIGH — 3+ lanes edit the same 8-file module; chat-ui consumed by SOURCE import (Tier-1 → prod, no semver buffer) | **Single chat-ui owner.** Order: #257 → #272 → WP-CHAT B → BR-70 RF11 → BR-62/BR-64. |
| `chat-ui/src/renderers` | BR-70 RF11 (custom-renderer slot), BR-64 canvas, BR-62 mermaid | HIGH — all register renderers | RF11 (BR-70) defines the slot CONTRACT first; BR-62/BR-64 consume it. |
| `chat-core/runtime*.ts` + chat-server + api chat loop | #257, BR-38a/b, BR-42e, BR-49, BR-58, BR-70 (RF4 resume) | HIGH — the resume/tool-dispatch seam is the most-touched | **Land #257 before BR-49/BR-58/BR-70.** Freeze `chat-core/ports.ts` under one owner for RF1 id/etag additions. |
| `api/drizzle/*.sql` (one-migration rule) | BR-44, BR-47, BR-53, BR-59, BR-60, BR-61, BR-65 | HIGH — migration ordering | **Migration calendar**: BR-44 first → BR-60 → BR-59/61 in chosen order. |
| `@sentropic/contracts` + comments + events | BR-46, BR-59, BR-60, BR-42c/d, BR-65 | MED — D11 contract-churn | No `contracts` mutation before BR-46. UBO envelope stays a SEPARATE unpublished package (DD6=A). |
| catalog / skills / tool registry | BR-42b (done), BR-45, BR-70, BR-33, BR-15 | MED — ResourceProvider/authz + `accessMethods` touch the same seams | Land catalog authz/ResourceProvider shape (BR-45→BR-70) before running BR-33/BR-15 concurrently. |
| documents / storage (S3) | BR-16b/c, BR-17, BR-38a/b, BR-40b/c, BR-52, BR-62 | MED | BR-52 ArtifactStorePort first if storage semantics change; keep BR-38a / BR-40b separate. |
| auth / IdP | BR-39n/e, BR-53, BR-62, BR-63, BR-54 | MED | Treat BR-39n / BR-39e as EXPLICIT external IdP gate names, not generic "BR-39". |

## 6. External lanes (coordination, not local dispatch)

- BR-39n (auth token claim-set) → gates BR-53, BR-62. IdP repo / `apps/auth-idp`.
- BR-39e (auth multi-tenant memberships) → gates BR-63. IdP repo.
- Cowork backend tool-driving split (owner/branch TO CONFIRM) → BR-54.
- Graphify fusion `plan/34` Lot 0 (npm transfer-vs-republish fork) → BR-34 → BR-57.
- chat-ui host-tool open extension point (OpenERP/Diag `LocalToolName` finding) → BR-62, chat lane.
- h2a `claude:openerp` (DD3 UBO mapping incl. order→lines→invoice) → BR-50.

## 7. Owner decisions taken 2026-06-09 + open items

Decisions (post coherence audit):
- **Q1=A** chat-ui serialization: SINGLE chat-ui owner, strict order #257 →
  #272 → WP-CHAT B → BR-70viz → BR-62/BR-64. PLUS the owner wants a dedicated
  **h2a-roles + track-work-package pass** that WRAPS the branches (one WP per
  branch/cluster) to guarantee orchestration / prioritization / orthogonality
  — TO DO as soon as the track system is functional (see open items).
- **Q2=A** SPLIT BR-70 (core + viz) and BR-71 (5 sub-branches) — see §4.
- **Q3=B** initial dispatch = BR-44 (hardening) + BR-45/46/47/48 (Wave-1a
  studies), 5 lanes; Wave-1b (BR-49/50/51/52) next.
- **Q4=A** merge the 3 docs PRs #276 → #280 → #281.

Open items:
- **Track not yet functional**: the live sidecar is empty (harness BRANCH.md
  ingestion not run; harness CLI needs a Docker build). Making track
  functional is the GATE for the Q1 h2a-roles + track-WP wrapping pass. Until
  then this registry + PLAN are the interim source of truth.
- **h2a-roles + track-WP pass** (Q1): define h2a roles + one track work-package
  per branch/cluster wrapping the branches for orchestration/priority/
  orthogonality — gated on track functional.
- Migration calendar enforcement for `api/drizzle/*` across BR-44/60/59/61/65.
- #272 scope-violation (touches `ui/AppChatPanel.svelte` it forbids) — chat
  lane to fix/split before merge.
- **publish-auth-hono ENEEDAUTH** (post-PR #511): `provenance: true` ajouté dans #511
  a déclenché `publish-auth-hono` — échec `ENEEDAUTH` car OIDC trusted publisher non
  configuré sur npmjs.org pour les packages hors llm-mesh. Fix : configurer les trusted
  publishers npmjs.org pour tous les `@sentropic/*` publics, OU ajouter le guard
  `npm view` dans chaque `make publish-*`. `priority: high`
  Ref: [job 92427869469](https://github.com/rhanka/sentropic/actions/runs/31038964594/job/92427869469)
- **api/package-lock.json llm-mesh ref stale** (post-PR #511): enregistre `0.9.0`
  au lieu de `0.13.0`. Pas de régression fonctionnelle mais à corriger. `priority: low`
