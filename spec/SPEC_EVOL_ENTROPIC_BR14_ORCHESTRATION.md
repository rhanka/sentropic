# Entropic BR-14 Orchestration Spec

This spec supersedes the old single-branch BR-14 plans. BR-14 is now a coordinated set of branches with one selected execution order.

## Selected Execution Order

Execution order is not alphabetical:

1. **PR-117 release actions** — confirm and execute the repository rename and public DNS/redirect plan, or explicitly defer execution to BR-14d with an owner and date.
2. **BR-14f `chore/node-workspace-monorepo-14f`** — introduce the root Node workspace and full-repo container mounts if the repo still isolates `api` and `ui` from future internal packages. This branch owns the repo/tooling baseline only, not the LLM mesh contract itself.
3. **BR-14c `feat/llm-mesh-sdk`** — first package/product branch. Publish the standalone LLM mesh library contract and consume the BR-14f baseline for the thin API proof path.
4. **BR-14b `refacto/llm-runtime-core`** — migrate the application LLM runtime onto the BR-14c mesh contract.
5. **BR-14a `feat/chat-ui-sdk`** — extract the chat UI SDK after the mesh contract is frozen. Lot 0 may scope in parallel, but implementation must not invent a separate provider abstraction.
6. **BR-14e `chore/entropic-codebase-finalization`** — final codebase sweep for non-chat and non-LLM application names, tests, public API labels, and compatibility decisions.
7. **BR-14d `chore/entropic-transition-ops`** — real transition branch for remaining repo/DNS/redirect/Scaleway/container/registry/secret/workflow rename work. This branch is mandatory unless every operational item is completed during PR-117 release.

## Options Considered

| Option | Order | Decision | Rationale |
| --- | --- | --- | --- |
| A | BR-14f -> BR-14c -> BR-14b -> BR-14a -> BR-14e -> BR-14d | Selected | Adds the minimal repo/tooling baseline first when internal packages cannot yet be consumed from API/UI containers, then keeps the original contract-first ordering for extracted packages. |
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
- Prepare clean consumption of future internal packages such as `@entropic/llm-mesh` and `@entropic/chat`.
- Do not move `api/` and `ui/` into `packages/`; the target layout remains app roots plus reusable packages.

Impact notes:

- BR-14c depends on BR-14f for the thin API proof path only; the mesh contract still belongs to BR-14c.
- BR-16a can continue in parallel, but will need a shallow rebase because its tests and local runtime rely on the same API/UI container wiring.
- BR-21a is low-impact and should preferably merge before BR-14f to avoid needless rebase churn on a near-finished branch.
- Current proof snapshot (2026-05-06): BR-14f is rebased on post-BR16a/post-BR21a `main`, PR #125 CI is green after rerunning the single live-AI flaky shard, and the isolated branch dev stack boots with `make dev API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f`. User smoke UAT remains on root `ENV=dev` with user data.

Activation plan:

- BR-14f is not a product branch. It is accepted only if it preserves CI, branch dev-stack capacity, and root user UAT capacity while enabling workspace package consumption.
- BR-14c is the first mandatory activation branch: create `packages/llm-mesh`, expose the `@entropic/llm-mesh` package, and prove API consumption through the root workspace without copy steps, path hacks, or direct app-root package coupling.
- BR-14b is the runtime activation branch: migrate application provider dispatch to the BR-14c mesh package and keep quotas, retries, streaming, structured output, tool calling, and audit behavior explicit.
- BR-14a is the UI/package activation branch: extract `@entropic/chat` while consuming provider/model behavior through the mesh contract or a narrow mesh-compatible interface.
- BR-14e and BR-14d are not activation substitutes. They close codebase naming and operational transition after the package/runtime/chat boundaries have been exercised.
- If BR-14c cannot consume a package from `packages/*` directly from `api/` under the BR-14f workspace wiring, BR-14f is incomplete and must be fixed before package extraction continues.

## BR-14c — LLM Mesh SDK

Branch: `feat/llm-mesh-sdk`

Goal: publish `@entropic/llm-mesh`, an open Vercel AI SDK-like model-access layer.

Minimum contract:

- Providers: OpenAI, Anthropic/Claude, Google/Gemini, Mistral, Cohere.
- Auth modes: direct token, user token, Codex-account mode.
- Later auth targets prepared, not fully implemented: Gemini Code Assist, Claude Code.
- Streaming contract normalized across providers.
- Tool-use capability represented explicitly per model.
- Capability matrix: context window, reasoning, tools, JSON/structured output, image/audio when available.
- Package API usable outside Top AI Ideas.

Exit criteria:

- Package boundary and public API documented.
- Existing app can call through the mesh in a thin integration path or proof branch.
- No chat UI extraction starts a competing provider abstraction.

## BR-14b — Runtime Core Migration

Branch: `refacto/llm-runtime-core`

Goal: migrate the application runtime to consume `@entropic/llm-mesh`.

Minimum contract:

- Replace app-specific provider dispatch with mesh adapters.
- Keep quota, retry, account resolution, and audit behavior explicit.
- Keep API behavior stable for existing chat and generation flows.
- Preserve deterministic unit tests for providers.
- Split live AI tests per provider so one provider failure does not hide another.

Exit criteria:

- Application runtime uses the mesh contract.
- Provider capability matrix is the single source of truth for runtime decisions.
- Chat service no longer imports provider-specific implementation details.

## BR-14a — Chat UI SDK

Branch: `feat/chat-ui-sdk`

Goal: extract `@entropic/chat` from web, Chrome, and VSCode surfaces.

Minimum contract:

- Shared chat transport, session, history, streaming, tool-call rendering, permissions bridge.
- Svelte reference implementation is allowed, but package boundaries must not lock the SDK to the current app routes.
- Chrome and VSCode integration points stay first-class test surfaces.
- Provider/model access goes through `@entropic/llm-mesh` or a narrow mesh-compatible interface.

Exit criteria:

- Chat package can be imported by a minimal external consumer.
- Web, Chrome, and VSCode chat surfaces still use one shared implementation path.
- BR-07 can consume the package for npm publishing/pretest work.

## BR-14d — Transition Operations

Branch: `chore/entropic-transition-ops`

Goal: execute the operational transition that remains after PR-117 release actions.

Mandatory scope:

- GitHub repository rename follow-up if not fully executed during PR-117 release.
- `entropic.sent-tech.ca` DNS and redirects from old `top-ai-ideas` hostnames.
- GitHub Pages custom domain and API hostname alignment.
- OAuth callback URLs, CORS origins, cookie domain, and allowed redirect URIs.
- Scaleway Container Serverless names.
- Scaleway registry image names.
- Secrets and environment variables with `TOP_AI`, `top-ai`, or `top-ai-ideas`.
- GitHub Actions workflow names, environment names, badges, and deployment metadata.
- Cockpit dashboards, logs, alerts, and runbooks.

Exit criteria:

- Old public URLs redirect or alias to the canonical Entropic URLs.
- New deployment objects are active and monitored.
- Old deployment objects are retained during a rollback window, then explicitly retired.
- No source file contains stale package or deployment names except documented compatibility aliases.

## BR-14e — Codebase Finalization

Branch: `chore/entropic-codebase-finalization`

Goal: close the rebrand at codebase level after BR-14a/14b/14c have settled package/runtime/chat boundaries and before BR-14d executes the final operational transition.

Mandatory scope:

- Inventory all remaining `top-ai`, `top_ai`, `topai`, `TOP_AI`, `Top AI Ideas`, `top-ai-ideas`, `@top-ai`, and old hostnames.
- Classify each occurrence as:
  - `rename now` — stale project/repo/package/runtime/deployment identity.
  - `business case keep` — intentional reference to Top AI Ideas as the first application built on Entropic.
  - `compat alias` — old external identifier retained temporarily for redirect/backward compatibility.
  - `historical docs` — completed branch notes or historical specs that should not be rewritten.
- Rename API/UI package names, public titles, OpenAPI/API labels, auth email branding, import/export source markers, report labels, test fixtures, and non-chat/non-LLM shared prefixes.
- Update tests and fixtures to assert Entropic names where the old name is not intentionally retained.
- Produce a residual-name report before handoff to BR-14d.

Exit criteria:

- `rg` inventory has no unclassified stale names.
- All remaining old names are listed in an allowlist with owner, reason, and expiry condition.
- API and UI tests pass after the final naming sweep.
- BR-14d receives a stable list of deployment/DNS/secret/workflow names to execute operationally.

## Coordination Rules

- BR-14f owns the repo/tooling baseline required for internal Node packages to be consumable from `api` and `ui`.
- BR-14c owns the public model-access contract.
- BR-14b owns application runtime migration to that contract.
- BR-14a owns chat UI/package extraction and must not redefine provider/model access.
- BR-14e owns final codebase naming cleanup outside the narrower chat, LLM, and ops scopes.
- BR-14d owns operational transition work and is not optional.
- Each branch must create its own `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` before implementation.
- Each branch must list file-level tests and UAT surfaces before coding.
