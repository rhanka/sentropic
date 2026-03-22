# SPEC_VOL — Agent Sandbox & Skill Catalog

Status: Raw product intent (2026-03-21). Needs spec phase before implementation.

## Vision

Replace the current hardcoded tool dispatch layer with a **skill catalog** backed by an **isolated V8 sandbox** for code execution. The agentic layer discovers capabilities through skill search, filtered by context (workspace type, user role, available data). The sandbox can produce files that the UI presents to the user.

## A. V8 Sandbox for tool execution

- Isolate tool execution in a V8 sandbox (e.g. `isolated-vm` or `vm2` successor) to run untrusted or generated JavaScript safely.
- Each skill execution gets a fresh sandbox context with controlled globals (no filesystem, no network except whitelisted).
- Sandbox has access to a controlled API surface:
  - `context` — current initiative/folder/organization data
  - `db.query(...)` — read-only scoped queries (workspace-filtered)
  - `db.mutate(...)` — write operations with audit trail
  - `files.create(name, content, mimeType)` — produce output files
  - `fetch(url)` — whitelisted external HTTP calls
- Execution timeout enforced (default 30s, configurable per skill).
- Memory limit per sandbox (default 128MB).

## B. Skill catalog

- A **skill** is a named capability with:
  - `id`, `name`, `description` — for search/discovery
  - `contextFilter` — workspace types, object types, roles where the skill applies
  - `inputSchema` — JSON schema of expected parameters
  - `outputSchema` — JSON schema of produced result
  - `implementation` — JavaScript code executed in sandbox OR reference to a built-in handler
  - `tags` — for categorization and search
- Skills replace current hardcoded tool definitions in `tools.ts`.
- Skills can be:
  - **Built-in** — shipped with the platform (read_initiative, update_initiative, web_search, etc.)
  - **Workspace-scoped** — created by admins for a workspace type
  - **Generated** — produced by the LLM agent itself (stored, versioned, reusable)

## C. Skill-based tool dispatch

- The agentic layer (chat-service, queue-manager) no longer dispatches tools by hardcoded name.
- Instead: agent prompt includes available skills discovered by searching the catalog filtered by current context.
- The LLM calls `execute_skill(skillId, params)` — a single meta-tool.
- The runtime resolves the skill, validates input against schema, executes in sandbox, validates output.
- Current tools (`read_initiative`, `update_initiative`, `web_search`, `comment_assistant`, `plan`, etc.) are migrated to built-in skills.

## D. File output & UI presentation

- Sandbox skills can produce files via `files.create(name, content, mimeType)`.
- Files are stored as chat attachments or initiative documents (depending on context).
- Supported types: JSON, CSV, XLSX, HTML, SVG, PNG, PDF, Markdown.
- The UI presents produced files inline in the chat (preview for images/HTML/SVG, download for others).
- Files can be attached to an initiative or folder as generated documents.

## E. Skill discovery by LLM

- Replace the static tool list in the system prompt with a dynamic skill search.
- The LLM can call `search_skills(query, context)` to discover available skills.
- The system prompt includes a curated "starter set" of skills for the current context.
- Additional skills can be discovered on demand.
- This enables open-ended extensibility without modifying the system prompt or code.

## F. Impact on existing tools

- All current tools in `api/src/services/tools.ts` become skills in the catalog.
- `chat-service.ts` tool dispatch (`if toolCall.name === 'read_initiative'`) is replaced by generic `execute_skill`.
- `queue-manager.ts` agent execution uses skill catalog for workflow task tools.
- Tool toggles in ChatPanel remain — they filter which skills are available in the UI.
- The TOOL_TOGGLES in ChatPanel map to skill categories/tags instead of hardcoded tool IDs.

## G. Security considerations

- Sandbox isolation must prevent:
  - Filesystem access outside sandbox
  - Network access outside whitelist
  - Memory/CPU exhaustion (limits enforced)
  - Cross-workspace data access (scoped DB queries)
- Generated skills (by LLM) require admin approval before becoming reusable.
- Built-in skills are trusted and can bypass some sandbox restrictions (e.g. direct DB access).

## Dependencies

- **BR-04** (workspace type system) — skill context filter uses workspace types
- **BR-04B** (view templates) — file output presentation may use view template widgets
- **BR-10** (vscode v2 multi-agent) — VSCode agents use skill catalog for tool discovery

## Downstream

- **BR-15** (spectral site tools) — depends on BR-19. Spectral-generated tools are registered as skills in the catalog. BR-15 must come AFTER BR-19.
