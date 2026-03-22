# Branch Plan: BR-19 — Agent Sandbox & Skill Catalog

## Status: to frame

## Objective

Replace hardcoded tool dispatch with a skill catalog backed by V8 sandbox execution. Enable dynamic skill discovery by LLM agents, file output from sandbox, and open-ended extensibility.

## Spec

`spec/SPEC_VOL_AGENT_SANDBOX_SKILLS.md`

## Dependencies

| Dependency | Type | Impact |
|---|---|---|
| BR-04 (workspace types) | required | Skill context filter uses workspace types, tool dispatch refactoring builds on BR-04 generic workflow engine |
| BR-04B (view templates) | optional | File output presentation may use view template widgets |
| BR-15 (spectral site tools) | **downstream** | BR-15 comes AFTER BR-19 — spectral-generated tools register as skills in the catalog |
| BR-10 (vscode v2 multi-agent) | downstream | VSCode agents will use skill catalog for tool discovery |

## Impact analysis

### High impact areas
- `api/src/services/chat-service.ts` — tool dispatch section (~200 lines of `if toolCall.name === '...'`) replaced by `execute_skill(skillId, params)`
- `api/src/services/queue-manager.ts` — agent task execution uses skill catalog
- `api/src/services/tools.ts` — entire file becomes skill seed data
- `api/src/services/tool-service.ts` — methods become skill implementations
- `ui/src/lib/components/ChatPanel.svelte` — TOOL_TOGGLES mapped to skill categories
- `ui/src/lib/utils/chat-tool-scope.ts` — workspace-type tool filtering via skill context filter

### New components
- `api/src/services/sandbox-service.ts` — V8 sandbox runtime (isolated-vm)
- `api/src/services/skill-catalog.ts` — skill CRUD, search, context filtering
- `api/src/routes/api/skills.ts` — skill catalog API
- `api/src/config/default-skills.ts` — built-in skill definitions (migrated from tools.ts)
- `api/src/db/schema.ts` — `skills` table
- `ui/src/lib/components/SkillOutputViewer.svelte` — inline file preview in chat

### Low impact areas
- `api/src/config/default-agents-*.ts` — agent prompts reference skills instead of tools
- `api/src/config/default-chat-system.ts` — system prompt includes skill discovery instructions
- `e2e/tests/03-chat*.spec.ts` — tool name assertions become skill assertions

## Lots (to frame)

### Lot 0 — Spec phase
- [ ] Frame SPEC_VOL into full spec with data model, API contracts, sandbox security model
- [ ] Define skill schema (id, name, implementation, contextFilter, input/outputSchema)
- [ ] Define sandbox API surface (context, db, files, fetch)
- [ ] Define migration path from tools.ts → default-skills.ts
- [ ] Define UI for file output presentation
- [ ] Impact on BR-15 (spectral tools → auto-registered skills)

### Lot 1 — V8 sandbox runtime
- [ ] Implement sandbox-service.ts with isolated-vm
- [ ] Controlled API surface (context, db.query, files.create)
- [ ] Timeout + memory limits
- [ ] Tests: sandbox isolation, resource limits, API surface

### Lot 2 — Skill catalog API + seed
- [ ] Skills table + CRUD API
- [ ] Migrate all tools.ts definitions to built-in skills
- [ ] Context filtering (workspace type, object type, role)
- [ ] Search endpoint for LLM discovery
- [ ] Tests: CRUD, filtering, search

### Lot 3 — Tool dispatch migration
- [ ] Replace chat-service.ts tool dispatch with execute_skill
- [ ] Replace queue-manager agent execution with skill-based dispatch
- [ ] Update ChatPanel TOOL_TOGGLES to use skill categories
- [ ] Non-regression: all existing tool functionality works via skills
- [ ] Tests: full chat tool flow via skills

### Lot 4 — File output + UI
- [ ] files.create() in sandbox produces attachments
- [ ] Chat UI inline preview (images, HTML, SVG)
- [ ] Download for other types (CSV, XLSX, PDF)
- [ ] Attach produced files to initiative/folder
- [ ] Tests: file production, preview, attachment

### Lot 5 — Skill discovery by LLM
- [ ] search_skills meta-tool
- [ ] Dynamic system prompt with starter skill set
- [ ] On-demand skill discovery during conversation
- [ ] Tests: discovery flow, context-filtered results

### UAT
- [ ] Existing tools work as skills (non-regression)
- [ ] Sandbox produces file, visible in chat
- [ ] Skill discovery works in conversation
- [ ] Workspace-type filtering works
