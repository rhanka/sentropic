# Feature: BR-42f LLM-Mesh Vertex AI Provider (`@sentropic/llm-mesh@0.2.0` + `api/` Vertex runtime)

## Objective
> **Provider id renamed `vertex` → `gcp` (user decision 2026-06-02, "Vertex AI" brand retired May 2026; `gcp` is brand-resilient + covers Model Garden's multi-publisher endpoint). Endpoint host stays `aiplatform.googleapis.com`.** Operative references below (provider id `gcp`, catalog ids `@gcp`, env vars `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION`/`GCP_LIVE_UAT`, make target `gcp-live-uat`, files `gcp-provider.ts`/`gcp-live-uat.ts`) reflect the rename; the deeper rationale prose still says "Vertex" and is kept for the record. The branch label and this plan filename keep `vertex-ai`.

Add a `gcp` provider so the Sentropic runtime calls Gemini models served by Google Cloud (Vertex AI / Model
Garden, `{region}-aiplatform.googleapis.com`, OAuth/ADC bearer) IN ADDITION to the existing AI-Studio `gemini`
provider, with ZERO regression on the 5 existing providers and ZERO legacy (no dual path). Provider-level
streaming is preserved as provider events (`content_delta`/`reasoning_delta`/`tool_call_start`), never
session/chat-lifecycle events. RESOLVED decisions are baked in (see `## Feedback Loop`): provider id
`gcp`; ADC bearer minted server-side in `api/` BEFORE mesh dispatch and forwarded as a non-`none` auth
material that passes the mesh `validateAuth` gate; reuse the Gemini body-builder + SSE→event mapper;
catalog ids are globally-unique gcp-qualified `{publisher}/{model}@gcp` keys.

## Scope / Guardrails
- Scope limited to: the `packages/llm-mesh/src/**` contract change (provider id + catalog + adapter + version
  bump), and the `api/**` Vertex runtime + registry + dispatch + env wiring under the granted `BR42f-EX1`.
- No `api/drizzle/*.sql` migration (the Vertex provider adds no DB schema; auth is ADC, not a stored key).
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-llm-mesh-vertex-ai`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification worktree must be commit-identical to the branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- `@sentropic/llm-mesh` MUST stay HTTP-free / dependency-light: NO `google-auth-library`, NO `fetch`, NO
  Google endpoint in `packages/llm-mesh/src/**`. ADC minting lives in `api/` only.
- No live Vertex calls in CI: live calls are gated by an explicit sentinel env (`VERTEX_LIVE_UAT=1`), never
  set in CI; UAT runs against a real GCP project on a branch stack only.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope, no exception)**:
  - `packages/llm-mesh/src/providers.ts` (add `'vertex'` id + vertex catalog-key strings to the closed unions)
  - `packages/llm-mesh/src/catalog.ts` (add `vertex` `providerProfiles` row + Vertex `modelProfiles` entries)
  - `packages/llm-mesh/src/adapters.ts` (add `VertexAdapter` + `VertexAdapterClient` + the `vertex` wiring row)
  - `packages/llm-mesh/package.json` (version bump `0.1.3 → 0.2.0`)
  - `packages/llm-mesh/tests/**` (facade/catalog vertex assertions)
  - `spec/SPEC_EVOL_LLM_MESH_VERTEX.md` (this branch's spec, docs consolidation)
  - `plan/42f-BRANCH_feat-llm-mesh-vertex-ai.md` (this file)
- **Conditional Paths (allowed ONLY under `BR42f-EX1`, GRANTED — see `## Feedback Loop`)**:
  - `api/src/services/providers/vertex-provider.ts` — NEW `VertexProviderRuntime`
  - `api/src/services/provider-registry.ts` — register `['vertex', new VertexProviderRuntime()]` (5 → 6)
  - `api/src/services/llm-runtime/index.ts` — add `selection.providerId === 'vertex'` branch in BOTH `generate`
    (~line 889) and `stream` (~line 1199), reusing `buildGeminiRequestBody` (line 414) + the Gemini SSE loop
  - `api/src/services/llm-runtime/mesh-dispatch.ts` — TWO edits (`getEnvironmentVariableName` vertex arm +
    explicit fallthrough at lines 202-207; `createDefaultProviderAdapters` vertex client at lines 308-313;
    `toMeshAuthInput` vertex branch returning a non-`none` material near line 210-242)
  - `api/src/services/provider-credentials.ts` — document the legitimate `none` for `vertex`
    (`getEnvironmentCredential` lines 26-32 already return `null`; no behavioural change, possibly a comment)
  - `api/src/services/model-catalog.ts` — home of the §C global-uniqueness invariant (`inferProviderFromModelId`
    null-on-collision); add a collision guard/test (no structural change required)
  - `api/src/config/env.ts` — add `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` (and `VERTEX_LIVE_UAT`) as
    `z.string().optional()`; `GOOGLE_APPLICATION_CREDENTIALS` if not already ambient
  - `api/src/routes/api/me.ts` (line 80) — add `'vertex'` to the `defaultProviderId` `z.enum`
  - `api/src/routes/api/ai-settings.ts` (line 25) — add `'vertex'` to the `defaultProviderId` `z.enum`
  - `api/tests/unit/**` — the breaking-test edits + new Vertex unit tests (see Lots 1, 3, 4)
  - `api/tests/api/models.test.ts` (M1) — exact-count API assertion at line 52 (`toHaveLength(11)` →
    `11 + N`) + a new `modelsByProvider('vertex')` exact-array assertion (see Lot 4)
  - `api/src/scripts/vertex-live-uat.ts` (M3) — NEW dedicated live-UAT node script (sanitized output;
    convention dir verified: `api/src/scripts/` already hosts `oauth-rotate-keys.ts`, `db-migrate.ts`, …)
  - `api/package.json` — only if `google-auth-library` is added as an api-only dep (preferred: thin
    metadata-server path, no dep; decide in Lot 3)
  - `api/package-lock.json` + root `package-lock.json` (M6) — ONLY if a dep is added; regenerated via
    `make lock-api` / `make lock-root` and committed alongside `api/package.json` (both locks are part of
    the `API_VERSION` content hash — `Makefile:34` — so a stale lock breaks the version/cache lane)
  - `.gitignore` (M3) — add the gitignored service-account key path used by `make vertex-live-uat`
    (NO credential is ever committed)
  - `Makefile` (M3) — NEW `vertex-live-uat` target (`docker cp` gitignored SA key into the `api` container +
    `docker compose exec api` of `vertex-live-uat.ts` with `VERTEX_PROJECT_ID`/`VERTEX_LOCATION`/
    `GOOGLE_APPLICATION_CREDENTIALS`/`VERTEX_LIVE_UAT=1` injected INLINE on that exec — fresh process; the
    `llm-mesh` publish lane already exists, so no publish-lane Makefile edit; see Lot 5)
  - `.github/workflows/ci.yml` — ONLY if a filter/enum change proves necessary (lane + api filter already
    cover `packages/llm-mesh/**`; see Lot 5)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml` (M3 — explicitly NOT in EX1; arbitrary `.env` keys do not reach the running API
    container — verified `docker-compose.yml:9-38` whitelist — so UAT is the make-only `vertex-live-uat`
    path, NOT a compose env edit)
  - `.cursor/rules/**`
  - `ui/**` (M5 — Vertex is intentionally NOT browser-selectable in this lot; three selectors hardcode-reject
    `vertex`: `ui/src/routes/settings/+page.svelte:161`, `ui/src/lib/components/chat/AppChatPanel.svelte:4167`,
    `ui/src/routes/folder/new/+page.svelte:122`; UI exposure DEFERRED to BR-42b/later; UAT proves the live
    call at the api/mesh layer, not the browser selector)
  - `api/drizzle/*.sql` (no migration)
  - `api/src/services/provider-connections.ts` (admin BYOK connections panel — Vertex is ADC/config-driven,
    NOT an admin-entered key; explicitly DEFERRED, see `## Deferred`)
  - any `api/**` not enumerated under Conditional above
  - `packages/llm-mesh/src/auth.ts` + `adapter-auth.ts` (the `gcp-adc` material is DEFERRED under the
    resolved Option A; touching them is out of scope)
  - other `plan/NN-BRANCH_*.md` (except this file)
- **Exception process**:
  - `BR42f-EX1` declared in `## Feedback Loop` (GRANTED by user) covers every `api/**` Conditional path above.
  - Any further conditional/forbidden touch needs a new `BR42f-EXn` with reason + impact + rollback.

## Feedback Loop
Actions with the following status should be included around tasks only if really required.
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

- **BR42f-D1 (provider identity)** `acknowledge` — RESOLVED Option A: durable provider id = **`vertex`**
  (top-level, single-token, mirrors `openai/gemini/...`). `ProviderFamily` stays `'google'` (already present).
  Do NOT reopen. Leaks into env vars, `ProviderId` union (`providers.ts:1` → `provider-runtime.ts` re-export),
  catalog, `api/` registry, the two route zod enums (`me.ts:80`, `ai-settings.ts:25`), UI selectors.
- **BR42f-D2 (auth model + §B ordering + M2 forward-path)** `acknowledge` — RESOLVED Option A now / Option B
  (`gcp-adc` material) DEFERRED. The ADC bearer is **minted PRE-DISPATCH** (in `toMeshAuthInput`, via the
  `VertexProviderRuntime` ADC helper + D-ADC1 cache/single-flight) and carried as a **`direct-token`** holding
  the concrete short-lived bearer. This single shape (a) passes `mesh.ts prepare()` → `adapter.validateAuth`
  which throws `!ok` BEFORE the adapter runs (verified `mesh.ts:124-130`), AND (b) flows through the existing
  actual-token forward path: `extractCredential` returns `material.token` for `direct-token` (verified
  `mesh-dispatch.ts:248`) and `buildProviderRuntimeRequest` forwards it as `runtimeRequest.credential`
  (verified `mesh-dispatch.ts:263-270`). **The envVar-only `environment-token` shape is REJECTED as the
  carrier** (M2): it passes `validateAdapterAuthSource` (verified `adapter-auth.ts:32-36`) yet `extractCredential`
  returns `undefined` for an envVar-only descriptor (verified `mesh-dispatch.ts:250`), so the bearer would
  never reach `VertexProviderRuntime`. The minted bearer MUST NOT be logged (D-ADC1). The string credential
  resolver is BYPASSED for `vertex` (`resolveProviderCredential('vertex')` legitimately returns `none`).
- **BR42f-D3 (initial catalog + GCP project/region)** `acknowledge`/`attendu` — RESOLVED shape: minimal
  Gemini-on-Vertex pair (`*-flash` + `*-flash-lite` class), one user-chosen region, opt-in only (no
  `defaultTaskHints`/default-routing change), expressed as globally-unique `google/<model>@vertex` catalog
  keys. The concrete `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` + exact live-callable wire ids are the SINGLE
  deferred user input — `attendu` at UAT (the catalog ships configurable/placeholder vertex-qualified ids +
  env-driven project/location; live confirmation is a UAT step before merge).
- **BR42f-D4 (code reuse)** `acknowledge` — RESOLVED REUSE: `buildGeminiRequestBody` (index.ts:414) + the
  Gemini SSE→event loop (index.ts ~1199-1322) are 100% reusable (identical Gemini payload; only URL + auth
  header differ). A shared SSE-loop helper may be extracted, but ONLY inside `api/src/services/llm-runtime`
  (never moved into the package).
- **BR42f-EX1 (cross-package scope exception)** `acknowledge` — **GRANTED** (user authorized BR-42f). The
  `api/**` file list under Conditional Paths is authorized; the branch is infeasible without it (the package
  is transport-less — verified zero `fetch`/`https`/`googleapis`/SSE in `packages/llm-mesh/src/**`). Impact:
  1 new `api/` runtime file (`vertex-provider.ts`) + ~8 edited `api/` service/route files + 1 env triple +
  package union/catalog/adapter edits + `0.1.3 → 0.2.0` bump, PLUS (post-review): `api/tests/api/models.test.ts`
  exact-count edit (M1); new `api/src/scripts/vertex-live-uat.ts` + new `Makefile` `vertex-live-uat` target +
  `.gitignore` SA-key entry (M3); `api/package.json` + `api/package-lock.json` + root `package-lock.json`
  ONLY if `google-auth-library` is added (M6). **`docker-compose*.yml` is NOT in EX1** (M3 — UAT is make-only)
  and **`ui/**` is NOT in EX1** (M5 — UI exposure deferred). Rollback: revert the registry registration +
  dispatch branch + catalog rows → `vertex` becomes undeclared, 5 existing providers unchanged
  (characterization-proved, Lot 1).
- **BR42f-D5 (provider-connections.ts)** `acknowledge` — `provider-connections.ts` (admin BYOK panel) is OUT
  of BR-42f (Vertex is ADC/config-driven, not an admin-entered key). Recorded in `## Deferred`.
- **D-ADC1 (token cache)** `acknowledge` — cache key `{project}+{location}+{scope=cloud-platform}`; refresh at
  `now >= expiry - 60s`; single-flight per-key promise; mint failure NOT cached and surfaced via D-ERR1;
  NO token/SA-JSON logging (log `{project,location}` only).
- **D-ADC2 (sync `ready`)** `acknowledge` — `validateCredential()` is SYNC (verified `gemini-provider.ts`):
  `ready` derives statically from config presence (`VERTEX_PROJECT_ID` + `VERTEX_LOCATION` set), never an
  async network mint; first real mint is lazy on the first `generate`/`streamGenerate`.
- **D-ERR1 (error mapping)** `acknowledge` — map Vertex `google.rpc.Status` by HTTP status: `401`/`403`/`404`
  non-retryable, `429`/`5xx` retryable (mirrors `gemini-provider.ts normalizeError`); surface the
  `status` enum string (`RESOURCE_EXHAUSTED`/`PERMISSION_DENIED`/`NOT_FOUND`/`UNAUTHENTICATED`) as `code`.
- **§C (global-unique ids)** `acknowledge` — Vertex catalog `modelId`s MUST be globally unique vs all other
  providers (`inferProviderFromModelId` returns `null` on >1 match → silent mis-route). Catalog key form
  `{publisher}/{model}@vertex`; the runtime strips it to `{publisher}` + wire `{model}` for the URL.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature
    here; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- All CI Vertex tests run against a MOCKED endpoint + STUBBED ADC token (deterministic) and MUST NOT be flaky;
  any nondeterminism there is a bug, never an allowlisted flake. Live Vertex calls are UAT-only, sentinel-gated.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single feature branch `feat/llm-mesh-vertex-ai`, internal lots 0..5;
      one final test cycle)
- [ ] **Multi-branch**
- Rationale: the lots are sequentially coupled — characterization (Lot 1) must lock the 5 providers' behaviour
  BEFORE `vertex` enters the catalog (Lot 2); the package union/catalog must exist BEFORE the `api/` runtime
  reuses it and the breaking tests are updated (Lots 3-4); the publish lane already exists so only the version
  bump publishes (Lot 5). One branch = one CI cycle, no version-sync churn. Sub-agents may take orthogonal
  sub-lots in slots 0..4, integrated on this branch.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch after Lot 4, gated by the `VERTEX_LIVE_UAT=1`
  sentinel (BR42f-D3 live-id confirmation — the single deferred user input).
- UAT checkpoints listed as checkboxes inside Lot 4 (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run mocked/stubbed tests in `tmp/feat-llm-mesh-vertex-ai`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`) on a BRANCH stack (`ENV=feat-*` /
    `ENV=test-*` with the slot ports below + `VERTEX_PROJECT_ID`/`VERTEX_LOCATION`/ADC/`VERTEX_LIVE_UAT=1`
    in `.env`), NEVER `ENV=dev`, NEVER the root ports 8787/5173/1080.
  - Switch back to `tmp/feat-llm-mesh-vertex-ai` after UAT.

## Wave & Port Allocation (branch nn = 42, slot 0)
- Slot ports: API `9000 + (42*5) + slot` = `9210..9214`; UI `5200 + (42*5) + slot` = `5410..5414`;
  Maildev UI `1100 + (42*5) + slot` = `1310..1314`.
- Slot 0 (default lot owner): `API_PORT=9210`, `UI_PORT=5410`, `MAILDEV_UI_PORT=1310`, `ENV=feat-llm-mesh-vertex-ai`.
- Before launching any sub-agent: `make ps-all` to verify no port conflict.
- Root dev/UAT stays on API `8787`, UI `5173`, Maildev `1080` (reserved for user).

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline, scoping, EX1 declaration & skeleton (confirm the 5-provider baseline)**
  - [ ] Verify branch: `git -C tmp/feat-llm-mesh-vertex-ai branch --show-current` = `feat/llm-mesh-vertex-ai`.
  - [ ] Create/confirm isolated worktree `tmp/feat-llm-mesh-vertex-ai` from `main`; copy `.env`, override
        `ENV=feat-llm-mesh-vertex-ai` + slot-0 ports (9210/5410/1310).
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`,
        `rules/security.md`, `PLAN.md`, `spec/SPEC_EVOL_LLM_MESH_VERTEX.md` (FULLY), sibling
        `spec/SPEC_EVOL_LLM_MESH.md`/`SPEC_EVOL_MODEL_PROVIDERS_RUNTIME.md`/`SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`,
        `plan/BRANCH_TEMPLATE.md`, and `plan/42a0-BRANCH_feat-chat-server.md` (the characterization-discipline
        reference).
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Validate scope boundaries; record `BR42f-EX1` (GRANTED) in `## Feedback Loop`.
  - [ ] Confirm the resolved decisions are baked (D1 `vertex`, D2 ADC mint-before-dispatch, D3 vertex-qualified
        ids + env-driven project/location, D4 REUSE, §C uniqueness, D-ADC1/2, D-ERR1) — do NOT reopen.
  - [ ] Confirm the 5-provider baseline: `providers.ts:1` = `['openai','gemini','anthropic','mistral','cohere']`;
        `provider-registry.ts:12-18` instantiates 5 runtimes; `mesh-dispatch.ts:308-313` wires 5 clients;
        the two route enums (`me.ts:80`, `ai-settings.ts:25`) list 5 ids.
  - [ ] Confirm the `llm-mesh` publish lane already exists (Makefile `typecheck/build/pack/publish-llm-mesh`;
        ci.yml `validate-llm-mesh` + `publish-llm-mesh` OIDC + `llm_mesh_publish` filter; the `api` path filter
        at `ci.yml:135` already includes `packages/llm-mesh/**`) → Lot 5 needs only the version bump to publish.

- [ ] **Lot 1 — CHARACTERIZATION FIRST (lock the 5 existing providers' generate+stream behaviour)**
  - [ ] Add `api/tests/unit/provider-characterization.test.ts` (BR-42a0 discipline) snapshotting, on baseline
        behaviour BEFORE `vertex` exists: for each of the 5 providers — the registry `listModels()` rows
        (label / reasoningTier / capabilities), `inferProviderFromModelId` for each catalog id, and a
        representative `generate`/`stream` event sequence (the regression oracle). Assert verbatim.
  - [ ] Inventory the existing non-regression set: `provider-mesh-contract-proof.test.ts`,
        `provider-registry-expansion.test.ts`, `llm-runtime-stream.test.ts` (STREAM_TEST_MATRIX strict-equality
        gate at line 857), `gemini-provider-sse.test.ts`, `provider-credentials.test.ts`, and the package
        `facade.test.ts`/`auth.test.ts`/`tools.test.ts` — record exact file list as the gate set.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-llm-mesh-vertex-ai` + `make lint-api ENV=test-llm-mesh-vertex-ai`
    - [ ] Sub-lot gate: `make test-api SCOPE=tests/unit/provider-characterization.test.ts ENV=test-llm-mesh-vertex-ai`
          (characterization green on baseline; this is the rollback-property oracle for EX1).

- [ ] **Lot 2 — Package edits (`@sentropic/llm-mesh@0.2.0`: unions + VertexAdapter + version bump)**
  - [ ] `packages/llm-mesh/src/providers.ts`: add `'vertex'` to `providerIds` (line 1); add the Vertex catalog
        keys (`google/<model>@vertex` — placeholder/configurable per D3) to the closed `knownModelIds` union
        (lines 13-27); add a `vertex` entry to `knownModelIdsByProvider` (line 33-39, `satisfies
        Record<ProviderId,...>` FORCES it). `ProviderFamily` (line 7) already has `'google'` — no change.
  - [ ] `packages/llm-mesh/src/catalog.ts`: add a `vertex` row to `providerProfiles` (line 132-186, forced by
        `satisfies Record<ProviderId,ProviderDescriptor>`, mirroring the `gemini` profile); add the Vertex
        `ModelProfile` rows to `modelProfiles` (from line 226) via `modelCapabilities('vertex', ...)` reusing
        the Gemini capability template (vision, `json-schema-subset`, `stringEnumsOnly`,
        `geminiUnsupportedJsonSchemaKeywords`, advanced/standard reasoning); `modelId` must be in the
        `providers.ts` union (§C key form).
  - [ ] `packages/llm-mesh/src/adapters.ts`: add `interface VertexAdapterClient extends ProviderAdapterClient`;
        `class VertexAdapter extends BaseProviderAdapter<VertexAdapterClient>`; a `vertex?: VertexAdapterClient`
        field in `DefaultProviderAdapterClients` (lines 50-55); and the `new VertexAdapter({ client:
        clients.vertex })` row in `createDefaultProviderAdapters` (from line 58).
  - [ ] `packages/llm-mesh/package.json`: bump `version` `0.1.3 → 0.2.0` (additive provider id + catalog =
        minor).
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh ENV=test-llm-mesh-vertex-ai`
    - [ ] **Package tests** (`packages/llm-mesh/tests/`):
      - [ ] `facade.test.ts` — extend provider/model listing assertions to include `vertex`; assert
            `getModelProfile('vertex', '<google/...@vertex>')` resolves and vertex reasoning-capable models are
            not `unsupported`. (inject a fake `ProviderAdapter`/client — no network.)
      - [ ] `auth.test.ts` — UNCHANGED (Option B `gcp-adc` material is DEFERRED; no new auth union member).
      - [ ] `tools.test.ts` — UNCHANGED unless a tool assertion enumerates providers.
      - [ ] Sub-lot gate: `make test-llm-mesh ENV=test-llm-mesh-vertex-ai`.
    - [ ] `make build-llm-mesh ENV=test-llm-mesh-vertex-ai` + `make pack-llm-mesh ENV=test-llm-mesh-vertex-ai`.

- [ ] **Lot 3 — `api/` Vertex runtime (reuse Gemini body+SSE; registry + dispatch + env + ADC mint)**
  - [ ] NEW `api/src/services/providers/vertex-provider.ts` (`VertexProviderRuntime`): URL builder
        `{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/{publisher}/models/{model}:{generateContent|streamGenerateContent}?alt=sse`;
        `Authorization: Bearer <ADC>` header (NO `?key=`); reuse `requestSse`/`readSse` byte-parsing semantics
        from `gemini-provider.ts`; SYNC `validateCredential` per D-ADC2 (`ready` = config presence);
        `normalizeError` per D-ERR1; an ADC token cache/refresh helper per D-ADC1 (cache key
        `{project}+{location}+cloud-platform`, 60s skew, single-flight, no-token-logging). Token sourcing:
        prefer a thin `fetch` against the GCE/GKE metadata server (`http://metadata.google.internal/.../token`)
        for k8s/workload-identity + a small SA-JSON path; add `google-auth-library` as an api-only dep
        (`make install-api google-auth-library`) ONLY if SA-JSON/local-dev ergonomics require it.
  - [ ] **M6 — lockfile step (only if a dep is added):** after `make install-api google-auth-library`, run
        `make lock-api ENV=test-llm-mesh-vertex-ai` (and `make lock-root ENV=test-llm-mesh-vertex-ai` if the
        workspace-root install touches it — verified targets `Makefile:420`/`Makefile:425`), then commit the
        regenerated `api/package-lock.json` (+ root `package-lock.json`) ALONGSIDE `api/package.json` in the
        SAME commit. Both locks feed the `API_VERSION` content hash (`Makefile:34`) — a stale lock breaks the
        version/cache lane and CI. `google-auth-library` is absent from both locks today (verified).
  - [ ] `api/src/services/provider-registry.ts`: import `VertexProviderRuntime`; instantiate
        `const vertex = new VertexProviderRuntime();` and add `['vertex', vertex]` to the `Map` (lines 12-18,
        5 → 6).
  - [ ] `api/src/services/llm-runtime/index.ts`: add a `selection.providerId === 'vertex'` branch in BOTH
        `generate` (~line 889, mirroring the gemini branch) and `stream` (~line 1199, reusing the Gemini
        SSE→event loop incl. the `finishReason !== 'FINISH_REASON_UNSPECIFIED'` break at line 1295), reusing
        `buildGeminiRequestBody` (line 414) VERBATIM; `runtimeRequest.mode` = a vertex mode (e.g.
        `'vertex-stream-generate-content'`) carrying `{project, location, publisher, model, body}` so the
        runtime builds URL+auth. Optionally extract the shared SSE loop into a small helper IN this dir only.
  - [ ] **M4 — parameterize the hardcoded Gemini SSE literals in the shared loop** (verified anchors): the
        Vertex branch reuses the same loop, so derive the prefixes/provider_id from the ACTIVE provider id
        (`gemini_`/`gemini_call_`/`'gemini'` for gemini; `vertex_`/`vertex_call_`/`'vertex'` for vertex):
        `index.ts:921` response `id: \`gemini_${createId()}\`` (generate branch); `index.ts:1200`
        `responseId = ... \`gemini_${createId()}\`` (stream branch); `index.ts:1281` toolCallId
        `\`gemini_call_${toolCallIndex}\``; `index.ts:1305` status `provider_id: 'gemini'`. A Vertex
        response/stream MUST be attributed to `vertex`, not `gemini`. (Tests for this attribution land in Lot 4.)
  - [ ] `api/src/services/llm-runtime/mesh-dispatch.ts` — THREE edits: (1) `getEnvironmentVariableName`
        (lines 202-208) — add a `vertex` arm (`'VERTEX_ADC'`) and make the fallthrough explicit/safe (today it
        `return 'COHERE_API_KEY'` for unknown ids at line 207 — a vertex request would mis-name Cohere's env
        var); (2) `createDefaultProviderAdapters({ ... vertex: applicationProviderClient })` (lines 308-314,
        wire the 6th client); (3) `toMeshAuthInput` (lines 210-243) gains the §B/M2 vertex branch that **mints
        the ADC bearer PRE-DISPATCH** (via the `VertexProviderRuntime` ADC helper + D-ADC1 cache/single-flight)
        and returns a **`direct-token`** holding the concrete short-lived bearer (`{ type:'direct-token',
        token:<minted ADC bearer>, label:'vertex adc' }`) — NOT an envVar-only `environment-token` (M2: that
        passes `validateAuth` but `extractCredential` at line 250 returns `undefined` for it, so the bearer
        would never reach the runtime). The `direct-token` both passes `adapter.validateAuth` and forwards via
        `extractCredential`→`buildProviderRuntimeRequest` (lines 248, 263-270). A request-override bearer takes
        precedence as a `direct-token`. The minted bearer MUST NOT be logged. NOTE: minting is async ⇒ run the
        vertex auth resolution in the async dispatch path before `buildMeshRequest` (line 335, already async).
  - [ ] `api/src/services/provider-credentials.ts`: `getEnvironmentCredential` (lines 26-32) already returns
        `null` for `vertex` ⇒ `source:'none'`. BYPASS the string resolver for vertex (auth is ADC-minted, not
        a stored string); add a clarifying comment that `resolveProviderCredential('vertex')` legitimately
        returns `none`. No behavioural change.
  - [ ] `api/src/services/model-catalog.ts`: no structural change; add the §C global-uniqueness guard/test
        home (assert no Vertex catalog id equals a Gemini/other id; `inferProviderFromModelId` stays
        single-match).
  - [ ] `api/src/config/env.ts`: add `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_LIVE_UAT` (all
        `z.string().optional()`, after `GEMINI_API_KEY` at line 12); add `GOOGLE_APPLICATION_CREDENTIALS` if
        not already ambient.
  - [ ] `api/src/routes/api/me.ts` (line 80) + `api/src/routes/api/ai-settings.ts` (line 25): add `'vertex'`
        to the `defaultProviderId` `z.enum(['openai','gemini','anthropic','mistral','cohere'])` so selecting/
        persisting `vertex` as default is coherent (the inference path can produce `provider_id:'vertex'`).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-llm-mesh-vertex-ai` + `make lint-api ENV=test-llm-mesh-vertex-ai`
    - [ ] (tests added in Lot 4; Lot 3 ends on typecheck/lint green only — no live calls.)

- [ ] **Lot 4 — Tests (mocked Vertex + stubbed ADC) + the BREAKING non-reg edits**
  - [ ] NEW `api/tests/unit/vertex-provider.test.ts` (mocked `fetch` Vertex endpoint + stubbed ADC token):
    - [ ] request URL =
          `{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{wire-id}:streamGenerateContent?alt=sse`.
    - [ ] `Authorization: Bearer <stub>` header present and NO `?key=` anywhere in the URL.
    - [ ] request body equals `buildGeminiRequestBody(...)` output (the REUSE proof).
    - [ ] SSE chunk fixtures map to the SAME `content_delta`/`reasoning_delta`/`tool_call_start` events as the
          Gemini matrix (region/publisher/model URL segments + SSE delta reuse).
    - [ ] error mapping per D-ERR1: `401`/`403`/`404` non-retryable, `429`/`5xx` retryable.
    - [ ] D-ADC1 token cache/single-flight/skew with a fake clock + stub mint (negative results not cached;
          no token logged).
    - [ ] mesh-gate proof (§B/M2): `resolveProviderCredential('vertex')` returns `source:'none'`, `toMeshAuthInput`
          for `vertex` returns a `direct-token` carrying the minted bearer (NOT an envVar-only `environment-token`),
          and `extractCredential` forwards that token to the runtime (proving the bearer actually reaches the
          wire call). The bearer never appears in any log line.
    - [ ] **M4 — provider attribution**: a Vertex response/stream is attributed to `vertex`, not `gemini` —
          response `id` starts `vertex_` (not `gemini_`), tool-call ids start `vertex_call_`, and the status
          event carries `provider_id: 'vertex'` (proves the `index.ts:921/1200/1281/1305` literals were
          parameterized by provider). Add a sibling assertion in the Gemini test that gemini stays `gemini_`.
  - [ ] **BREAKING non-reg edits (MUST land in this lot, verified to break the instant `vertex` enters the
        catalog/registry):**
    - [ ] **M1** — `api/tests/api/models.test.ts` (verified `models.test.ts:47-52`): line 52
          `expect(data.models).toHaveLength(11)` → `11 + N` (N = number of Vertex catalog entries added in
          Lot 2; current `11` = openai 3 + gemini 2 + anthropic 2 + mistral 2 + cohere 2); add
          `expect(modelsByProvider('vertex')).toEqual([<sorted Lot-2 vertex catalog keys>])` mirroring lines
          47-51, listing the EXACT Vertex `google/<model>@vertex` ids added in Lot 2 (UAT-confirmed at the D3
          step). Lines 47-51 (the other 5 per-provider arrays) stay byte-identical. NOTE: the sibling
          `generic-dispatch.test.ts:288` `toHaveLength(5)` is unrelated TASK cardinality — do NOT touch it.
    - [ ] `api/tests/unit/provider-mesh-contract-proof.test.ts`: line 13 `toHaveLength(5)` → `6`; extend the
          `arrayContaining([...])` at line 11 with `'vertex'`; the "keeps package model profiles aligned" block
          (lines ~18-43) requires the Vertex rows present in BOTH the package `catalog.ts` AND the `api/`
          runtime catalog with MATCHING `label`/`reasoningTier`/capabilities.
    - [ ] `api/tests/unit/provider-registry-expansion.test.ts`: line 16 `toHaveLength(5)` → `6` + add
          `expect(ids).toContain('vertex')`; line 23 `toHaveLength(5)` → `6`; extend the `providerIds`
          `arrayContaining` at lines 20-22 and the "list models / capabilities per provider" assertions with
          `vertex`. (The `for (const id of providerIds)` resolve loops auto-cover vertex once registered.)
    - [ ] `api/tests/unit/llm-runtime-stream.test.ts`: the STRICT-EQUALITY gate at line 857
          (`[...matrixByKey.keys()].sort()` EQUALS the full catalog `providerId:modelId` list at line 858)
          FORCES a matching `STREAM_TEST_MATRIX` fixture row (from line 107) per Vertex model — add content +
          reasoning + tool fixtures per Vertex model. THE single most important non-regression edit.
    - [ ] `api/tests/unit/gemini-provider-sse.test.ts`: add a SIBLING Vertex SSE assertion (or a new
          `vertex-provider-sse.test.ts`) proving the Vertex runtime parses the IDENTICAL Gemini SSE envelope.
    - [ ] `api/tests/unit/provider-credentials.test.ts`: add a case asserting `resolveProviderCredential('vertex')`
          returns `source:'none'` and leaks no string credential.
  - [ ] **GATES to keep GREEN (must not regress):** the all-model STREAM_TEST_MATRIX (post-fixture-add), the
        Gemini SSE test (incl. gemini still attributed `gemini_` — M4), the credentials/connection tests, the
        `api/tests/api/models.test.ts` catalog endpoint (post-M1-count-edit), and the package
        `facade.test.ts`/`auth.test.ts`.
  - [ ] **Characterization proof**: re-run `provider-characterization.test.ts` AFTER `vertex` is added and
        assert the 5 existing providers' outputs are byte-identical (no label/tier/capability/dispatch drift)
        — this PROVES the EX1 rollback property.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-llm-mesh-vertex-ai` + `make lint-api ENV=test-llm-mesh-vertex-ai`
    - [ ] Sub-lot gate: `make test-api ENV=test-llm-mesh-vertex-ai` (all API unit/integration green, mocked).
    - [ ] **UAT (BR42f-D3 live-id confirmation — the SINGLE deferred user input, `attendu`) — make-only,
          api/mesh layer, NO browser selector (M3 + M5)**, on a branch stack from root
          (`ENV=feat-llm-mesh-vertex-ai`, ports 9210/5410/1310), NEVER `ENV=dev`:
      - [ ] Place a **gitignored** service-account key file at the path declared in `.gitignore` (M3); set
            `.env` (local only, NEVER committed): `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (ADC = the
            SA-JSON key file; `GOOGLE_APPLICATION_CREDENTIALS` is injected inline by the target, not via compose).
      - [ ] Run **`make gcp-live-uat ENV=feat-llm-mesh-vertex-ai`** (M3 — `docker cp`s the SA key into the
            running `api` container at a tmp path, then `docker compose exec api` of `api/src/scripts/
            gcp-live-uat.ts` with `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION`/`GOOGLE_APPLICATION_CREDENTIALS`/
            `GCP_LIVE_UAT=1` injected INLINE on that exec — a fresh process the env reaches, unlike the
            already-running server). The script drives a real `gcp:<catalog-key>` STREAMING call at the
            api/mesh layer (NOT the browser selector — `ui/**` is FORBIDDEN, M5).
      - [ ] Confirm tokens stream as `content_delta`, reasoning as `reasoning_delta` when requested, a tool
            call as `tool_call_start`, and the EXACT wire model ids are callable in the chosen region.
      - [ ] Confirm a deliberately-wrong region/model surfaces the D-ERR1 `404`/`403` mapping (the script
            covers a negative case).
      - [ ] The script output is SANITIZED — record per model `{project, location, publisher, modelId(catalog
            key + wire id), pass/fail, finishReason}` in this file, WITHOUT committing any credential / token /
            SA-JSON (location may appear, token MUST NOT; the SA key path stays gitignored).
      - [ ] Replace the placeholder catalog keys with the UAT-confirmed live ids; re-run Lot 4 mocked gates
            (incl. the M1 `models.test.ts` exact-array + count).

- [ ] **Lot 5 — Publish lane (confirm, version bump publishes) + UAT packet doc**
  - [ ] Confirm the `llm-mesh` publish lane is COMPLETE (verified at Lot 0): Makefile
        `typecheck/build/pack/publish-llm-mesh` (+ `publish-llm-mesh-token` bootstrap); ci.yml `validate-llm-mesh`
        + steady-state OIDC `publish-llm-mesh` (fires on `github.ref==main`) + `llm_mesh_publish` filter; the
        `api` path filter (`ci.yml:135`) already includes `packages/llm-mesh/**` so api unit/integration + e2e
        rerun on package change. ⇒ NO Makefile/ci.yml edit needed for the package lane; the `0.1.3 → 0.2.0`
        bump (Lot 2) is what publishes. (The publish LANE needs NO Makefile/ci.yml edit; the ONLY Makefile
        edit in this branch is the new `vertex-live-uat` target — M3, next item — which is unrelated to the
        publish lane.)
  - [ ] **M3 — author the `make gcp-live-uat` target** (Makefile, under BR42f-EX1): `docker cp`s the
        gitignored SA key into the running `api` container at a tmp path, then `docker compose exec api sh -lc`
        of `api/src/scripts/gcp-live-uat.ts` (the `make exec-api` pattern `Makefile:1567-1575`; script-run +
        inline-env pattern per `oauth-rotate-keys` `Makefile:2455`) with `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION`/
        `GOOGLE_APPLICATION_CREDENTIALS`/`GCP_LIVE_UAT=1` injected INLINE on that exec; output sanitized
        (no bearer / SA-JSON / full project cred). Add the SA-key path to `.gitignore` in the SAME commit.
  - [ ] Author the UAT packet doc (the credential-safe live protocol) — consolidate into
        `spec/SPEC_EVOL_LLM_MESH_VERTEX.md §F`: the make-only `vertex-live-uat` path (compose UNTOUCHED — M3),
        `VERTEX_LIVE_UAT` sentinel (CI never sets it ⇒ live calls gated out structurally), `ENV=test-*`/
        `ENV=e2e-*` isolation + branch slot ports, sanitized logs (no bearer/SA-JSON/full project cred),
        recorded evidence `{project, location, publisher, modelId, pass/fail, finishReason}` with NO committed
        credential, and the note that UAT is api/mesh-only (UI selector exposure deferred — M5).
  - [ ] `enforce-package-bump` (pull_request) green for `packages/llm-mesh` (`0.1.3 → 0.2.0`).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Sync `spec/SPEC_EVOL_LLM_MESH_VERTEX.md` to as-built: provider id `vertex`, ADC mint-before-dispatch +
        the §B ordering fix, the catalog `{publisher}/{model}@vertex` key form, the UAT-confirmed live ids
        (recorded WITHOUT credentials), and the confirmation that the publish lane pre-existed. If a
        `spec/BRANCH_SPEC_EVOL.md` was used, integrate then delete it.
  - [ ] Note the `gcp-adc` auth material (D2/Option B) + Claude/Llama-on-Vertex (R4) + `provider-connections.ts`
        admin surface (D5) as DEFERRED (see `## Deferred`).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint (llm-mesh + api) green.
  - [ ] Retest package: `make test-llm-mesh ENV=test-llm-mesh-vertex-ai`.
  - [ ] Retest API: `make test-api ENV=test-llm-mesh-vertex-ai` (characterization + vertex-provider + breaking
        edits + all gates).
  - [ ] Retest E2E: chat-relevant e2e groups (cf. ci.yml e2e split) — provider runtime is the wire under test;
        `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-llm-mesh-vertex-ai
        E2E_GROUP=<matrix.e2e_group>` (matrix groups per `.github/workflows/ci.yml`).
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document signatures here.
  - [ ] Record explicit user sign-off if any AI flaky test is accepted, AND the BR42f-D3 UAT live-id sign-off.
  - [ ] Bumped `packages/llm-mesh/package.json` `0.1.3 → 0.2.0` — `enforce-package-bump` green.
  - [ ] Final gate step 1: create/update PR using this file's text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.

## Deferred (recorded, out of BR-42f)
- **`gcp-adc` / `service-account` first-class auth material in the package** (BR42f-D2 Option B) — deferred to
  a later identity lot (e.g. BR-39h identity unification incl. NHI). The resolved Option A carries Vertex
  through the mesh gate via `environment-token`/`direct-token` without widening the package auth union.
- **Claude-on-Vertex / Llama-on-Vertex** (R4) — different `publishers/{anthropic|meta}` namespace + different
  request/response body = a separate mapping = out of the "reuse the Gemini mapping" scope; additive later
  branch once Gemini-on-Vertex is proven.
- **`api/src/services/provider-connections.ts` (admin BYOK connections panel)** (BR42f-D5) — Vertex auth is
  ADC/config-driven (no stored API key), so it does not fit the BYOK connection model; revisit if/when the UI
  must surface Vertex connection state.
- **`ui/**` Vertex selector surfacing (M5 — Deferred to BR-42b/later)** — Vertex is opt-in (R2, no
  default-routing change) and intentionally NOT browser-selectable in BR-42f. Three selectors hardcode-reject
  `vertex` (verified `ui/src/routes/settings/+page.svelte:161` `validProviderIds`;
  `ui/src/lib/components/chat/AppChatPanel.svelte:4167` 5-way guard; `ui/src/routes/folder/new/+page.svelte:122`
  5-way guard). `ui/**` stays FORBIDDEN; UAT proves the live call at the api/mesh layer, not the browser
  selector. UI provider-selector exposure of `vertex` is deferred to BR-42b/later.

## Plan Review Log
Second-pass adversarial plan review by Codex 5.5-xhigh (verdict: "Revise plan first; not ready to implement")
reconciled by the Opus 4.8 conductor + Codex 5.5-xhigh. Each must-fix was re-verified against the worktree
source before encoding (anchors cited). All six are now folded into the lots/scope above; the
characterization-first Lot 1 is unchanged.
- **M1 — missing exact-count API test.** `api/tests/api/models.test.ts:47-52` asserts exact per-provider model
  arrays AND `data.models` total `toHaveLength(11)` (verified). RESOLUTION: added to `BR42f-EX1` (Conditional
  Paths) AND to the Lot 4 breaking-count edits — total → `11 + N` (N = Vertex catalog entries) + a new
  `modelsByProvider('vertex')` exact-array assertion. The only other API `toHaveLength(5)` is
  `generic-dispatch.test.ts:288` = unrelated TASK cardinality (verified, NOT touched).
- **M2 — auth model inconsistency.** `mesh-dispatch.ts:245-252` (`extractCredential`) forwards only an ACTUAL
  token; `adapter-auth.ts:32-36` validates an envVar-only `environment-token` (verified). RESOLUTION: the
  Vertex ADC bearer is **minted PRE-DISPATCH and carried as a `direct-token`** — passes `validateAuth` AND
  flows through the `extractCredential`→`buildProviderRuntimeRequest` actual-token path (mesh-dispatch.ts:248,
  263-270); the envVar-only descriptor is REJECTED as carrier; bearer NOT logged. Encoded in D2 + Lot 3
  `mesh-dispatch.ts` + Lot 4 mesh-gate proof; spec §2/§B/R5/§5 D2 aligned.
- **M3 — UAT env wiring.** `docker-compose.yml:9-38` forwards only a whitelist; arbitrary `.env` keys never
  reach the running API (verified). RESOLUTION: `docker-compose.yml` stays UNTOUCHED (NOT in EX1); UAT is a
  make-only `make vertex-live-uat` target (`docker cp` gitignored SA key + `docker compose exec api` of a new
  `api/src/scripts/vertex-live-uat.ts` with env injected INLINE on a fresh process), sanitized output. Added
  `Makefile` + `api/src/scripts/vertex-live-uat.ts` + `.gitignore` to EX1; encoded in Lot 4 UAT + Lot 5; spec
  §F/§7 aligned.
- **M4 — Gemini SSE literals to parameterize.** `index.ts:921/1200/1281/1305` hardcode `gemini_` /
  `gemini_call_` / `provider_id:'gemini'` in the shared loop the Vertex runtime reuses (verified). RESOLUTION:
  parameterize prefixes + `provider_id` by active provider; encoded in Lot 3 (index.ts edit) + Lot 4
  (attribution test); spec reuse-analysis aligned.
- **M5 — UI hardcodes.** `settings/+page.svelte:161`, `AppChatPanel.svelte:4167`, `folder/new/+page.svelte:122`
  reject `vertex` (verified). RESOLUTION: UAT is API/mesh-only; `ui/**` stays FORBIDDEN; UI provider-selector
  exposure DEFERRED to BR-42b/later (recorded in `## Deferred`); encoded in Forbidden Paths + Lot 4 UAT note;
  spec §F/§7 aligned.
- **M6 — lockfile scope.** Adding `google-auth-library` to `api/package.json` requires the lock(s) in scope;
  `google-auth-library` absent from both `api/package-lock.json` and root `package-lock.json` today, and both
  feed the `API_VERSION` hash (`Makefile:34`) (verified). RESOLUTION: added `api/package-lock.json` + root
  `package-lock.json` to EX1; the dep-add step runs `make lock-api`/`make lock-root` (`Makefile:420`/`:425`)
  and commits the lock(s) with `api/package.json`. Encoded in Lot 3 + EX1; spec §7 aligned.

**Final EX1 file list (re-verified complete + internally consistent):** `api/src/services/providers/gcp-provider.ts`
(new) · `api/src/services/provider-registry.ts` · `api/src/services/llm-runtime/index.ts` ·
`api/src/services/llm-runtime/mesh-dispatch.ts` · `api/src/services/provider-credentials.ts` ·
`api/src/services/model-catalog.ts` · `api/src/config/env.ts` · `api/src/routes/api/me.ts` ·
`api/src/routes/api/ai-settings.ts` · `api/tests/unit/**` · `api/tests/api/models.test.ts` (M1) ·
`api/src/scripts/gcp-live-uat.ts` (new, M3) · `Makefile` (`gcp-live-uat` target, M3) · `.gitignore`
(SA-key entry, M3) · `api/package.json` + `api/package-lock.json` + root `package-lock.json` (M6, only if a
dep is added). **NOT in EX1:** `docker-compose*.yml` (M3 — make-only UAT) · `ui/**` (M5 — deferred).
