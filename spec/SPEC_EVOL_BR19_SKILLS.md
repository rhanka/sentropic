# SPEC_EVOL_BR19 — `@sentropic/skills` package

Status: scoping draft for BR-19. To be consolidated into `spec/SPEC_VOL_AGENT_SANDBOX_SKILLS.md` at Lot 8 then deleted (per `rules/MASTER.md` `BRANCH_SPEC_EVOL` policy).

This SPEC_EVOL freezes the design surface that downstream lots (1..9 of `BRANCH.md`) implement without ambiguity. It refines `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`, `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §1+§5+§14+§15, and the existing `SPEC_VOL_AGENT_SANDBOX_SKILLS.md`.

## 0. Definitions used in this spec

- **Tool**: atomic LLM-callable function (`{ name, description, inputSchema, execute }`). Granularity ≈ one verb.
- **Skill**: capability bundle (instructions + 0..N tools + invocation guidance + optional `contextFilter` + optional `sandbox` policy).
- **Skill bundle / package**: distributable npm artefact wrapping one or more skills.
- **Skill source registry**: in-memory map keyed by `name`, scoped per process; populated from built-ins + installed npm packages + (future) marketplace fetches.

## 1. `SKILL.md` format (frozen)

YAML frontmatter (strict schema, validated by Zod at parse time) + Markdown body (free-form, surfaced to the LLM as instructions).

### 1.1 Frontmatter schema

```yaml
name: string                                 # unique within source registry; kebab-case
description: string                          # ≤ 280 chars; LLM-readable for description-match auto-discovery
version: string                              # semver
category: string                             # free taxonomy (document | object | web | workflow | analysis | ...)
contextFilter:                               # optional; defaults to "always available"
  workspaceTypes: string[]                   # e.g. ['ai-ideas', 'opportunity']
  roles: string[]                            # AuthzContext roles required
  requiresOnline: boolean                    # default false (see SPEC_STUDY_ARCHITECTURE_BOUNDARIES §10.6)
sandbox:                                     # optional; absent => skill exposes native handlers only
  surface: string[]                          # allowlist: 'files.create' | 'files.read' | 'db.query' | 'db.mutate' | 'fetch'
  timeoutMs: number                          # default 30000
  memoryMb: number                           # default 128
tools:                                       # one or more LLM-callable tools exposed by the skill
  - name: string                             # globally unique tool name within skill registry (kebab-case, may inherit skill prefix)
    description: string                      # tool-level description for fine LLM choice
    inputSchema: JSONSchema                  # required; Zod-derived JSON Schema accepted
    outputSchema: JSONSchema                 # optional; required when outputRenderHint != 'text'
    outputRenderHint: string                 # optional; 'text' | 'terminal' | 'map' | 'chart' | 'image' | 'iframe' | 'download' | string
    sideEffect: boolean                      # default false; if true => idempotency key server-derived (§3 SPEC_STUDY_ARCHITECTURE_BOUNDARIES)
    requiresApproval: boolean                # default false; if true => chat-core surfaces approval gate
authzRequirements:                           # optional explicit allow set (overrides contextFilter.roles for fine grain)
  permissions: string[]                      # logical permission slugs validated against AuthzContext.allowedTools
```

### 1.2 Body (free-form Markdown)

The body is appended verbatim to the LLM system context when the skill is loaded (per §14 of `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`, "skill overlay onto agent template"). Recommended sections: `# <skill>`, `## When to use`, `## Inputs`, `## Examples`, `## Failure modes`.

### 1.3 Example — `documents` skill (existing `docx-freeform` migrated)

```markdown
---
name: documents
description: Generate DOCX / PPTX documents from sandbox-executed code; render structured outputs into downloadable artefacts.
version: 1.0.0
category: document
contextFilter:
  workspaceTypes: [ai-ideas, opportunity]
  roles: [editor, admin]
  requiresOnline: false
sandbox:
  surface: [files.create]
  timeoutMs: 30000
  memoryMb: 128
tools:
  - name: document_generate
    description: Render a DOCX from a TypeScript program executed in the sandbox. Returns a downloadable artefact.
    inputSchema:
      type: object
      required: [title, code]
      properties:
        title:    { type: string }
        code:     { type: string, description: "TypeScript body returning a docx Document object" }
        format:   { type: string, enum: [docx, pptx], default: docx }
    outputSchema:
      type: object
      properties:
        artefactId: { type: string }
        mimeType:   { type: string }
    outputRenderHint: download
    sideEffect: true
    requiresApproval: false
authzRequirements:
  permissions: [document.generate]
---

# documents

Sandbox-based DOCX/PPTX generator. Loads the canonical `docx-freeform-skill` reference (§4 of SPEC_VOL_AGENT_SANDBOX_SKILLS) into the sandbox runtime.

## When to use
Call `document_generate` when the user asks for an exportable DOCX or PPTX report from an initiative, executive summary, or matrix.

## Inputs
- `title`: file name (without extension).
- `code`: TypeScript body. Must `return doc([...])` using the helper API (`h`, `p`, `table`, `list`, …). No `require`, no `import`, no `fs`, no `fetch`.
- `format`: `docx` (default) or `pptx`.

## Examples
See `packages/skills/skills/documents/README.md`.

## Failure modes
- Sandbox timeout (> 30s) → `tool-result.isError = true`, `code: SANDBOX_TIMEOUT`.
- Disallowed API call (`fetch`, `require`) → `code: SANDBOX_DENIED`.
```

## 2. Sandbox runtime decision

Comparison (security / perf / FFI cost / maintenance):

| Runtime          | Isolation                         | FFI cost (JS ↔ host) | Perf       | Status / risk                                        |
|------------------|-----------------------------------|----------------------|------------|------------------------------------------------------|
| `isolated-vm`    | Strong (separate V8 isolate)      | Medium (copy at boundary) | Good (V8 JIT) | Active maintenance, native addon (build chain cost) |
| `vm2`            | Weak (multiple breakouts CVE'd)   | Low                  | Good       | **Deprecated** since 2024; security model broken     |
| `quickjs` (wasm) | Strong (wasm sandbox)             | Low (no native deps) | Lower (interpreter) | Active; portable; pkg `@jitl/quickjs-wasmfile-release-sync` |
| Deno worker      | Strong (perm model)               | High (subprocess)    | Good (V8)  | Requires Deno runtime in container; out of npm tree  |
| Wasmtime/WASI    | Strong                            | High                 | Good       | Needs compiling skill code to wasm; mismatch with JS skill format |

**Decision (frozen)**: `isolated-vm` as primary runtime.

Rationale:
- The existing `docx-freeform-skill` already runs DOCX generation in a `vm.createContext` sandbox; `isolated-vm` is the strict successor of that pattern and supports the same execution shape (`return Document`) with hard isolation.
- Strong V8-isolate boundary covers the threat model (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §3): no shared heap, hard memory cap, hard CPU timeout, deterministic teardown.
- `vm2` is excluded — deprecated, exploitable.
- `quickjs` is the documented **fallback** for environments where native add-ons cannot be built (e.g., serverless cold-start, Bun runtime); shipped as an optional adapter (`SandboxRuntime` is an interface, not a concrete class).
- Performance: docx generation is bound by docx.js, not JS execution; isolate startup (~30ms) is acceptable per call.

API surface inside the sandbox is restricted to the allowlist declared in `SKILL.md` `sandbox.surface`. Default allowlist (no entries) = pure compute only.

## 3. `SkillRegistry` interface (frozen)

Defined in `packages/skills/src/catalog/registry.ts`. Implements no `chat-core` types directly; instead, a thin `SkillsToolRegistry` adapter exposes `ToolRegistry` from `@sentropic/contracts` (§5 of `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`).

```ts
import type {
  TenantContext,
  AuthzContext,
  ToolRegistry,
  ResolvedTool,
} from '@sentropic/contracts';

interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly category: string;
  readonly contextFilter?: ContextFilter;
  readonly sandbox?: SandboxPolicy;
  readonly toolNames: ReadonlyArray<string>;
}

interface SkillSearchHit {
  readonly metadata: SkillMetadata;
  readonly score: number;
  readonly matchedFields: ReadonlyArray<'name' | 'description' | 'category'>;
}

interface SkillRegistry {
  register(skill: Skill): void;
  unregister(name: string): void;
  list(filter?: {
    category?: string;
    workspaceType?: string;
    role?: string;
  }): ReadonlyArray<SkillMetadata>;
  get(name: string): Skill | null;
  search(
    query: string,
    context: TenantContext,
    options?: { topK?: number },
  ): ReadonlyArray<SkillSearchHit>;
}

interface SkillsToolRegistry extends ToolRegistry {
  // Bridges SkillRegistry → ToolRegistry for chat-core.
  // resolveTools(authz) returns the union of tools exposed by skills
  // whose contextFilter.{workspaceTypes, roles} match authz.caller and
  // whose tool names are in authz.allowedTools (unless the skill declares
  // a meta-tool such as search_skills, which is always exposed).
  resolveTools(
    authz: AuthzContext,
    options?: { skillName?: string },
  ): ReadonlyArray<ResolvedTool>;
}
```

In-memory reference adapter ships with the package; per the `Ports & adapters` rule, this is mandatory so a downstream consumer can build with zero Postgres dependency.

## 4. Migration plan: `tools.ts` → skill bundles

The 30 entries in `api/src/services/tools.ts` group into **10 skill bundles**. Each bundle owns its `SKILL.md`, instructions, tools, and (where applicable) sandbox policy. Migration order is Wave A → D (see `BRANCH.md` Lot 5), ordered by blast radius (read-only first, sandbox last).

| # | Bundle              | Wave | Existing tools absorbed (line refs in `tools.ts`)                                                               | Sandbox? | Notes |
|---|---------------------|------|-----------------------------------------------------------------------------------------------------------------|----------|-------|
| 1 | `web`               | A    | `web_search` (26), `web_extract` (44)                                                                           | no       | Requires `requiresOnline: true`. Uses Tavily; credential carried via `AuthzContext`. |
| 2 | `workspace`         | A    | `workspace_list` (804), `initiative_search` (816)                                                               | no       | Pure read across tenant workspace; small surface. |
| 3 | `organizations`     | B    | `organizations_list` (126), `organization_get` (151), `organization_update` (172), `batch_create_organizations` (925) | no  | Wave B absorbs `_list`+`_get`+`_update`; `batch_create_organizations` deferred to Wave D (write fan-out, idempotency required). |
| 4 | `folders`           | B    | `folders_list` (233), `folder_get` (259), `folder_update` (280)                                                 | no       | |
| 5 | `initiatives`       | B    | `initiatives_list` (311), `read_initiative` (69), `update_initiative` (95)                                      | no       | Existing `read_initiative` becomes `initiatives.read`; same for `update`. |
| 6 | `solutions`         | B    | `solutions_list` (689), `solution_get` (702)                                                                    | no       | |
| 7 | `proposals`         | B    | `proposals_list` (721), `proposal_get` (737), `bidsListTool`/`bidGetTool` aliases (751-753)                     | no       | Aliases collapsed to one tool with `kind: 'proposal' \| 'bid'` parameter. |
| 8 | `products`          | B    | `products_list` (758), `product_get` (773)                                                                      | no       | |
| 9 | `analysis`          | C    | `executive_summary_get` (340), `executive_summary_update` (362), `matrix_get` (393), `matrix_update` (408), `documents` (432), `history_analyze` (484), `comment_assistant` (544), `plan` (609), `gate_review` (789) | no | Compound business-analysis bundle. Each tool keeps its current handler in `tool-service.ts` ported to the skill's `handlers/` folder. |
| 10 | `documents`        | D    | `document_generate` (859) + ports `docx-freeform-skill.ts` content                                              | **yes**  | Reference sandbox-backed skill. Owns DOCX/PPTX generators. |
| 11 | `orchestration`    | D    | `task_dispatch` (832), `batch_create_organizations` (925)                                                       | yes (optional) | Side-effecting bundle; both tools require `sideEffect: true` and server-derived idempotency keys. |

Per-bundle deliverable: `packages/skills/skills/<bundle>/SKILL.md` + `packages/skills/skills/<bundle>/handlers.ts` (or `sandbox-entry.ts` for Wave D) + `packages/skills/skills/<bundle>/index.ts` exporting the `Skill` instance.

Cleanup: after Wave D lands, `api/src/services/tools.ts` is deleted in one final commit; `chat-service.ts` calls only `SkillsToolRegistry.resolveTools(authz)`. Per `rules/MASTER.md` "No legacy fallback — delete old code when replacing with new system. Zero dual paths."

## 5. Discovery: `search_skills` meta-tool

Once the catalog exceeds ~10 skills, the system prompt cannot list every tool description (token budget + LLM attention dilution). Inspired by Claude Code's description-match auto-discovery, the runtime exposes a single meta-tool to the LLM:

```ts
{
  name: 'search_skills',
  description:
    'Search the skill catalog by natural-language query. Returns up to topK skill descriptions that the agent can then invoke through their declared tools.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language description of what the agent wants to accomplish.' },
      topK:  { type: 'number', default: 5, maximum: 10 },
      categoryHint: { type: 'string', description: 'Optional category filter.' },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name:        { type: 'string' },
        description: { type: 'string' },
        category:    { type: 'string' },
        toolNames:   { type: 'array', items: { type: 'string' } },
        score:       { type: 'number' },
      },
    },
  },
}
```

Behaviour:
1. The LLM sees the meta-tool plus a curated "starter set" (≤ 5 skills declared in the agent definition via `attachedSkills`, per §14 of `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`).
2. On invocation, `SkillsToolRegistry.search(query, tenant, { topK })` runs description-match ranking. v0.1 ranking is BM25 over `name + description + category`; vector embeddings deferred until corpus exceeds ~200 skills.
3. Results are filtered through `AuthzContext` BEFORE ranking — never expose a denied skill, even at score 0.
4. The LLM then issues a normal tool call to one of the surfaced skill tools; `chat-core` resolves it through `SkillsToolRegistry.resolveTools(authz, { skillName })`.

Token-budget enforcement: the starter set + `search_skills` description must stay under 1200 tokens for the system prompt; ranking responses must stay under 600 tokens per call (truncate `description` to 240 chars).

## 6. MCP server export (Lot 6)

Each skill compiles to one MCP server bundle (Anthropic's `Model Context Protocol`), exposing its tools, optional resources, and optional prompt templates. Mapping:

- Skill `tools[]` → MCP `tools/list`. Each MCP tool inherits `name`, `description`, `inputSchema` from the SKILL.md frontmatter.
- Skill body (Markdown) → MCP `prompts/list` with one prompt named `<skill>.instructions` returning the rendered body.
- `outputRenderHint` is dropped at the MCP boundary (renderer registry is a Sentropic UI concern, not an MCP feature). Consumers using the skill via MCP must fall back to text rendering.
- Sandbox-backed skills compile only when the consumer environment can provide an equivalent runtime; otherwise the export emits a warning and skips the tool.

Transports: stdio (default for CLI consumers like Claude Code / Codex / Gemini) + HTTP/SSE (default for server-to-server consumers). Granularity decision: **1 skill = 1 MCP server**, for granular permissions on the consumer side and clean uninstall semantics.

Publishing pipeline: out of scope for Lot 6 — Lot 6 ships only the compiler. Publish workflow to `mcp.so` is documented as a manual `npm run mcp:publish` step for v0.1; automation deferred.

## 7. Distribution strategy

Primary (v0.1):
- **npm**: each skill = its own package `@sentropic-skills/<name>` (per-skill semver). Aggregate `@sentropic/skills` re-exports built-ins and ships registry + sandbox.
- **GitHub releases**: source bundles + changelog per skill.

Secondary (Lot 6):
- **MCP servers** published to `mcp.so` for Claude Code / Codex / Gemini CLI cross-CLI interop. Source of truth remains the `SKILL.md` in our repository.

Tertiary (deferred, no business case yet):
- Proprietary Sentropic registry (curated, paid, signed). Deferred per `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md` §7.

## 8. Boundary with `@sentropic/marketplace` (BR-27)

Per `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §15:

- `@sentropic/skills` = **the catalog** (the *things*). Owns registry, sandbox, parser, discovery, MCP export.
- `@sentropic/marketplace` = **the governance overlay** (the *organizational rules on the things*). Owns `MarketplacePolicy`, `MarketplaceEngine.evaluate()`, audit log, approval queue.

BR-19 ships skills only; marketplace integration is wired by BR-27 through a single hook inside `SkillsToolRegistry.resolveTools()`:

```ts
// Pseudocode in resolveTools()
const candidates = filterByContext(authz);
if (marketplaceEngine) {
  const decisions = await Promise.all(
    candidates.map(s => marketplaceEngine.evaluate(authz.caller, 'invoke', s.ref))
  );
  return candidates.filter((_, i) => decisions[i].allowed);
}
return candidates;
```

If `marketplaceEngine` is undefined (Sentropic v0.1 default), the registry behaves as an open catalog gated only by `AuthzContext`. Marketplace deployment is opt-in.

## 9. Boundary with `@sentropic/chat-core` (BR-14b) and `@sentropic/flow` (BR-26)

- `@sentropic/chat-core` consumes the `ToolRegistry` interface (`@sentropic/contracts`). It does not import `@sentropic/skills` directly; instead, application code composes a `ChatToolRegistry` that delegates to a `SkillsToolRegistry` (federated per `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §8 Q3).
- `@sentropic/flow` (future) follows the same pattern: a `FlowToolRegistry` composes the same `SkillsToolRegistry` instance per run.
- This federation is what guarantees the skill catalog is the *single source of truth* across runtimes without coupling `chat-core` to skill internals.
- `chat-core` reasoning loop is unchanged: the skill abstraction is transparent at the `ToolRegistry` boundary.

## 10. Open questions (BR19-Qn)

1. **BR19-Q1 — Sandbox runtime fallback choice**: ship `quickjs` as a built-in fallback (extra ~2 MB to the package) or as a peer optional dep? Lean **peer optional**, install only if app declares `SANDBOX_BACKEND=quickjs`.
2. **BR19-Q2 — Per-skill npm vs aggregate-only**: publish one `@sentropic-skills/<name>` per skill or single `@sentropic/skills` with built-ins re-exported? Lean **both**: aggregate ships built-ins; per-skill packages are the canonical distribution for third-party authors.
3. **BR19-Q3 — MCP granularity**: 1 skill = 1 MCP server (per §6 above) vs 1 bundle = 1 server? Lean **1-per-skill** for granular permission and uninstall — needs user validation.
4. **BR19-Q4 — `AuthzContext` declaration in SKILL.md**: rely on `contextFilter.roles` only, or add the more expressive `authzRequirements.permissions[]`? Lean **both**, with `permissions` taking precedence when present.
5. **BR19-Q5 — Cross-skill composition**: can one skill invoke another skill's tool? Lean **no** for v0.1 (keep skills atomic; composition is the agent's job per `SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md` §9.7). Re-evaluate after Wave D.
6. **BR19-Q6 — Optional `skill_metadata` Postgres table**: needed for marketplace audit + admin UI listing. Defer to Lot 3 — if needed, declare `BR19-EX1` and ship one migration in `api/drizzle/*.sql`.
7. **BR19-Q7 — Versioning compatibility**: how does a chat session declare "skills compatible with semver range"? Lean **`skillRequirements: Record<string, string>` field on session metadata** (semver range per skill name). Defer enforcement to BR-19c.
8. **BR19-Q8 — Description-match ranking algorithm**: BM25 (no external dep) vs minilm-based embeddings (extra dep)? Lean **BM25 for v0.1**, swap to embeddings only when corpus > 200 skills.
