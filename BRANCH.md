# Feature: Refactor MDC directives (workflow + testing)

## Objective
Refactor `.cursor/rules/*.mdc` and core docs to align on the simplified workflow, add architecture design-pattern guidance in specs, and introduce a design system directive.

## Scope / Guardrails
- Scope limited to `.mdc` files, `README.md`, and relevant `spec/*.md` updates.
- No code, schema, or test changes expected.
- Keep all new text in English.
- Make-only workflow (no direct Docker commands).

## Questions / Notes
- Best-practice analysis completed; decisions on adoption still pending.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Re-read current `.cursor/rules/*.mdc`.
  - [x] Capture Makefile targets needed for debug and testing.
  - [x] Confirm branch scope (docs-only, no migrations).

- [x] **Lot 1 — Workflow directives**
  - [x] Update `workflow.mdc` to match the requested workflow (lots, UAT, tests-at-end, make-only).
  - [x] Update `MASTER.mdc` for make-only + debug commands.
  - [x] Update `testing.mdc` for lot gates, E2E build/clean rules, and UI TS-only testing.
  - [x] Update `data.mdc` to enforce single migration per branch.

- [x] **Lot 2 — README alignment**
  - [x] Update README dev workflow (make-only, no native dev).

- [x] **Lot 3 — Consistency pass**
  - [x] Scan for remaining `RELEASE.md` references and remove them.
  - [x] Ensure wording is consistent across `.mdc` and README.

- [x] **Lot 4 — Spec cleanup**
  - [x] Refactor `spec/COLLAB.md` to use functional requirements (no UAT/implementation framing).

- [x] **Lot 5 — Best-practice analysis (prerequisite)**
  - [x] Analyze conductor model + model testing (Bmad) and capture conclusions in directives.

- [ ] **Lot 6 — Architecture design patterns in specs**
  - [ ] Add architecture design-pattern directives to relevant specs (API/UI).
  - [ ] Document lifecycle guidance for key components (API/UI) and internal tech-debt/refactor planning.

- [ ] **Lot 7 — Design system directive**
  - [ ] Create a new `.mdc` file for the design system and document usage rules.

- [ ] **Lot N — Final validation**
  - [ ] Verify CI is checked at the end of the branch.
  - [ ] Final commit removes `BRANCH.md` and checks the TODO item.
