# SPEC - BR25 Best-of-Breed Recommendation

## Status

This is the BR25 decision output document. It synthesizes the Lot 1-3 study (`SPEC_STUDY_BEST_OF_BREED_AGENT_METHODS.md`) and the Lot 4 enforcement candidates (`SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md`) into recommendations awaiting human approval. No implementation is performed in this branch.

## Recommendation summary

Adopt the Entropiq conductor model as the source of truth and selectively borrow from external references where they cover gaps. Publish reusable primitives as templates and skills before any CLI or npm packaging. Add mechanical enforcement only for objective failures with documented incident history.

## Method ranking by dimension

| Dimension | Keep from Entropiq | Borrow from external | Net recommendation |
| --- | --- | --- | --- |
| Intention capture | `spec_vol`/`spec_evol` split, branch-bound intent | Spec Kit task layering after `vol_validated`, Graphify evidence linking | Adopt review-state ladder: study → vol_draft → vol_validated → evol → decision_record |
| Loop control | Lot-based execution, conductor reports | Superpowers brainstorm/plan/TDD/verify rituals, GSD short loops | Codify capture/plan/act/observe/decide/verify/publish loop with explicit stop conditions |
| Branch discipline | Worktrees, allowed/forbidden paths, port slots, make-only | None (Entropiq leads) | Publish as portable template; this is the differentiator |
| Verification | Staged gates (typecheck/lint/build/unit/E2E/CI/UAT) | Verification-before-completion skill | Add risk-to-check mapping; require check category in handoff |
| Mechanical enforcement | Written rules, manual reviews | Superpowers hooks, Spec Kit CI checks | Adopt Layer A advisory hooks first (see Lot 4 candidates) |
| Memory and context | `BRANCH.md`, `PLAN.md`, specs, incident reports | Graphify clusters, Claude project memory | Layer memory: rules > branch > spec > skill > incident graph; agent-local is never source of truth |
| Publication | None today | Codex skills, Claude commands, Spec Kit templates, npm packaging | Ship templates first, then skills/commands, then optional CLI; never publish ports/secrets |
| Interoperability | Make-only as common interface | MCP servers, agent-neutral markdown | Keep portable markdown templates; expose CLI via make targets that any agent can invoke |

## What Entropiq does better

- Multi-agent branch isolation with explicit worktrees and per-branch ENV/port slots.
- Docker-first and make-only consistency between local and CI.
- Allowed/forbidden/conditional path governance with `BRxx-EXn` exception protocol.
- `spec_vol`/`spec_evol` separation that protects user intent from drift.
- Selective staging and small commit discipline tied to lot checkboxes.
- Conductor reporting and feedback loops bound to `BRANCH.md`.

## What external references do better

- Packaging operating methods as reusable skills/commands (Superpowers, Codex, Claude).
- Visual evidence and audit trails (Graphify).
- Spec-first templates with task decomposition (Spec Kit).
- Lightweight entry points for common loops (GSD, Superpowers).
- CLI/plugin surfaces that enforce instead of remind (Spec Kit, Codex hooks).

## Minimum durable method

The recommended minimum, applicable inside and outside Entropiq, is:

1. Capture intention with explicit review state.
2. Create a scoped branch plan with allowed/forbidden paths and lot-by-lot tasks.
3. Run short action loops with named stop conditions (wrong branch, dirty scope, missing exception, ambiguous intent, blocked test environment).
4. Record spec evolution under `spec_evol` without overwriting the validated intent.
5. Verify according to risk category; declare the category in the handoff report.
6. Publish decisions and reusable artifacts separately from private project state.
7. Add mechanical enforcement only for objective, repeated failures with documented rollback.

## Naming conventions to publish

- `SPEC_VOL_<TOPIC>.md`: validated user intent.
- `SPEC_EVOL_<TOPIC>.md`: controlled evolution after validation.
- `SPEC_STUDY_<TOPIC>.md`: research/watch artifact before validation.
- `BRANCH.md`: branch-local execution contract.
- `PLAN.md`: multi-branch conductor view.
- `DECISION_<TOPIC>.md`: high-cost decision with rationale and rollback.
- `REPORT_<TOPIC>.md`: audit or publication artifact.

## Decisions (pending human approval)

- D1: Adopt the review-state ladder above as the canonical lifecycle for specs and study artifacts.
- D2: Adopt the capture/plan/act/observe/decide/verify/publish loop as the named loop for `rules/workflow.md` and the conductor report.
- D3: Adopt the verification taxonomy (none/static/unit/integration/e2e/ci/uat) and require category declaration in handoff reports.
- D4: Adopt the merge-readiness UAT state requirement (`uat_passed`/`uat_waived`/`uat_not_applicable`) for any branch changing user-visible behavior.
- D5: Adopt the Lot 4 enforcement candidates as advisory (Layer A) for one release cycle before any blocking promotion.
- D6: Publish portable templates (BRANCH.md, SPEC_VOL/EVOL/STUDY skeletons, subagent launch packet, decision record, report) before any CLI/plugin packaging.
- D7: Defer public CLI/npm packaging until after Layer A hooks prove useful inside Entropiq.

## Boundaries

- BR25 does not redesign product runtime, sandbox dispatch, database schemas, API routes, or UI surfaces.
- BR25 does not own product skill catalog (BR19) implementation.
- BR25 does not own framework runtime selection (BR23).
- BR25 does not own CI/Action upgrades (BR24) or VSCode plugin v2 (BR10) implementation.

## Open questions for review

- Should the review-state ladder be enforced via a `make spec-state-check` target, or remain documentation-only?
- Should Graphify reports become the default incident-audit publication, or remain optional?
- Should the public CLI surface be Codex-skill-first, MCP-first, or a make-wrapped script?

## Cross-references

- `SPEC_STUDY_BEST_OF_BREED_AGENT_METHODS.md` (Lot 1-3 source).
- `SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md` (Lot 4 candidate list).
- `rules/MASTER.md`, `rules/workflow.md` (current written guidance).
- `plan/BRANCH_TEMPLATE.md` (template source for publishable artifacts).
