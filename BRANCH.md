# Fix: document summary fails — docx "Échec" (BUG-3) + pdf job=null (BUG-4)

## Objective
Fix two owner-confirmed document-summary regressions: docx uploads fail with OfficeParser "supports docx... add support for zip files" (BUG-3), and a pdf can end up status=failed with job_id=NULL (BUG-4).

## Scope / Guardrails
- Make-only, Docker-only, isolated worktree ENV=e2e-docfix ports 9485/5585/1485.
- Tests on ENV=e2e-docfix only, never dev.
- English everywhere.

## Branch Scope Boundaries (MANDATORY)
- Allowed Paths:
  - api/src/services/document-text.ts
  - api/src/services/queue-manager.ts
  - api/src/routes/api/documents.ts
  - api/tests/**
  - e2e/tests/08-document-summary-formats.spec.ts
  - e2e/tests/fixtures/**
  - BRANCH.md
- Forbidden Paths: Makefile, docker-compose*.yml, .cursor/rules/**
- Conditional Paths: api/** (see exception)
- Exception BR-EX1: api/** touched to fix the document extraction + enqueue robustness. Rationale: server-side bug fix (officeparser extension routing + fail-loud enqueue). Impact: more documents summarize successfully; failed enqueue surfaces a real error instead of a silent orphan. Rollback: revert this branch.

## Feedback Loop
- none

## Plan / Todo
- [x] BUG-3 root cause: officeparser given a Buffer delegates type detection to file-type@22, which fails to classify OOXML zip containers within its scan budget -> "supports docx... add support for zip files". Fix: route through a temp file carrying the correct extension (resolved from mime/filename) so officeparser uses reliable extension dispatch; fallback to raw Buffer when extension unknown.
- [x] BUG-4 root cause: if queueManager.addJob throws, the row was left status=uploaded + job_id=NULL (silent orphan). Fix: try/catch the enqueue, mark status=failed + error on failure.
- [x] queue-manager.ts: corrected the misleading "Unsupported mime type for summarization" message to "Failed to extract text from document".
- [x] Tests: api unit document-text-office-extension.test.ts; api/tests/api/documents.test.ts (enqueue-failure path); e2e 08-document-summary-formats.spec.ts (real docx + real pdf -> status ready, non-empty summary).
- [x] E2E proof: 1 passed (49.3s) — docx+pdf reach status=ready (not "Échec"). Trace in .tmp/uat-analysis/proof-artifacts/.
