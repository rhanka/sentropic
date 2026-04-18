# Entropic

> **Heads-up — this PR renames the repo.** Until the GitHub rename of
> `rhanka/top-ai-ideas-fullstack` → `rhanka/entropic` lands and the in-code
> rename of `@top-ai/*` is dispatched across BR-14 / BR-14b, references to
> "top-ai" still appear in the codebase. See
> [`README.intent.md`](README.intent.md) for the founding intent, and
> [`PLAN.md`](PLAN.md) for the dispatch status.

**Entropic is a decentralized, open-source substrate for AI-coded software.**

> MANDATORY for contributors: read [`rules/MASTER.md`](rules/MASTER.md) and the
> companion rule files before opening any PR.

## What this is

Entropic is a working repository that doubles as:

1. **A progressively-growing replacement for the commercial AI ecosystem** —
   agentic workflows, AI SDKs, coding CLIs — rebuilt standalone, in open source,
   with no commercial telos.
2. **A platform for real consulting business cases** — AI/IT assessment,
   opportunity & bid management — running *on* the substrate as proof that it
   holds up under real workloads.
3. **A long-horizon bet** that agent coding makes it realistic for any company
   to build its own OS, its own AI stack, and its own tools — and that the
   software industry's next decade is entropic (dispersion), not consolidative.

The name carries three meanings, in order of seriousness:

- **Shannon entropy** — the mathematical substrate LLMs actually operate on.
- **A counter-positioning to Anthropic** — decentralized alternative to
  frontier-lab-as-platform.
- **A wink at the SaaSpocalypse** — the industry-wide refactor we're betting on.

Read [`README.intent.md`](README.intent.md) for the founding 10-point manifesto.

## Current state — what actually runs today

The repository currently hosts one working application — **Top AI Ideas** — a
consulting-facing tool that generates and evaluates AI use-cases for an
organization. Top AI Ideas is *one business case* running on the platform; it
is not the project.

What ships today:

- **UI** — SvelteKit 5 + Tailwind, static build, EN/FR i18n.
- **API** — Hono + Drizzle + Zod on Node 20, REST + OpenAPI.
- **Data** — PostgreSQL 17 with a custom PostgreSQL-backed job queue (no Redis).
- **AI** — multi-provider runtime around OpenAI / Anthropic / Cohere, quota and
  retry management.
- **Auth** — WebAuthn passkeys, email verification, magic-link fallback, RBAC.
- **Delivery** — UI on GitHub Pages, API on Scaleway Container Serverless,
  Docker-first dev environment, Make-only commands.

### Architecture — today

```mermaid
flowchart TB
    User[User]
    UI["SvelteKit 5 UI<br/>Tailwind · i18n EN/FR"]
    API["Hono API<br/>TypeScript · REST/OpenAPI"]
    AI["LLM Runtime<br/>multi-provider"]
    DB[("PostgreSQL 17")]
    Queue["PostgreSQL-backed Queue"]
    LLMs["OpenAI / Anthropic / Cohere"]
    OIDC["OIDC Providers<br/>Google / LinkedIn"]

    User --> UI
    UI -->|REST/JSON| API
    API --> AI
    AI --> LLMs
    API --> DB
    API --> Queue
    Queue --> AI
    API -->|OIDC| OIDC
```

## Near-term scope — the ecosystem pieces, one brick at a time

The active engineering plan lives in [`PLAN.md`](PLAN.md). The agenda, in plain
language:

- **`@entropic/chat` — publishable chat SDK** (BR-14). The bar is "as well put
  together as the Vercel AI SDK", shipped as an npm library independent from
  the Top AI Ideas UI.
- **LLM runtime refactor** (BR-14b). Clean multi-provider abstraction so the
  chat SDK can be embedded in any project.
- **Document connectors** (BR-16a, BR-16b). Google Drive SSO with in-situ
  indexing first; SharePoint / OneDrive and generic abstraction next.
- **Agentic workflows** (BR-07 / BR-07b). A LangGraph-equivalent positioned for
  standalone publication.
- **UI templating for AI-generated interfaces** and collaborative work on
  AI-generated artifacts — new surface area, not yet broken out into branches.

Long horizon (not on any current wave): TypeScript OS primitives, a compiler,
and eventually an in-house LLM.

## Using the repo

### Dev environment

```bash
make dev         # Docker-first, starts UI + API + Postgres + MailDev
make down        # Stop everything
make ps-all      # Inspect running services across branch worktrees
```

Never run `npm`, `python`, or `docker` directly. All commands go through
`make`. Never set `ENV=...` as a shell prefix — it is always the *last*
argument to a `make` target.

### Branch isolation

Each active branch uses its own worktree under `tmp/<slug>/`, with its own
`ENV`, `API_PORT`, `UI_PORT`, and `MAILDEV_UI_PORT`. See
[`rules/workflow.md`](rules/workflow.md) and [`PLAN.md`](PLAN.md) §6 for the
port convention.

### Contributing

- Commits are atomic (`make commit MSG="..."`), under ~150 lines, with
  selective `git add` (never `git add .`).
- Every branch declares `Allowed Paths` / `Forbidden Paths` in its `BRANCH.md`,
  templated from [`plan/BRANCH_TEMPLATE.md`](plan/BRANCH_TEMPLATE.md).
- Full rule set: [`rules/MASTER.md`](rules/MASTER.md).

## Configuration reference

### UI

- `VITE_API_BASE_URL` — API backend base URL. Defaults to
  `http://localhost:8787/api/v1` locally; set in `docker-compose.yml` for
  Compose runs; set in CI for production.

### API

- `CORS_ALLOWED_ORIGINS` — comma-separated origin list, supports `*` subdomain
  wildcards (e.g. `https://*.sent-tech.ca`).
- `JWT_SECRET` — random 32+ chars for JWT signing.
- `DATABASE_URL` — PostgreSQL connection string.
- `OPENAI_API_KEY` / provider API keys — as needed by the LLM runtime.
- `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` — WebAuthn relying-party config.
- `MAIL_PASSWORD` — SMTP password (Brevo or other).

Never commit these. Use the platform secrets manager (GitHub Secrets, Scaleway
Secrets).

## Security posture

- **Passkeys by default** — WebAuthn with discoverable credentials, email
  verification (6-digit code, 10-min TTL), magic-link fallback for device
  reset only.
- **Sessions** — `HttpOnly` / `Secure` / `SameSite=Lax` cookies with JWT.
- **RBAC hierarchy** — `admin_app > admin_org > editor > guest`, with User
  Verification required for admin actions.
- **Anti-replay & anti-cloning** — strict challenge TTL and credential-counter
  validation.
- **Rate limiting** — every auth endpoint; email verification capped at
  3 codes / email / 10 min.
- **Security headers** — CSP, HSTS, COOP, COEP, `X-Content-Type-Options`,
  `X-Frame-Options`.

Details: [`spec/WORKFLOW_AUTH.md`](spec/WORKFLOW_AUTH.md).

## Repository layout

- `ui/` — SvelteKit 5 application (Top AI Ideas front-end, soon `@entropic/chat`
  consumer).
- `api/` — Hono API and LLM runtime.
- `rules/` — engineering rules (MASTER + workflow + conductor + subagents +
  testing + security).
- `plan/` — active branch execution files and orchestration artifacts.
- `spec/` — technical specs per surface.
- `e2e/` — Playwright end-to-end tests.
- `docs/` — user-facing documentation.
- `tmp/` — per-branch worktrees (gitignored).

## License & intent

Open source. No commercial telos for the substrate itself. Business-case
surfaces (Top AI Ideas and successors) are separate products running on top.
See [`README.intent.md`](README.intent.md) for the founding manifesto.
