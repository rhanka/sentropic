---
name: trace-impact
description: Trace impact of a schema or service change across the codebase before modifying
paths: "api/src/db/schema.ts,api/src/services/**"
allowed-tools: Read Bash Grep Glob
---

## Impact Trace Workflow

1. Identify the table or service being modified
2. Trace service consumers:
   `grep -r "TABLE_OR_SERVICE" api/src/services/ --include="*.ts" -l`
3. Trace route usage:
   `grep -r "TABLE_OR_SERVICE" api/src/routes/ --include="*.ts" -l`
4. Trace test coverage:
   `grep -r "TABLE_OR_SERVICE" api/tests/ --include="*.ts" -l`
5. If modifying a JSONB data column → check TypeScript type definition + all `context-*` loaders
6. Verify `workspace_id` filtering in every query touching this table
7. List all impacted files before making changes
8. If schema.ts change → check `spec/DATA_MODEL.md` needs sync
