# Entropic — Rebrand Intent (2026-04-17)

> This document captures the founding intent behind renaming `top-ai-ideas-fullstack`
> to `entropic` and the underlying vision for the project. It is committed **as-is**
> from the user's own articulation, before any engineering translation. The new
> `README.md` at the repo root is the engineering-facing rewrite derived from this
> intent; this file remains the source of truth for *why*.

## 1. Naming — the three layers

The name `entropic` is deliberately overloaded:

1. **Entropy (Shannon's information theory)** — the core mathematical substrate of
   everything LLMs do. Tokens, probability distributions, compression, surprise:
   these are the primitives we build on. Naming the project after entropy is a
   statement that we take the underlying theory seriously, not the branded veneer.
2. **A tongue-in-cheek nod to Anthropic** — "entropic" sits one phoneme away from
   "Anthropic" and means the opposite thrust. Where a closed frontier lab curates
   and sells access, this project disperses, recombines, and redistributes. The
   wordplay is the point.
3. **A wink at the SaaSpocalypse** — the thesis that the entire commercial SaaS
   stack is about to get re-synthesized by agent-coded software, and that the
   direction of motion is entropic: bespoke OSes, bespoke stacks, proliferation
   rather than consolidation.

## 2. The 10-point manifesto

1. **Entropy as theoretical ground.** Shannon's theory is the foundation we
   reference, not the marketing surface.
2. **A pied-de-nez à Anthropic.** The name is a deliberate counter-positioning to
   the frontier-lab-as-platform model. We are not a lab. We are the decentralized
   alternative.
3. **SaaSpocalypse clin d'œil.** The whole software industry is about to refactor
   itself. We think that is a feature, not a bug.
4. **JS-first bet.** Per the prediction (whose author we forget, and that is fine)
   that everything becomes JavaScript eventually — we lean into TypeScript as the
   lingua franca.
5. **Every company builds its own OS.** Agent coding accelerates the point where
   any organization can stand up, in-house, the software substrate it used to rent.
   We build the tools that make that realistic.
6. **Progressive standalone replacement of the AI ecosystem.** As a solo developer
   (and eventually a community of them), we replace, one brick at a time, the
   commercial AI ecosystem: agentic workflows (LangGraph, Temporal), AI SDKs
   (Vercel AI SDK, Vercel Chatbot), coding plugins and CLIs. All open-source. No
   commercial telos.
7. **New concepts, not just clones.** Two are already on the table:
   - **UI templating adapted to AI** — UI primitives designed from the ground up for
     AI-generated and AI-modified interfaces.
   - **Collaborative work on AI-generated objects** — multi-user workflows where
     the artifact is jointly produced with an AI, not merely reviewed after.
8. **First business cases: consulting.** The earliest vertical applications are
   consulting workflows — AI/IT assessment, opportunity management, bid
   management. These are *demonstrations* of the platform, not the platform itself.
9. **SaaSpocalypse acceleration plan.** Start with the AI core, and pull in the
   Python libraries it depends on, as fast as possible, into the JS/TS world. The
   core AI runtime must not be held hostage to a second runtime.
10. **Long horizon: TS OS + compiler + LLM.** The end-state includes an OS in
    TypeScript, a compiler, and eventually our own LLM. **No strong conviction
    about TypeScript per se** — it is a convergent positioning, accelerated by AI
    itself. A small, explicit conviction: **separate ourselves from React.**

## 3. Engineering consequences (committed here, dispatched elsewhere)

The intent above has a few immediate engineering consequences. This document does
not *execute* them — it only declares them, so the dispatch can be traced:

- **Repo rename:** `rhanka/top-ai-ideas-fullstack` → `rhanka/entropic`. The
  repo-level rename is handled in PR #117 (this branch). A study agent will
  enumerate every `top-ai` / `@top-ai/*` / `TOP_AI_*` occurrence in the code and
  dispatch the renames into exactly two engineering branches:
  - **BR-14** `feat/chat-modularization` — UI / chat surface rename as part of
    making `@entropic/chat` a publishable library.
  - **BR-14b** `feat/llm-runtime-refacto` — API / LLM runtime rename, concurrent
    with the runtime refactoring that BR-14 hands off to.
  - No rename commits leak outside these three branches.
- **Top-AI-Ideas becomes a business case.** The existing product (top AI ideas
  catalog) stops being the project. It becomes one of several consulting
  business-case surfaces running *on* entropic.
- **`@top-ai/` scope retired.** All new packages are published under `@entropic/`.
  Existing `@top-ai/` names are migrated in BR-14 / BR-14b, never elsewhere.

## 4. What is NOT decided here

- Specific package boundaries of `@entropic/*` — that is BR-14 scoping.
- How BR-14b's runtime refactor matches BR-14's SDK seams — that is the BR-14 →
  BR-14b handoff contract.
- The TS-OS and LLM end-states — long horizon, not on any current wave.
- Whether we ship a LangGraph-equivalent, a Temporal-equivalent, or both — that
  is BR-07 / BR-07b territory.

## 5. Relationship to `README.md`

The new `README.md` in this PR is the *engineering-facing* expression of this
intent: positioning, scope today, scope tomorrow, contribution model. This file
(`README.intent.md`) is the *founding document* — kept in-repo so future rewrites
of `README.md` can be audited against the original intent, and so newcomers can
read the unvarnished version.

---

*Committed as-is from the user's articulation on 2026-04-17. Edits to this file
are discouraged; extend or supersede via a new dated intent document.*
