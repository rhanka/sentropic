# SPEC — Provider `local` (llm-mesh)

> Origin: transferred from `rhanka/kog` (`spec/SPEC_STUDY_LOCAL_PROVIDER.md`) per the
> handoff of PR #378. The `local` provider was merged + published (llm-mesh 0.6.0,
> llm-gateway 0.2.1) **before** architect/h2a review — this doc exists so the contract
> is recorded in-repo for retro-ratification by the architect.

**Provider name (user decision):** `local` — generic, reusable for any host-local
OpenAI-compatible backend (not Laneformer-specific).

**Open question (user):** should `local` support a **list of models**? → **Yes.** The
provider must expose N models (e.g. Laneformer variants + future quantized models),
not a single hard-coded one.

---

## Status — as built (PR #378, merge commit `36b816a2c`)

- **llm-mesh**: `local` is the 7th `providerId`; `LocalAdapter`; provider profile
  `family: openai`, `reasoning: unsupported`, `structuredOutput: unsupported`;
  `knownModelIdsByProvider.local = ['laneformer-2b-it']`. Package stays transport-free.
- **api**: `LocalProviderRuntime` (`api/src/services/providers/local-provider.ts`) — an
  OpenAI-compatible client to the host sidecar, `baseURL` default `http://127.0.0.1:8089`,
  overridable via `LOCAL_INFERENCE_BASE_URL`, unauthenticated. Registered in
  `provider-registry.ts`.
- **Scoped out (follow-up, owned by the llm-mesh build lane)**: advertising the *model*
  `laneformer-2b-it` in the **static** runtime catalog (`modelProfiles`) requires a
  per-model `STREAM_TEST_MATRIX` fixture (`api/tests/unit/llm-runtime-stream.test.ts`) +
  a `local` chat-completions normalizer in `api/src/services/llm-runtime/index.ts`. Until
  then the sidecar serves the model on **direct selection**.

---

## Base contract

The sidecar already exposes the standard OpenAI API:
- `GET /v1/models` → available models
- `POST /v1/chat/completions` with a `model` field → selection

`local` is therefore an OpenAI-compatible provider pointing at `http://127.0.0.1:PORT`.

---

## Handling the model list — 3 options

### Option 1 — One multi-model sidecar (route by `model` field)
A single process loads several models and routes by `model`.
**Pro:** one endpoint, native discovery via `/v1/models`.
**Con:** N models × 2–5 GB loaded simultaneously blows the memory cap. Lazy loading is
possible but complex (eviction, cold start).

### Option 2 — One sidecar per model (one port each) ⭐ recommended
Each model is a process on its own port; the `local` provider holds a
`modelId → baseUrl` table.
**Pro:** clean memory isolation (start/stop per model); the memory cap applies per model;
discovery = aggregate each active sidecar's `/v1/models`.
**Con:** multi-process orchestration (mitigated by `make start MODEL=…`).

### Option 3 — One model at a time (swap by restart)
A single sidecar, `MODEL_ID` changed on restart.
**Pro:** simplest, minimal memory.
**Con:** no concurrent multi-model; slow swap (full reload).

---

## Recommendation

**Option 2** as the target architecture, with **Option 3** as the immediate default (one
active model today: `laneformer-2b-it` on `:8089`).

Proposed (reversible) sentropic config shape:

```ts
// llm-mesh — local provider
{
  provider: "local",
  models: [
    { id: "laneformer-2b-it",      baseUrl: "http://127.0.0.1:8089" },
    // future:
    // { id: "laneformer-2b-it-int8", baseUrl: "http://127.0.0.1:8090" },
    // { id: "coder-npu-q4",          baseUrl: "http://127.0.0.1:8091" },
  ],
  enabled: false,  // disabled by default
}
```

Dynamic discovery (aggregated `GET /v1/models`) can come in V2; a static config list is
enough to start and stays explicit/auditable.

---

## Decisions for the architect (retro-ratification)

- **D-local-0 (retro):** ratify the 7th *published* provider contract (`local`) added
  without the D-gate. Additive, non-breaking, but published on npm ⇒ not cleanly
  reversible.
- **D-local-1:** static discovery (config) first, dynamic (`/v1/models` polling) later?
  → proposed: static first.
- **D-local-2:** a port registry (8089→…) driven by `make start MODEL=x`? → wire when the
  2nd model lands.
- **D-local-3:** external `model` id = `local/laneformer-2b-it` (provider-prefixed) or
  just `laneformer-2b-it`? → sentropic convention to confirm at wiring time.
