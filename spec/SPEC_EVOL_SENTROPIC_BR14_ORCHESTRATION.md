# Sentropic BR-14 Orchestration Spec

This spec supersedes the old single-branch BR-14 plans. BR-14 is now a coordinated set of branches with one selected execution order.

## Selected Execution Order

Execution order is not alphabetical:

1. **PR-117 release actions** — confirm and execute the repository rename and public DNS/redirect plan, or explicitly defer execution to BR-14d with an owner and date.
2. **BR-14f `chore/node-workspace-monorepo-14f`** — introduce the root Node workspace and full-repo container mounts if the repo still isolates `api` and `ui` from future internal packages. This branch owns the repo/tooling baseline only, not the LLM mesh contract itself.
3. **BR-14c `feat/llm-mesh-sdk`** — first package/product branch. Publish the standalone LLM mesh library to npm and cut the application LLM runtime over to it in the same branch. This is a refactor/isolate/publish cutover, not a proof-only branch.
4. **BR-14g `feat/model-catalog-gpt55-opus47`** — pivot model catalog defaults and compatibility rules to GPT-5.5 and Claude Opus 4.7, while keeping GPT-5.4 Nano unchanged. This runs after BR-14c so the change lands against the live mesh-backed model-profile contract.
5. **BR-14b `refacto/chat-service-core`** — modularize the chat-service logic above the LLM runtime: reasoning loop, tool loop, continuation boundaries, and reusable chat orchestration pieces that do not belong in `@sentropic/llm-mesh`.
6. **BR-14a `feat/chat-ui-sdk`** — extract the chat UI SDK after the mesh contract is frozen. Lot 0 may scope in parallel, but implementation must not invent a separate provider abstraction.
7. **BR-14e `chore/sentropic-codebase-finalization`** — final codebase sweep for non-chat and non-LLM application names, tests, public API labels, and compatibility decisions.
8. **BR-14d `chore/sentropic-transition-ops`** — real transition branch for remaining repo/DNS/redirect/Scaleway/container/registry/secret/workflow rename work. This branch is mandatory unless every operational item is completed during PR-117 release.

## Options Considered

| Option | Order | Decision | Rationale |
| --- | --- | --- | --- |
| A | BR-14f -> BR-14c -> BR-14g -> BR-14b -> BR-14a -> BR-14e -> BR-14d | Selected | Adds the minimal repo/tooling baseline first when internal packages cannot yet be consumed from API/UI containers. BR-14c then publishes the mesh package to npm and performs the strict runtime cutover in one branch, BR-14g updates model versions against the live mesh contract, and BR-14b modularizes chat-service logic above the runtime. |
| B | BR-14c -> BR-14b -> BR-14a -> BR-14e -> BR-14d | Rejected as current-state default | This was correct only if the existing repo already behaved like a Node workspace monorepo. It does not when `api`/`ui` are mounted as isolated containers, so BR-14c cannot prove a thin app consumption path cleanly. |
| C | BR-14a -> BR-14b -> BR-14c -> BR-14e -> BR-14d | Rejected | Repeats the current problem: chat SDK would define transport/provider seams before the reusable LLM mesh contract exists. |
| D | BR-14d -> BR-14f -> BR-14c -> BR-14b -> BR-14a -> BR-14e | Rejected as default | Renaming all operational objects before package boundaries and code names are stable creates repeated DNS/container/secret churn. Can be used only if repo/DNS changes block development. |

## Audit Finding — BR-14e Required

The initial inventory is broader than chat, LLM runtime, or operational objects. Examples found outside BR-14a/14b/14c/14d ownership:

- API and UI package names: `api/package.json`, `ui/package.json`, lockfiles.
- API public labels: OpenAPI title, root API response, WebAuthn RP name, auth email subjects/templates.
- Export/import metadata: source markers such as `top-ai-ideas`.
- UI application labels and routes: `<title>`, report cover, locales, DOCX report labels.
- Tests and fixtures that encode old repo/package/download names.
- Shared `topai` prefixes and event names that are not strictly owned by the chat SDK extraction.

BR-14e is therefore required unless an implementation branch proves, with an inventory report, that every non-owned occurrence was already intentionally handled.

## BR-14f — Node Workspace Monorepo Infra

Branch: `chore/node-workspace-monorepo-14f`

Goal: make the repo behave like a real Node workspace monorepo for `api`, `ui`, and future internal packages without replacing `make` as the top-level orchestrator.

Minimum contract:

- Add a private root `package.json` with Node workspace metadata.
- Move container mounts from per-app subdirectories to the repo root with explicit working directories for `api` and `ui`.
- Keep `make` as the entrypoint; do not introduce Nx as a required orchestrator.
- Prepare clean consumption of future internal packages such as `@sentropic/llm-mesh` and `@sentropic/chat`.
- Do not move `api/` and `ui/` into `packages/`; the target layout remains app roots plus reusable packages.

Impact notes:

- BR-14c depends on BR-14f for real workspace package consumption from the API. The mesh contract and application runtime cutover both belong to BR-14c.
- BR-16a can continue in parallel, but will need a shallow rebase because its tests and local runtime rely on the same API/UI container wiring.
- BR-21a is low-impact and should preferably merge before BR-14f to avoid needless rebase churn on a near-finished branch.
- Current proof snapshot (2026-05-06): BR-14f is rebased on post-BR16a/post-BR21a `main`, PR #125 CI is green after rerunning external-network failures, the isolated branch dev stack boots with `make dev API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f`, and root user smoke UAT is validated on `ENV=dev` with user data.

Activation plan:

- BR-14f is not a product branch. It is accepted only if it preserves CI, branch dev-stack capacity, and root user UAT capacity while enabling workspace package consumption.
- BR-14c is the first mandatory activation branch: create `packages/llm-mesh`, expose the `@sentropic/llm-mesh` package, publish it to npm through CI/CD, migrate the application LLM runtime to that package, and delete the app-local runtime code it replaces. No double runtime path, feature flag, compatibility bridge, fallback alias, copy step, path hack, or direct app-root package coupling is allowed.
- BR-14g is the model catalog activation branch: move the OpenAI default from GPT-5.4 to GPT-5.5, keep GPT-5.4 Nano available, move Claude Opus 4.6 to Opus 4.7, and update compatibility/default rules against the mesh model-profile contract.
- BR-14b is the chat-service modularization branch above the model runtime: extract and stabilize reasoning-loop, tool-loop, continuation, and orchestration boundaries after BR-14c has already moved model access to the mesh.
- BR-14a is the UI/package activation branch: extract `@sentropic/chat` while consuming provider/model behavior through the mesh contract or a narrow mesh-compatible interface.
- BR-14e and BR-14d are not activation substitutes. They close codebase naming and operational transition after the package/runtime/chat boundaries have been exercised.
- If BR-14c cannot consume `@sentropic/llm-mesh` directly from `api/` under the BR-14f workspace wiring, the branch is incomplete. A relative source import such as `../../packages/...` is not a valid exit criterion.

## BR-14c — LLM Mesh SDK

Branch: `feat/llm-mesh-sdk`

Goal: publish `@sentropic/llm-mesh` to npm, an open Vercel AI SDK-like model-access layer, and migrate the application LLM runtime to it in a strict cutover.

Minimum contract:

- Providers: OpenAI, Anthropic/Claude, Google/Gemini, Mistral, Cohere.
- Auth modes: direct token, user token, Codex-account mode.
- Later auth targets prepared, not fully implemented: Gemini Code Assist, Claude Code.
- Streaming contract normalized across providers.
- Tool-use capability represented explicitly per model.
- Capability matrix: context window, reasoning, tools, JSON/structured output, image/audio when available.
- Package API usable outside Top AI Ideas.
- API runtime imports `@sentropic/llm-mesh` as a workspace package.
- Application LLM runtime dispatch uses the mesh package.
- Replaced app-local provider/runtime functions are deleted in the same branch.
- CI/CD validates, packs, and publishes `@sentropic/llm-mesh` as the first `@sentropic` npm library.
- Current behavior is preserved for credential precedence, quotas, retries, streaming order, tool-call continuation, reasoning controls, traces/audit metadata, and live AI tests.

Exit criteria:

- Package boundary and public API documented.
- Package metadata, README, dist build, pack check, and CI npm publish lane are ready before merge.
- Existing app calls through the mesh in the live runtime path.
- No duplicated legacy runtime path remains for responsibilities moved into `@sentropic/llm-mesh`.
- No chat UI extraction starts a competing provider abstraction.

BR-14c implementation snapshot:

- `packages/llm-mesh` defines the public contract, static model/provider profiles, capability statuses, normalized generation and stream events, tool/result payloads, error normalization, auth descriptors, and deterministic adapter scaffolds.
- `createLlmMesh({ registry, authResolver, hooks })` provides the minimal facade for `generate()` and `stream()`.
- The API imports `@sentropic/llm-mesh` as a real workspace package through `api/src/services/llm-runtime/mesh-dispatch.ts`.
- Application runtime dispatch for `callLLM` and `callLLMStream` is cut over to the mesh facade; replaced app-local runtime dispatch selectors are removed.
- CI/CD detects `packages/llm-mesh/**`, validates typecheck/test/build/pack on PRs, and publishes `@sentropic/llm-mesh` on `main` through npm Trusted Publishing with GitHub OIDC, without a long-lived npm publish token.
- Local dev/test startup prepares mounted workspace `node_modules` and package `dist/` artifacts before API boot, so branch UAT/dev stacks exercise the same package import boundary.
- Live AI validation remains split by command and credential gate; the BR-14c default OpenAI test model passed `chat-sync` and `chat-tools` on the branch test environment.
- BR-14c leaves the model-version pivot to BR-14g and chat-service modularization above the runtime to BR-14b.

## BR-14g — Model Catalog GPT-5.5 / Opus 4.7 Pivot

Branch: `feat/model-catalog-gpt55-opus47`

Goal: update the model catalog and compatibility rules after the mesh contract is frozen, without mixing provider version churn into BR-14c package extraction.

Minimum contract:

- OpenAI default reasoning model pivots from GPT-5.4 to GPT-5.5.
- GPT-5.4 Nano remains available and must not be migrated to GPT-5.5.
- Anthropic Claude Opus pivots from Opus 4.6 to Opus 4.7.
- Provider API model identifiers must be verified at branch start before code changes; labels alone are not sufficient.
- Model profile capabilities, reasoning tiers, context budgets, defaults, legacy cutover rules, API tests, package catalog tests, and chat display labels must remain consistent.
- BR-14g must not migrate runtime dispatch; BR-14c owns runtime migration. BR-14g updates the already mesh-backed catalogs/defaults.

Exit criteria:

- `@sentropic/llm-mesh` and application model catalogs expose the new model profiles consistently.
- Legacy defaults that pointed to GPT-5.4 are intentionally mapped to GPT-5.5 where appropriate.
- GPT-5.4 Nano remains selectable and unchanged.
- Claude Opus 4.6 references are removed or documented as compatibility aliases.
- Unit/API tests cover model listing, defaults, and legacy cutover behavior.

## BR-14b — Chat Service Core Modularization

Branch: `refacto/chat-service-core`

Goal: modularize reusable chat-service behavior above `@sentropic/llm-mesh` after BR-14c has completed model runtime cutover.

Minimum contract:

- Extract reasoning-loop and tool-loop boundaries from the monolithic chat service without redefining provider/model access.
- Preserve current chat streaming, local-tool handoff, tool-result continuation, cancellation, retry, checkpoint, trace, and audit semantics.
- Keep API behavior stable for existing chat and generation flows.
- Use `@sentropic/llm-mesh` as the only model-access layer.
- Prepare later publication of chat/workflow packages without coupling them back to app-local model providers.

Exit criteria:

- Chat service no longer owns reusable model-access concerns already provided by the mesh.
- Reasoning/tool orchestration boundaries are testable without provider-specific runtime details.
- No competing provider/model abstraction is introduced.

## BR-14a — Chat UI SDK

Branch: `feat/chat-ui-sdk`

Goal: extract `@sentropic/chat` from web, Chrome, and VSCode surfaces.

Minimum contract:

- Shared chat transport, session, history, streaming, tool-call rendering, permissions bridge.
- Svelte reference implementation is allowed, but package boundaries must not lock the SDK to the current app routes.
- Chrome and VSCode integration points stay first-class test surfaces.
- Provider/model access goes through `@sentropic/llm-mesh` or a narrow mesh-compatible interface.

Exit criteria:

- Chat package can be imported by a minimal external consumer.
- Web, Chrome, and VSCode chat surfaces still use one shared implementation path.
- BR-07 can consume the package for npm publishing/pretest work.

## BR-14d — Transition Operations

Branch: `chore/sentropic-transition-ops`

Goal: execute the operational transition that remains after PR-117 release actions.

Mandatory scope:

- GitHub repository rename follow-up if not fully executed during PR-117 release.
- `sentropic.sent-tech.ca` DNS and redirects from old `top-ai-ideas` hostnames.
- GitHub Pages custom domain and API hostname alignment.
- OAuth callback URLs, CORS origins, cookie domain, and allowed redirect URIs.
- Scaleway Container Serverless names.
- Scaleway registry image names.
- Secrets and environment variables with `TOP_AI`, `top-ai`, or `top-ai-ideas`.
- GitHub Actions workflow names, environment names, badges, and deployment metadata.
- Cockpit dashboards, logs, alerts, and runbooks.

Exit criteria:

- Old public URLs redirect or alias to the canonical Sentropic URLs.
- New deployment objects are active and monitored.
- Old deployment objects are retained during a rollback window, then explicitly retired.
- No source file contains stale package or deployment names except documented compatibility aliases.

## BR-14e — Codebase Finalization

Branch: `chore/sentropic-codebase-finalization`

Goal: close the rebrand at codebase level after BR-14a/14b/14c have settled package/runtime/chat boundaries and before BR-14d executes the final operational transition.

Mandatory scope:

- Inventory all remaining `top-ai`, `top_ai`, `topai`, `TOP_AI`, `Top AI Ideas`, `top-ai-ideas`, `@top-ai`, and old hostnames.
- Classify each occurrence as:
  - `rename now` — stale project/repo/package/runtime/deployment identity.
  - `business case keep` — intentional reference to Top AI Ideas as the first application built on Sentropic.
  - `compat alias` — old external identifier retained temporarily for redirect/backward compatibility.
  - `historical docs` — completed branch notes or historical specs that should not be rewritten.
- Rename API/UI package names, public titles, OpenAPI/API labels, auth email branding, import/export source markers, report labels, test fixtures, and non-chat/non-LLM shared prefixes.
- Update tests and fixtures to assert Sentropic names where the old name is not intentionally retained.
- Produce a residual-name report before handoff to BR-14d.

Exit criteria:

- `rg` inventory has no unclassified stale names.
- All remaining old names are listed in an allowlist with owner, reason, and expiry condition.
- API and UI tests pass after the final naming sweep.
- BR-14d receives a stable list of deployment/DNS/secret/workflow names to execute operationally.

## Coordination Rules

- BR-14f owns the repo/tooling baseline required for internal Node packages to be consumable from `api` and `ui`.
- BR-14c owns the public model-access contract and application runtime migration to that contract.
- BR-14b owns chat-service modularization above that contract.
- BR-14a owns chat UI/package extraction and must not redefine provider/model access.
- BR-14e owns final codebase naming cleanup outside the narrower chat, LLM, and ops scopes.
- BR-14d owns operational transition work and is not optional.
- Each branch must create its own `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` before implementation.
- Each branch must list file-level tests and UAT surfaces before coding.
