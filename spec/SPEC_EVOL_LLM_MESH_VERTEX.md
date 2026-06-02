# SPEC EVOL - LLM Mesh Vertex AI Provider

Status: SCOPING (planning-only) for BR-42f `feat/llm-mesh-vertex-ai`. Adversarially double-reviewed (Opus 4.8 + Codex 5.5-xhigh, **converged** — see `## Review log`) and to be UAT-validated before any implementation.

Owner branch: `feat/llm-mesh-vertex-ai`.

Baseline: `main` with BR-42a0 (`@sentropic/chat-server`) + BR-42a1 (`build-app-cli`). `@sentropic/llm-mesh@0.1.3`; provider ids `openai/gemini/anthropic/mistral/cohere`.

Parent plan: `plan/42-BRANCH_chore-scale-build-app.md` (BR-42f row + `BR42f-Q1` attention). Anchor: `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md §16.3` ("`llm-mesh` exec → Vertex AI LLMs, streaming préservé"). Sibling references: `spec/SPEC_EVOL_LLM_MESH.md`, `spec/SPEC_EVOL_MODEL_PROVIDERS_RUNTIME.md`, `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`.

## Objective

Let the Sentropic runtime call **Gemini models served by Google Vertex AI** (region+project endpoints under `{region}-aiplatform.googleapis.com`, OAuth/ADC bearer auth) **in addition to** the existing `gemini` provider that uses Google AI Studio (`generativelanguage.googleapis.com`, `?key=` API-key auth). Provider-level streaming MUST be preserved as provider events (`content_delta` / `reasoning_delta` / `tool_call_start`), never session/chat-lifecycle events — the §1/§7 invariant of `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`.

This spec owns: the durable provider identity decision, the auth model for short-lived Vertex bearer tokens, the verified-live initial Vertex model catalog, the code-reuse-vs-separate-adapter analysis, the precise scope/path boundaries (package vs `api/`), the test/UAT plan, and the decisions ledger for the batched user-validation packet.

## Review log (Opus 4.8 + Codex 5.5-xhigh — CONVERGED)

Both reviewers independently re-read the package + `api/` source and **converged** on the following load-bearing conclusions; every claim below was re-verified against the repo while revising this spec:

1. **`@sentropic/llm-mesh` is transport-less** — verified zero `fetch`/`https`/`googleapis`/SSE in `src/**` (only test fixtures). It is a typed contract runtime. CONFIRMED.
2. **`api/**` MUST be touched — `BR42f-EX1` is unavoidable.** A package-only change yields a provider that is declared but uncallable (no transport, no registry entry, no dispatch branch). CONFIRMED; the launch-packet "package-only" framing is not achievable.
3. **Reuse the Gemini body-builder + SSE→event mapper.** Vertex `generateContent`/`streamGenerateContent` payload bodies are the identical Gemini API shape; only the transport envelope (URL + auth header) differs. `buildGeminiRequestBody` and the Gemini SSE loop are 100% reusable. CONFIRMED.
4. **The prior EX1 file list was incomplete.** Expanded in §5.D5 below (closed unions in `providers.ts`, `adapters.ts` hardcode, `provider-credentials.ts`, `model-catalog.ts`, plus two zod enums in `api/src/routes/**` not previously listed).
5. **Mesh validates auth BEFORE the runtime runs** (`mesh.ts prepare()` → `adapter.validateAuth` throws on `!ok`), and `toMeshAuthInput` returns `{type:'none'}` when no credential string is present → mesh would reject Vertex *before* the runtime ever mints an ADC bearer. This ordering bug is resolved in §B / D2. CONFIRMED.
6. **Catalog id global-uniqueness is a hard invariant** — `inferProviderFromModelId` returns `null` on >1 match, so a Vertex id colliding with an AI-Studio Gemini id silently mis-routes to the default provider. New invariant in §C. CONFIRMED.

Convergence note: no reviewer dissent remains on R1–R5 or D4/D5; the only open items are the genuinely user-owned blocking decisions (name `vertex`, GCP project/region/live ids) batched in §5.

**Second-pass plan review (Codex 5.5-xhigh, verdict "Revise plan first; not ready to implement") — 6 must-fixes reconciled (Opus 4.8 conductor + Codex 5.5-xhigh):**
1. **M1 — missing exact-count API test.** `api/tests/api/models.test.ts:47-52` asserts exact per-provider model arrays AND `data.models` total length `11`; adding Vertex catalog models breaks both. Resolution: `api/tests/api/models.test.ts` is added to `BR42f-EX1` AND to the Lot 4 breaking-count edits (new total `11 + N`, N = Vertex catalog entries; add a `modelsByProvider('vertex')` exact-array assertion). Verified the only sibling `toHaveLength(5)` at `generic-dispatch.test.ts:288` is unrelated **task** cardinality. Encoded in §E + §7 + Lot 4.
2. **M2 — auth model inconsistency.** `mesh-dispatch.ts:245-252` (`extractCredential`) only forwards an ACTUAL token; an envVar-only `environment-token` passes `adapter-auth.ts:32-36` validation yet forwards NO bearer. Resolution: the Vertex ADC bearer is **minted PRE-DISPATCH and carried as a `direct-token`** — passing `validateAuth` AND flowing through the actual-token forward path; bearer NOT logged. Encoded in §2 Option A + §B + R5 + §5 D2.
3. **M3 — UAT env wiring.** `docker-compose.yml:9-38` forwards only a whitelist; arbitrary `.env` keys never reach the running API. Resolution: `docker-compose.yml` stays UNTOUCHED (NOT in EX1); UAT is a make-only `make vertex-live-uat` target (`docker cp` gitignored SA key + `docker compose exec` of `api/src/scripts/vertex-live-uat.ts` with env injected INLINE on a fresh process), sanitized output. Encoded in §F + §7.
4. **M4 — Gemini SSE literals to parameterize.** `index.ts:921/1200/1281/1305` hardcode `gemini_` / `gemini_call_` / `provider_id:'gemini'` in the shared loop the Vertex runtime reuses. Resolution: parameterize prefixes + `provider_id` by active provider. Encoded in the reuse analysis + Lot 3 + Lot 4 anchors.
5. **M5 — UI hardcodes.** `settings/+page.svelte:161`, `AppChatPanel.svelte:4167`, `folder/new/+page.svelte:122` reject `vertex`. Resolution: UAT is API/mesh-only; `ui/**` stays FORBIDDEN; UI provider-selector exposure DEFERRED to BR-42b/later. Encoded in §F + §7 + deferred.
6. **M6 — lockfile scope.** Adding `google-auth-library` to `api/package.json` requires the lockfile(s) in scope. Resolution: `api/package-lock.json` (and root `package-lock.json` if the workspace install touches it) added to `BR42f-EX1`; the dep-add step runs `make lock-api`/`make lock-root` and commits the lock(s). Encoded in §7 + Lot 3.

## CRITICAL FINDING — Where the provider code actually lives (verified, not assumed)

The launch packet frames BR-42f as "a Vertex AI provider adapter **in `@sentropic/llm-mesh`**". The code does not match that mental model. Verified by reading every `packages/llm-mesh/src/*.ts` and the `api/` consumers:

- **`@sentropic/llm-mesh@0.1.3` contains ZERO HTTP, ZERO `fetch`, ZERO Google endpoint, ZERO SSE parsing.** It is a *typed contract runtime*: `providers.ts` (ids + closed model-id unions), `catalog.ts` (profiles/capabilities), `adapter-core.ts`/`adapters.ts` (`BaseProviderAdapter` that simply delegates to an **injected** `ProviderAdapterClient`), `auth.ts` (`SecretAuthMaterial` union + redacted `AuthDescriptor`), `adapter-auth.ts` (`validateAdapterAuthSource`), `mesh.ts` (`createLlmMesh` facade: select model → validate features → resolve auth → **validate auth** → emit hooks → call adapter), `registry.ts`, `streaming.ts` (`StreamEvent` types), `errors.ts`. The only grep hits for `https://`/`googleapis` in the package are in test fixtures.
- **The real Gemini transport lives in `api/`**, not the package:
  - `api/src/services/providers/gemini-provider.ts` (`GeminiProviderRuntime`) owns the endpoint, auth, `fetch`, and SSE reader. `buildApiUrl()` hardcodes `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}` and `resolveApiKey()` reads `env.GEMINI_API_KEY` / a request credential. `requestSse()` + `readSse()` parse the SSE byte stream into raw JSON chunks. `validateCredential()` is **synchronous** and `ready` is computed once in the constructor from `validateCredential().ok`.
  - `api/src/services/llm-runtime/index.ts` (2153 lines) owns the **Gemini API-shape mapping**: `buildGeminiRequestBody()` (`contents`/`generationConfig`/`tools`/`thinkingConfig`/`responseSchema` + `sanitizeGeminiResponseSchema`), `extractGeminiText()`, `normalizeGeminiToolArgs()`, and the **SSE chunk → provider-event** loop (~lines 1199-1322: `candidates[0].content.parts[]` → `content_delta`; `part.thought` → `reasoning_delta`; `part.functionCall` → `tool_call_start`; `finishReason !== 'FINISH_REASON_UNSPECIFIED'` → break; `done`).
  - `api/src/services/provider-registry.ts` instantiates the **five** `*ProviderRuntime` classes (hardcoded constructor) and is the map `providerId → runtime`.
  - The package's `ApplicationProviderMeshClient` (in `api/src/services/llm-runtime/mesh-dispatch.ts`) is the injected `ProviderAdapterClient`; its `generate`/`stream` just call `providerRegistry.requireProvider(providerId).generate/.streamGenerate(...)`. So the mesh facade is a thin typed wrapper; the bytes flow through the `api/` provider registry. `createDefaultProviderAdapters({...})` here wires exactly the **five** clients.

**Consequence (drives the whole scope):** "adding a Vertex provider" is overwhelmingly an **`api/` change** (new `VertexProviderRuntime` + endpoint/auth + registry registration + a `selection.providerId === 'vertex'` dispatch branch reusing the existing Gemini body/SSE mapping), plus a **small `@sentropic/llm-mesh` change** (register the new provider id + catalog profiles + auth recognition so the contract recognises it). The package-only framing in the launch packet is not achievable on its own: a package change with no `api/` change produces a provider that is declared but never callable. This is recorded as **BR42f-D1 (blocking)** and **BR42f-EX1 (unavoidable scope exception)**.

## Reuse analysis — Vertex Gemini vs AI Studio Gemini (verified payload shapes)

The Vertex `generateContent` / `streamGenerateContent` request and response **payload bodies are the same Gemini API shape** as AI Studio (`contents`, `systemInstruction`, `generationConfig` incl. `thinkingConfig`/`responseSchema`, `tools.functionDeclarations`, and on the wire `candidates[].content.parts[]` with `text`/`thought`/`functionCall`, plus `usageMetadata` and `finishReason`). What differs between AI Studio and Vertex is **only the transport envelope**:

| Concern | AI Studio (`gemini`) | Vertex AI (`vertex`) |
|---|---|---|
| Base URL | `generativelanguage.googleapis.com/v1beta` | `{region}-aiplatform.googleapis.com/v1` (or global `aiplatform.googleapis.com`) |
| Path | `/models/{model}:{generateContent\|streamGenerateContent}` | `/projects/{project}/locations/{region}/publishers/{publisher}/models/{model}:{generateContent\|streamGenerateContent}` |
| Auth | `?key={API_KEY}` query param | `Authorization: Bearer {OAuth access token}` header (ADC-derived) |
| SSE flag | `?alt=sse` | `?alt=sse` (identical) |
| Body / response shape | Gemini | Gemini (same) |
| Publisher namespace | n/a (Google models only) | `publishers/google/models/...` (Gemini), `publishers/anthropic/...` (Claude-on-Vertex), `publishers/meta/...` (Llama) |

Therefore the **request-body builder (`buildGeminiRequestBody`) and the SSE→event mapper are 100% reusable**; only the URL construction + auth header in the transport class need to change. This makes "share the Gemini mapping, swap endpoint+auth" the correct technical posture (BR42f-D4 préconisation: REUSE).

**M4 — Gemini SSE literals to parameterize (verified, blocking for clean reuse):** the shared SSE/generate loop in `api/src/services/llm-runtime/index.ts` hardcodes Gemini-specific literals that the Vertex runtime would otherwise inherit incorrectly:
- `index.ts:921` — `id: \`gemini_${createId()}\`` (in the `generate` branch at `index.ts:889`).
- `index.ts:1200` — `const responseId = previousResponseId || \`gemini_${createId()}\`` (in the `stream` branch at `index.ts:1199`).
- `index.ts:1281` — `const toolCallId = \`gemini_call_${toolCallIndex}\``.
- `index.ts:1305` — `provider_id: 'gemini'` (status event).

Because the Vertex runtime REUSES this loop (BR42f-D4), these literals MUST be **parameterized by the active provider id** (derive the response-id prefix, tool-call-id prefix, and `provider_id` from the current provider — `gemini_` / `gemini_call_` / `'gemini'` for `gemini`, `vertex_` / `vertex_call_` / `'vertex'` for `vertex`), so a Vertex response/stream is correctly attributed. This is a required edit in the Lot 3 (api vertex runtime) + Lot 4 (tests) anchors below.

## 1. Provider identity (BR42f-D1, blocking — durable name needs user validation)

Three viable shapes; all require a durable, user-validated name because it leaks into env vars, the model catalog, the `ProviderId` union (`packages/llm-mesh/src/providers.ts` → `api/src/services/provider-runtime.ts` re-exports `MeshProviderId`), the `api/` registry, the `api/routes` zod enums, and UI selectors (memory lesson: durable names need validation before merge, default provider-neutral):

- **Option A — new top-level provider id `vertex`** (préconisation). Add `'vertex'` to `providerIds`, `ProviderFamily` stays `'google'` (already present), a `vertex` row in `providerProfiles`, a `VertexProviderRuntime` in `api/`, and a `selection.providerId === 'vertex'` dispatch branch that **reuses** `buildGeminiRequestBody` + the Gemini SSE mapper. Clear separation, distinct catalog/credential namespace, distinct env vars. Cost: one more provider id, one more registry entry, catalog defaults touched, two zod enums updated.
- **Option B — a `vertex` MODE of the existing `gemini` provider** (e.g. a runtime flag/`providerOptions.endpoint = 'vertex'` selecting endpoint+auth under the same `gemini` id). Pros: no new id, catalog defaults untouched. Cons: violates the "no dual path inside one provider" instinct; the same model id would mean two different billing/auth/region surfaces; harder to expose to UI selectors and to credential precedence; contradicts the clean per-provider runtime boundary of `SPEC_EVOL_MODEL_PROVIDERS_RUNTIME.md §4`. Risk: medium-high (ambiguity at selection + credential time).
- **Option C — name it `vertex-ai`** (hyphenated). Same as A but a longer durable id. Slightly more descriptive; marginally more typing across env/catalog. Risk: low; purely cosmetic vs A.

Risk ranking (lowest first): A < C < B. **Préconisation: Option A, id `vertex`** (short, provider-neutral relative to Google product naming, mirrors the existing single-token ids `openai/gemini/...`). Decision belongs to the user (durable name).

## 2. Auth model (BR42f-Q1 → BR42f-D2, blocking)

How llm-mesh auth works today (verified in `auth.ts` + `adapter-auth.ts` + `mesh.ts` + `mesh-dispatch.ts`): `SecretAuthMaterial` is a closed union — `direct-token`, `user-token`, `workspace-token`, `environment-token`, `codex-account`, `account-transport`, `none`. `validateAdapterAuthSource` only knows how to validate those. `api/`'s `toMeshAuthInput()` maps a resolved credential **string** to one of the token materials, and `gemini-provider.ts` ultimately treats it as the `?key=` API key. **There is no concept of a short-lived OAuth bearer minted from ADC/metadata server.** Vertex needs exactly that: a rotating `Authorization: Bearer` token derived from Application Default Credentials (service-account JSON, GCE/GKE metadata server, or workload identity), scoped `https://www.googleapis.com/auth/cloud-platform`, plus **region + project** config (which are not credentials and must travel separately).

Options for representing Vertex auth in the mesh contract:

- **Option A — minimal, no new union member (DECIDED).** Keep Vertex auth **entirely server-side in `api/`** (mint/cache the bearer in the `VertexProviderRuntime` ADC helper from ADC). The mesh contract is satisfied by presenting a **`direct-token`** material carrying the freshly-minted short-lived ADC bearer (minted PRE-DISPATCH in `toMeshAuthInput`; see §B / M2). This single shape both passes `adapter.validateAuth` AND flows through `extractCredential`'s actual-token forward path so the bearer actually reaches the runtime — the envVar-only `environment-token` shape is explicitly NOT used for `vertex` because it would pass validation yet forward no token (verified `mesh-dispatch.ts:245-252`). `region`/`project` travel via `providerOptions.runtimeRequest` (not via auth material). The package's auth union is unchanged ⇒ smallest blast radius, no v-major risk. Cons: the mesh `AuthDescriptor` does not *describe* "ADC/workload-identity" semantics (only a redacted token) — acceptable because the package's job is redaction, not GCP identity modelling; the bearer MUST NOT be logged.
- **Option B — add a first-class `gcp-adc` / `service-account` auth material to the package** (`type: 'gcp-adc'` with optional `clientEmail`/`projectId`/`tokenRef`, validated in `adapter-auth.ts`, described in `describeAuthMaterial`). Pros: the contract *names* the GCP identity; future Vertex-via-workload-identity is self-describing; consistent with the way `codex-account` was added as a transport. Cons: widens the public package surface (minor bump + new exported types + a new `describeAuthMaterial` switch arm), and the package still must NOT mint tokens (no `google-auth-library` in the package — see §7), so it is a descriptor-only addition. Risk: low-medium (public surface growth).
- **Option C — both: server-side minting (A) now, descriptor (B) deferred to a later identity lot** (e.g. when BR-39h unifies identities incl. NHI). Préconisation-adjacent.

Region+project surface: in all options, `region` (e.g. `us-central1`, `europe-west1`) and `project` are **configuration, not secrets**. They are supplied via new env vars (`VERTEX_PROJECT_ID`, `VERTEX_LOCATION`) consumed by `VertexProviderRuntime`, with per-request override via `providerOptions.runtimeRequest` (the existing transport already threads `providerOptions.runtimeRequest` and the runtime builds `runtimeRequest.requestOptions`). The catalog entries should also declare the model's default/eligible region(s) (see §3).

Risk ranking (lowest first): A < C < B. **Préconisation: Option A now** (server-side ADC token minting in `api/`, region/project via env+`providerOptions`), **Option B descriptor deferred** to a later identity lot. Token sourcing sub-decision (which ADC path): support service-account JSON via `GOOGLE_APPLICATION_CREDENTIALS` **and** the GCE/GKE metadata server (for workload identity in k8s) — both are standard ADC and resolvable by the same minting helper.

## B. RESOLUTION — mesh auth ORDERING (blocking, folded into D2)

**The bug (verified):** `mesh.ts` `prepare()` (verified `mesh.ts:124-130`) runs, in order: `selectModel` → `validateFeatures` → `resolveAuth` → `adapter.validateAuth(auth)` and **throws `'Provider auth source is not configured'` if `!validation.ok` (mesh.ts:130) — BEFORE** the adapter's `stream`/`generate` is ever called (mesh.ts:147/158, which pass `{ auth: prepared.auth }` into the adapter that dispatches into `api/` `VertexProviderRuntime`). Meanwhile `toMeshAuthInput()` (verified `mesh-dispatch.ts:210-243`) returns `{ type: 'none' }` whenever `credentialResolution.source === 'none'`, i.e. whenever there is no API-key-style credential string. For Vertex, the credential is **not** a string the credential resolver knows about — it is an ADC-minted bearer. So with the naive path, `source === 'none'` → `{type:'none'}` → `validateAdapterAuthSource` returns `{ok:false}` → **mesh rejects every Vertex request before any dispatch.** This is a hard blocker for D1/D2.

**Second, deeper inconsistency (verified, M2):** an `environment-token` carrying ONLY an `envVar` (no token) passes `validateAdapterAuthSource` (verified `adapter-auth.ts:32-36`: `ok` when `hasText(token) || hasText(envVar)`), BUT the dispatch forward path `extractCredential()` (verified `mesh-dispatch.ts:245-252`) returns `material.token` for an `environment-token` — which is `undefined` for an envVar-only descriptor. `buildProviderRuntimeRequest` (verified `mesh-dispatch.ts:263-270`) then only forwards `credential` when it is truthy (L268). **So an envVar-only `environment-token` would pass the mesh gate yet forward NO bearer to `VertexProviderRuntime`** — the ADC token never reaches the wire call, and the runtime would have to re-mint from scratch with no token in hand. The envVar-only shape is therefore rejected as the carrier.

**Decision (DECIDED — encoded, do not reopen):** the Vertex ADC bearer is **minted PRE-DISPATCH** (in the dispatch layer, before `buildMeshRequest`) and carried as a **`direct-token` auth material** holding the concrete short-lived bearer. This single shape satisfies BOTH constraints at once:
- it passes `mesh.prepare()` → `adapter.validateAuth` (verified `adapter-auth.ts:20-23`: `direct-token` validates `ok` when `hasText(token)`), AND
- it flows through the existing actual-token forward path: `extractCredential()` returns `material.token` for `direct-token` (verified `mesh-dispatch.ts:248`), and `buildProviderRuntimeRequest` forwards it as `runtimeRequest.credential` (verified `mesh-dispatch.ts:265-268`) into `VertexProviderRuntime` — exactly the path the other providers' actual tokens already use.

Concretely:
1. **`toMeshAuthInput()` gains a `vertex` branch** (verified anchor `mesh-dispatch.ts:210-243`) that, for `providerId === 'vertex'`, mints the ADC bearer (via the `VertexProviderRuntime` ADC helper / D-ADC1 cache, single-flight) and returns `{ type: 'direct-token', token: <freshly-minted ADC bearer>, label: 'vertex adc' }`. There is **NO envVar-only descriptor for `vertex`** — the bearer is a concrete short-lived token minted from ADC just before dispatch. The mint is async, so this resolution runs in the async dispatch path before `buildMeshRequest` (which is already async). A request-override bearer (if explicitly supplied) takes precedence as a `direct-token` over the minted one.
2. **The bearer MUST NOT be logged** (per D-ADC1): it is carried only as the in-memory `direct-token.token`, is kept out of the redacted `AuthDescriptor`, and never appears in any log line; logs record `{project, location}` config only.
3. **Escape hatch (documented, NOT chosen) —** `BaseProviderAdapter` accepts an `options.validateAuth` override (verified `adapter-core.ts:92-93`). A `VertexAdapter` could force `{ok:true}` for the ADC case. Rejected as the carrier because it would diverge the contract's validation semantics per-provider AND would still leave `extractCredential` with no token to forward (the envVar-only failure mode above). The `direct-token` mint-before-dispatch path needs no such override.

**Credential resolver coupling (verified, must decide):** `provider-credentials.ts` `getEnvironmentCredential()` hardcodes the five providers and **already returns `null` for any unknown id** (including `vertex`). So Vertex naturally resolves to `source: 'none'` today. The decision is whether to (a) **bypass** the string-credential resolver for Vertex entirely (since auth is ADC-minted, not a stored string) and inject the auth in the dispatch branch, or (b) add a `vertex` arm to `getEnvironmentCredential` returning a sentinel. **Préconisation: (a) bypass** — Vertex auth is not a string credential; document that `resolveProviderCredential('vertex')` legitimately returns `none` and the dispatch branch supplies the auth material directly. This keeps `provider-credentials.ts` honest (it stores no Vertex secret) while §B item 1 makes the mesh gate pass.

## C. HARD INVARIANT — Vertex catalog ids MUST be globally unique vs AI-Studio Gemini ids

**Why (verified):** `model-catalog.ts` `inferProviderFromModelId()` filters the catalog by `model_id` and **returns `null` when `matches.length !== 1`**. This inference runs at selection time (`resolveRuntimeSelection` in `llm-runtime/index.ts` and in `me.ts`/`ai-settings.ts`). If a Vertex model id equals an existing AI-Studio Gemini id (e.g. both literally `gemini-3.5-flash`), then a request specifying only the model id (no explicit provider) would get `inferredProvider === null` and **silently fall back to the default provider** — mis-routing a Vertex-intended call to AI Studio (or vice-versa), with different billing/auth/region. This is the memory-lesson failure mode ("dead/ambiguous id breaks the slot") in a new guise.

**Invariant (mandatory):** Vertex catalog `modelId`s MUST be **globally unique** across the entire catalog — they must NOT collide with any `gemini` (or other provider) id. Require a **vertex-prefixed / fully-qualified id** for the *catalog/selection key*, of the form `{publisher}/{model}@vertex` (e.g. `google/gemini-3.5-flash@vertex`). The **wire model name** sent to the Vertex `publishers/{publisher}/models/{model}` path is the un-prefixed `{model}` (and `{publisher}` drives the path segment) — the prefix/suffix exists only to keep the catalog selection key unique and self-describing. The `VertexProviderRuntime`/dispatch branch strips the catalog key back to `{publisher}` + `{model}` when building the URL.

This **constrains D3**: the initial Vertex ids are not bare Gemini ids; they are `google/<gemini-model>@vertex` catalog keys whose wire form is UAT-confirmed callable. (Note: the closed `KnownModelId` union in `providers.ts` must gain these exact catalog-key strings — see D5.)

## 3. Model catalog (BR42f-D3, blocking — must be verified-live ids)

Memory lesson (load-bearing): **catalog `modelId`s drive the wire call; a listed-but-not-callable id breaks the slot** (and on Gemini, a dead id can break sibling slots). Vertex publisher model ids differ from AI Studio ids and from Vertex's own *listing* — "listed ≠ callable" applies doubly here (region-availability gates a model further). Therefore the initial set must be **minimal and confirmed callable against a real Vertex project+region during UAT before merge**, not copied from docs.

Catalog requirements for Vertex entries (extending `catalog.ts` `ModelProfile` + `providers.ts` unions):
- `providerId: 'vertex'`, `family: 'google'`.
- Catalog selection key obeys the §C **global-uniqueness invariant**: `{publisher}/{model}@vertex` (e.g. `google/gemini-3.5-flash@vertex`).
- A **publisher** dimension (`google` for Gemini; later `anthropic`/`meta`) so the URL path `publishers/{publisher}/models/{model}` is constructed correctly. Préconisation: derive `publisher`+wire-`model` from the catalog key (parse `{publisher}/{model}@vertex`), or carry a small typed `vertex` metadata block on the runtime catalog entry; do not overload the *wire* `modelId`.
- A **region** declaration: either a default region per model or an allowed-region list, so the runtime can build `{region}-aiplatform.googleapis.com` and the UI can warn on unavailable regions.
- Capabilities reuse the existing Gemini capability template (vision, `json-schema-subset`, `stringEnumsOnly`, `geminiUnsupportedJsonSchemaKeywords`, advanced reasoning) since the model family is identical — i.e. `modelCapabilities('vertex', ...)` mirrors `providerProfiles.vertex` which mirrors the Gemini profile.

Initial set préconisation (Gemini-on-Vertex only for BR-42f; **exact ids to be UAT-confirmed live**, candidates aligned to the model generation already in the catalog): the same two model families the `gemini` provider exposes (a `*-flash` class + a `*-flash-lite` class), expressed as globally-unique `google/<model>@vertex` keys, in **one default region** chosen by the user's GCP project. Claude-on-Vertex / Llama-on-Vertex are **explicitly deferred** (different publisher namespace + different request/response body = a separate mapping = out of the "reuse the Gemini mapping" scope of BR-42f).

Blocking sub-question for the batch: (a) confirm the initial Vertex model id list + default region against the user's real GCP project during UAT; (b) confirm `vertex` stays **opt-in only** (no `defaultTaskHints`/default routing changed). Préconisation: `vertex` is **opt-in only** initially, which also keeps the model-providers-runtime defaults stable.

## D. ADDED DECISIONS (new, blocking-or-near)

### D-ADC1 — ADC token cache / refresh (préconisation, reversible-in-`api/`)
- **Cache key** = `{project}+{location}+{scope}` (scope fixed to `cloud-platform`). Distinct projects/regions get distinct cached tokens.
- **Expiry skew**: refresh when `now >= expiry - SKEW` (préco `SKEW = 60s`, aligned with `OAUTH_DPOP_IAT_SKEW_SEC` default). Never serve a token within the skew window.
- **Single-flight**: concurrent requests for the same cache key share ONE in-flight mint (a per-key promise), to avoid a thundering-herd of token mints on cold cache / expiry.
- **Failure behaviour**: a mint failure surfaces as a normalized provider error (see D-ERR1), is NOT cached (negative results not cached), and is retryable only per the D-ERR1 matrix (5xx/quota from the token endpoint).
- **Logging**: **NO token logging** — never log the bearer, the SA-JSON, or the full project/credential. Logs may record `{project, location}` only (non-secret config), never the token value or its fingerprint.
- **`ready`/`validateCredential()` is SYNC** (verified `gemini-provider.ts`): `VertexProviderRuntime.validateCredential()` MUST derive `ready` **statically** from config presence (`VERTEX_PROJECT_ID` + `VERTEX_LOCATION` set, and an ADC source resolvable *in principle*) — it MUST NOT perform an async network mint inside the synchronous `validateCredential`. The first real mint happens lazily on the first `generate`/`streamGenerate`.

### D-ERR1 — Vertex error mapping (préconisation)
Vertex returns the **`google.rpc.Status` shape** (`{ error: { code, status, message, details[] } }`) which differs from AI Studio's. `VertexProviderRuntime.normalizeError()` MUST map by HTTP status:
- `401` → expired/invalid bearer → **non-retryable** at the provider layer (trigger a single token-refresh-and-retry at the runtime layer if the cached token was stale; do not loop).
- `403` → IAM / permission / API-not-enabled → **non-retryable** (config/permission error; surface clearly, mention IAM).
- `404` → model-not-in-region / wrong publisher path → **non-retryable** (catalog/region error; the §C/D3 UAT step exists to prevent this).
- `429` → quota / rate limit → **retryable**.
- `5xx` → **retryable**.
Only `429` and `5xx` are `retryable: true` (mirrors `gemini-provider.ts` `normalizeError`, which already marks `429`/`>=500` retryable). The `google.rpc.Status.status` enum string (e.g. `RESOURCE_EXHAUSTED`, `PERMISSION_DENIED`, `NOT_FOUND`, `UNAUTHENTICATED`) SHOULD be surfaced as the normalized `code`.

### D-ADC2 — ADC `ready` / `validateCredential` semantics (préconisation)
- `validateCredential(credential?)` returns `{ok:true}` iff `VERTEX_PROJECT_ID` and `VERTEX_LOCATION` are present (config), regardless of whether a live token can be minted right now — because the call is sync and must not block on network. `ready` (constructor-time) = `validateCredential().ok`.
- A live-token failure manifests at call time via D-ERR1, not at `ready`-time. This matches the existing `gemini` pattern (key-present ⇒ ready; bad key ⇒ runtime error).
- If D2/Option B (`gcp-adc` material) is later adopted, `validateAdapterAuthSource` gains a matching arm; until then the §B/M2 **`direct-token`** (pre-dispatch-minted bearer) carries Vertex through the mesh gate AND forwards the token to the runtime.

## 4. Streaming (reversible — REUSE, BR42f-D5/R1)

Provider-level streaming preserved as **provider events**, per §7 anti-pattern ("Provider events stay provider-shaped; no `session_id`/message lifecycle in mesh"). Mechanically: `VertexProviderRuntime.streamGenerate()` does the same `fetch` + `readSse()` byte parsing as `gemini-provider.ts` (Vertex `streamGenerateContent?alt=sse` emits the identical SSE-of-Gemini-JSON envelope), differing only in URL (`{region}-aiplatform.googleapis.com/.../publishers/{publisher}/models/{model}:streamGenerateContent?alt=sse`) and the `Authorization: Bearer` header. The `api/src/services/llm-runtime/index.ts` dispatch adds a `selection.providerId === 'vertex'` branch that reuses **`buildGeminiRequestBody` verbatim** and the **exact existing Gemini SSE→event loop** (`part.thought` → `reasoning_delta`; text parts → `content_delta`; `part.functionCall` → `tool_call_start`; `finishReason !== 'FINISH_REASON_UNSPECIFIED'` → break). No new `StreamEvent` type, no session-lifecycle leakage. Reversible: it is pure code-reuse of a frozen contract; if Vertex ever diverges, a Vertex-specific mapper can be forked without touching the contract. Préconisation: REUSE the Gemini mapper; if extracting the shared SSE-loop into a small helper reduces duplication across the two `if` branches, do so **inside `api/src/services/llm-runtime`** (do not move mapping into the package).

## 5. Decisions ledger

### Reversible (decide now, recorded préconisation)

- **R1 — Reuse the Gemini request-body builder + SSE→event mapper for Vertex** (BR42f-D4/D5). Why reversible: same Gemini payload shape (verified §reuse); a future divergence forks the mapper without contract change. Reco: REUSE; extract a shared helper only if it reduces duplication, keep it in `api/src/services/llm-runtime`.
- **R2 — `vertex` is opt-in; do not change catalog default routing.** Why reversible: defaults are data in `catalog.ts`/runtime catalog; flipping a default later is a one-line data change. Reco: ship opt-in, no `defaultTaskHints` for `vertex` that would alter routing in BR-42f.
- **R3 — Region/project as configuration (`VERTEX_PROJECT_ID`, `VERTEX_LOCATION`) + per-request `providerOptions.runtimeRequest` override**, not as secrets/auth material. Why reversible: env+options plumbing, no contract type. Reco: env-first with override.
- **R4 — Defer Claude-on-Vertex / Llama-on-Vertex** (different publisher + body shape). Why reversible: additive later branch (BR-42f.x) once Gemini-on-Vertex is proven. Reco: defer.
- **R5 — Server-side ADC token minting lives in `api/` `VertexProviderRuntime`, cached with expiry (D-ADC1)**, presented to the mesh contract as a **`direct-token`** holding the pre-dispatch-minted short-lived bearer (§B/M2: passes `validateAuth` AND forwards through `extractCredential`; envVar-only `environment-token` rejected). Why reversible: internal to `api/`; can be upgraded to a first-class descriptor (D2/Option B) later. Reco: mint+cache in `api/`, `direct-token` (minted-bearer) shape at the mesh gate; bearer NOT logged.

### Blocking / high-stakes (compact dossiers for the batched user packet)

- **BR42f-D1 — Provider identity & durable name.** Question: new top-level `vertex` id (A) vs `vertex` MODE of `gemini` (B) vs `vertex-ai` id (C)? Options/trade-offs in §1. Risk rank A<C<B. **Reco: A (`vertex`).** Stakes: durable across env vars, `ProviderId` union (`providers.ts`→`provider-runtime.ts`), catalog, `api/` registry, **two `api/routes` zod enums** (`me.ts`, `ai-settings.ts`), UI selectors; hard to rename post-publish.
- **BR42f-D2 — Auth model for the short-lived Vertex bearer (incl. §B ordering + M2 forward-path).** Question: keep ADC minting server-side and present a `direct-token` (minted bearer) to the contract (A) vs add a first-class `gcp-adc` auth material to the package (B) vs A-now/B-later (C)? §2 + §B. Risk rank A<C<B. **Reco: A now (mint-before-dispatch as a `direct-token` to pass the mesh `validateAuth` gate AND forward the bearer to the runtime; bypass the string credential resolver for `vertex`), B deferred.** The envVar-only `environment-token` shape is rejected (M2: passes validation but `extractCredential` forwards no token). Stakes: public package surface + minor/major bump; the mesh validates auth BEFORE the runtime, so the ordering fix is mandatory for callability; future workload-identity/NHI modelling (BR-39h).
- **BR42f-D3 — Initial Vertex model catalog (verified-live, globally-unique ids).** Question: confirm the minimal Gemini-on-Vertex id set (as `google/<model>@vertex` catalog keys) + default region against the user's real GCP project (UAT), and confirm `vertex` stays opt-in (no default-routing change)? §3 + §C. **Reco: minimal Gemini-on-Vertex pair, single user-chosen region, opt-in only, globally-unique vertex-qualified ids, wire ids UAT-confirmed before merge.** Stakes: dead/ambiguous id breaks the slot or silently mis-routes (§C); region availability.
- **BR42f-D4 — Code reuse vs separate adapter.** Question: reuse the Gemini body+SSE mapping (swap endpoint+auth) vs author a Vertex-specific mapper? §reuse. **Reco: REUSE.** Stakes: duplication/maintenance vs over-coupling two providers (low risk given identical shape). Converged.
- **BR42f-D5 / EX1 — Cross-package scope (the unavoidable scope exception).** Verified: **`api/**` MUST change** — the package-only framing is infeasible. **Reco: open `BR42f-EX1`** covering the named `api/` + package paths below. Rationale: the real provider transport lives in `api/`. Impact: 1 new `api/` runtime file + several edited `api/` files + 1 new env pair + package union/catalog/adapter edits + version bump. Rollback: revert the registry registration + dispatch branch + catalog rows → provider becomes undeclared, **5 existing providers unchanged** (characterization-proved, §E).

  **EX1 file list (EXPANDED — prior list was incomplete; each verified against the repo):**

  *Package `packages/llm-mesh/src/**` (the smaller half):*
  - `providers.ts` — add `'vertex'` to `providerIds`; add the vertex catalog-key strings to the **closed** `knownModelIds` union AND a `vertex` key to `knownModelIdsByProvider` (it is `satisfies Record<ProviderId, ...>`, so adding `vertex` to `providerIds` *forces* a `vertex` entry to typecheck). `ProviderFamily` already includes `'google'` — no change there.
  - `catalog.ts` — add a `vertex` row to `providerProfiles` (it is `satisfies Record<ProviderId, ProviderDescriptor>`, forced once `vertex` is a `ProviderId`); add the Vertex `ModelProfile` entries to `modelProfiles` (note `modelCapabilities(providerId,...)` indexes `providerProfiles[providerId]`, so the `vertex` profile must exist first). `ModelProfile.modelId` is typed `KnownModelId`, so the catalog keys must be in the `providers.ts` union.
  - `adapters.ts` — `createDefaultProviderAdapters` + `DefaultProviderAdapterClients` **hardcode exactly 5** adapters/clients → add a `VertexAdapter` class + a `vertex?: VertexAdapterClient` field + the `new VertexAdapter({ client: clients.vertex })` row.
  - `package.json` — version bump `0.1.3 → 0.2.0` (additive provider id + catalog = minor).
  - (Conditional, only if D2/Option B is taken) `auth.ts` + `adapter-auth.ts` — add the `gcp-adc` material + validation + `describeAuthMaterial` arm. **Deferred under the préconisation (Option A).**

  *App `api/**` (the larger half, requires `BR42f-EX1`):*
  - `api/src/services/providers/vertex-provider.ts` — **NEW** `VertexProviderRuntime` (URL builder for `{region}-aiplatform.googleapis.com/.../publishers/{publisher}/models/{model}:{action}?alt=sse`, `Authorization: Bearer` header, ADC mint+cache per D-ADC1, sync `validateCredential` per D-ADC2, `normalizeError` per D-ERR1, reusing `requestSse`/`readSse` byte-parsing semantics from `gemini-provider.ts`).
  - `api/src/services/provider-registry.ts` — register `['vertex', new VertexProviderRuntime()]` (constructor hardcodes 5 → 6).
  - `api/src/services/llm-runtime/index.ts` — add a `selection.providerId === 'vertex'` branch in BOTH `generate` (~line 889 region) and `stream` (~line 1199 region), reusing `buildGeminiRequestBody` + the Gemini SSE→event loop; `runtimeRequest.mode` = a vertex mode (e.g. `'vertex-stream-generate-content'`) carrying `{project, location, publisher, model, body}` so the runtime can build the URL+auth.
  - `api/src/services/llm-runtime/mesh-dispatch.ts` — **TWO edits**: (1) `getEnvironmentVariableName` must become **explicit** (today it `return 'COHERE_API_KEY'` as the unknown default — a `vertex` request would mis-name its env var as Cohere's); add a `vertex` arm (e.g. `'VERTEX_ADC'`) and make the fallthrough explicit/safe. (2) `createDefaultProviderAdapters({ ... vertex: applicationProviderClient })` must wire the new `vertex` client (currently 5 clients hardcoded), AND `toMeshAuthInput` gains the §B vertex branch returning a non-`none` material.
  - `api/src/services/provider-credentials.ts` — `getEnvironmentCredential` hardcodes 5 and already returns `null` for unknown (so `vertex` ⇒ `null` ⇒ `source:'none'` today). Decision (§B): **bypass** the string resolver for `vertex` (ADC-minted, not a stored string); document the legitimate `none`. Minimal/no code change here under the préconisation, but listed because the behaviour is load-bearing for §B.
  - `api/src/services/model-catalog.ts` — no structural change required (it reads the registry), BUT the §C global-uniqueness invariant lives here (`inferProviderFromModelId` null-on-collision). Listed as the invariant's home; add a guard/test asserting no Vertex/Gemini id collision.
  - `api/src/config/env.ts` — add `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` (both `z.string().optional()`); optionally `GOOGLE_APPLICATION_CREDENTIALS` if not already ambient.
  - `api/tests/unit/**` — see §E.

  **Flagged conditional (admin surface only — likely NOT required for BR-42f, confirm):**
  - `api/src/services/provider-connections.ts` — has its OWN `ProviderConnectionId` union (`'codex'|'openai'|...|'cohere'`) + a hardcoded 5-provider `Promise.all` + `toSimpleProviderState` list. This is the **admin connections panel**. Vertex's auth is ADC (no stored API key), so it does not naturally fit the "BYOK credential" connection model. **Préconisation: leave `provider-connections.ts` OUT of BR-42f** (Vertex is config-driven, not an admin-entered key); revisit if/when the UI must surface Vertex connection state. Flagged so the conductor decides explicitly rather than by omission.
  - `api/src/routes/api/me.ts` (line ~80) and `api/src/routes/api/ai-settings.ts` (line ~25) — both hardcode `z.enum(['openai','gemini','anthropic','mistral','cohere'])` for `defaultProviderId`. **If `vertex` must be user-selectable as a default provider, these two enums MUST gain `'vertex'`** or the API rejects setting `vertex` as default. Under R2 (opt-in, no default routing) Vertex need not be a *default* — but the inference path can still produce `provider_id:'vertex'`, and persisting it via `default_provider_id` is validated by `isProviderId` (flows from the package union, OK) while these two `z.enum`s are NOT. **Préconisation: add `'vertex'` to both enums** so selection/persistence is coherent; mark as part of EX1.

## E. Non-regression — EXACT tests that WILL break + must edit (like BR-42a0)

Verified against the current test files; these break the instant `vertex` enters the catalog/registry and MUST be updated in the same lots:

- `api/tests/api/models.test.ts` (M1 — exact-count API assertion, verified `models.test.ts:47-52`):
  - line 52 `expect(data.models).toHaveLength(11)` → `11 + N` where **N = number of Vertex catalog entries added in Lot 2** (the global catalog total grows by exactly the Vertex rows). The current `11` = openai 3 + gemini 2 + anthropic 2 + mistral 2 + cohere 2.
  - add a `expect(modelsByProvider('vertex')).toEqual([<sorted vertex catalog keys>])` assertion mirroring lines 47-51 (the per-provider exact-array pattern), listing the exact Vertex model ids added in Lot 2 (`google/<model>@vertex` keys, UAT-confirmed at the D3 step). The other five per-provider arrays (lines 47-51) stay byte-identical (characterization property).
  - this file is the ONLY exact provider-catalog-count assertion in the API suite. Verified the other `toHaveLength(5)` in `api/tests/api/generic-dispatch.test.ts:288` is `taskResults.toHaveLength(5)` — unrelated **task** cardinality, NOT provider/model count; it does NOT change.
  - `api/tests/api/models.test.ts` is therefore added to both `BR42f-EX1` and the Lot 4 breaking-count edits.
- `api/tests/unit/provider-mesh-contract-proof.test.ts`:
  - line 13 `expect(proof.providers).toHaveLength(5)` → `6` (and keep/extend the `arrayContaining([... 'vertex'])` assertion).
  - the "keeps package model profiles aligned" block (lines 18-43) iterates `providerRegistry.listModels()` and asserts each has a matching **package** mesh model with same `label`/`reasoningTier`/capabilities → the Vertex catalog rows MUST be added to BOTH the package `catalog.ts` AND the `api/` runtime catalog with **matching** label/tier, or this fails.
- `api/tests/unit/provider-registry-expansion.test.ts`:
  - line 16 `expect(ids).toHaveLength(5)` → `6` + add `expect(ids).toContain('vertex')`.
  - line 23 `expect(providerIds).toHaveLength(5)` → `6`.
  - the `for (const id of providerIds)` loops (getProvider/requireProvider) automatically cover `vertex` once registered — they assert each id resolves, so the registry registration is what keeps them green.
  - "list models from all providers" + "capabilities per provider" → extend with `vertex` if a strict assertion is added.

GATES to keep green (verified, must not regress):
- **All-model stream matrix** `api/tests/unit/llm-runtime-stream.test.ts` — line 857 asserts `[...STREAM_TEST_MATRIX keys].sort()` **EQUALS** the full catalog `providerId:modelId` list (strict equality, not superset). Adding any `vertex` model to the catalog **forces** a matching `STREAM_TEST_MATRIX` fixture row per Vertex model (content + reasoning + tool fixtures as applicable), or the gate fails. This is the single most important non-regression edit.
- `api/tests/unit/gemini-provider-sse.test.ts` — SSE byte-parsing gate for the Gemini runtime; the Vertex runtime should get a sibling SSE test asserting it parses the identical envelope.
- `api/tests/unit/provider-credentials.test.ts` — must still pass; add a case asserting `resolveProviderCredential('vertex')` returns `source:'none'` (bypass, per §B) and does NOT leak a string credential.
- Package gates: `packages/llm-mesh/tests/facade.test.ts`, `auth.test.ts`, `tools.test.ts` — `facade.test.ts` must include `vertex` in the provider/model listing assertions; `auth.test.ts` only changes if D2/Option B is taken.

**Characterization step (mandatory, mirrors BR-42a0):** before adding `vertex`, snapshot the 5 existing providers' catalog/registry/stream behaviour; after adding `vertex`, assert the 5 existing providers' outputs are **byte-identical** (no label/tier/capability/dispatch drift). The rollback property of D5 ("revert vertex → 5 providers unchanged") is proven by this characterization, not asserted.

## F. UAT — credential-safe, live-id protocol

UAT runs real Vertex calls but MUST keep credentials out of CI and out of the repo. **UAT is API/mesh-only (no browser selector — see M5); Vertex is exercised at the api/mesh layer, not via the UI.**

**M3 — env wiring: a make-only `vertex-live-uat` path, `docker-compose.yml` UNTOUCHED (NOT in EX1).** Verified `docker-compose.yml:9-38` forwards only a fixed whitelist of API env vars (`OPENAI_API_KEY`, `GEMINI_API_KEY`, … `GOOGLE_DRIVE_*`); arbitrary `.env` keys (`VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_LIVE_UAT`, `GOOGLE_APPLICATION_CREDENTIALS`) do **NOT** reach the running API container, and the server process is already started so a new `.env` value would not reach it anyway. The resolution does NOT touch compose; instead a new **`make vertex-live-uat`** target:
- (a) `docker cp`s a **gitignored** service-account key file into the running `api` container at a tmp path (e.g. `/tmp/vertex-sa.json`);
- (b) runs a `docker compose exec api sh -lc '…'` (the `make exec-api` pattern, verified `Makefile:1567-1575`; script-run + env-injection pattern verified against `oauth-rotate-keys`, `Makefile:2453-2455`) of a **dedicated** `api/src/scripts/vertex-live-uat.ts` node script with `VERTEX_PROJECT_ID` / `VERTEX_LOCATION` / `GOOGLE_APPLICATION_CREDENTIALS` / `VERTEX_LIVE_UAT=1` injected **INLINE on that exec** — a fresh process whose env reaches it (unlike the already-running server).
- Output MUST be **sanitized**: the script prints `{project, location, publisher, modelId, finishReason, pass/fail}` only; NO bearer, NO SA-JSON, NO full project credential leak. The SA key path is **gitignored** (new `.gitignore` entry); NO credential is ever committed.

Constraints that still hold:
- **Opt-in env SENTINEL, not creds-absence.** Live Vertex calls are gated by `VERTEX_LIVE_UAT=1`, NOT merely by "credentials happen to be present". CI never sets the sentinel ⇒ live calls are gated **out of CI** structurally, even if some ADC happens to be ambient on a runner. The `vertex-live-uat` target is the only path that sets it.
- **Isolated ENV** — `ENV=test-*` / `ENV=e2e-*` / `ENV=feat-llm-mesh-vertex-ai` with the branch five-slot ports (API `9000 + nn*5 + slot`, UI `5200 + nn*5 + slot`, Maildev `1100 + nn*5 + slot`); never `ENV=dev` (afterEach purge), never the root ports `8787/5173/1080`.
- **Sanitized logs** — no bearer token, no SA-JSON, no full project credential in any captured log (per D-ADC1 logging rule). Region/location may appear; the token MUST NOT.
- **Recorded evidence** — for each model tested, record `{project, location, publisher, modelId(catalog key + wire id), pass/fail, finishReason observed}` in the plan/`BRANCH.md`, **WITHOUT committing any credential** (`VERTEX_PROJECT_ID`, SA-JSON, bearer stay in `.env`/local only).
- **Pass criteria** (the D3 verification): with `VERTEX_PROJECT_ID` + `VERTEX_LOCATION` + ADC available (service-account JSON via `GOOGLE_APPLICATION_CREDENTIALS`) and `VERTEX_LIVE_UAT=1`, `make vertex-live-uat` drives a real `vertex:<catalog-key>` **streaming** call at the api/mesh layer and confirms: tokens stream as `content_delta`, reasoning streams as `reasoning_delta` when requested, a tool call surfaces as `tool_call_start`, the **exact wire model ids are callable** in the chosen region, and a deliberately-wrong region/model surfaces the D-ERR1 `404`/`403` mapping. UAT proves the live call at the **api/mesh layer (not the browser selector)**.

### UAT runbook (step-by-step — the SINGLE deferred user input, BR42f-D3)

1. **Create + download a Vertex service-account key** (gcloud or Cloud Console). The SA needs the **Vertex AI User** role (`roles/aiplatform.user`) on the target project. CLI form:
   ```
   gcloud iam service-accounts create vertex-uat --project <PROJECT_ID>
   gcloud projects add-iam-policy-binding <PROJECT_ID> \
     --member "serviceAccount:vertex-uat@<PROJECT_ID>.iam.gserviceaccount.com" \
     --role roles/aiplatform.user
   gcloud iam service-accounts keys create ./vertex-sa.json \
     --iam-account vertex-uat@<PROJECT_ID>.iam.gserviceaccount.com
   ```
2. **Put the key at the gitignored path.** `vertex-sa*.json` and `.secrets/` are gitignored; the key is NEVER committed. Keep it at the worktree root, e.g. `./vertex-sa.json`.
3. **Bring up the branch stack** (slot-0 ports; never `ENV=dev`, never root ports):
   ```
   make dev API_PORT=9210 UI_PORT=5410 MAILDEV_UI_PORT=1310 ENV=feat-llm-mesh-vertex-ai
   ```
4. **Run the live UAT** (the target `docker cp`s the key into the running `api` container at `/tmp/vertex-sa.json`, then `docker compose exec` runs the script with `VERTEX_PROJECT_ID`/`VERTEX_LOCATION`/`GOOGLE_APPLICATION_CREDENTIALS=/tmp/vertex-sa.json`/`VERTEX_LIVE_UAT=1` injected INLINE on a fresh process):
   ```
   make vertex-live-uat VERTEX_PROJECT_ID=<PROJECT_ID> VERTEX_LOCATION=<REGION> VERTEX_SA_KEY=./vertex-sa.json ENV=feat-llm-mesh-vertex-ai
   ```
5. **Expected sanitized PASS output** (project id masked; NO bearer / SA-JSON / `Authorization` ever printed):
   ```
   --- Vertex live UAT (sanitized) ---
   project=abc***xy location=us-central1
   models=2
   [PASS] google/gemini-3.5-flash@vertex (publisher=google wire=gemini-3.5-flash) http=200 tokens=<n> finishReason=STOP latencyMs=<ms>
   [PASS] google/gemini-3.1-flash-lite@vertex (publisher=google wire=gemini-3.1-flash-lite) http=200 tokens=<n> finishReason=STOP latencyMs=<ms>
   -----------------------------------
   Result: ALL PASS (2/2 models)
   ```
   Record `{project(masked), location, publisher, modelId(catalog key + wire id), pass/fail, finishReason}` per model in this file — WITHOUT committing any credential/token/SA-JSON.
6. **If the live-callable wire ids differ from the 2 placeholders** (`google/gemini-3.5-flash@vertex` + `google/gemini-3.1-flash-lite@vertex`): the swap is a 1-line catalog change — update the ids in `packages/llm-mesh/src/providers.ts` (`knownModelIds` + `knownModelIdsByProvider.vertex`), `packages/llm-mesh/src/catalog.ts` (`modelProfiles`), and the matching `modelsByProvider('vertex')` assertion in `api/tests/api/models.test.ts`; then re-run `make vertex-live-uat …` and the Lot 4 mocked gates. The `vertex-live-uat.ts` script reads the ids from the package catalog, so it needs NO edit.

Published-package validate lane: `make typecheck-llm-mesh`, `make test-llm-mesh`, `make pack-llm-mesh`, then `make typecheck-api` / `make lint-api` / `make test-api` (the gate sequence recorded in `SPEC_EVOL_LLM_MESH.md`). Version bump enforced by the `enforce-package-bump` CI job (`0.1.3 → 0.2.0`).

## 6. Pre-test plan (deterministic, no live Vertex, no real credentials in CI)

- **Package** (`packages/llm-mesh/tests/`): `vertex` appears in `providerIds`/`listProviders()`; Vertex `ModelProfile`s present with the Gemini capability template; `getModelProfile('vertex', '<google/...@vertex>')` resolves; `facade.test.ts`-style check that Vertex reasoning-capable models are not `unsupported`; if D2/Option B is taken, `validateAdapterAuthSource` accepts the new `gcp-adc` material and rejects the empty case. Mirrors existing `facade.test.ts`/`auth.test.ts` patterns (inject a fake `ProviderAdapter`/client — no network).
- **`api/`** (`api/tests/unit/`): a mocked Vertex endpoint (stub `fetch`) + a **stubbed ADC token** asserting (1) request URL = `{region}-aiplatform.googleapis.com/.../publishers/google/models/{wire-id}:streamGenerateContent?alt=sse`, (2) `Authorization: Bearer <stub>` header present and **no `?key=`**, (3) the request body equals `buildGeminiRequestBody(...)` output (reuse proof), (4) SSE chunk fixtures map to the same `content_delta`/`reasoning_delta`/`tool_call_start` events as the Gemini matrix (the new `STREAM_TEST_MATRIX` `vertex` rows), (5) error mapping per D-ERR1 (`401/403/404/429/5xx` → `retryable` only on `429`/`5xx`), (6) the §C collision guard (no Vertex id equals a Gemini id), (7) `resolveProviderCredential('vertex')` returns `none` and the dispatch still passes the mesh `validateAuth` gate (§B), (8) D-ADC1 cache/single-flight/skew behaviour with a fake clock + stub mint.
- **No live Vertex calls in CI** — sentinel-gated (§F); the credential-gated live-AI split pattern (BR-14c) applies.

## 7. Dependencies & scope

- **No new package runtime dependency in `@sentropic/llm-mesh`** (it stays HTTP-free / dependency-light; it MUST NOT import `google-auth-library`). The package change is types + catalog data only (+ optional descriptor types under deferred D2/Option B).
- **ADC token minting in `api/`**: prefer dependency-light. Options: (a) `google-auth-library` in `api/` only (handles SA-JSON + metadata-server + workload-identity uniformly) — préconisation if a thin hand-rolled minter is fragile; (b) a thin `fetch` against the GCE/GKE **metadata server** (`http://metadata.google.internal/.../token`) for k8s/workload-identity plus a small JWT-bearer flow for SA-JSON. Reco: start with the metadata-server thin path for the k8s deploy target; add `google-auth-library` (api-only dep, installed via `make install-api google-auth-library`) if SA-JSON/local-dev ergonomics require it. Either way the dep is confined to `api/`, never the published package.
- **M6 — lockfile scope (verified).** If `google-auth-library` (or any new dep) is added to `api/package.json`, the dependency-add step MUST run the make lock targets (`make lock-api`, verified `Makefile:420`; and `make lock-root`, verified `Makefile:425`, when the workspace install touches the root lock) and commit the regenerated lockfile(s) alongside `api/package.json`. Both `api/package-lock.json` and root `package-lock.json` exist today and `google-auth-library` is absent from both — so adding it changes both. Both lockfiles are part of the `API_VERSION` content hash (verified `Makefile:34`), so a stale lock would also break the version/cache lane. `api/package-lock.json` and `package-lock.json` are therefore in the `BR42f-EX1` file list.
- **Scope / paths.** Allowed (no exception): `packages/llm-mesh/src/**`, `packages/llm-mesh/tests/**`, `packages/llm-mesh/package.json` (version bump), `spec/SPEC_EVOL_LLM_MESH_VERTEX.md`, this branch's `plan/42f-BRANCH_feat-llm-mesh-vertex-ai.md`. **Conditional (requires `BR42f-EX1`):** the `api/**` files enumerated in §5.D5 + `api/tests/api/models.test.ts` (M1) (`vertex-provider.ts` new, `provider-registry.ts`, `llm-runtime/index.ts`, `llm-runtime/mesh-dispatch.ts`, `provider-credentials.ts`, `model-catalog.ts`, `config/env.ts`, `routes/api/me.ts`, `routes/api/ai-settings.ts`, `tests/unit/**`, `tests/api/models.test.ts`), PLUS the UAT/lock/dep enablers: `Makefile` (new `vertex-live-uat` target — M3), `api/src/scripts/vertex-live-uat.ts` (new — M3), `.gitignore` (SA-key entry — M3), `api/package.json` (dep add), `api/package-lock.json` + root `package-lock.json` (M6 — only if a dep is added). **Forbidden:** `docker-compose*.yml` (M3 — explicitly NOT in EX1; UAT is make-only), `ui/**` (M5 — Vertex intentionally NOT browser-selectable in this lot), `.cursor/rules/**`, any `api/**` not enumerated above. **The whole branch is infeasible without `BR42f-EX1`** — this is the single most important scope decision for the conductor to resolve before launching implementation.
- **M5 — UI provider-selector exposure DEFERRED to BR-42b/later.** Three UI selectors hardcode-reject `vertex` (verified `ui/src/routes/settings/+page.svelte:161` `validProviderIds = ['openai','gemini','anthropic','mistral','cohere']`; `ui/src/lib/components/chat/AppChatPanel.svelte:4167` 5-way provider guard; `ui/src/routes/folder/new/+page.svelte:122` 5-way provider guard). For BR-42f, Vertex is **intentionally NOT browser-selectable**: `ui/**` stays **FORBIDDEN**, and UAT proves the live call at the api/mesh layer (not the browser selector). Surfacing `vertex` in the UI selectors is deferred to BR-42b/later (recorded under deferred items).

## RETURN — decisions for the user batch

**Reversible (decided now, recorded; no user action required unless they object):** R1 REUSE mapper · R2 `vertex` opt-in (no default-routing change) · R3 region/project as env+`providerOptions` config · R4 defer Claude/Llama-on-Vertex · R5 ADC mint+cache in `api/`, presented to the mesh as a **`direct-token`** holding the pre-dispatch-minted short-lived bearer (passes `validateAuth` AND forwards through `extractCredential`; envVar-only `environment-token` rejected — M2) · plus the engineering sub-decisions D-ADC1 (cache key/skew/single-flight/no-token-logging) · D-ERR1 (status→retryable mapping) · D-ADC2 (sync `ready` from config) · §C global-unique vertex-qualified ids.

**Blocking (need the user, batch as ONE packet):**
1. **BR42f-D1 — durable provider name `vertex`** (vs `vertex-ai`, vs a `gemini` mode). Reco: `vertex`. Stakes: leaks into env vars, `ProviderId` union, catalog, registry, two route zod enums, UI selectors; hard to rename post-publish.
2. **BR42f-D2 — auth model**: Option A (server-side ADC mint, carried as a **`direct-token`** holding the pre-dispatch-minted bearer at the mesh gate, bypass string resolver for `vertex`) now, Option B (`gcp-adc` material) deferred. Reco: A-now/B-later. (Includes the §B ordering fix AND the M2 forward-path fix — both mandatory for callability; envVar-only `environment-token` rejected as carrier.)
3. **BR42f-D3 — GCP project + region + live model ids**: the user must provide a real `VERTEX_PROJECT_ID` + `VERTEX_LOCATION`, and the **exact callable Gemini-on-Vertex wire ids** in that region for UAT confirmation (expressed in-catalog as globally-unique `google/<model>@vertex` keys). Reco: minimal Gemini-on-Vertex pair, one region, opt-in only, UAT-confirmed before merge.
4. **BR42f-EX1 — scope exception approval**: confirm the `api/**` file list in §5.D5 is authorised (the branch is infeasible otherwise), and confirm whether `provider-connections.ts` (admin panel) is in or out (reco: OUT for BR-42f).

Do not commit (planning-only).
