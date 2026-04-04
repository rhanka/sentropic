---
description: "Database schema changes — impact tracing, migration workflow, JSONB field evolution"
alwaysApply: false
paths: ["api/src/db/schema.ts", "api/drizzle/**"]
globs: ["api/src/db/schema.ts", "api/drizzle/**"]
tags: [database, schema, migrations]
---

# Schema and Migrations

## schema.ts Is the God File

- 50+ tables, 800+ lines.
- Every change impacts multiple services — trace consumers before editing.

## Before Modifying a Table

- Run `grep -r "tableName" api/src/services/ -l` to find all service files that reference the table.
- Check route handlers that depend on those services.
- Check context-* loaders if the table feeds LLM prompts.

## JSONB Columns

- `initiatives.data` — typed as `InitiativeData`.
- `organizations.data` — typed as `OrganizationData`.
- `context_documents.data` — typed as `ContextDocumentData`.
- Adding a JSONB field requires:
  - Update the TypeScript interface.
  - Update all context-* loaders that hydrate the data.
  - Handle rows where the new field is `undefined` (backward compat).

## Migration Workflow

1. Edit `api/src/db/schema.ts`.
2. Run `make db-generate` to produce the SQL migration file.
3. Review the generated SQL in `api/drizzle/`.
4. Run `make db-migrate` to apply.

## Branch Rules

- 1 migration maximum per branch.
- If you need multiple schema changes, combine them into a single migration.

## Safe Changes

- Adding nullable columns.
- Creating new tables.
- Adding new indexes.
- These do not require a backward compatibility plan.

## Breaking Changes

- Renaming columns, dropping columns, changing column types.
- Require a migration + explicit backward compatibility plan.
- Coordinate with API service changes in the same branch.

## Documentation

- Keep `spec/DATA_MODEL.md` in sync with any schema change.
- Document new tables, new columns, and changed relationships.

## Foreign Keys and Indexes

- Cascading deletes configured on workspace and session FKs.
- Self-FK: `initiatives.antecedent_id` references `initiatives.id`.
- Composite indexes on `(workspace_id, type)` for most tables.
- Add indexes for any new query pattern that filters or sorts on non-indexed columns.
