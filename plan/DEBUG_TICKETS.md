# DEBUG_TICKETS

Purpose:
- Lightweight shared register for UI/UX debug tickets during branch execution.
- Mandatory reference for the debug loop defined in `.cursor/rules/workflow.mdc`.

Status values:
- `open`, `in_progress`, `blocked`, `fixed`, `closed`

Severity values:
- `critical`, `high`, `medium`, `low`

## Tickets

| ID | Branch | Owner | Severity | Status | Repro Steps | Expected | Actual | Evidence | Decision Needed | Updated At (UTC) |
|---|---|---|---|---|---|---|---|---|---|---|
| DBG-001 | `feat/<slug>` | `<name>` | `high` | `open` | `1. ...` | `...` | `...` | `log://... screenshot://...` | `none` | `YYYY-MM-DDTHH:MM:SSZ` |

## Usage notes
- Create a new `DBG-###` for each distinct issue.
- Update `Status` and `Updated At (UTC)` after each meaningful step.
- Link ticket IDs in `BRANCH.md` lot notes and `plan/CONDUCTOR_QUESTIONS.md` when escalation is needed.
