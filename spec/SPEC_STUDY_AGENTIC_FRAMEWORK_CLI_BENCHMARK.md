# SPEC_STUDY - Agentic Framework and CLI Control Benchmark

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

## Current Entropiq baseline

The study starts from the existing roadmap rather than from a blank architecture:

- `@sentropic/llm-mesh` is the intended model access boundary. It should remain responsible for provider selection, model profiles, credentials, token/account modes, streaming normalization, and provider-level telemetry.
- The app chat runtime already has agent-facing concerns: message history, tool dispatch, continuation boundaries, generated artifacts, and UI-facing streaming.
- The workflow runtime from BR04B models product workflows as executable transitions. It is useful for business-process state, but it is not yet a complete governance layer for autonomous reasoning loops.
- The conductor branch process already contains useful human-control primitives: explicit scope, allowed/forbidden paths, selective staging, approval gates, checkpoints via commits, and read/report contracts.
- BR19 is the natural target for durable skill catalog and sandbox decisions. This BR23 study should produce inputs for BR19, not implement BR19 directly.

This means the target is not "pick one framework and replace Entropiq." The target is a layered architecture where framework adoption is selective and migration-safe.

## Decision lens: workflow graph modeling versus control-loop governance

Workflow graph modeling answers "what durable process should happen, in which states, with which dependencies, retries, and human gates." It is about explicit process topology and operational durability.

Reasoning/control-loop governance answers "how does an agent decide the next step, call tools safely, request approval, edit artifacts, checkpoint, recover, and expose its activity to users." It is about the live loop between model reasoning, tools, policy, state, and observation.

These concerns overlap but should not be collapsed:

- A graph can coordinate agents without defining safe patch discipline, shell policy, or approval UX.
- A CLI can enforce excellent loop governance without providing durable long-running workflow execution.
- A model SDK can stream and observe model calls without modeling either durable workflows or tool governance.
- Entropiq needs all three layers: model access, loop governance, and workflow durability.

## Decision matrix

| Candidate | Primary layer | Decision | Best fit for Entropiq | Key strengths | Main gaps / risks | BR23 implication |
| --- | --- | --- | --- | --- | --- | --- |
| LangGraph | Agent/workflow graph | Adapt | Explicit graph/state modeling for multi-step agent plans, supervisor/worker patterns, and replayable state transitions. | Strong graph semantics, stateful execution, explicit transitions, useful mental model for multi-agent routing. | Does not by itself solve product-grade approvals, filesystem policy, patch discipline, or CLI UX. May overlap with BR04B workflow concepts if adopted wholesale. | Use as a reference model for agent graph/state schemas. Do not replace product workflows by default. |
| Agno | Agent/team abstraction | Watch / selectively adapt | Lightweight agent/team/tool ergonomics and examples for app-level multi-agent composition. | Fast to model agents, tools, teams, knowledge, and simple app flows. Good ergonomics for prototypes. | Durability, governance, approvals, and enterprise observability need independent validation before adoption. | Borrow agent/team vocabulary where useful; avoid dependency until a concrete BR19/BR10 implementation need exists. |
| Temporal | Durable workflow engine | Adapt / possible adopt for jobs | Long-running durable workflows, retries, signals, cancellations, human gates, and background execution. | Mature durability model, workers, retries, event history, signals, timers, compensation patterns. | Heavy operational footprint. Not a reasoning-loop framework. Poor fit for per-token interactive CLI control. | Strong candidate for API/background workflow durability if Entropiq outgrows current workflow runtime. Keep separate from agent loop. |
| Vercel AI SDK / AI Gateway | Model access, streaming, gateway | Adapt | Streaming UX, provider abstraction patterns, telemetry/gateway ideas, and app integration. | Strong web streaming primitives, provider adapters, gateway/observability direction, good UI integration patterns. | Not a Temporal-equivalent workflow engine and not a full agent governance layer. Potential overlap with `@sentropic/llm-mesh`. | Use as a benchmark for mesh API shape, streaming events, and gateway telemetry. Do not replace workflow or control loop. |
| Claude Code | CLI control loop | Adapt | Terminal UX, plan/tool/observe loop, patch and file-edit discipline, approvals, memory, and human checkpoints. | Strong interactive coding loop, tool mediation, file context discipline, approval-oriented workflows. | Product APIs are not a reusable embedded framework. Behavior is tied to Anthropic/Claude UX and local CLI assumptions. | Treat as a reference implementation for Entropiq CLI loop governance. |
| Codex CLI | CLI control loop | Adapt | Workspace safety, sandbox/approval model, selective edits, code review posture, tool mediation, and commit discipline. | Strong repo-safety habits, explicit sandboxing, patch-first workflow, scope reporting, review-oriented final outputs. | Not a general workflow engine. CLI UX and policies may not map one-to-one to browser sessions. | Use as reference for branch/worktree execution, approvals, sandboxing, and patch discipline. |
| Gemini CLI | CLI control loop / provider integration | Watch / adapt | Tool mediation, repo operations, large-context workflows, and Google ecosystem/provider integration. | Useful comparison point for CLI tool contracts, model/provider coupling, and context handling. | Exact governance primitives and plugin model need verification before product commitment. | Track for CLI ergonomics and provider integration lessons; do not depend on it in BR23. |
| Clawcode-like tools | Claude-compatible CLI ecosystem | Watch | Compatibility patterns around Claude Code-like commands, local tooling conventions, and terminal affordances. | Can reveal emerging conventions for agent terminal UX and command/plugin portability. | Ecosystem quality and stability vary. Risk of copying surface UX without governance substance. | Use as a trend signal only unless a concrete primitive is superior and documented. |
| Entropiq current stack | Product runtime | Adopt as base | Existing product workflow/chat/model boundaries plus conductor governance patterns. | Already aligned with product domain, branch discipline, web/API concerns, and planned packages. | Needs a formal loop-governance layer and shared skill schema to avoid duplicated UI/API/CLI behavior. | Keep as base architecture; add framework-inspired primitives deliberately. |

## Framework notes

### LangGraph

LangGraph is strongest when the problem is explicit graph and state management for agentic flows. It is useful for modeling agent routers, supervisor/worker patterns, conditional transitions, accumulated state, and controlled continuation between nodes.

For Entropiq, the durable lesson is the shape of graph state, not necessarily the dependency. A future BR19 or BR10 design can borrow these primitives:

- `AgentGraph`: named nodes, typed edges, entry/exit conditions, and resumable state.
- `NodeState`: messages, artifacts, tool observations, policy decisions, and next-action hints.
- `TransitionPolicy`: deterministic conditions for moving between agents, tools, human approval, or stop states.

LangGraph should not be treated as a complete answer to approvals or patch discipline. It can say which node runs next; it does not define whether a shell command should be allowed, whether a patch is too broad, or how the user approves a risky action.

### Agno

Agno is interesting as an ergonomics benchmark for agent and team composition. The useful comparison points are how quickly an app can declare agents, attach tools, wire teams, and expose a runnable assistant.

The risk is premature adoption. Entropiq needs strict policy boundaries, artifact tracking, tool mediation, branch discipline, and future package boundaries. If Agno accelerates simple agent assembly but pushes governance into ad hoc callbacks, it should remain a watch item.

The likely use is vocabulary and developer-experience inspiration, not direct runtime replacement.

### Temporal

Temporal is the strongest candidate for durable process execution. It should be evaluated for jobs that must survive restarts, wait for humans, retry reliably, emit event history, and coordinate external side effects.

Temporal is not the agent reasoning loop. A good Entropiq design would use Temporal around the loop, not instead of it:

- Temporal workflow owns durable job lifecycle, retries, timers, signals, and cancellation.
- Entropiq agent loop owns reasoning steps, tool calls, approval requests, and artifact edits.
- Skill execution owns sandboxed tool behavior and typed outputs.
- UI/CLI owns interaction, streaming, and approval presentation.

This separation avoids the dual-runtime trap: long-running background workflows can become durable without forcing every interactive chat or CLI turn into Temporal.

### Vercel AI SDK / AI Gateway

Vercel AI SDK and AI Gateway are model/streaming/application infrastructure benchmarks. They are not direct replacements for Temporal or a full agent-control layer.

The strongest lessons for Entropiq are:

- event taxonomy for streaming text, tool calls, tool results, errors, and metadata;
- provider abstraction shape and normalized model invocation;
- app-friendly streaming APIs for UI and server routes;
- gateway-level telemetry, rate/usage visibility, and provider routing patterns.

The main architectural constraint is overlap with `@sentropic/llm-mesh`. Entropiq should compare API shape and telemetry practices, but preserve the mesh as the owner of provider and credential policy unless a later branch explicitly changes that contract.

## CLI control-loop benchmark

### Reusable control-loop primitives

The CLI candidates converge on a set of primitives Entropiq should treat as first-class:

- `Session`: current workspace, user intent, active policy, transcript, memory refs, and runtime mode.
- `Plan`: explicit current objective, ordered steps, status, and stop conditions.
- `ToolRequest`: proposed tool call with schema, risk class, policy decision, and approval requirement.
- `Observation`: tool output, user input, file diff, error, or external event returned to the loop.
- `Patch`: structured artifact edit with scope, target files, rationale, and rollback/checkpoint metadata.
- `Checkpoint`: durable boundary such as commit, saved artifact, workflow state, or user-approved milestone.
- `Approval`: user decision with scope, duration, and whether it applies once or to a command class.
- `Policy`: filesystem, network, secret, destructive action, and publication boundaries.

These primitives should be runtime-neutral. The same objects can drive a web chat session, an API background job, or a terminal session.

### Claude Code reference lessons

Claude Code is useful as a reference for interactive terminal UX:

- Planning is visible and revisable.
- Tool calls are mediated rather than invisible.
- File edits are treated as deliberate patches.
- User approvals interrupt the loop at risky boundaries.
- Memory and project instructions shape behavior before action.
- The terminal session remains conversational while still operating on real files.

The main lesson is not to copy the exact UX. The lesson is that an agentic CLI needs a control plane, not just a chat prompt plus shell access.

### Codex CLI reference lessons

Codex CLI is especially relevant to Entropiq's conductor process:

- strict workspace and branch awareness;
- sandboxed command execution with escalation;
- selective patching and selective staging;
- review-oriented reporting with read set, checks, risks, and scope adherence;
- strong distinction between exploration, edit, validation, and commit phases.

Entropiq can adapt this into a product-independent CLI loop where each action has a policy decision and each session can produce an audit trail.

### Gemini CLI reference lessons

Gemini CLI should remain a watch/adapt candidate for:

- large-context repository operations;
- Google ecosystem integration;
- command/tool mediation patterns;
- model/provider coupling choices;
- extension or command packaging conventions.

Before adopting any Gemini-specific pattern, BR23 or a later branch should verify the current public behavior and document exact primitives. If network or account access is unavailable, the blocker should be recorded rather than inferred.

### Clawcode-like reference lessons

Clawcode-like tools are best treated as ecosystem signals. They may show which Claude-compatible terminal affordances are becoming standard: slash commands, local memory files, MCP/tool wiring, shell approvals, and plugin-like extension points.

The risk is copying conventions without the safety model. Entropiq should only adapt a pattern if it improves governance, portability, or user comprehension.

## Shared UI/API/CLI architecture sketch

Entropiq should define a shared agent structure that is independent of presentation surface:

```text
Runtime surface
  UI chat | API job | CLI session | CI job | plugin host

Control plane
  Session -> Plan -> ToolRequest -> Approval -> Observation -> Patch -> Checkpoint

Shared services
  Agent registry -> Skill catalog -> Policy engine -> Artifact store -> Event log

Execution layers
  @sentropic/llm-mesh -> model calls and streaming
  Skill runner -> sandboxed tools and artifacts
  Workflow runtime / Temporal candidate -> durable jobs and human gates
```

### Shared schema proposal

| Object | Purpose | Shared by UI | Shared by API | Shared by CLI |
| --- | --- | --- | --- | --- |
| `AgentDefinition` | Name, role, model profile, available skills, memory policy, output contract. | Yes | Yes | Yes |
| `SkillDefinition` | Tool schema, permissions, runtime, input/output contract, artifact policy. | Yes | Yes | Yes |
| `WorkflowDefinition` | Business process graph, states, transitions, gates, retry policy. | Yes | Yes | Read/trigger |
| `LoopPolicy` | Approval rules, filesystem/network scope, destructive action gates, secret rules. | Yes | Yes | Yes |
| `SessionState` | Transcript, active plan, observations, pending approvals, artifacts, checkpoints. | Yes | Yes | Yes |
| `EventEnvelope` | Streaming/audit event with type, actor, timestamp, payload, correlation id. | Yes | Yes | Yes |

### Surface-specific behavior

| Surface | Shared structure | Surface-specific constraints |
| --- | --- | --- |
| UI chat | Agent definitions, skill catalog, streaming events, approvals, artifact cards. | Browser-friendly approval UX, optimistic streaming, multi-user permissions, hidden filesystem. |
| API jobs | Workflow definitions, skill execution, event log, artifacts, retry/cancel policy. | Durable execution, idempotency, background workers, no interactive terminal assumptions. |
| CLI sessions | Same loop policy, skills, event log, and artifact model. | Local filesystem scope, shell approvals, patches, commits/checkpoints, terminal affordances. |
| Hosted chat connectors | Model/skill subset and transcript policy. | Limited filesystem/tool control, provider-hosted constraints, less reliable checkpoint semantics. |

## Policy boundaries

The policy model should be explicit before implementation:

- Filesystem: CLI can operate on local worktrees with scoped read/write rules; UI/API should only access stored artifacts and server-authorized paths.
- Network: every runtime needs allow/deny policy and auditable escalation for public network calls.
- Secrets: model credentials and connector tokens stay in managed server-side stores; CLI may reference local credentials only through explicit policy.
- Destructive actions: delete, reset, force push, production writes, and external publication require high-friction approvals.
- Generated artifacts: every generated file/document should have an artifact record, owner, source event, and export/download path.
- Checkpoints: CLI checkpoints may be commits or patch snapshots; API checkpoints may be workflow events; UI checkpoints may be saved artifacts and user approvals.

## Observability and streaming requirements

The shared event stream should be designed before adopting a framework:

- `model.delta`: streamed model output from `@sentropic/llm-mesh`.
- `tool.requested`: tool call proposed with arguments and policy metadata.
- `approval.requested`: user or system approval required before execution.
- `tool.started` / `tool.completed` / `tool.failed`: execution lifecycle.
- `artifact.created` / `artifact.updated`: generated file or document lifecycle.
- `checkpoint.created`: durable boundary for recovery or review.
- `workflow.transitioned`: business workflow state transition.
- `policy.denied`: blocked action with reason and remediation path.

This event taxonomy is the bridge between UI streaming, API observability, CLI transcripts, and audit trails.

## Branch implications

| Branch | Implication |
| --- | --- |
| BR14b | Chat-service core should isolate the agent loop from model access and product workflow state. Avoid embedding framework-specific graph assumptions directly into chat service internals. |
| BR14a | Chat UI SDK should consume a stable event taxonomy and approval/artifact contracts rather than hardcoding provider-specific streaming behavior. |
| BR19 | Primary target for `SkillDefinition`, `LoopPolicy`, sandboxing, tool mediation, and shared skill discovery. |
| BR15 | Generated spectral/site tools should register as skills instead of bespoke tool branches once BR19 exists. |
| BR10 | VSCode multi-agent work should reuse CLI loop primitives: workspace policy, patch discipline, approvals, checkpoints, and terminal/editor UX. |

## Recommendation

The current recommendation is layered:

- Adopt Entropiq's current stack as the base, including `@sentropic/llm-mesh`, BR04B workflow concepts, conductor discipline, and future BR19 skill catalog.
- Adapt LangGraph concepts for graph/state schemas, not as an immediate wholesale runtime replacement.
- Adapt Temporal concepts, and possibly the engine later, for durable API/background workflows with human gates.
- Adapt Vercel AI SDK / AI Gateway patterns for streaming, model event taxonomy, gateway telemetry, and app integration while preserving mesh ownership.
- Adapt Claude Code and Codex CLI as control-loop governance references for CLI UX, approvals, patch discipline, checkpoints, and scoped tools.
- Watch Agno, Gemini CLI, and Clawcode-like tools for ergonomics and ecosystem conventions until a later branch verifies concrete adoption value.

No SPEC_VOL should be written from this study alone. The output is decision support for a later user review session.

## study_evol rules

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
