# Chore: BR-42 Scale / build-app foundry (documentation umbrella)

## Objective
Register and document the "scale / build-app foundry" effort: give the ecosystem a **CLI for app
construction** (`sentropic-build-app`, **monorepo-resident** — add internal structure, no repo split)
and **isolate the modules** needed for multi-client / multi-cloud growth. This branch is
**documentation-only**: it adds this umbrella plan file, registers the BR-42a0..g lots in `PLAN.md`,
and records the module-isolation iteration in `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md §16`. No code.

The trust-model concepts (VALEUR / ATTENTION / INTÉRÊT / CONFIANCE / MUTUALISATION) are posed in
`rhanka/h2a` (EVO-9, owned by `claude:a2a-cli`) and **consumed** here — build-app is h2a's downstream
client. See `handover-h2a-trust-concepts.md` + `b2b2b-sentropic-eval.md`.

## Family scope (numbers + finalités)
- **BR-42a0 `feat/chat-server`** — *Purpose*: extract `@sentropic/chat-server` as the reusable
  wire+turn Hono package over `@sentropic/chat-core`, migrate the current `api/` onto it in
  `routes: 'app-contract'` mode, and prepare first publish. This is the D5 split prerequisite before the
  build-app CLI can generate runnable chat backends.
- **BR-42a1 `feat/build-app-cli`** — *Purpose*: ship the `sentropic-build-app` **CLI MVP (scaffolder)**:
  `init <name>` bootstraps a **runnable chat-ui↔backend app** (consuming `@sentropic/chat-ui` +
  `@sentropic/chat-server` + `chat-core` + `llm-mesh` + `design-system`) and **creates the GitHub repo**.
  First foundry surface; forces the **librarisation of templating / doc-gen**. Monorepo home
  (`packages/build-cli` + an app template package). Depends on the merged chat stack and the published
  `@sentropic/chat-server@0.1.x` package.
- **BR-42b `feat/catalog-agents-canvas`** — *Purpose*: **generalise the capability catalog** from
  `skills+tools` to **`skills+tools+agents+canvas`**, and open it to external `CatalogSource` kinds
  (**`mcp`**, **`google-marketplace`**). Extends BR-19 (skills) + BR-33 (marketplace); ties §14 agent
  templating + §10.3 canvas. (Catalog generalisation + Google `CatalogSource` are one thread.)
- **BR-42c `feat/comments-package`** — *Purpose*: extract dedicated **`@sentropic/comments`**
  (collaborative annotation over messages / canvas / artifacts): `CommentStore` port + wire events.
  The one genuinely-new module.
- **BR-42d `feat/persistence-comments-observability`** — *Purpose*: extend **persistence ports/adapters**
  for **comments + observability** (DB relation, §5/§12). Identities provided by BR-39.
- **BR-42e `feat/flow-queue-streaming`** — *Purpose*: extract the api Postgres queue into
  **`@sentropic/flow` `JobQueue`** for **streaming chat** (background tasks §10.4). Extends BR-32 (flow).
- **BR-43 `feat/llm-mesh-gcp`** (was BR-42f) — **moved to BR-43**: standalone `@sentropic/llm-mesh`
  **GCP provider** (`gcp` id; endpoint host `aiplatform.googleapis.com`), **streaming preserved**.
  **Renumbered OUT of BR-42 scale 2026-06-03** — a single LLM provider is not app-foundry work, so it is
  no longer a BR-42 lot. The scale-relevant Google piece stays here as the native multi-cloud secrets
  contract + observability + MCP/marketplace catalog (see §16 / BR-42b / BR-42g).
- **BR-42g `feat/events-bigquery-sink`** — *Purpose*: add a **BigQuery `EventSink`** adapter
  (**PG and/or BigQuery**, incl. **PG-via-BigQuery**) for observability storage.
- **BR-42h `feat/harness-followons`** — *Purpose*: the `@sentropic/harness` follow-ons handed to
  scale/`stp` (the BR-25 in-fine deliverable is DONE: `@sentropic/harness@0.1.1` shipped). Backlog
  in `plan/42h-BRANCH_feat-harness-followons.md`: D7 publish-federation register (GATED_D7 in
  BR-42i's manifest, ZERO rework), `stp scope check` router, harness method-verb layer
  (`harness brainstorm|test|debug|review --consensus|plan` + `branch|verify|init|audit`; native
  superpowers-surface replacement — **BR-42k dissolved into it**), genericity G1–G6, enforcement
  candidates C5/C7/C8/C10, BRANCH.md grammar conformance. Decision: `spec/SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md`.

## Orchestration Mode
- [x] **Multi-branch**: BR-42b..g are largely orthogonal package extensions and parallelisable; BR-42a1
  (the CLI) consumes them as they land.
- [ ] Mono-branch + cherry-pick
- Rationale: each lot extends a distinct package boundary (catalog, comments, persistence, flow, mesh,
  events); BR-42a0 is the prerequisite chat-server split, and the CLI (BR-42a1) is the integrator after
  chat-server is merged and published.

## Wave & Port Allocation (branch nn = 42)
- Slot ports: API `9000 + (42*5) + slot` = `9210..9214`; UI `5200 + (42*5) + slot` = `5410..5414`;
  Maildev UI `1100 + (42*5) + slot` = `1310..1314`.
- Per-lot slot/worktree/ports assigned at each lot launch (with its own `BRANCH.md`).
- Root dev/UAT stays on API `8787`, UI `5173`, Maildev `1080` (reserved for user).

## Dependency graph
- **BR-39** (auth-ui/auth-hono, **in flight via `codex:39-auth`**) → provides **identities**; BR-42d depends on it.
- **BR-42a0** → depends on the merged chat stack (`@sentropic/chat-ui` + `chat-core` + `llm-mesh`) and
  publishes `@sentropic/chat-server`.
- **BR-42a1** → depends on BR-42a0 (`@sentropic/chat-server@0.1.x`) + a template package.
- **BR-42b** → extends BR-19 (`@sentropic/skills`) + BR-33 (`@sentropic/marketplace`).
- **BR-42c** → contracts + persistence + events (new package).
- **BR-42d** → BR-42c (comments) + `@sentropic/events` (observability) + BR-39 (identities).
- **BR-42e** → extends BR-32 (`@sentropic/flow`).
- **BR-42g** → independent additive `EventSink` (events). (BR-42f's GCP provider **moved to BR-43**,
  `feat/llm-mesh-gcp` — no longer a BR-42 scale lot.)

## Deferred (out of BR-42)
- **`k8s-ops` → PaaS** hosting/FinOps substrate (multi-cloud / multi-k8s / multi-client / multi-app),
  likely `paas.sent-tech.ca`, **+ a clean `sentropic`↔`k8s-ops` contract** (provider→customer boundary,
  co-design with the build-app deploy flow). Coordinate with the live `claude:poc-k8s`. See §16.5.
- **Multi-tenant managed h2a MCP service + BYO-h2a** (the "central sentropic instance").
- **Multi-cloud GitOps deploy substrate** (scw→gcp→aws/azure/ovh; k8s bare + openshift).

## Branch Scope Boundaries (this chore branch)
- **Allowed Paths**:
  - `plan/42-BRANCH_chore-scale-build-app.md`
  - `PLAN.md`
  - `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, any `api/**`, `ui/**`,
  `packages/**`, `e2e/**`, other `plan/NN-BRANCH_*.md`.
- No code, no migration, no test changes in this branch.

## Feedback Loop (open framing questions — to resolve before/within implementation)
- **BR42a1-Q1** `attention`: CLI home — `packages/build-cli` (default) vs top-level `cli/`; app-template
  package name. To resolve at BR-42a1 Lot 0.
- **BR42a1-Q2** `attention`: CLI **binary name** — `sentropic-build-app` vs `sentropic init` vs
  `create-sentropic-app`. Durable name → **user validation required** before merge.
- **BR42b-Q1** `attention`: catalog generalisation home — extend `@sentropic/skills` catalog (default,
  `SkillSource`→`CatalogSource`) vs a new `@sentropic/catalog`.
- **BR42d-Q1** `attention`: default observability sink (PG vs BigQuery vs both) per workspace.
- **BR42-Q1** `attention`: first wave selection — BR-42a1 (MVP) + BR-42g (independent) in parallel?
  (The GCP provider question — `gcp` auth mapping in `llm-mesh` credentials: ADC / service-account /
  workload-identity — **moved to BR-43**, `feat/llm-mesh-gcp`; no longer a BR-42 lot.)

## Closure
- [x] Module-isolation iteration recorded in `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md §16`.
- [x] Umbrella plan file added (`plan/42-BRANCH_chore-scale-build-app.md`).
- [x] `PLAN.md` updated (status addendum + pending list).
- [x] BR-42a0 split recorded and launched (`feat/chat-server`, PR #201, UAT OK; merged; `@sentropic/chat-server@0.1.0` bootstrap-published; Trusted Publisher attachment pending).
- [ ] Per-lot `BRANCH.md` (from `plan/BRANCH_TEMPLATE.md`) created at each future lot launch.
- [ ] User validation of durable names (CLI binary, package names) before any lot merge.
