# BR23 - feat/multi-agent-framework-comparison

## Identity

- [ ] Branch: `feat/multi-agent-framework-comparison`
- [ ] Worktree: `tmp/feat-multi-agent-framework-comparison`
- [ ] Base: `origin/main` after BR14c and audit hotfix merge
- [ ] Mode: brainstorm and watch branch, no product implementation by default
- [ ] ENV: `test-feat-multi-agent-framework-comparison`

## spec_vol

- [ ] Intention: identify a durable agentic architecture that treats workflow models and reasoning/control loops as first-class concerns.
- [ ] Success: produce a decision-grade comparison covering app runtime, CLI runtime, web/chat runtime, provider SDKs, agent frameworks, orchestration engines, and plugin publication paths.
- [ ] Success: clarify how the same agent/workflow/skill structure can be used from UI, API, and CLI modes.
- [ ] Non-goal: no immediate migration to LangGraph, Agno, Temporal, Vercel, Claude, Codex, Gemini CLI, or any other framework.

## spec_evol

- [ ] Broaden the benchmark when a candidate exposes durable control-loop primitives, CLI execution semantics, plugin distribution, or observability that our architecture lacks.
- [ ] Treat Vercel AI SDK / AI Gateway as model-access, streaming, observability, and deployment-adjacent infrastructure, not as a Temporal-equivalent workflow engine.
- [ ] Treat Claude Code, Codex CLI, Gemini CLI, Clawcode, and similar CLIs as reference implementations for agent loop control, patch discipline, tool mediation, memory, approval gates, and terminal UX.
- [ ] Separate workflow graph modeling from reasoning loop governance.
- [ ] Defer product implementation to BR19 or later branches unless the benchmark identifies a critical blocker for BR14b/BR14a.

## Scope

- [ ] Allowed: `BRANCH.md`.
- [ ] Allowed: `spec/**` for benchmark notes and decision specs.
- [ ] Allowed: `plan/**` for branch dependency updates.
- [ ] Allowed: `docs/**` if documentation directory exists or is introduced for benchmark artifacts.
- [ ] Conditional: `packages/llm-mesh/**` only for read-only notes unless explicitly approved later.
- [ ] Forbidden: product runtime rewrites.
- [ ] Forbidden: database migrations.
- [ ] Forbidden: npm package publishing changes.
- [ ] Forbidden: direct dependency installation without an approved implementation branch.

## Lot 0 - Frame the benchmark

- [x] Define evaluation dimensions for workflow graph, control loop, tool mediation, memory, approvals, observability, streaming, CLI UX, web UX, plugin distribution, and durability.
- [x] Define current architecture baseline: `@sentropic/llm-mesh`, app chat runtime, workflow runtime, default agents, existing tools, and planned BR19 skill catalog.
- [x] Define how `spec_vol` and `spec_evol` will be used to record intention and scope evolution.

## Lot 1 - Framework and orchestration watch

- [x] Compare LangGraph for graph/stateful agent orchestration.
- [x] Compare Agno for agent/team abstractions and tool orchestration.
- [x] Compare Temporal for durable workflow execution and human-in-the-loop control.
- [x] Compare Vercel AI SDK / AI Gateway for model access, streaming, gateway, telemetry, and app integration.
- [x] Add other candidates only if they materially affect durable app+CLI architecture.

## Lot 2 - CLI loop/control benchmark

- [x] Analyze Claude Code control-loop patterns: planning, tool calls, patch discipline, approvals, memory, and checkpoints.
- [x] Analyze Codex CLI control-loop patterns: workspace discipline, tools, sandboxing, approvals, and code review flow.
- [x] Analyze Gemini CLI control-loop patterns: tool mediation, repo operations, and model/provider integration.
- [x] Analyze Clawcode or equivalent Claude-compatible CLI patterns if useful.
- [x] Extract reusable primitives for an Entropiq CLI.

## Lot 3 - Unified app and CLI architecture

- [x] Define a shared agent/workflow/skill schema that can drive both web app interactions and CLI sessions.
- [x] Define how UI chat, API jobs, and CLI loops share skill discovery and execution policies.
- [x] Define where Claude.ai/ChatGPT-style hosted chat constraints differ from controllable CLI loops.
- [x] Define policy boundaries for user approvals, filesystem/network access, secret handling, and generated artifacts.

## Lot 4 - Publication and ecosystem strategy

- [ ] Identify whether output should be shipped as npm packages, Codex/Claude/Gemini plugins, GitHub Actions, CLI binary, docs, or templates.
- [ ] Define how `@sentropic/llm-mesh` relates to future agent/workflow/skill packages.
- [ ] Define what should stay product-private versus public/open reusable infrastructure.

## Lot 5 - Decision output

- [x] Produce a recommendation matrix with adopt, adapt, watch, and reject categories.
- [x] Produce branch implications for BR14b, BR14a, BR19, BR15, and BR10.
- [ ] Produce a short migration-safe roadmap with no dual-runtime trap.
- [ ] Remove `BRANCH.md` before merge unless project explicitly keeps it.
