# SPEC_VOL - Agentic Framework and CLI Control Benchmark

## Intention

Build a durable decision framework for Entropiq's agentic architecture. The benchmark must compare workflow engines, agent frameworks, model-access SDKs, and CLI control loops as distinct layers, then define how one shared structure can power web, API job, and CLI modes.

## Durable question

The central question is not only which framework models workflows best. It is also which control-loop structure lets an agent reason, call tools, ask for approval, edit artifacts, verify work, recover from failures, and expose the same behavior in a browser session and a terminal session.

## Candidate families

- LangGraph: graph/stateful agent orchestration and explicit state transitions.
- Agno: agent/team/tool abstractions and app-level ergonomics.
- Temporal: durable workflow execution, retries, signals, human-in-the-loop gates, and long-running jobs.
- Vercel AI SDK / AI Gateway: model access, streaming primitives, provider abstraction, observability, and application integration.
- Claude Code / Codex CLI / Gemini CLI / Clawcode-like tools: reasoning loop control, patch discipline, tool mediation, approvals, filesystem boundaries, shell execution, and terminal UX.
- Entropiq current stack: `@sentropic/llm-mesh`, default agents, workflow runtime, chat runtime, conductor branch process, future BR19 skill catalog.

## Evaluation dimensions

- Workflow modeling: graph, DAG, state machine, queue, task ownership, cancellation, resumability.
- Reasoning loop governance: plan, act, observe, revise, approval, checkpoint, rollback, escalation.
- Tool mediation: schema, permission, context filtering, typed execution, result validation.
- Skill discovery: static registry, dynamic search, context-aware availability, user toggles.
- Runtime modes: web chat, background jobs, CLI sessions, CI jobs, plugin execution.
- Observability: transcript, event log, artifacts, metrics, cost, replay, audit trail.
- Safety: sandboxing, secrets, filesystem/network access, destructive command gates.
- Publication: npm package, CLI binary, Codex skill/plugin, Claude command/plugin, Gemini extension, GitHub Action, MCP server, documentation template.

## Architecture hypothesis

Entropiq should separate four layers:

- Model access layer: `@sentropic/llm-mesh` owns providers, model profiles, streaming normalization, and credentials.
- Agent loop layer: owns reasoning loop state, approvals, tool calls, observations, memory, and recovery.
- Workflow layer: owns durable task graphs, retries, dependencies, human gates, and background execution.
- Skill layer: owns capability discovery, schemas, sandboxed execution, artifact production, and policy filters.

A CLI should not be a separate architecture. It should be a runtime shell around the same agent loop, workflow, skill catalog, and model mesh used by the web app.

## spec_evol rules

- Add candidates only when they teach a durable primitive missing from the current benchmark.
- Do not collapse Vercel AI SDK into the same category as Temporal; compare it as model/streaming/gateway infrastructure.
- Do not collapse Claude.ai or ChatGPT hosted UX into CLI loops; hosted chat has different control boundaries.
- Feed product implementation decisions into BR19 and later runtime branches, not directly into this benchmark branch.
- Prefer adopt/adapt/watch/reject decisions over vague recommendations.

## Expected output

- A benchmark matrix with evidence and tradeoffs.
- A shared UI/API/CLI architecture sketch.
- A CLI feasibility recommendation.
- Implications for BR14b, BR14a, BR19, BR10, and future public packages.
