# @sentropic/skills

Skill catalog, SKILL.md parser, sandbox runtime, and description-based discovery for Sentropic agents.

This package is the BR-19 capability extraction. It ships:

- `SKILL.md` parser (YAML frontmatter + Markdown body) with strict Zod schema validation.
- `SkillRegistry` (in-memory reference adapter) for catalog management.
- `SandboxRuntime` port with an `isolated-vm` adapter for code execution skills.
- `search_skills` meta-tool for description-based discovery.
- `SkillsToolRegistry` adapter bridging the catalog to the `ToolRegistry` interface consumed by `@sentropic/chat-core`.
- MCP server compilation for cross-CLI interop (`1 skill = 1 MCP server`).

## Public Scope

- Skill format: `SKILL.md` (frontmatter `name`, `description`, `version`, `category`, `contextFilter`, `sandbox`, `tools[]`, `authzRequirements`).
- Sandbox policy enforcement: timeout, memory cap, API-surface allowlist.
- Description-match discovery: BM25 ranking over `name + description + category`.
- Federation with `@sentropic/chat-core` (`BR-14b`) and `@sentropic/flow` (`BR-26`) through the `ToolRegistry` interface.
- Marketplace boundary (`@sentropic/marketplace`, `BR-27`): consumed via a single optional hook inside `SkillsToolRegistry.resolveTools()`.

Application wiring, persistent skill metadata storage, marketplace policy evaluation, UI rendering, and live skill publishing pipelines remain outside this package contract.
