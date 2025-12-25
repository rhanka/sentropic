# Feature: Chat Tools — Folders / Use Cases / Executive Summary / Companies (CRUD + Batch + AI)

## Objective
Add chat tool-calls so the assistant can operate from key UI views with **read + update** tools (mandatory), plus selected **batch** and **destructive** actions (delete) and **AI-assisted creation/population** where relevant:
- Folders view: list/read, batch actions, delete, add one or many folders, optionally populate with AI.
- Folder context: list/read/update use cases, batch update (e.g., translate all use cases to English), add/delete use cases.
- Executive summary: read/update, optionally grounded on the current folder’s use cases.
- Companies: list/read/update, batch update, batch add (AI-assisted), batch delete, plus company detail read/update.

**Important**: this feature expands beyond “read-only”. Any destructive or high-impact action must follow project guardrails (⚠ human approval on dangerous actions).

## Scope
- API-only unless UI changes are strictly required to display tool calls (prefer none).
- Minimal changes: tool registry + tool handlers + authorization + tests.
- No broad refactors, no unrelated schema changes.

## Views → Tools availability (contract)
- **Folders list view**:
  - Folder tools: read/list, create (single/multi), update (batch allowed), delete (batch allowed).
  - Can access use case tools (list/detail) for any folder selected in context.
- **Use case list view (within a folder)**:
  - Use case tools: read/list, update (batch allowed), create, delete (batch allowed).
  - Executive summary tools are allowed.
  - Constraint: only the **current folder** is in scope for list/batch operations.
- **Use case detail view**:
  - Use case tools: read + update only (no change vs current behavior).
- **Companies list view**:
  - Companies (batch) tools: list/read, create (batch + AI-assisted), update (batch allowed), delete (batch allowed).
- **Company detail view**:
  - Company (detail) tools: read + update for the **current company**.
  - Read-only access to that company’s folders and use cases.
- **Executive summary view**:
  - Executive summary tools: read + update.
  - Can access “use case list” tools for the current folder.

## Tool design principles (based on your additions)
- **Read + update tools exist for each entity**, consistent with the existing use case tools.
- **Field selection**: tools should support either:
  - returning only `ids` (then follow-up with detail tool), or
  - returning selected fields / all fields (same pattern across entities).
- **Workspace-scoped authorization**: tools enforce session + workspace scope. (No extra object-level rules unless already enforced elsewhere.)

## Proposed Tool IDs (explicit detail vs batch)
Tool IDs should be **English-only** and stable. UI text remains FR via i18n.

### Companies (batch / list scope) — `companies_*`
- `companies_list`: list companies (supports `ids_only` or `fields` selection).
- `companies_update_batch`: batch update companies (⚠ high-impact).
- `companies_create_batch`: create one or many companies; optionally AI-assisted (⚠ high-impact).
- `companies_delete_batch`: delete one or many companies (⚠ high-impact).

### Company (detail scope) — `company_*`
- `company_get`: read one company by id (supports `fields` selection).
- `company_update`: update one company by id (⚠ can be high-impact depending on fields).

Note: the same naming split applies to folders/use cases where we have both “single-entity” and “batch/list” operations.

## Guardrails (MANDATORY)
- Any tool that can **delete**, **batch update**, or **create many objects**, or **trigger AI population** must be treated as **⚠ high-impact**:
  - require explicit user intent confirmation in the chat UX,
  - be logged with full parameters and result counts,
  - implement safe defaults (`dry_run=true` by default where possible),
  - and follow the project rule: never perform destructive actions without human approval.

## Open Questions (still need confirmation)
- What are the **exact tool IDs** you want? (English-only IDs recommended; UI labels remain FR via i18n.)
- For batch operations: do you want a universal `dry_run` + `confirm` pattern, or reuse an existing approval mechanism already in the codebase?
- For “populate with AI”: what is the minimum acceptable contract (inputs, expected outputs, limits, and cost safeguards)?

## Plan / Todo
- [ ] Inventory existing services/endpoints/queries for folders/use cases/executive summaries/companies (reuse first).
- [ ] Align tool contracts with existing “use case” tool patterns (field selection + ids-only mode).
- [ ] Implement tools per view contract (read/update first, then batch/delete/AI with guardrails).
- [ ] Ensure authorization is consistent (session + workspace scope) and test it.
- [ ] Add API tests for each new tool (happy path, not-found, access-control, batch safety).
- [ ] Run required test suite via Make: `make test-api [SCOPE=...]`.
- [ ] Push branch and verify GitHub Actions status for this branch.

## Commits & Progress
- [ ] **Commit 1**: docs: BRANCH.md (scope + plan + guardrails)

## Status
- **Progress**: 0/7 tasks completed
- **Current**: Lock tool contracts and guardrails
- **Next**: Commit BRANCH.md, then inventory existing API services to reuse
