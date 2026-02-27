# UAT Feedback Trace - BR03 TODO Runtime / Steering UX

Date: 2026-02-27
Branch: `uat/br03-local` (BR03)
Status: raw UAT feedback captured for immediate triage and integration into evolution specs.

## Raw feedback (captured)

### Immediate UI wording and layout fixes
- Rename panel title from "TODO runtime de session" to simply "TODO".
- Hide low-value technical metadata in default view:
  - `Statut: todo`
  - `Plan: <id>`
  - `TODO: <id>`
- Replace visible metadata block with an info menu (icon `i`) in expanded state only.
- Reduce task line font size to match the TODO subtitle size.
- Reduce expanded panel max height by about 30%.

### Steering UX and semantics
- Current wording "Steer du run actif" is unclear and should be removed or justified.
- Steering intent is in-flight user guidance during AI execution, not a separate thread UX.
- Requested interaction model:
  - when AI is active, message action visually switches to steering mode (floating steer button instead of regular send semantics);
  - steering message appears as an additional user bubble under the original user prompt context;
  - reasoning/tool strip immediately reflects acknowledgment (e.g. "New user message taken into account");
  - if final answer is already being generated, AI should append an additional response bubble (without interrupting tools already running).

### Major product gap reported
- TODO is expected to be an executable AI plan, but progress update is not operational.
- UAT evidence reports that after TODO creation the assistant says it cannot mark tasks as done.
- Current behavior blocks UAT criterion: "Ask AI to mark one task as done".
- Requested direction:
  - once TODO plan is presented, AI should request explicit "go" before execution;
  - runtime/workflow should support progressive completion state updates while concrete actions run;
  - if workflow engine is already available, align tool/runtime integration to use it directly.

## Requested execution sequence (from UAT)
1. Commit `BRANCH.md` + this feedback trace immediately.
2. Analyze and update appropriate `spec/SPEC_EVOL*` documents.
3. Add complementary Lot 4 DEV items in `BRANCH.md`.
4. Implement fixes and behavior updates.
5. Re-run UAT on generation after this fix set.

## Notes
- This file is a trace artifact to preserve exact user UAT intent before specification consolidation.
- Follow-up spec updates should reference this trace and then keep canonical requirements in the relevant `SPEC_EVOL` files.
