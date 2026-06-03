# SPEC EVOL — Build-App CLI (`sentropic-build-app`)

Status: Scoping / brainstorm (planning-only) for **BR-42a `feat/build-app-cli`**. No code, no branch, no worktree produced by this document. Output of read-only analysis on `main` HEAD, 2026-05-31.

## Review log

- **2026-05-31** — Revised after a double adversarial review (**Opus 4.8** + **Codex 5.5-high**). Both reviewers converged (no conflicts). Verdict: **revised per findings**. The revision corrects six factual errors (a non-existent `chat-core/server` export, wrong wire endpoints, a false "no design-system" premise, a non-existent `fake` provider, a wrong provider id `google`, and a mis-cited BR-25 figure), reclassifies four decisions, adds five new blocking decisions (backend wire seam, h2a artifact, GitHub repo-creation permissions, CI/publish lane + scope exception, licensing), and tightens the pre-test/UAT plan for hermeticity. Each correction was re-verified against the repo (see inline `Verified` notes).

Owner branch (to create): `feat/build-app-cli`.

Family umbrella: `plan/42-BRANCH_chore-scale-build-app.md` (BR-42 "scale / build-app foundry"). Architecture anchor: `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §16 (build-app iteration), §6 (harness), §10.1 (third-party CLI use case), §10.7 (session offload), §13/§14 (graphify, agent templating). Trust-model consumption seam: `handover-h2a-trust-concepts.md` + `b2b2b-sentropic-eval.md` (h2a EVO-9, owned by `claude:a2a-cli`).

This spec is decision-oriented. The single most consequential section is **§5 Decisions ledger**, which splits every decision into *Reversible (decide now)* and *Blocking / high-stakes (defer to batch)*. The **#1 scope risk** is the backend wire seam (**BR42a-E**): there is no shippable server export today, so the template must own its own minimal Hono routes — read §3.5 and §5.2-E first.

---

## 1. Purpose & non-goals

### 1.1 Purpose

`sentropic-build-app` is **a CLI for app construction**, the first concrete "foundry" surface of the BR-42 scale program. It lives **inside the sentropic monorepo** (add internal structure, no repo split — confirmed §16 and `plan/42`).

The **MVP is a scaffolder**. Its single headline command, `init <name>`, bootstraps a **runnable `chat-ui` ↔ backend application** that:

- consumes the published `@sentropic/*` chat stack (`@sentropic/chat-ui` 0.1.1, `@sentropic/chat-core` 0.1.2, `@sentropic/llm-mesh` 0.1.2) plus the published design surface (`@sentropic/design-system-svelte` + themes + tokens — see §4.1 + BR42a-G/§5.2-R7);
- is immediately runnable via its own `make dev` (web UI served, a **template-owned** backend serving the `/chat/sessions/:id/*` wire contract that `@sentropic/chat-ui` consumes, a chat round-trip works against a deterministic offline adapter or a BYO provider);
- has its **GitHub repository created and the initial commit pushed**.

A second motive is *forcing function*: the scaffolder cannot emit a working app without **librarising the templating substrate** that today lives application-locally in `api/src/services/*` (`view-template-service.ts`, `docx-service.ts`, `docx-generation.ts`, `docx-freeform-helpers.ts`, `docx-render-worker.ts`) and in `api/templates/*.docx`. The MVP extracts the *minimal generator/templating substrate the CLI itself needs* (file templating, token substitution, scaffold manifest), and records — but does not necessarily ship — the larger DOCX doc-gen extraction (see §4.4 + BR42a-Q4).

`sentropic-build-app` is the **downstream consumer** of the h2a EVO-9 trust model. The MVP only wires the *consumption seam* (an optional "register this app/repo with an h2a instance" step, default off) — it does **not** design or own any h2a concept. See §3.6.

### 1.2 Non-goals (MVP)

- **No app evolution loop.** "Manage spec/evolutions via the UI", background branch agents, attention-raising via h2a — all deferred (this is the `init` scaffolder, not the runtime developer console). See §7.
- **No deploy / hosting / GitOps.** scw/gcp/aws/azure/ovh, k8s-bare/openshift, the `sentropic`↔`k8s-ops` PaaS contract — all deferred to the multi-cloud deploy workstream (§16.5, coordinate `claude:poc-k8s`).
- **No catalog/comments/persistence/flow/mesh/events extensions.** Those are sibling lots BR-42b..g; BR-42a is the *integrator* that consumes them as they land, not their owner.
- **No "central sentropic instance" / multi-tenant managed h2a MCP / BYO-h2a.** Deferred (§16.5, `plan/42`).
- **No iii integration-parity work.** That is the independent-design program tracked elsewhere; BR-42a only inherits its motivation.
- **No application relocation.** The "move the current Top AI Ideas app to another repo, keep this repo lib-only" question (user prompt 1) is an org-level decision, explicitly *not* taken here.
- **No full app generator.** `init` produces *one* opinionated app shape (chat-ui ↔ backend). No multi-preset matrix, no business-workspace generation (ai-ideas/opportunity/code), no Chrome/VSCode-extension scaffolding in the MVP.
- **No backend wire-protocol package extraction.** The MVP does **not** publish a `@sentropic/chat-server` or a `chat-core/server` subentry; it ships template-owned routes and *records* the extraction as a follow-up (BR42a-E).

---

## 2. CLI surface

### 2.1 Binary & verbs (MVP)

The binary name is a **durable, blocking decision** — see §5.2 BR42a-B. For the rest of this spec the working placeholder is `sentropic-build-app`. The **verb surface is a public CLI contract** (R4) — flag names and verb names are an external API renaming-after-release is costly, so the verb set is fixed deliberately even though it is "reversible-ish".

MVP verbs:

| Verb | Status | Purpose |
|---|---|---|
| `init <name>` | MVP (headline) | Scaffold + (optionally) create GitHub repo + first commit. The whole MVP. |
| `--version` / `-v` | MVP | Print CLI + template-package versions. |
| `--help` / `-h` | MVP | Usage. Per-verb help (`init --help`). |
| `doctor` | MVP (thin) | Pre-flight: Docker present, `make` present, `gh` auth status, Node/engines, port availability. Non-mutating. Gates a clean `init`. |

Deferred verbs (named here so the surface is forward-compatible, **not** built in MVP): `add <capability>` (wire a catalog capability), `dev` (proxy to generated `make dev`), `deploy`, `evolve`/`spec` (the UI-driven evolution loop), `register` (standalone h2a registration). See §7.

### 2.2 `init <name>` — flags

```
sentropic-build-app init <name> [flags]
```

| Flag | Default | Meaning |
|---|---|---|
| `--dir <path>` | `./<name>` | Target directory. Must be empty or non-existent (no overwrite without `--force`; see `--force` semantics below). |
| `--package-manager` | `npm` | Reserved; MVP only validates `npm` (monorepo is npm-based; `package-lock.json` present). |
| `--provider <id>` | `stub` | Seed default provider for the generated app: `stub` (deterministic, offline, template-owned adapter — used by the smoke test, see §4.1) or a real `@sentropic/llm-mesh` provider id (`openai`, `gemini`, `anthropic`, `mistral`, `cohere`). Real providers scaffold a `.env.example` slot, never a baked key. **Note: `stub` is NOT an llm-mesh provider id** — it is a deterministic `ProviderAdapter` the template owns (see §4.1). |
| `--git` / `--no-git` | `--git` | Initialise a local git repo + first commit. |
| `--github` / `--no-github` | `--no-github` | Create the GitHub repo via `gh` and push. **Off by default** (network + auth side effect). When on, requires `gh auth status` OK (verified by `doctor`). See BR42a-G for ownership/collision/remote-mutation policy. |
| `--github-visibility` | `private` | `private` \| `public`. Only with `--github`. |
| `--github-owner <org>` | **explicit, no default** | Owner/org for the created repo. Required when `--github` is on; never inferred silently (BR42a-G). |
| `--h2a-register` | off | Consumption-seam stub: emit an h2a registration descriptor for the new app/repo. Default off, no h2a design. Descriptor shape is undecided (BR42a-F). See §3.6. |
| `--yes` / `-y` | off | Non-interactive: accept all defaults, fail (non-zero) on any unresolved required input instead of prompting. CI/test mode. |
| `--force` | off | Overwrite policy for a non-empty `--dir`. **Semantics are a blocking detail** — see "`--force` semantics" below; must be defined and tested *before* the flag is exposed. |
| `--dry-run` | off | Compute and print the full scaffold plan + intended GitHub action **without writing files or creating the repo**. Backs the repo-creation dry-run test (§6). |

**`--force` semantics (must be defined + tested before exposure):** three candidate behaviours — (a) **refuse-with-list**: when `--dir` is non-empty, print the conflicting paths and exit non-zero (safest; default when `--force` absent); (b) **overwrite**: replace only the files the scaffold owns, leave unrelated files untouched; (c) **merge**: write missing files, skip existing ones. Préconisation: without `--force` → (a) refuse-with-list; with `--force` → (b) overwrite-scaffold-owned-files-only (never blanket-delete the directory). Negative tests in §6.1 cover existing-dir and existing-git-repo cases.

### 2.3 Interactive vs non-interactive

- **Interactive (default, TTY):** minimal wizard — confirm app name, choose provider (`stub`/real), choose GitHub on/off + visibility/owner, confirm. Reuse the *existing* prompt ergonomics already vendored in the monorepo if any; do **not** add a heavy TUI framework (keep dependencies thin — §4.5).
- **Non-interactive (`--yes` or no TTY):** every required value comes from flags/defaults; missing required value → clear non-zero error. This is the mode the end-to-end smoke and CI use.

### 2.4 What `init <name>` produces — step by step

1. **Validate** (`doctor`-equivalent pre-flight): target dir empty/creatable; Docker + `make` present; if `--github`, `gh auth status` OK; engines satisfied. Fail fast, no partial writes.
2. **Resolve scaffold plan** from the **app-template package** (§3.3) + chosen options. (`--dry-run` stops here and prints the plan.)
3. **Materialise the app** into `--dir` from the template package: backend (Hono server owning minimal routes over `@sentropic/chat-core`'s `ChatRuntime` that match `@sentropic/chat-ui`'s default transport — `POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream`, `GET /chat/sessions/:id/bootstrap` — plus `@sentropic/llm-mesh` runtime, see §3.5 + BR42a-E), web UI (Svelte 5 app embedding `@sentropic/chat-ui` `ChatPanel`/`ChatWidget` + design surface), `Makefile` (or thin make include — see BR42a-Q5/BR42a-I) with at least `dev`/`down`/`typecheck`/`build`, `docker-compose.yml`, `.env.example`, `package.json` pinned to the published `@sentropic/*` versions, `README.md`, `LICENSE` (MIT — BR42a-I), `.gitignore` (**must exclude `.env`** before any commit/push — §6.1).
4. **Substitute tokens** (app name, ports, provider id, repo URL placeholder) via the librarised templating substrate (§4.4). Deterministic output (no timestamps/random in committed files) so the generator can be golden-tested (R10 invariant).
5. **`npm install`** inside the generated app via its own Docker-first flow (the generated app is itself Make-only/Docker-first; the CLI does **not** run host npm — it invokes the generated `make` bootstrap). *Open*: whether `init` runs install or leaves it to the user's first `make dev` — see BR42a-Q6 (reversible).
6. **git init + first commit** (`--git`), conventional message (`chore: scaffold <name> via sentropic-build-app`).
7. **GitHub repo** (`--github`): `gh repo create <owner>/<name> --<visibility> --source <dir> --push` (or equivalent). **No native `--dry-run` exists on `gh repo create`** — see BR42a-G + §6 for the safety design (never mutate an existing remote; refuse on name collision). Capturing the resulting URL, backfill the repo URL token into `package.json`/`README` *before the first commit* (preferred) or amend the first commit (fallback) — backfill-vs-amend is a BR42a-G sub-decision.
8. **h2a register stub** (`--h2a-register`): emit a descriptor file only (§3.6, BR42a-F). No network call to any h2a in MVP.
9. **Print next steps**: `cd <dir> && make dev`, the served URLs, and the UAT pointer.

The success contract: from a clean machine, `init <name> --yes --provider stub` produces a directory where `make dev` serves the UI and a chat round-trip completes against the deterministic stub adapter — proven by the smoke test (§6).

---

## 3. Architecture & ecosystem composition

### 3.1 The critical question — harness (§6 / BR-25) vs new package

`spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §6 ascribes to a future `@sentropic/harness` (BR-25): *"project init with three presets (minimal Node / Svelte app / Postgres durable)"*, *"branch scaffolding"*, *"rules/skills/plan/spec templates"*, *"conductor CLI"*, *"verify hooks"*. On the surface this **fully overlaps** with a scaffolding CLI. The honest analysis:

**Verified facts (not assumptions):**
- There is **no `@sentropic/harness` package** in `packages/` (verified: directory absent; `packages/` contains auth-hono, auth-ui, chat-core, chat-ui, contracts, cowork-bridge, cowork-desktop, events, flow, llm-mesh, skills).
- `@sentropic/harness` is, however, a **planned** package: it is named in `PLAN.md` (line 262 — *"Imported by @sentropic/harness (BR25) as peerDep"*, in the graphify-fusion BR-34 row) and is the BR-25 target in `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §6/§11. So harness is **planned, not hypothetical** — which *strengthens* the keep-separate recommendation: a planned generic substrate must not be pre-empted/bloated by a lib-coupled scaffolder.
- **BR-25 is `chore/rules-skills-audit`** — a *docs/rules-only* branch in **study mode**. The **"17/46 checkboxes" figure is from `PLAN.md` (line 55)**, not from `plan/25-BRANCH_chore-rules-skills-audit.md` (the plan file's checkboxes are unchecked; it carries no progress count). Its `Allowed Paths` are `rules/**`, `.claude/**`, and its own plan file; its `Forbidden Paths` explicitly include `api/**`, `ui/**`. It has **no package code mandate** (verified: `plan/25-BRANCH_chore-rules-skills-audit.md`). So "BR-25 harness" today = absorbing audit learnings into rules/skills + mechanical enforcement (hooks), **not** building a published scaffolder package.
- The §6 `@sentropic/harness` is therefore a **to-scope, planned intention**, not shipped code. Its presets describe *generic, runtime-agnostic, zero-private-dep* tooling that *must compile with a fake provider and in-memory adapters* (§6 rules: "no Drizzle, Hono, Svelte or Mistral lock-in inside harness").

**The boundary that resolves the overlap:**

| Axis | `@sentropic/harness` (§6 intention, planned) | `sentropic-build-app` (BR-42a) |
|---|---|---|
| Output | Generic project skeletons + dev-workflow tooling (rules/skills/plan/spec templates, conductor CLI, verify hooks) | One opinionated **runnable chat-ui↔backend product app** consuming the *real* `@sentropic/*` libs |
| Coupling | **Zero private deps**; explicitly forbids Hono/Svelte/Mistral lock-in | **Deliberately couples** to `@sentropic/chat-ui` (Svelte), template-owned Hono routes over `@sentropic/chat-core`, `@sentropic/llm-mesh`, design surface |
| Audience | Anyone building *any* sentropic-flavoured project/CLI (use case §10.1) | Someone who wants the *batteries-included sentropic app* + GitHub repo |
| Side effects | None mandated | **Creates a GitHub repo**, pushes, optional h2a register |

These are genuinely different products: harness = *generic, decoupled, zero-dep dev-workflow tooling*; build-app = *opinionated, lib-coupled, repo-creating app foundry*. Folding build-app into harness would **violate the §6 zero-private-dep / no-framework-lock-in invariant** (harness would suddenly depend on chat-ui/Svelte/Hono). Folding harness into build-app would betray harness's "tooling-only, zero runtime dependents" purpose.

**Recommendation (decision BR42a-A / §5.2-A):** ship `sentropic-build-app` as a **new, separate package** (BR-42a). Keep `@sentropic/harness` as the future generic substrate (BR-25 → a later packaging branch). Define a **clean seam**: when/if harness ships a generic templating/scaffold-manifest engine, `sentropic-build-app` *consumes* it (build-app = a harness preset specialised to the chat-app + a repo-creation + lib-pinning layer on top). Until harness ships that engine, build-app carries the minimal generator substrate itself (§4.4) behind an interface designed to be back-fed to harness later. This is the *contract-consumer co-design* lesson: design the generator interface now with build-app as the first real consumer, so harness can adopt it without a painful v-bump.

This is a **blocking decision** (durable architecture + naming), escalated in §5.2-A.

### 3.2 Where the CLI lives — BR42a-Q1

Two candidate homes (per `plan/42` BR42a-Q1): `packages/build-cli` (default) vs top-level `cli/`.

- `packages/build-cli` keeps it inside the publishable `@sentropic/*` family, reuses the existing per-package CI/publish lane (OIDC trusted publisher, `version-already-published` skip, `enforce-package-bump` gate — `rules/workflow.md` Package Publication), and matches the existing convention (`cowork-bridge`, `cowork-desktop` both live in `packages/`). **Recommended.** Note: it does **not** reuse the lane for free — the lane is hand-wired per package (Makefile targets + `ci.yml` path filters + `bootstrap_publish_target` enum), which is BR42a-H + the EX1 scope exception.
- top-level `cli/` would be a new top-level convention with no CI lane, breaking the "every `packages/<pkg>/` is published" rule and needing bespoke wiring.

**Recommendation:** `packages/build-cli` (publish as `@sentropic/build-cli`, distinct from the *binary* name — see §3.4 + BR42a-B). Reversible-ish (a directory move pre-publish is cheap) but it sets the CI lane and is tied to the package-name decision, so it is escalated alongside BR42a-B in §5.2-B. Default decision documented; user confirms with the binary name.

### 3.3 The app-template package — BR42a-C boundary

The generated app's source lives in a **template package**, separate from the CLI logic, so the CLI is "find template → substitute tokens → write" and the template can be versioned/tested independently. Candidates:

- (a) `packages/app-template` published as `@sentropic/app-template` (template files shipped as package assets; CLI reads from its installed dependency). Clean, versioned, testable in isolation; the template app's own `package.json` can be type-checked/built in CI as a real consumer of `@sentropic/chat-ui|chat-core|llm-mesh` (a *contract-consumer co-design* win — it continuously proves the published libs compose).
- (b) Templates embedded as assets *inside* `@sentropic/build-cli` (`packages/build-cli/templates/**`). Simpler (one package, one version), but conflates CLI logic with app source and bloats the CLI tarball.

**Recommendation:** start with **(b) embedded templates** for the MVP to minimise moving parts and the publish surface, **but structure them as a self-contained subtree** (`packages/build-cli/templates/chat-app/**` with its own `package.json`) so promotion to (a) `@sentropic/app-template` is a lift-and-shift later. This is a **blocking decision** (durable boundary) — §5.2-C. The deciding tension: (a) gives a continuously-CI-verified "real consumer" of the libs; (b) is faster to MVP. The recommendation buys (a)'s testability (the subtree is still typecheck-able in CI) without (a)'s second publish lane yet.

### 3.4 Binary name vs package name

These are independent. `plan/42` BR42a-Q2 lists three binary candidates: `sentropic-build-app`, `sentropic init`, `create-sentropic-app`. The package name (§3.2) is `@sentropic/build-cli` regardless. Existing precedent: `@sentropic/cowork-desktop` ships binary `sentropic-cowork` (verified). Naming convention in the ecosystem favours a `sentropic-*` prefixed binary. The `create-*` form is the npm-init idiom (`npm create sentropic-app`) and is the most discoverable for a scaffolder, but it implies a separate `create-sentropic-app` package wrapper. Durable → **user validation required before merge** (`rules`: No unvalidated naming). Escalated §5.2-B.

### 3.5 Backend wire seam — the #1 scope risk (BR42a-E)

**Verified — the previous draft was wrong.** There is **no `@sentropic/chat-core/server` export and no shippable backend wire server to mount.** Concretely:
- `packages/chat-core/package.json` exports **only `"."`** (`{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`). There is **no `./server` subpath**.
- The real SSE wire server is **app-local**, in `api/src/routes/api/streams.ts` (a Hono router coupled to Drizzle, the app's PG job queue, presence/locks, workspace access — not extractable as-is).
- `@sentropic/chat-ui`'s default client transport (`packages/chat-ui/src/client/transport.ts`) talks to **`POST /chat/sessions/:id/messages`**, **`GET /chat/sessions/:id/stream`** (SSE), and **`GET /chat/sessions/:id/bootstrap`**. The `fromSeq` replay query param is forwarded by the transport, but the `GET /sessions/:id/events?fromSeq=N` replay endpoint and the `Sec-Sentropic-Wire-Version` header are **study-spec (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §4) future contracts, not implemented** (`packages/chat-ui/src/client/replay.ts` says replay "lands later"; grep finds no `Sec-Sentropic-Wire-Version` in chat-ui/chat-core/api). The MVP must wire only the **real** endpoints above and must not reference the unimplemented replay endpoint or wire-version header as if they existed.

So the generated backend **cannot** "mount `@sentropic/chat-core/server` routes" — that export does not exist. The MVP must own the routes itself. This is the single biggest scope risk; it is a **blocking decision** (BR42a-E, §5.2-E).

### 3.6 GitHub repo creation & h2a registration seam

- **GitHub:** via the `gh` CLI (verified present; origin is `github.com/rhanka/sentropic`). The CLI shells out to `gh repo create ... --source <dir> --push`. No GitHub API token handling in the CLI itself — delegate auth entirely to `gh` (consistent with Docker-first/no-secrets-in-code posture). `doctor` checks `gh auth status`. **`gh repo create` has no native `--dry-run`** — the CLI's own `--dry-run` prints the exact `gh` invocation without running it (test seam, §6); safety on the real path rests entirely on the CLI's gating (owner explicit, never mutate an existing remote, refuse on name collision). See BR42a-G (§5.2-G) for the full permission/ownership dossier.
- **h2a registration (consumption seam only):** the MVP emits a **descriptor file**, gated by `--h2a-register`, default off. It does **not** call any h2a tool, does **not** model VALEUR/ATTENTION/INTÉRÊT/CONFIANCE/MUTUALISATION, does **not** open an h2a session. **The descriptor *shape* is undecided** — the previously-assumed `.sentropic/h2a-app.json` was invented (h2a is at 0.24.0; no such artifact contract is published). See BR42a-F (§5.2-F) for the dossier. Trust-model design stays in `rhanka/h2a` (EVO-9, `claude:a2a-cli`). This honours the *contract-consumer co-design* rule: the seam is shaped by build-app's real need, but the protocol is owned upstream.

### 3.7 What the CLI composes (dependency picture)

```
sentropic-build-app (CLI, @sentropic/build-cli)
  ├── (reads) app-template subtree  ──► generated app depends on:
  │                                        @sentropic/chat-ui   (^0.1.1, peer: svelte ^5, @lucide/svelte ^0.562, svelte-streamdown ^3)
  │                                        @sentropic/chat-core (^0.1.2)        [exports "." only — no /server]
  │                                        @sentropic/llm-mesh  (^0.1.2)
  │                                        @sentropic/design-system-svelte + -themes + -tokens  (see §4.1 + BR42a-R7)
  │                                        hono (template-owned wire routes — §3.5/BR42a-E)
  ├── (uses)  generator/templating substrate (librarised — §4.4; seam to future @sentropic/harness)
  └── (shells out) gh  (repo create/push)  ·  make/docker (generated app bootstrap)
```

The CLI itself stays thin and Node-only (matches `@sentropic/cowork-desktop` bin pattern: a small `bin/*.mjs` over an importable library where all testable logic lives).

---

## 4. The app template

### 4.1 What the generated app contains

A minimal, runnable, two-tier app:

- **Backend** (`api/` inside the generated app): a **template-owned** Hono server exposing the three routes `@sentropic/chat-ui` consumes — `POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream` (SSE), `GET /chat/sessions/:id/bootstrap` — implemented over `@sentropic/chat-core`'s `ChatRuntime` and routing model calls through `@sentropic/llm-mesh` `createLlmMesh(...)`. **Verified:** there is no `@sentropic/chat-core/server` to mount (§3.5); the template owns these routes. Ships with a **deterministic, offline `ProviderAdapter`** wired by default (the `stub` provider) so it runs without keys. **Verified:** llm-mesh has **no `fake` provider id** (ids: `openai`, `gemini`, `anthropic`, `mistral`, `cohere`) and **no `InMemoryMeshDispatch`/`MeshDispatchPort` symbol** — the deterministic adapter is a small `ProviderAdapter` implementation the *template owns* (extending the exported `BaseProviderAdapter` / implementing the `ProviderAdapter` interface and registering it in the mesh registry), not a library-provided fake. In-memory reference adapters for `MessageStore`/`SessionStore`/`StreamBuffer`/`CheckpointStore` (study §5 mandates an in-memory adapter per port; confirm which ship in published `@sentropic/chat-core`, else the template ships minimal stubs — §7.1) — **no Postgres in the MVP app**.
- **Web UI** (`ui/` inside the generated app): Svelte 5 app embedding `@sentropic/chat-ui` `ChatPanel`/`ChatWidget`, wired to the backend over HTTP/SSE via the chat-ui default transport (`createDefaultTransport(baseUrl)`), with `VITE_API_BASE_URL` aligned to the backend port (mirrors the monorepo convention). Includes the **design surface** so the app is not unstyled.
- **Design surface (BR42a-R7 — BLOCKING):** **Verified — the previous "no `@sentropic/design-system` package" premise was false.** A real, published, Svelte-5-aligned design system exists: **`@sentropic/design-system-svelte` (`@0.10.3`)** plus **`-themes`** and **`-tokens`** (repo `rhanka/sent-tech-design-system`; the in-repo `sent-tech-design` skill lints against it and references `@sentropic/design-system-themes`/`-svelte`). So the choice is **not** "inline vs extract a non-existent package" — it is **consume the published DS (recommended) vs inline a local theme**. Elevated from reversible to **blocking** (§5.2-R7) because it dictates the generated app's runtime dependency set and visual identity.
- **Tooling:** `Makefile`/make-include (`dev`/`down`/`typecheck`/`build` — Docker-first), `docker-compose.yml` (isolated compose project name + non-conflicting ports — BR42a-Q9), `.env.example` (provider-key slots, ports), `package.json` (pinned `@sentropic/*`), `README.md`, `LICENSE` (MIT — BR42a-I), `.gitignore` (excludes `.env`).

### 4.2 `make dev` runnable contract

`cd <generated-app> && make dev` must: build/start the backend + UI containers, serve the UI, and serve the chat wire protocol so a message sent in the UI streams an assistant reply from the deterministic `stub` adapter. The generated app is a **separate compose project** with its **own project name** and **its own `ENV`**, on **non-conflicting ports** (never the monorepo's reserved `8787/5173/1080`) — the project-name + port-allocation policy is itself a decision (BR42a-Q9, §5.2-Q9). The smoke test (§6) asserts this end-to-end and is hermetic.

### 4.3 Wire alignment (no reinvention)

The generated backend serves the **same routes** `@sentropic/chat-ui` already consumes (`/chat/sessions/:id/{messages,stream,bootstrap}` — verified §3.5). The CLI must **not** invent a parallel transport. It must also **not** advertise unimplemented contract surface (`/sessions/:id/events?fromSeq=N` replay, `Sec-Sentropic-Wire-Version`) — those are §4-study futures, not shipped. This is the *reuse-UI-no-entropy* rule applied to the scaffolder.

### 4.4 Librarising templating / doc-gen (the forcing function)

Two distinct concerns, scoped differently:

- **Scaffold/file templating substrate (in scope, minimal):** the CLI needs token substitution + a scaffold manifest (list of template files → output paths + transforms). Today no such generic engine exists; the app's `view-template-service.ts` is DB/workspace-coupled and the DOCX path is `dolanmiu/docx`-specific (both verified). The MVP extracts a **tiny, dependency-light** file-templating + manifest engine (deterministic `{{token}}` substitution over a file tree). It is built *behind an interface* so it can later become part of `@sentropic/harness` (§3.1 seam). Location: a small internal module of `@sentropic/build-cli` for the MVP (not a separately published lib yet) — reversible (§5.1-R5).
- **DOCX / business doc-gen (recorded, deferred):** the larger doc-gen system (`docx-service.ts`, `executive-synthesis.docx`, `usecase-onepage.docx`, the `{{FOR ... IN ...}}` loop engine, markdown→Word) is *business-app* doc generation, **not** something the chat-app scaffolder needs. Extracting it into a published lib is real work with no MVP dependency. **Recommendation:** record it as a deferred follow-up (its own lot, e.g. `@sentropic/doc-gen`), do **not** scope it into BR-42a. The `init` MVP does not emit DOCX templates. — §5.1-R6.

### 4.5 Dependency posture

Keep the CLI and template thin: Node built-ins + a minimal arg/prompt approach + `gh`/`make` shell-outs. Avoid heavy TUI/scaffolding frameworks. The generated app's runtime deps are the published `@sentropic/*` libs (chat-ui/chat-core/llm-mesh/design-system-svelte + themes/tokens) + their peers (svelte ^5, `@lucide/svelte` ^0.562, `svelte-streamdown` ^3, Hono) — pinned to known-good published versions.

---

## 5. Decisions ledger

> The decision-grade section. (a) Reversible decisions are decided now with a one-line rationale. (b) Blocking / high-stakes decisions are escalated as compact dossiers for one batched question set.

### 5.1 Reversible (decide now)

| ID | Decision | Préconisation | Why reversible |
|---|---|---|---|
| **R1** | MVP verb surface (NOTE: public CLI contract — verbs/flag names are an external API) | Ship only `init`, `doctor`, `--version`, `--help`. Name deferred verbs but don't build. Fix the names deliberately (renaming after release is costly), see R4. | Adding verbs later is purely additive; the *names* however are a public contract. |
| **R2** | GitHub off by default | `--no-github` default; `--github` opt-in; auth fully delegated to `gh`. | A flag default flip is trivial; no contract leaks. |
| **R3** | Default provider `stub` (template-owned deterministic adapter; NOT an llm-mesh id) | `init` defaults to the deterministic `stub` `ProviderAdapter`; real providers (`openai`/`gemini`/`anthropic`/`mistral`/`cohere`) scaffold `.env.example` slots, never baked keys. | Default switch is one line; offline-first keeps smoke tests hermetic. |
| **R4** | `--dry-run` + non-interactive `--yes` from day one (NOTE: flag *names* are part of the public CLI contract — R1) | Build both early — they back the tests (§6) and CI. | Behaviour is internal; the names are public-contract, fix them deliberately. |
| **R5** | Templating substrate as an internal module first | Keep the file-templating + manifest engine internal to `@sentropic/build-cli`, behind an interface, for the MVP. | Promotion to a shared lib / into harness is a later, interface-preserving lift. |
| **R6** | DOCX doc-gen extraction deferred | Do **not** extract `docx-*`/`executive-synthesis` into BR-42a; record as a separate `@sentropic/doc-gen` follow-up. | Pure scoping; no MVP code depends on it. |
| **R8** | Generated app uses in-memory adapters, no Postgres | Ship the chat-app on in-memory reference adapters (study §5); Postgres-durable is a later preset. | Adding a durable preset later is additive; matches harness preset ladder. |
| **R11** | Conventional first-commit message | `chore: scaffold <name> via sentropic-build-app`. | Cosmetic. |

> Reclassified out of "reversible": **R7** (design surface) → **BLOCKING** §5.2-R7 (a real published DS exists; consume-vs-inline dictates the dependency set). **R9** (generated-app ports/compose project naming) → **BLOCKING** §5.2-Q9 (affects every scaffolded app). **R10** (deterministic generator output) → restated as a **non-negotiable test invariant** below, not a choice. R4's *names* are flagged as public-contract.

**R10 — Deterministic generator output (INVARIANT, not a choice).** The generator MUST produce byte-identical output for identical inputs: no timestamps, no random ids, no environment-dependent ordering in any committed scaffold file. This is a **test invariant** the golden-file suite (§6.1 #1) depends on, not a reversible decision. Any non-determinism is a bug.

### 5.2 Blocking / high-stakes (defer to batch)

#### **BR42a-A — Harness (§6 / BR-25) vs new package** *(the critical decision)*

- **Question:** Is BR-42a a **new package** or an **evolution/extension of `@sentropic/harness`** (which §6 already plans to own "project init with three presets", "scaffolding", "templates", "conductor CLI")?
- **Context/stakes:** Durable architecture + naming. Wrong call either (a) bloats harness with Svelte/Hono/lib coupling, violating its §6 zero-private-dep / no-framework-lock-in invariant, or (b) duplicates a generic scaffolder harness is meant to own. **Verified:** no `@sentropic/harness` package exists in `packages/`, but it **is planned** (named in `PLAN.md:262` + §6/§11); BR-25 (`chore/rules-skills-audit`) is rules/docs-only, study mode (the "17/46" count is from `PLAN.md:55`, not the plan file), forbidden from `api/**`/`ui/**` — so harness's scaffolder is *planned, unbuilt intention*.
- **Options:**
  1. **New separate package `@sentropic/build-cli`, harness stays generic; define a consumption seam (build-app = a future harness preset + repo-creation + lib-pinning layer).** *Trade-off:* honours both products' invariants; small duplication of a minimal templating engine until harness ships its generic one (mitigated by R5's interface design). **Risk: LOW.**
  2. **Fold build-app into `@sentropic/harness` as its `svelte-app`/chat preset.** *Trade-off:* one tool, but couples a *planned* generic substrate to Svelte/Hono/chat-ui and to GitHub-repo side effects — breaks the §6 invariant; also blocks on BR-25 maturing from study to package. **Risk: HIGH.**
  3. **Fold harness into build-app.** *Trade-off:* betrays harness's "tooling-only, zero runtime dependents, generic" purpose; conflates dev-workflow tooling with a product scaffolder. **Risk: HIGH.**
- **Risk ranking:** Option 1 ≪ Option 2 ≈ Option 3.
- **Préconisation:** **Option 1.** New `@sentropic/build-cli`; harness kept generic and planned; design the templating engine interface now (R5) so harness can adopt it later without a v-bump.

#### **BR42a-B — Binary name (+ package/CLI-location coupling) — durable, user-validation-required**

- **Question:** What is the CLI **binary name**, and (coupled) the package name + location? Note: the binary/verb names are a **public CLI contract**.
- **Context/stakes:** Durable public identity; npm + `bin` are hard to rename post-publish. `rules`: durable names need user validation before merge. Precedent: `@sentropic/cowork-desktop` → binary `sentropic-cowork` (verified).
- **Options (binary):**
  1. **`sentropic-build-app`** (package `@sentropic/build-cli` in `packages/`). *Trade-off:* matches the program name and the `sentropic-*` binary convention; explicit "build-app" intent. Default location reuses the existing publish-lane *pattern*.
  2. **`sentropic init`** (a subcommand of a future umbrella `sentropic` binary). *Trade-off:* clean UX long-term, but presumes an umbrella CLI that does not exist; premature.
  3. **`create-sentropic-app`** (npm-init idiom: `npm create sentropic-app`). *Trade-off:* most discoverable for a scaffolder, but implies a `create-*` wrapper package and a second name to maintain.
- **Risk ranking:** all reversible only *before* first publish; after publish, renaming is high-cost → treat as blocking.
- **Préconisation:** **Binary `sentropic-build-app`, package `@sentropic/build-cli`, location `packages/build-cli`** (Option 1 + §3.2 default). Confirm with user before any publish. (If the user prefers the npm-init idiom, switch to `create-sentropic-app` *before* Lot 0 ends.)

#### **BR42a-C — App-template package boundary**

- **Question:** Embedded template subtree inside `@sentropic/build-cli`, or a separate published `@sentropic/app-template`?
- **Context/stakes:** Determines publish surface + how continuously the libs are proven to compose together.
- **Options:**
  1. **Embedded subtree** (`packages/build-cli/templates/chat-app/**`, self-contained `package.json`, typecheck-able in CI). *Trade-off:* one package/one version, fastest to MVP; still CI-verifiable as a real consumer; structured for later promotion. **Risk: LOW.**
  2. **Separate `@sentropic/app-template`.** *Trade-off:* cleanest "real consumer" CI signal and independent versioning, but a second publish lane + version-sync burden between CLI and template now. **Risk: MEDIUM.**
- **Risk ranking:** Option 1 < Option 2 (for MVP velocity).
- **Préconisation:** **Option 1**, structured for lift-and-shift to Option 2 later. Escalated because the *subtree shape* is a durable boundary the user may want to fix up front.

#### **BR42a-D — Wave selection / sequencing (delivery decision)**

- **Question:** Does BR-42a start *now* against the merged chat stack, or wait for sibling lots?
- **Context/stakes:** `plan/42` BR42-Q1 proposes wave-1 = BR-42a + BR-42g in parallel. (The former BR-42f GCP provider is **moved to BR-43**, `feat/llm-mesh-gcp` — no longer a BR-42 wave lot.)
- **Options:** (1) BR-42a now (consumes published `chat-ui`/`chat-core`/`llm-mesh` 0.1.x — all merged/published, verified). (2) Wait for catalog/comments/persistence lots.
- **Préconisation:** **Option 1 — start now.** The chat stack BR-42a needs is already published; sibling lots are additive and the CLI consumes them as `add <capability>` later (§7). Low risk; unblocks the foundry surface earliest. (Caveat: the backend wire seam BR42a-E is template-owned regardless — it is not unblocked by waiting.)

#### **BR42a-E — Backend wire seam (THE #1 SCOPE RISK)**

- **Question:** How does the generated backend serve the wire protocol `@sentropic/chat-ui` consumes, given there is **no shippable server export** today?
- **Context/stakes:** **Verified:** `@sentropic/chat-core` exports `"."` only — there is **no `chat-core/server` subpath**; the only real wire server is app-local in `api/src/routes/api/streams.ts` (Drizzle/PG-queue/presence-coupled, not extractable as-is); `@sentropic/chat-ui` calls `/chat/sessions/:id/{messages,stream,bootstrap}`. This is the largest risk to the MVP definition of done — get it wrong and `make dev` cannot serve a chat round-trip.
- **Options:**
  1. **Extract/publish `@sentropic/chat-server` (or add a `chat-core/server` subentry)** from `api/src/routes/api/streams.ts`, then the template mounts it. *Trade-off:* clean reuse, single source of truth for the wire server; but a real extraction effort (decoupling Drizzle/PG-queue/presence), a second publish surface, and it blocks the MVP on that extraction. **Risk: HIGH (schedule + scope).**
  2. **Template owns minimal Hono routes** over `@sentropic/chat-core`'s `ChatRuntime`, implementing exactly `POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream` (SSE), `GET /chat/sessions/:id/bootstrap`. *Trade-off:* fastest MVP, no upstream extraction; some duplication of route glue that a later `@sentropic/chat-server` would absorb; the template carries a Hono dep. **Risk: MEDIUM (duplication, later consolidation).**
- **Risk ranking:** Option 2 (MVP) < Option 1 (now). Flag Option 1 as a strong follow-up (`@sentropic/chat-server` extraction) once the route shape is proven by the template.
- **Préconisation:** **Option 2 for MVP velocity**, with the route glue written behind a thin module so it can be lifted into a future `@sentropic/chat-server`. Record the extraction as a follow-up lot.

#### **BR42a-F — h2a registration artifact shape**

- **Question:** What is the on-disk shape of the `--h2a-register` descriptor?
- **Context/stakes:** **Verified:** the previously-assumed `.sentropic/h2a-app.json` shape was **invented**; h2a is at 0.24.0 and publishes no such artifact contract. Picking a shape now risks fossilising a wrong contract that the real h2a register (owned upstream in `rhanka/h2a`, EVO-9) won't match.
- **Options:**
  1. **Minimal local descriptor** (app name, repo URL, intended scope/role placeholders) in a clearly app-local file, explicitly *not* an h2a protocol artifact. *Trade-off:* zero coupling, easy to replace; not interoperable yet. **Risk: LOW.**
  2. **h2a envelope** mirroring an h2a register payload. *Trade-off:* forward-compatible if it matches; high risk of mismatching the real (unfrozen) contract. **Risk: HIGH.**
  3. **ENGAGEMENT/MANDATE pointer** (a reference into the h2a trust vocabulary). *Trade-off:* aligns with EVO-9 concepts but those are not finalised for build-app consumption. **Risk: HIGH.**
  4. **Future-import descriptor** (a stub marked "to be transformed into an h2a register call later"). *Trade-off:* honest placeholder; needs a migration later. **Risk: LOW-MEDIUM.**
- **Risk ranking:** Option 1 ≈ Option 4 ≪ Option 2 ≈ Option 3.
- **Préconisation:** **Option 1 — minimal local descriptor for MVP**, explicitly non-protocol; the real h2a register is deferred and co-designed upstream when EVO-9 freezes the contract.

#### **BR42a-G — GitHub repo-creation permissions / ownership**

- **Question:** What is the policy for `gh repo create` ownership, collisions, existing remotes, visibility, and remote mutation?
- **Context/stakes:** `gh repo create` has **no native `--dry-run`**; `--source --push` can create/modify remotes. Wrong defaults can push private code to the wrong org, collide with an existing repo name, or mutate an existing `origin`. Side effects are irreversible-ish (a created remote, a push).
- **Decision points + préconisation:**
  - **Owner:** require an explicit `--github-owner`; never silently infer the org (default to the authenticated user's personal account only if owner omitted AND interactively confirmed). *Préco: explicit owner flag.*
  - **Visibility:** default **private** (R2-adjacent); `public` only with explicit `--github-visibility public`. *Préco: private default.*
  - **Name collision:** if `<owner>/<name>` already exists, **refuse with a clear message**; never overwrite. *Préco: refuse on collision.*
  - **Existing remote in `--dir`:** if the target dir already has a git remote, **never mutate it**; refuse and tell the user. *Préco: never mutate an existing remote.*
  - **Backfill-vs-amend:** prefer backfilling the repo URL token *before* the first commit (clean history); amend-after-push only as a fallback, and never force-push. *Préco: backfill-before-first-commit.*
- **Préconisation (summary):** personal/private by default + explicit owner flag; refuse on collision; never mutate an existing remote; backfill before first commit.

#### **BR42a-H — CI/publish lane + scope exception (BR42a-EX1)**

- **Question:** How does the new package get a publish lane, and which default-forbidden paths must the branch touch?
- **Context/stakes:** **Verified** the lane is hand-wired per package, not free: it needs (a) hand-written `Makefile` targets mirroring the existing per-package pattern — `build-build-cli`, `typecheck-build-cli`, `test-build-cli`, `pack-build-cli`, `publish-build-cli` (OIDC), `publish-build-cli-token` (bootstrap); (b) `.github/workflows/ci.yml` additions — a `packages/build-cli/**` path filter (the file already filters per-package, lines ~126–234), a new entry in the `bootstrap_publish_target` `workflow_dispatch` enum (currently `none|contracts|events|chat-core|chat-ui|auth-hono|auth-ui|flow|cowork-bridge|cowork-desktop|all`), and a publish job; (c) a lockfile update; (d) a one-time OIDC trusted-publisher manual attach on npm (the documented bootstrap-then-attach flow). **`Makefile` and `docker-compose*.yml` are DEFAULT-FORBIDDEN paths** (`rules/MASTER.md`), and `.github/workflows/**` is conditional → this **requires an explicit `BR42a-EX1` scope exception** in `BRANCH.md` (rationale + impact + rollback).
- **Préconisation:** **Grant `BR42a-EX1`**, mirroring the existing per-package lane exactly (copy the `cowork-bridge`/`chat-ui` target + ci.yml shapes). Rationale: a publishable package cannot ship without its lane. Impact: additive Makefile targets + ci.yml filter/enum/job; no change to other packages' lanes. Rollback: remove the added targets/filter/enum entry and the package directory.

#### **BR42a-Q9 — Generated-app compose project name + port allocation** *(elevated from config)*

- **Question:** How are the generated app's compose project name and ports chosen so that *every* scaffolded app is isolated and never collides?
- **Context/stakes:** This is not per-branch config — it affects **every app the CLI ever scaffolds**. Two scaffolded apps on one machine, or a scaffolded app next to the monorepo dev stack, must not collide. The monorepo reserves `8787/5173/1080`.
- **Options/decision points:** (1) derive a stable compose project name from the app name (slugified) vs a random suffix vs user-supplied; (2) port strategy — fixed template defaults (risk: two apps collide) vs name-hashed offset vs `doctor`-discovered free ports written into `.env`. *Préco:* compose project name = slugified app name; ports = template defaults that are **not** `8787/5173/1080`, with `doctor` detecting conflicts and the wizard/`--yes` failing fast on a clash (or offering an offset). Tested via the port-conflict negative test (§6.1).
- **Préconisation:** stable slug project name + non-reserved default ports + `doctor` conflict detection.

#### **BR42a-I — Licensing**

- **Question:** What license applies to the CLI package, the template subtree, and the generated app, and do copied template files carry headers?
- **Context/stakes:** The generated app is distributed code; its `LICENSE` and `package.json` `license` field must be correct, and copied template files must not carry conflicting headers.
- **Decision points + préconisation:** LICENSE source = MIT (consistent with the `@sentropic/*` family); `@sentropic/build-cli` `license: "MIT"`; generated app ships a top-level `LICENSE` = MIT and `package.json` `license: "MIT"`; **no per-file SPDX headers** (avoid header noise in generated files); third-party notices only if a bundled dep requires it. *Préco: MIT throughout, generated-app LICENSE = MIT, no per-file headers.*

---

## 6. Pre-test & UAT plan (maximal pre-tests)

Test-first, Docker-first, no E2E-timeout inflation (`rules/testing.md`). Per `rules/workflow.md` Package Publication, BR-42a adds package-specific make targets (`typecheck-build-cli`, `test-build-cli`, `build-build-cli`, `pack-build-cli`) and bumps the package version (lane wiring is BR42a-H/EX1).

### 6.1 Gating automated tests

1. **Generator unit tests (golden-file).** For `init <name> --yes --provider stub --dry-run` and full materialise: assert the scaffold manifest and the rendered file tree byte-for-byte against committed golden fixtures (R10 invariant makes this possible). Cover: token substitution (name/ports/provider/repo-URL placeholder), empty-dir guard, the three `--force` behaviours, provider-slot `.env.example`, pinned `@sentropic/*` versions in the generated `package.json`, and that the generated backend declares the three real routes (`/chat/sessions/:id/{messages,stream,bootstrap}`) and **no** unimplemented `/sessions/:id/events` route or `Sec-Sentropic-Wire-Version` header.
2. **Templating-substrate unit tests.** The librarised `{{token}}` + manifest engine: substitution correctness, missing-token failure, no-partial-write on error, idempotent re-render, determinism (R10).
3. **`doctor` unit tests.** Each pre-flight check (Docker present, `make`, `gh auth status`, engines, **port availability incl. the generated-app port-conflict detection of BR42a-Q9**) with mocked environment; correct non-zero exit on failure.
4. **Repo-creation safety test (no native `gh --dry-run`).** Because `gh repo create` has no dry-run, the test **stubs both `gh` and `git`**, forces a **temp `HOME` and temp `PATH`** (so the stubs are picked up), runs `init <name> --github --dry-run` **and** the real `--github` path against the stubs, and asserts **zero side effects**: no remote creation, no directory writes outside the temp workspace, no amend/backfill on the real-remote-exists path, and the **exact `gh repo create ...` command string** that would run. Also asserts collision refusal and existing-remote refusal (BR42a-G).
5. **End-to-end "init → app builds & `make dev` serves chat-ui↔backend" smoke (the headline gate) — HERMETIC.** The smoke MUST be hermetic: a **temp working dir + temp `HOME`**, **no host npm writes**, **controlled package fetches + Docker pulls**, an **isolated compose project name + pinned non-conflicting ports** (BR-42 slots: API `9210..9214`, UI `5410..5414`, Maildev `1310..1314`), and **teardown assertions** (no leaked containers/volumes/ports after `make down`). Run `init demo --yes --provider stub --no-github`; then in the generated app run its `make build` + bring up `make dev`; assert the UI is served, the **template-owned** wire endpoints respond, and a sent message streams a `stub`-provider assistant reply over `GET /chat/sessions/:id/stream`. Tear down with the generated app's `make down` and assert clean teardown. **This is the MVP's definition of done.** (It depends on the **template-owned server** + the **deterministic stub adapter** — *not* on any `chat-core/server` export or a `fake` provider, which do not exist.)
6. **h2a-register stub test.** `--h2a-register` emits the BR42a-F descriptor file and performs **no** h2a network call.
7. **Lint/typecheck gates** for `@sentropic/build-cli` + the template subtree (`typecheck-build-cli`, `lint`); the template subtree typechecks against the published `@sentropic/*` libs (continuous "real consumer" proof per BR42a-C).
8. **Generated-app negative tests.** Cover: invalid app names (empty, whitespace, non-slug, reserved), **path traversal** in `--name`/`--dir` (`../`, absolute paths), **existing non-empty dir** (refuse without `--force`; correct behaviour with `--force`), **existing git repo / existing remote** in `--dir` (refuse, never mutate — BR42a-G), **repo-name collision** on `--github` (refuse — BR42a-G), **missing Docker/make/gh** (doctor fails actionably), **port conflict** (BR42a-Q9 detection), **`.env` secret leakage** (assert generated `.gitignore` excludes `.env` *before* any commit/push, and `.env` never appears in the first commit or the pushed tree), and **tarball contents** (`pack-build-cli` includes the template subtree + bins, excludes tests/fixtures/secrets).

### 6.2 Step-level UAT checklist (user runs at the end)

- [ ] `sentropic-build-app --version` prints CLI + template versions.
- [ ] `sentropic-build-app doctor` reports Docker/make/gh/engines/ports truthfully (try once with `gh` logged out → clear actionable message; try once with a port already bound → conflict reported).
- [ ] `sentropic-build-app init demo --provider stub` (interactive): wizard prompts are clear; defaults sane; produces `./demo`; `.gitignore` excludes `.env`.
- [ ] `cd demo && make dev`: UI loads at the printed URL; sending a chat message streams an assistant reply (stub provider) over `/chat/sessions/:id/stream`; no runtime errors in `make logs`.
- [ ] Switch provider: set a real key in `demo/.env` (provider one of `openai`/`gemini`/`anthropic`/`mistral`/`cohere`), restart, confirm a real model reply (credential-gated; documented if skipped).
- [ ] `init demo2 --github --github-owner <owner> --github-visibility private` (with `gh` authed): repo is created under the explicit owner, first commit pushed, repo URL backfilled in `package.json`/README; `.env` is NOT in the pushed tree; `make dev` still works.
- [ ] `init demo3 --dry-run --github --github-owner <owner>`: prints the full plan + the exact `gh repo create` command; writes nothing; creates no repo.
- [ ] `init demo --force` over a non-empty dir behaves per the defined `--force` semantics; without `--force` it refuses with the conflicting-paths list.
- [ ] Generated app ports do **not** collide with the monorepo's `8787/5173/1080`, and the compose project name is the app slug.
- [ ] `--h2a-register` writes the (local, non-protocol) descriptor file only; no h2a session opened.
- [ ] Naming sign-off: the binary/package names match the BR42a-B decision (gate before merge).
- [ ] Licensing sign-off: generated-app `LICENSE` = MIT, `package.json license: "MIT"` (BR42a-I).

---

## 7. Dependencies & sequencing within BR-42

### 7.1 Upstream dependencies (must be satisfied before BR-42a builds)

- **Merged & published chat stack** — `@sentropic/chat-ui` 0.1.1, `@sentropic/chat-core` 0.1.2, `@sentropic/llm-mesh` 0.1.2 (all verified present/published; BR-14a/b/c merged). **Satisfied.**
- **No backend wire server exists** — `@sentropic/chat-core` exports `"."` only; the template owns the routes (BR42a-E). **This is the gating design decision, not an upstream dependency to wait on.**
- **In-memory reference adapters** for chat-core ports (study §5 mandates one per port). Confirm availability in the published `@sentropic/chat-core`; if absent, the template ships minimal in-memory stubs (small, additive) — flag at Lot 0.
- **Design surface** — published external DS (`@sentropic/design-system-svelte`@0.10.3 + `-themes` + `-tokens`, `rhanka/sent-tech-design-system`) **exists and is consumable** (verified via the in-repo `sent-tech-design` skill). Consume-vs-inline is BR42a-R7.
- **`gh` CLI** authed on the user/CI host for the `--github` path (verified present locally). CI uses stubbed `gh` only (no real repo creation — BR42a-G/§6.1 #4).

### 7.2 Relationship to sibling lots (BR-42b..g)

BR-42a is the **integrator**, not the owner of sibling lots. They are largely orthogonal package extensions (catalog/comments/persistence/flow/mesh/events) that the CLI **consumes as they land** via the deferred `add <capability>` verb (§2.1). None of them block the MVP scaffolder. Notably:

- **BR-42b** (catalog +agents+canvas), **BR-42c/d** (comments + persistence), **BR-42e** (flow queue streaming), **BR-42g** (BigQuery sink): all *additive* to a future generated app, surfaced later as `add` capabilities / template presets. Not MVP. The former **BR-42f** (single GCP/`gcp` provider in `@sentropic/llm-mesh`) is **moved to BR-43** (`feat/llm-mesh-gcp`; provider ids today are `openai`/`gemini`/`anthropic`/`mistral`/`cohere`) — a single provider is not app-foundry/scale work. The genuinely scale-relevant Google piece is the **native multi-cloud secrets contract** (make/compose/CI/k8s ↔ `k8s-ops`) + **observability** + the **MCP/marketplace catalog** (BR-42b/BR-42g + boundaries §16), not the individual provider.
- **BR-39** (auth-ui/auth-hono, in flight via `codex:39-auth`): provides identities. The MVP chat-app can scaffold **without** auth (stub provider, in-memory); an `--with-auth` template preset wiring `@sentropic/auth-ui` + `@sentropic/auth-hono` is a fast follow-up once BR-39 is merged. Not a hard MVP blocker.

### 7.3 Recommended sequencing

- **Lot 0 (read-only scoping):** confirm the batched blocking decisions (BR42a-A harness-vs-package, BR42a-B names, BR42a-C template boundary, **BR42a-E wire seam**, **BR42a-F h2a artifact**, **BR42a-G GitHub policy**, **BR42a-H + EX1 CI lane**, **BR42a-Q9 ports/project**, **BR42a-R7 design surface**, **BR42a-I licensing**) in one batched user question set; verify chat-core in-memory adapter availability; create `packages/build-cli`; declare `BR42a-EX1` in `BRANCH.md`.
- **Lot 1:** templating substrate + generator core + golden unit tests (§6.1 #1–#2).
- **Lot 2:** `init` materialise + `doctor` + `--dry-run`/`--yes`/`--force` + repo-creation safety test (§6.1 #3–#4, #6) + negative tests (§6.1 #8).
- **Lot 3:** the app template (template-owned backend routes + UI + design surface + make/compose) + the hermetic end-to-end `make dev` smoke (§6.1 #5) — the definition of done.
- **Lot 4:** GitHub repo creation real path + UAT + package publish lane (BR42a-H/EX1; OIDC trusted-publisher bootstrap-then-attach per `rules/workflow.md`) + naming + licensing sign-off.

### 7.4 Deferred (recorded, out of BR-42a)

- The UI-driven **evolution loop** (manage spec/evolutions in-app, background branch agents, attention-raising via h2a) — a later BR-42 lot / separate program.
- **`@sentropic/chat-server` (or `chat-core/server` subentry)** extraction from `api/src/routes/api/streams.ts` — BR42a-E follow-up.
- **DOCX doc-gen** extraction (`@sentropic/doc-gen`) — R6.
- **Real h2a register** (vs the MVP local descriptor) — BR42a-F, co-designed upstream when EVO-9 freezes.
- **Deploy / GitOps / `k8s-ops`→PaaS** + the `sentropic`↔`k8s-ops` contract — §16.5 (coordinate `claude:poc-k8s`).
- **Central sentropic instance / multi-tenant managed h2a MCP / BYO-h2a**.
- **iii integration-parity** + **app relocation** (lib-only repo split).

---

## 8. Decisions — RATIFIED (2026-05-31, user)

The §5.2 blocking batch is resolved as follows (user decisions; supersede the §5.2 préconisations where noted):

- **D1 / BR42a-A + BR42a-B — REFRAMED & RATIFIED (supersedes the `sentropic-build-app` préconisation).** Introduce **`@sentropic/cli`**, the single **umbrella** CLI — binary **`stp`** (alias **`sentropic`**) — that **federates** the ecosystem as subcommands: `stp graphify …`, `stp h2a …`, `stp remote …`, `stp app …` (extensible). (`stp` = « s'il te plaît » → `stp h2a` reads "please, h2a".) **`@sentropic/build-cli`** holds the **`stp app`** processes (the app scaffolder/builder), surfaced as `stp app <verb>` (e.g. `stp app init <name>`, `stp app build`). The §2.1 verbs therefore move under `stp app` (`stp app init`, `stp app doctor`, …). **BR-42a delivers `@sentropic/build-cli` (the `stp app` subtree) + the subcommand-registration seam in `@sentropic/cli`.** Full federation of graphify / h2a / remote (each in its own repo) is broader than BR-42a (the umbrella depends on / invokes their published CLIs). Dispatch mechanism (hard-wired table vs plugin discovery) → decided at the plan gate; lean **plugin discovery** (each `@sentropic/*-cli` self-registers — ties to the `CatalogSource` idea).
- **D2 / BR42a-E — RATIFIED Option 1 (supersedes the template-owned préconisation): extract `@sentropic/chat-server` NOW.** The SSE wire server (`POST /chat/sessions/:id/messages`, `GET /chat/sessions/:id/stream`, `GET /chat/sessions/:id/bootstrap`) is extracted from `api/src/routes/api/streams.ts` into a reusable **`@sentropic/chat-server`** package; **both** the generated app **and** the existing `api/` consume it. Rationale (user): aligns with the **librarisation / mutualisation** doctrine — the wire server is the reusable lib every app needs; no per-app duplication. This adds a `@sentropic/chat-server` extraction lot within/ahead of BR-42a.
- **D3 / BR42a-H — RATIFIED: BR42a-EX1 GRANTED.** The branch may edit `Makefile` + `.github/workflows/ci.yml` to wire the publish lane(s) for the new package(s) (`@sentropic/cli`, `@sentropic/build-cli`, `@sentropic/chat-server`), mirroring the existing per-package lane. Rationale / impact / rollback per §5.2-H.
- **D4 / BR42a-R7 — RATIFIED: consume the published design system** — the generated app depends on `@sentropic/design-system-svelte` + `-themes` + `-tokens` (not an inline theme).

**Impact on BR-42 deliverables (reshapes the plan gate):** BR-42a now produces **`@sentropic/cli`** (umbrella `stp`), **`@sentropic/build-cli`** (`stp app`), and **`@sentropic/chat-server`** (extracted wire server), plus the generated-app template — under one EX1 scope exception. The plan gate (next) will re-lot accordingly and update `plan/42-BRANCH_chore-scale-build-app.md` + `PLAN.md`.

### Plan-gate outcome — RATIFIED (2026-05-31, user) after double review (Opus 4.8 + Codex 5.5-high)

Both reviewers converged; the user ratified D5 + D7.

- **D5 — SPLIT.** `@sentropic/chat-server` + the full `api/` migration become a **prerequisite** branch/PR **BR-42a0 `feat/chat-server`**, sequenced BEFORE **BR-42a1 `feat/build-app-cli`** (build-cli + app-template + `@sentropic/cli` umbrella), both under the BR-42 umbrella. BR-42a1 consumes the published, 0-regression-proven `@sentropic/chat-server`.
- **D7 — configurable route layer (option ii).** `@sentropic/chat-server` exposes **configurable route mounting**: the current app KEEPS its public contract (`POST /chat/messages`, `GET /streams/sse?streamIds=`, `GET /chat/sessions/:id/{messages,bootstrap}`) → **no `ui/**` change, minimal regression**; the generated app mounts the chat-ui canonical routes (`/chat/sessions/:id/{messages,stream,bootstrap}`). Only the legacy **implementation** is removed (handler bodies → chat-server ports); converging the current app's routes onto canonical is a later, optional step.
- **Generation/queue/stream port (must-add).** chat-server defines an explicit generation/queue/stream port set; `runAssistantGeneration` + queue + NOTIFY move behind it. **PG adapter** for `api/` (the existing `chat-service.ts`/`queue-manager.ts`/`stream-service.ts` code becomes the PG adapter — **NOT deleted as "legacy"**); **in-memory/stub** adapter (synchronous pump) for the generated app.
- **"0 legacy" clarified.** Remove the duplicate chat-WIRE/turn implementation (no dual paths); the PG/NOTIFY/presence code persists as the chat-server **PG adapter** + app-local non-chat multiplexing (the other 9 NOTIFY channels stay in `api/src/routes/api/streams.ts`). **No additive "keep legacy routes" escape hatch.**
- **CI (EX1).** the `api` path filter in `.github/workflows/ci.yml` MUST also trigger on `packages/chat-server/**` (api consumes it), in addition to the new per-package `chat-server` lane.
- **0-regression sequencing.** characterization/baseline tests on the current chat flow FIRST (POST/SSE/bootstrap/stop/steer/retry/tool-results/feedback/checkpoints), then build chat-server (no Drizzle/PG imports in the package), migrate `api/` as first client in one cut, run the full api + e2e matrix green, THEN build BR-42a1 against chat-server.

**Stale-text superseded:** §1.2 ("No backend wire-protocol package extraction") and §3.5/§4 ("template owns the routes") are SUPERSEDED — `@sentropic/chat-server` IS the wire package (BR-42a0); the generated app *consumes* it, it does not own routes.
