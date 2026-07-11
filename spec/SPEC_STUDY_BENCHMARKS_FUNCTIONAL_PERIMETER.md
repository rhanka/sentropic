# SPEC_STUDY — Competitive Benchmarks Across Sentropic's Functional Perimeter

> Verified as of **2026-07-09**. Every cited `@sentropic/*` version is the in-repo `package.json` at
> that date; every "position" claim is evidence-first (a shipped package/branch, never a plan). Refresh
> the stamp + numbers on each revision, or the evidence-first claim self-undermines.

## Intention

Establish a **perennial workpackage** (WP-BENCH) that maintains, per functional perimeter, a
**living best-of-breed benchmark**: for each theme we track the state of the art ("best of"), score
Sentropic against it honestly, and keep two finalities in view at once:

1. **Virtuous / reversible** — open standards, self-hostable, data-portable, no vendor lock-in, a clean
   exit path. Being good must never mean being a cage. This is scored in the §Reversibility grid.
2. **At least as functional as everyone** — for each theme, Sentropic must reach feature parity with
   the best of the field on the criteria that matter to our users.

This document is the WP's charter + the benchmark tables. It is **living**: each theme's table is
refreshed as the field moves; the WP rolls up `%` per theme in track.

## What this WP is (and is NOT)

- **IS**: the benchmark ARTIFACTS — comparison criteria, competitor "best of" per theme, an honest
  Sentropic position, parity gaps, and the reversibility scorecard. One benchmark theme per functional
  perimeter, each mapped to the owning WP that actually builds the feature.
- **IS NOT**: the implementation of any feature. Building the feature stays in its owning WP
  (WP-APP for mcp/auth, WP-CHATUI for chat-ui, WP-KNOW for canvas, WP-FRAME/RESP/DATA). WP-BENCH
  feeds those WPs a target; it does not ship the code and does not mandate architecture.
- **IS NOT**: the h2a CLI benchmark. The **CLI** theme is **delegated to h2a**; WP-BENCH only imports
  h2a's benchmark result via a delegated-benchmark contract (§Theme 7) — it does not re-run it.
- **Deep-dive already owned**: the *agentic framework + control-loop + coding-CLI* theme has a
  dedicated deep study, [`SPEC_STUDY_AGENTIC_FRAMEWORK_CLI_BENCHMARK.md`](./SPEC_STUDY_AGENTIC_FRAMEWORK_CLI_BENCHMARK.md)
  (BR23). WP-BENCH references it as the theme-1 deep dive and keeps only the summary + reversibility row.

## Method (per theme)

Each theme is scored on a common frame so themes stay comparable:

- **Best of** — the strongest references in the field right now (leaders + notable OSS), grouped by
  sub-surface where a theme spans several (e.g. canvas).
- **Criteria** — the capabilities that decide the theme for our users (theme-specific).
- **Sentropic position** — `ahead | at-parity | partial | gap | absent`, each backed by the shipped
  package/branch; `partial` is used wherever a library exists but full product parity is unproven.
- **Parity gap** — the shortest list of what is missing to reach "at least as functional".
- **Reversibility** — a one-line per-theme note here, and a row in the §Reversibility grid
  (`yes | partial | no` on 5 criteria), because the virtuous finality is non-negotiable.

Scoring is **evidence-first and falsifiable**: a Sentropic "at-parity" claim cites a shipped package
+ version; an unpublished/private package is marked "in-repo, not published" and does NOT earn a
parity lean. A competitor claim cites a public capability, not marketing.

---

## Theme 1 — Agentic framework + engine (control loop + workflow durability)

> Deep dive: `SPEC_STUDY_AGENTIC_FRAMEWORK_CLI_BENCHMARK.md`. Summary only here.

**Best of.** *Frameworks*: LangGraph, Google ADK, Microsoft Agent Framework (AutoGen+Semantic Kernel
lineage), CrewAI, LlamaIndex Workflows, OpenAI Agents SDK, Pydantic-AI (typed), Mastra (TS), Agno,
AWS Strands / Bedrock AgentCore. *Durable engines*: Temporal, Restate, Inngest, **DBOS**, **Cloudflare
Agents (Durable Objects)**. *Memory*: Letta. *Optimization*: DSPy.

**Criteria.** Loop governance (plan/act/observe/approve/checkpoint/rollback); typed tool mediation;
durable long-running execution (retries/signals/human gates); **long-term memory / cross-session
state**; **eval / regression harness**; **state migration** (version a running graph); one structure
across web + job + CLI; **interop (MCP / A2A / tool-schema)**; observability (transcript/replay/cost);
safety (sandbox/secrets/destructive-gate).

**Sentropic position.** `gap`. Layered separation is the target (model access = `@sentropic/llm-mesh`;
loop governance; workflow durability; skill layer), but there is no formal loop-governance layer nor a
chosen durable engine yet — tracked by BR23. No over-claim: this theme is design-stage.

**Reversibility.** Agent loop is our own code; providers via mesh (swappable); the durable-engine choice
MUST stay self-hostable (Temporal/Restate/DBOS OSS) — no managed-only lock-in.

## Theme 2 — MCP (auth · gateway · registry)

**Best of.** *MCP-specific auth*: WorkOS AuthKit, Stytch Connected Apps, Descope, Auth0/Okta (generic
IdPs adapted). *Gateway / catalog*: Docker MCP Gateway + Catalog, Smithery, mcp.run, Composio,
Pipedream MCP, Zapier MCP, **Stacklok ToolHive**, **Klavis AI**, Gram (Speakeasy), Cloudflare Workers
OAuth provider. *Registry / directory*: official **MCP registry** (`modelcontextprotocol/registry`),
**PulseMCP**, **Glama**, Azure API Center. (Auth vendors, gateways, and registries are distinct
sub-markets — do not conflate.)

**Criteria.** Spec-correct RFC 9728 PRM + RFC 8414/8707 + RFC 9207; DCR (RFC 7591) vs static custom
creds; **transport coverage (streamable-HTTP / SSE / stdio)**; **newer-spec coverage (elicitation /
sampling / structured output)**; per-tenant enrollment + revocation; audience-bound tokens (no
passthrough); registry/discovery surface; gateway multiplexing + capability manifest; claude.ai +
ChatGPT + generic-native-client compatibility.

**Sentropic position.** `at-parity` on the **RS + IdP auth path** — `@sentropic/mcp-auth@0.2.0` +
`@sentropic/oauth-verify@0.1.0` shipped, claude.ai MCP go-live proven end-to-end (immo, public+PKCE),
self-hosted IdP live. `gap` on: open DCR/CIMD (deferred), a public registry surface, generic
ChatGPT/native-client flows, and platform activation — `@sentropic/mcp-platform` is **in-repo,
`private`, `0.0.0`, not published** (session store/revocation, per-tenant secret lifecycle, tenant
mapping, capability registry, `elicitation.ts` exist in-repo but earn no parity lean until published +
production-activated, P1).

**Reversibility.** Open standards throughout (MCP, OAuth/OIDC, RFCs); self-hostable IdP; tokens are
standard JWT — no proprietary handshake; a client can leave.

## Theme 3 — Mesh & gateway (model access + egress)

**Best of.** LiteLLM (proxy/gateway), OpenRouter, Portkey, Cloudflare AI Gateway, Kong AI Gateway,
Vercel AI Gateway, TrueFoundry; *observability/eval*: Helicone, Langfuse, **Braintrust**, **LangSmith**;
*routing (secondary/unverified as best-of)*: Martian, Requesty; cloud model gardens (Bedrock, Vertex).

**Criteria.** Provider-compat drop-in (`/v1/messages` + `/v1/chat/completions`); routing + fallback +
sticky sessions; **prompt/semantic caching**; **guardrails / PII redaction**; metering / quota / cost
ledger; streaming normalization; account modes (API key vs subscription/OAuth account pooling);
observability/eval; self-hostable.

**Sentropic position.** `at-parity` on the **account-selection primitive** — `@sentropic/llm-mesh@0.6.0`
ships a no-silent-rebind sticky lease via a pure in-memory `selectAccount` (`account-transports.ts`) +
the Claude-Code account auth path. **Differentiator**: personal Claude/Codex **account mutualization**
(ToS-guarded), a niche the big gateways avoid. `partial/gap` on the **gateway** —
`@sentropic/llm-gateway@0.2.1` defines the pooled-egress port contract (the `FOR UPDATE SKIP LOCKED`
short-tx lease is the *port contract* in `llm-gateway/src/ports/pool.ts`, not yet production-proven);
live routing, quotas, cost ledger, auth, and deployment (`llm.sent-tech.ca`) are not yet demonstrated.

**Reversibility.** Drop-in provider-compat endpoints — a consumer swaps `BASE_URL` back to the provider
and leaves; metering is our own exportable ledger; no proprietary SDK required.

## Theme 4 — Chat-UI (headless + rendered)

**Best of.** **assistant-ui** (React, closest peer), Vercel AI SDK UI (`useChat`) + **AI Elements**,
**OpenAI ChatKit / Apps-SDK widgets**, CopilotKit, Chainlit, LibreChat, Open WebUI, Deep Chat, NLUX,
Streamlit / Gradio chat; emerging protocol: **AG-UI**.

**Criteria.** Headless core vs rendered components; streaming + tool-call rendering;
**generative-UI / interactive in-stream components**; local-tool registration + capability gate;
attachments/vision; multi-framework (React/Svelte/Vue); theming / design-system adaptability; turnkey
`ChatConversation` vs BYO; **a11y**; **i18n / RTL**; **SSR hydration**; **long-thread virtualization**;
**reconnect / replay**; **bundle size / perf**.

**Sentropic position.** `at-parity` on a **headless-first** split — `@sentropic/chat-core@0.1.6` +
`chat-server@0.3.0` + `chat-ui@0.22.0` (published; local-tool registry + deny-by-default capability
gate; turnkey `ChatConversation`; DS "small" preset). `gap` vs assistant-ui/OpenAI on **React/Vue
adapters** (chat-ui ships **Svelte only** — verified: no React/Vue in `chat-ui/src`), generative-UI
components, and the assistant-ui/OpenAI mapping (tracked). Gold-parity program active.

**Reversibility.** MIT packages, headless core (BYO rendering/upload), standard message/wire shapes;
a host imports the core and renders its own — not a walled component kit.

## Theme 5 — Harness (full-stack agent/coding harness)

**Best of.** Claude Code, OpenAI Codex CLI, Cursor, GitHub Copilot (agent/Workspace), Aider, Cline,
Continue, Windsurf, Devin (Cognition), OpenHands, Sourcegraph Amp, Google Jules, Goose (Block),
SWE-agent, Roo Code; *hosted assistants* claude.ai, ChatGPT.

**Criteria.** Plan→edit→verify→PR loop; **autonomous edit loop**; **IDE + PR automation**; scope/branch
discipline; sandbox + approvals; skills / plugins / MCP; multi-host (CLI + web + CI); neutral
verification record; cross-agent portability; **objective benchmark score (SWE-bench Verified /
Terminal-Bench)** — the number a reader expects.

**Sentropic position.** `ahead` on a **neutral, cross-host method** — `@sentropic/harness@0.3.0`
(`harness <verb>` brainstorm/test/debug/review --consensus/plan/branch/verify, emits neutral
VerificationRun/WorkEvent; `harness/*` skill pack; the harness↔track seam v0) and on branch/scope
discipline + neutral artifacts (adopted by Claude/Codex/Gemini agents — evidence, not marketing).
`gap` on full coding-agent parity: no autonomous edit loop, no IDE/PR automation, no published
objective SWE-bench/Terminal-Bench score, third-party genericity unproven. Hermes = the runtime target
(BR23).

**Reversibility.** Neutral JSON records (VerificationRun / WorkEvent), MIT, cross-host plugins; not
bound to one model or IDE — portability is the point.

## Theme 6 — Canvas (pptx · doc · xlsx · diagram)

**Best of (by surface).**
- **Slides/pptx**: Gamma, Beautiful.ai, **Canva** (+ Magic Design), Microsoft Copilot (PowerPoint),
  Google Slides + Gemini, `python-pptx`, `pptxgenjs`, **Marp / Slidev / reveal.js**, Presenton (OSS).
  (Tome = watch/legacy.)
- **Docs**: Word Copilot, Google Docs + Gemini, Notion AI, `docx` (npm), **Typst**, **Pandoc**
  (universal export), OnlyOffice, Coda.
- **Spreadsheets**: Excel Copilot, Google Sheets + Gemini, ExcelJS, **Univer**, Rows, Equals.
  (Luckysheet = watch/legacy.)
- **Diagrams**: **Lucidchart** (+ Lucid AI), Excalidraw (+ AI), **Mermaid**, **D2**, **PlantUML**,
  **Graphviz**, tldraw, Miro AI, **Figma / FigJam**, diagrams.net (draw.io), Whimsical, Napkin.

**Criteria.** Round-trip fidelity (read + write, not just generate); native format output
(.pptx/.docx/.xlsx, no lossy PDF-only); rich in-app editing vs one-shot generation; charts / formulas;
collaboration; template fidelity; diagram-as-data (Mermaid/D2/Lucid); citation / source-anchoring;
export / portability; round-trip regression tests.

**Sentropic position.** `partial`. Native read+write is shipped (exceljs read+write, docx, pptxgenjs;
BR-40 prioritization sheets; Diag `render_mermaid` local tool; `@sentropic/cited-source-viewer` MD+PDF),
but native libraries + generated files ≠ canvas parity: `gap` on rich diagram editing (BR-40d deferred
Univer-like editor), collaboration, template fidelity, charts/formulas depth, round-trip tests, and
one-shot polished generation (Gamma/Canva).

**Reversibility.** Native open formats (OOXML .pptx/.docx/.xlsx, Mermaid/D2 text, Typst, PDF), OSS libs;
artifacts are downloadable standard files — the user owns the file, not a proprietary canvas.

## Theme 7 — CLI (delegated to h2a)

The CLI theme is **benchmarked by h2a**, not re-run here. WP-BENCH imports it via a
**delegated-benchmark contract**:

- **Source** — h2a benchmark artifact URI + version + freshness date (imported, not re-scored here).
- **Imported result** — h2a's own position + score, cited verbatim with its date.
- **Seam criterion** — how a Sentropic capability is *exposed* as a CLI surface through the h2a/`stp`
  seam is a *measured* criterion here (parity of exposure), NOT an architecture mandate imposed by this
  WP.
- **Reversibility** — imported from the h2a benchmark's own reversibility scorecard.

Until h2a publishes its benchmark artifact, this theme is `pending-import` (unmeasured, flagged — not
silently "done").

---

## Reversibility grid (the virtuous finality, made testable)

A theme cannot be called "done" on functionality alone if it fails reversibility. Scored
`yes | partial | no`:

| Theme | Open standard | Self-hostable | Data export | No lock-in SDK | Exit path |
| --- | --- | --- | --- | --- | --- |
| 1 · Agentic framework+engine | partial (MCP/A2A emerging; frameworks proprietary) | yes (OSS engines) | yes (event log) | yes (mesh-swappable) | partial (engine choice) |
| 2 · MCP (auth/gateway/registry) | yes (MCP/OAuth/RFCs) | yes (self-host IdP) | yes (standard JWT/DB) | yes | yes |
| 3 · Mesh & gateway | yes (OpenAI/Anthropic-compat) | yes | yes (own ledger) | yes (swap BASE_URL) | yes |
| 4 · Chat-UI | partial (own shapes; AG-UI emerging) | yes (MIT) | yes | yes (headless BYO) | yes |
| 5 · Harness | partial (neutral JSON; no industry std) | yes | yes (VerificationRun/WorkEvent) | yes (cross-host) | yes |
| 6 · Canvas | yes (OOXML/Mermaid/Typst/PDF) | yes | yes (native files) | yes (OSS libs) | yes |
| 7 · CLI (delegated) | → imported from h2a | → imported | → imported | → imported | → imported |

The differentiated Sentropic thesis: **be at least as functional as the best of each field, while being
the only one you can walk away from.**

## How this maps to the other workpackages

WP-BENCH is one WP; its themes mirror the delivery WPs. Each theme's parity gap is an input to the
owning WP's backlog (WP-BENCH measures; it does not build):

| Theme | Owning delivery WP(s) | Deep-dive doc |
| --- | --- | --- |
| 1 · Agentic framework + engine | WP-FRAME / WP-RESP | SPEC_STUDY_AGENTIC_FRAMEWORK_CLI_BENCHMARK |
| 2 · MCP (auth/gateway/registry) | WP-APP | SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM |
| 3 · Mesh & gateway | WP-APP / (mesh lane) | SPEC_EVOL_LLM_GATEWAY |
| 4 · Chat-UI | WP-CHATUI | SPEC_EVOL_CHAT_ECOSYSTEM / CHATUI_* |
| 5 · Harness | WP-FRAME | SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION |
| 6 · Canvas | WP-KNOW | SPEC_EVOL_CHAT_CANVAS / PDF_CANEVA_VIEWER |
| 7 · CLI | delegated → h2a | (h2a benchmark artifact) |

## Deliverables of the WP (perennial)

- This living benchmark doc, refreshed per theme (with the verified-as-of stamp) as the field moves.
- Per-theme parity-gap items fed to the owning delivery WP.
- The reversibility grid kept green across themes (the virtuous guarantee).
- No implementation here — WP-BENCH is measurement + target-setting only.

## Review provenance

Double-consensus on the first cut (2026-07-09): Opus 4.8 + Codex (GPT-5.x), both `SHIP-WITH-FIXES`.
Folded: real reversibility grid; tempered every over-claim to evidence (mesh `0.6.0`; SKIP-LOCKED =
gateway port contract not shipped mesh; `mcp-platform` marked private/unpublished; canvas `partial`;
harness `ahead`-on-method/`gap`-on-coding-parity; MCP `at-parity`-auth/`gap`-rest); added SWE-bench/
Terminal-Bench, caching+guardrails, transport+elicitation, generative-UI+a11y/SSR, memory/eval/interop
criteria; added DBOS/Cloudflare-Agents/Semantic-Kernel/Strands, PulseMCP/Glama/ToolHive/Klavis,
ChatKit/AI-Elements/AG-UI, Braintrust/LangSmith, Typst/Marp/D2/Pandoc/Canva/Figma; delegated-benchmark
contract for the CLI theme.
