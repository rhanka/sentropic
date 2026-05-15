# SPEC_STUDY — Skills, Tools, Plugins, Agents, Marketplace

Study only. Output of BR23 dedicated research (peer F) on the conceptual boundary between `@sentropic/skills` (BR19, our "gems-style" store) and an "agent marketplace", and how `@sentropic/harness` (BR25) sits alongside.

## 1. Canonical definitions

| Concept | Definition | Identity criterion |
|---|---|---|
| **Tool** | atomic function callable by an LLM | `{ name, description, inputSchema, execute }`. Stateless. Granularity ≈ one verb. |
| **Skill** | capability bundle = instructions + 0..N embedded or referenced tools + invocation guidance + optional context filter + optional sandbox policy | one logical capability. Invoked by `/skill-name` or auto-discovered by LLM via description match. |
| **Plugin (CLI)** | distributable package containing one or more skills + tools + manifest | shippable artefact (npm pkg, git repo, Codex/Claude/Gemini plugin format). |
| **Agent** | autonomous orchestrator with reasoning loop, memory, tool dispatch, approval gates, checkpoints | has state machine. Multi-step. An agent **consumes** skills and tools; it is not itself a skill. |
| **Marketplace** | curated public registry with discovery + distribution + optional monetization | exists to make skills/plugins/agents discoverable and installable across users/orgs. Distinct from a flat registry by adding curation, ranking, payment, SLAs. |

Negation rules (must hold by construction):
- Tool ≠ Skill (granularity: function vs capability bundle).
- Skill ≠ Plugin (logical unit vs distributable artefact; a plugin may bundle many skills).
- Plugin ≠ Agent (extension mechanism vs autonomous orchestrator).
- Marketplace ≠ Registry (curated/billed/ranked vs flat inventory).

## 2. Inventory per product

| Product | Tools | Skills | Plugin/extension | Agent | Marketplace |
|---|---|---|---|---|---|
| **Claude Code** | MCP servers (stdio/HTTP/SSE) | `SKILL.md` (frontmatter `name`/`description`, body, `/skill-name` invocation, description-based auto-discovery) | MCP servers + Claude skills folder | Claude Code session = agent | none integrated (relies on `mcp.so` for tool discovery) |
| **Codex CLI** | git/code/file tools, sandboxed | not yet a public skill registry; `.codex/skills/` mentioned but format proprietary | `codex plugin add <repo>` | Codex CLI session = agent | none |
| **Gemini CLI** | repo ops, MCP integration | "Gems" (persona/instructions packs) | MCP servers | Gemini CLI session = agent | Gemini API gallery (informal) |
| **OpenAI / ChatGPT** | function calls + Custom GPT actions (webhook-based) | Custom GPT instructions | none for CLI; GPT actions for hosted GPTs | Custom GPTs (agents) | **GPT Store** (curated, monetizable) |
| **Vercel AI SDK** | typed `tools: { name: {...} }` | no skill layer — tools only | none (library) | composable via `streamText + maxSteps` | none |
| **CrewAI / Agno / Mastra** | `@tool` decorators on agent classes | embedded in agent definitions | local-only | first-class agent abstraction | none integrated |
| **MCP (Anthropic)** | servers expose tools + resources + prompts | indirect (a "prompt" resource is skill-adjacent) | MCP servers = the plugin format | not directly | `mcp.so` registry (currently flat, not a true marketplace) |
| **LangChain Hub** | LCEL runnable templates | template skills (closer to prompt skills) | LangChain packages | composable agents (LangGraph) | LangChain Hub (templates + agents) |
| **Hugging Face** | model + Spaces (apps) | Spaces with custom UI | Space repo | full agent Spaces | HF Spaces / Models (true marketplace incl. paid) |

Pattern observed:
- "Skill" is consistently **a bundle that wraps tools with instructions**.
- "Plugin" is consistently **a distributable artefact**.
- "Agent" is consistently **a runtime orchestrator**.
- "Marketplace" is the optional layer **on top of a registry**, adding curation + distribution + monetization. Only GPT Store and HF Spaces qualify as true marketplaces today.

## 3. MCP as transport layer (not as the business layer)

What MCP standardizes:
- Wire protocol for **tools**, **resources**, **prompts** over stdio / HTTP / SSE transports.
- Capability negotiation between client (CLI/app) and server (capability provider).
- A flat registry (`mcp.so`).

What MCP does **not** standardize:
- Skill description-based auto-discovery semantics (Claude Code-specific).
- Approval policy UX.
- Artifact lifecycle.
- Sandbox policy.
- Agent loop control.
- Marketplace curation, monetization, SLAs.

Implication for `@sentropic/*`:
- `@sentropic/skills` MAY expose its skills as MCP servers (for cross-CLI interop with Claude Code / Codex / Gemini).
- MCP is a **transport adapter**, not a substitute for the skill semantic in `@sentropic/skills`.
- A `@sentropic/skills` skill compiles to one MCP server bundle (or a subset of an MCP server), but the source of truth is the SKILL.md in our format.

## 4. Frontière `skill` vs `agent`

A skill answers "what can be done?" (capability + invocation guidance).
An agent answers "who decides and acts?" (autonomous reasoning loop).

Concretely:
- A skill is invoked. An agent invokes.
- A skill is stateless from the consumer perspective (or carries thin context filter). An agent owns durable state (memory, checkpoints).
- A skill is portable across agents. An agent is bound to a runtime (chat-core, vscode-ext, CLI session).

In our stack:
- `@sentropic/skills` (BR19) provides the **catalog** of skills.
- `@sentropic/chat-core` (BR14b) is **one agent runtime**.
- `@sentropic/flow` (future) is **another agent runtime** (workflow-style).
- A custom CLI built on `@sentropic/harness` is **a third agent runtime**.
- All three runtimes consume the same skills.

## 5. `@sentropic/skills` design (proposed)

Package structure:

```
@sentropic/skills/
├── src/
│   ├── types/
│   │   ├── skill.ts          # Skill, SkillMetadata, ContextFilter, SandboxPolicy
│   │   ├── tool.ts           # re-exported tool types from contracts
│   │   └── invocation.ts     # SkillInvocation, SkillResult
│   ├── catalog/
│   │   ├── registry.ts       # SkillRegistry: register / list / search / get
│   │   └── built-ins.ts      # built-in skills shipped with package
│   ├── sandbox/
│   │   ├── runtime.ts        # isolated-vm or vm2 wrapper (interface)
│   │   └── policy.ts         # API surface allowed inside sandbox
│   ├── discovery/
│   │   └── search.ts         # search_skills meta-tool (LLM-callable for description-match)
│   └── interop/
│       └── mcp-export.ts     # compile a skill to an MCP server bundle
├── skills/                   # bundled reference skills (each its own SKILL.md folder)
│   ├── document_generate/
│   │   ├── SKILL.md
│   │   └── tools.ts
│   └── ...
└── package.json
```

Skill format (`SKILL.md`):

```markdown
---
name: document_generate
description: Generate DOCX/PPTX documents from LLM-produced code in a sandbox.
version: 1.0.0
category: document
contextFilter:
  workspaceTypes: [ai-ideas, opportunity]
  roles: [editor]
sandbox:
  surface: [files.create, files.read, network.fetch]
tools:
  - name: generate_docx
    description: Render a DOCX from a TypeScript program.
    inputSchema: { ... }
  - name: generate_pptx
    description: Render a PPTX from a TypeScript program.
    inputSchema: { ... }
outputRenderHints:
  generate_docx: download
  generate_pptx: download
---

# document_generate

Sandbox-based document generation skill.

## When to use

Call this skill when the user asks for a DOCX/PPTX export.

## Inputs

...

## Examples

...
```

Distribution:
- npm package: `@sentropic-skills/document-generate` (one skill per npm package keeps versioning clean).
- The aggregate `@sentropic/skills` is the registry + sandbox + built-ins.
- Optional: compile to MCP server via `interop/mcp-export.ts`, publish to `mcp.so` for cross-CLI use.

Consumption:
- `chat-core` calls `skills.search(query, context)` → returns skill candidates → LLM chooses.
- Or LLM directly calls `search_skills` meta-tool (registered automatically by `chat-core`).
- Then `chat-core` invokes the chosen skill's tools via standard tool dispatch.

## 6. `@sentropic/harness` ↔ `@sentropic/skills` articulation

These are **two distinct packages** with no runtime dependency between them.

| | `@sentropic/harness` (BR25) | `@sentropic/skills` (BR19) |
|---|---|---|
| Nature | tooling | runtime |
| Scope | scaffold + verify + conduct dev branches | catalog + sandbox + discovery of agentic capabilities |
| Consumer | CLI users / project maintainers | agents (chat-core, flow, custom CLI) |
| Distribution | one npm package + CLI binary `harness` (or `sentropic`) | one aggregate npm + one per skill |
| Imports | `graphify-node` (planned, for `harness graph ...` commands) | tool schemas from `@sentropic/contracts` |
| Runtime dependency from `@sentropic/*` | none | depended on by `chat-core` (via `ToolRegistry`) and `flow` |
| Marketplace ambition | none | yes — skills publishable to npm + mcp.so + future Sentropic registry |

Harness is the equivalent of "graphify for ai-dev OS": a project bootstrapper / branch conductor / verify hook runner. Skills is the equivalent of "Gemini Gems" or "Claude skills": a catalog of agentic capabilities.

Conceptual layering:

```
  Runtime surfaces (UI chat, API job, CLI session, CI job)
                        ↓
  Agent runtimes (@sentropic/chat-core | @sentropic/flow | custom CLI built with harness)
                        ↓
  Shared infrastructure (@sentropic/llm-mesh, @sentropic/events, @sentropic/contracts)
                        ↓
  Capability catalog (@sentropic/skills) ← consumed by agents, NOT by harness
                        ↓
  Distribution (npm, mcp.so, GitHub releases, optional Sentropic registry)
```

`harness` sits sideways — it scaffolds projects that USE the agent runtimes; it does not consume skills at runtime.

## 7. Distribution strategy (no proprietary registry yet)

Primary:
- **npm**: each skill is its own npm package `@sentropic-skills/<name>`, semver-versioned, published from a monorepo.
- **GitHub releases**: source + changelog.

Secondary:
- **MCP server export**: each skill compiles to an MCP server bundle, publishable to `mcp.so` for cross-CLI compatibility (Claude Code / Codex / Gemini).

Tertiary (deferred):
- **Sentropic registry**: only if a business need emerges (curated catalog, paid skills, usage analytics, signed skills, SLAs). Not for MVP.

Rationale: ship on existing ecosystems first; build a proprietary registry only when curation/monetization needs justify the operational cost.

## 8. Decision: skills vs marketplace, summarized

- "Skills" and "agent marketplace" are **orthogonal concerns**.
- `@sentropic/skills` is the **catalog + runtime + sandbox** for skills. It is what we ship in BR19.
- A **marketplace** is a distribution surface that can sit on top of any skill catalog. Initially we delegate distribution to npm + mcp.so. A proprietary marketplace is a separate, later, business-driven decision.
- An **agent marketplace** (selling whole agents like GPT Store does) is a different product entirely — it would package a custom `chat-core` configuration + selected skills + system prompt as a deployable agent. **Out of scope until** we have multiple successful agent runtimes and explicit demand.

## 9. Open questions

1. Per-skill npm package vs monorepo with single aggregate package? Lean per-skill for independent versioning; aggregate `@sentropic/skills` re-exports.
2. Sandbox runtime: `isolated-vm`, `vm2` (deprecated), `quickjs`, WASM? Each has different security posture and FFI cost.
3. `outputRenderHint` declared at tool level or skill level? Lean tool level (a single skill may have tools with different render hints).
4. MCP export strategy: 1 skill = 1 MCP server, or 1 skill bundle = 1 MCP server? Lean 1-per-skill for granular permissions on the consumer side.
5. How does a skill declare its required `AuthzContext` (RBAC role)? Probably via `contextFilter.roles`, enforced by `chat-core.ToolRegistry`.
6. Versioning compatibility: how does a chat-core session declare "skills compatible with semver range"? Lean a `skillRequirements` field in session metadata.
7. Cross-skill composition: can one skill call another skill? Lean no, to keep skill semantics atomic; if composition needed, that's the agent's job.

## 10. References

- Claude Code skills: <https://code.claude.com/docs/en/sub-agents>
- Anthropic skills repo: <https://github.com/anthropics/skills>
- Codex CLI plugins: <https://developers.openai.com/codex/agent-approvals-security>
- MCP protocol: <https://modelcontextprotocol.io>
- mcp.so registry: <https://mcp.so>
- OpenAI GPT Store: <https://chatgpt.com/gpts>
- HF Spaces: <https://huggingface.co/spaces>
- LangChain Hub: <https://smith.langchain.com/hub>
- Internal `tools.ts` (current 30+ tool implementations to migrate into skills): `api/src/services/tools.ts`
- BR19 plan (pending): `plan/19-BRANCH_feat-agent-sandbox-skills.md`
