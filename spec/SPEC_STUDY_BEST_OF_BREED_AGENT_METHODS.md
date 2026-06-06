# SPEC_STUDY - Best-of-Breed Agent Methods, Skills, and Publication

## Intention

Turn the strongest parts of Entropiq conductor practice, Graphify, Superpowers, GSD-style execution discipline, GitHub Spec Kit, and current AI coding-agent ecosystems into a durable, shareable method for AI-assisted development.

## Product boundary

This branch is about developer-agent operating methods, rules, specs, skills, plugins, and publication strategy. It is not the product skill catalog branch. Product-facing skill catalog, sandbox execution, and app tool replacement belong to BR19.

## Benchmark families

- Graphify: knowledge graph extraction, community clustering, audit reports, visual publication, traceability from raw material to conclusions.
- Superpowers: brainstorming, writing plans, TDD, worktrees, verification, subagent-driven development, branch finishing.
- Entropiq conductor: `PLAN.md`, `BRANCH.md`, branch lanes, port isolation, make-only discipline, spec_vol/spec_evol, commit discipline, conductor reports.
- GSD-style execution: small loops, explicit next actions, low ceremony, progress visibility, interruption recovery, outcome bias.
- GitHub Spec Kit: spec-first planning, task decomposition, implementation tracking, repository-native collaboration.
- AI coding tools: Codex, Claude Code, Gemini CLI, Clawcode-like tools, MCP servers, plugins, skills, commands, hooks, and CI agents.

## Study status

This document is a study/watch artifact, not a validated `SPEC_VOL`. It records patterns worth adopting or rejecting before a human review decides what becomes repo policy, public tooling, or product roadmap.

No public network verification was performed in this pass. Claims below are based on project-observed behavior, locally available method descriptions, and broadly established patterns of the referenced ecosystems. Items that require live trend validation are marked as watch items rather than facts.

## Evaluation dimensions

- Intention capture: how clearly the method records what the user wants and why.
- Spec evolution: how scope changes are recorded without losing the original intent.
- Loop control: how planning, action, observation, correction, approval, and verification are governed.
- Mechanical enforcement: which rules can be checked by hooks, make targets, CI, or plugins.
- Branch discipline: worktree isolation, allowed paths, forbidden paths, commit size, merge readiness.
- Memory and context: what should persist across sessions and what should be regenerated.
- Publication: what can become reusable public infrastructure without leaking project-specific context.
- Interoperability: what can work across Codex, Claude, Gemini, GitHub, CLI, and Entropiq product surfaces.

## Boundary with BR19

BR25 studies developer-agent operating methods: how coding agents plan, branch, execute, verify, publish, remember context, and coordinate with humans. These methods live around the repository and developer workflow.

BR19 owns product skill catalog design: user-facing skills available inside Entropiq, sandboxed execution, tool replacement, runtime permissions, and product UX for skill discovery and invocation.

The two branches may share vocabulary, but they must not share implementation ownership during this phase:

- BR25 may recommend reusable skill packaging formats, command schemas, plugin metadata, documentation conventions, and mechanical checks for developer agents.
- BR25 may hand off product-relevant findings to BR19, especially around skill manifests, permission boundaries, and audit trails.
- BR25 must not redesign product runtime dispatch, sandbox execution, database schemas, API routes, UI surfaces, or BR19 catalog behavior.
- BR19 may later consume BR25 developer-agent methods as inspiration, but only through an explicit product spec and implementation branch.

## Benchmark matrix

| Method family | Best pattern | Weak point | Entropiq adoption target |
| --- | --- | --- | --- |
| Graphify | Evidence graph from raw inputs to clustered insights and an audit trail. | Can become a report generator without action discipline if not tied to decisions. | Use for benchmark publication, incident taxonomy, and rule-evolution traceability. |
| Superpowers | Explicit skills for brainstorming, planning, TDD, worktrees, verification, subagents, and finishing. | Skill invocation can become ritual if every task forces all skills. | Convert repeated Entropiq workflows into narrow skills with trigger rules and small outputs. |
| Entropiq conductor | Strong branch lanes, worktree isolation, port discipline, make-only execution, allowed/forbidden paths, and conductor reporting. | Too much policy is written prose rather than mechanically enforced. | Keep conductor as the repo-native control plane, then add targeted checks for repeated violations. |
| GSD-style execution | Short loops, visible next action, low ceremony, interruption recovery, and outcome bias. | Can under-document why decisions were made if optimized too hard for speed. | Use for session cadence: small deltas, explicit blockers, and fast handoff notes. |
| GitHub Spec Kit | Spec-first repository workflow with plans, tasks, implementation trace, and reviewable artifacts. | Generic templates do not encode Entropiq-specific branch isolation, make-only, or port rules. | Borrow task/spec layering and implementation trace; preserve Entropiq branch controls. |
| Codex ecosystem | Skills, plugins, connectors, MCP tools, local files, CLI/API hooks, and repo-aware execution. | Enforcement varies by host; skills can drift from repo rules. | Publish Entropiq methods as Codex skills/plugins plus make-backed checks. |
| Claude ecosystem | Slash commands, project memory, MCP servers, and concise agent rituals. | Commands often rely on convention rather than branch-aware enforcement. | Export compatible commands/templates for planning, review, and handoff. |
| Gemini ecosystem | CLI-oriented agent operation, broad context handling, and scriptable developer loops. | Distribution conventions are less uniform across teams. | Keep templates and hooks portable rather than Codex-only. |

## Dimension findings

### Intention capture

Best-of-breed behavior separates raw user intent from execution interpretation. The strongest pattern is a two-layer model:

- `SPEC_VOL`: reviewed user will, stable enough to implement.
- `SPEC_EVOL`: controlled evolution after implementation exposes new facts.

BR25 should preserve that split. The branch-specific `spec_vol` section in `BRANCH.md` can record proposed intention during study, but must not masquerade as a validated `SPEC_VOL`. For this branch, the correct output is a study recommendation and review packet, not a binding product spec.

Graphify improves intention capture by retaining traceability from source statements to derived concepts. Superpowers improves it by requiring brainstorming before creative implementation. GitHub Spec Kit improves it by keeping specs close to tasks. Entropiq improves it by binding intent to branch scope and forbidden paths.

Recommended durable primitive: every serious agent task should record `intent`, `non-goals`, `decision owner`, `review state`, and `evidence links`. The review state must distinguish draft, study, validated, superseded, and rejected.

### Spec evolution

Spec evolution works when the original intent is not overwritten. Entropiq's `spec_vol/spec_evol` split is stronger than generic plan/task systems because it protects user will from implementation drift.

Adopt the following evolution ladder:

- `study`: broad research and comparison; no product commitment.
- `vol_draft`: candidate user intent; not yet accepted.
- `vol_validated`: user-reviewed intention; implementation may begin.
- `evol`: discovered constraints, scope changes, and decisions after validation.
- `decision_record`: irreversible or high-cost choice with rationale and rollback path.

GitHub Spec Kit style tasks are useful once `vol_validated` exists. Before that, task lists should stay framed as research lots, not implementation backlog.

### Loop control

Best execution loops are explicit and short:

- Capture: restate intent and scope.
- Plan: select files, lots, checks, and stop conditions.
- Act: make one bounded change.
- Observe: inspect result or collect feedback.
- Decide: continue, stop, escalate, or defer.
- Verify: run only the appropriate gate at the right phase.
- Publish: commit/report with traceable scope.

Superpowers supplies the clearest named loops. GSD-style execution supplies the best cadence. Entropiq supplies stronger branch boundaries. The combined method should avoid both extremes: no unbounded improvisation, and no heavyweight process for trivial edits.

Loop control must include explicit stop conditions:

- Wrong branch or dirty unexpected scope.
- Forbidden path required without approved exception.
- Product behavior requested before `SPEC_VOL` validation.
- Test or network requirement blocked by environment.
- Ambiguous user intent that changes product semantics.

### Branch discipline

Entropiq's branch discipline is the strongest reference in this study. The durable method should keep:

- One worktree per branch in `tmp/<slug>`.
- Branch identity recorded in `BRANCH.md`.
- Allowed, conditional, and forbidden paths.
- Make-only command execution.
- `ENV=<env>` last in make commands.
- Port ownership and branch-specific port slots for running services.
- Selective staging and `make commit`.
- Small commits tied to branch checklist updates.

External methods rarely encode port isolation or Docker-first discipline. That is a differentiator worth publishing as a template for multi-agent repos.

### Verification

Verification should be staged, not reflexive. Entropiq's rule set already distinguishes typecheck, lint, build, unit, E2E, CI, UAT, logs, and cleanup. The missing best-of-breed layer is a verification contract that maps task risk to the minimum acceptable check.

Recommended categories:

- `none`: study-only documentation, when user explicitly forbids tests.
- `static`: formatting, typecheck, lint, schema checks.
- `unit`: scoped behavior with stable inputs.
- `integration`: service or database behavior.
- `e2e`: user journey or cross-surface behavior.
- `ci`: merge readiness.
- `uat`: human acceptance for UX/product semantics.

BR25 should later propose mechanical prompts/checks that prevent agents from claiming "done" without stating which category was used or why verification was intentionally skipped.

### Merge readiness and UAT gate

CI success is necessary but not sufficient for product branches. A branch that changes user-visible behavior, runtime defaults, package behavior, or operational publication must not be merged until one of these states is recorded in the branch report:

- `uat_passed`: user or delegated UAT validated the relevant surfaces on the exact commit under qualification.
- `uat_waived`: the user explicitly waived UAT and the branch records the reason and risk.
- `uat_not_applicable`: the branch is non-user-facing and records why UAT does not apply.

The conductor report should surface this state next to CI and dirty status. The final merge command should be treated as blocked when the UAT state is empty. This is a governance rule, not a flaky-test workaround: a green CI run cannot replace a missing human checkpoint when the branch changes runtime behavior or product semantics.

### Mechanical enforcement

Text rules fail when violations are easy to make under speed pressure. Candidate enforcement should target repeated, objective failures:

- Branch mismatch before write.
- Direct forbidden commands such as host `npm`, direct `docker`, `git commit`, broad `git add .`, or `git add -A`.
- Missing `ENV=<env>` or wrong placement in make commands.
- Writes outside `Allowed Paths`.
- `BRANCH.md` shape drift from template.
- Commit size above target.
- Missing branch checklist update in a commit that changes scoped files.
- Test command using `ENV=dev`.
- Forbidden path edits without `BRxx-EXn`.

Judgment-heavy decisions should remain written guidance:

- Whether a UX choice is acceptable.
- Whether a product spec is sufficiently validated.
- Whether a fallback is legitimate.
- Whether a public artifact leaks project context.

### Memory and context

Best-of-breed memory is layered:

- Repo rules: durable policy and safety constraints.
- Branch files: current execution context.
- Specs: validated intent and evolution.
- Skills/commands: reusable operating procedures.
- Incident reports: evidence for changing rules.
- Agent-local memory: personal/session preference, never source of truth.

Graphify-style graphs are useful for incident memory because they preserve relationships among failures, rules, commits, branches, and corrective actions. They should complement, not replace, `PLAN.md`, `BRANCH.md`, and specs.

### Publication strategy

Publish the method as layers, from most portable to most repo-specific:

- Public docs: a concise "AI branch discipline" guide with branch scope, worktrees, allowed paths, verification categories, and review states.
- Templates: `BRANCH.md`, `SPEC_VOL`, `SPEC_EVOL`, benchmark matrix, decision record, subagent launch packet, handoff report.
- Codex skills: branch bootstrap, study benchmark, conductor report, verification mapping, scope audit, finish branch.
- Claude commands: planning, scope audit, review handoff, verification summary.
- Gemini-compatible templates: CLI-neutral markdown prompts and checklist files.
- MCP/plugin utilities: optional readers/writers for branch status, scope checks, rule lookup, and report generation.
- Make/CLI hooks: mechanical enforcement for objective rules.
- npm package or standalone CLI: only after the hooks stabilize inside this repo.

Private-only material:

- Entropiq-specific ports, service names, secrets, deployment lanes, branch history, incident raw logs, and product roadmap details.
- Any BR19 product skill runtime details until separately approved.

Public-safe material:

- Generic branch discipline patterns.
- Spec review-state model.
- Allowed/forbidden path model.
- Verification taxonomy.
- Subagent launch packet template without project secrets.
- Incident-to-rule improvement workflow.

### Plugins, templates, CLI, and API hooks

Plugin and command ecosystems should be treated as distribution surfaces, not as the source of truth. The source of truth remains repo files and make targets.

Recommended packaging model:

- `templates/`: portable markdown artifacts and checklists.
- `skills/`: agent-specific operating instructions that point back to templates.
- `commands/`: thin wrappers for Claude/Gemini-style flows.
- `plugins/`: integrations that expose repo-aware tools and connectors.
- `cli/`: optional enforcement and reporting commands.
- `api/`: only if a future Entropiq developer platform needs remote orchestration; not part of BR25 implementation.

CLI/API hooks should be idempotent and read-heavy first:

- `scope-check`: compare changed files against `BRANCH.md`.
- `command-check`: detect forbidden command patterns from logs or shell wrapper.
- `branch-check`: verify current branch and worktree identity.
- `env-check`: validate make command environment placement.
- `commit-check`: measure diff size and required branch checklist updates.
- `report`: generate Done/Checks/Risks/Scope/Read-set summary.

## Entropiq synthesis

Entropiq already does better than the external references on:

- Multi-agent branch isolation with explicit worktrees.
- Docker-first and make-only operational consistency.
- Port allocation conventions for parallel agents.
- Allowed/forbidden/conditional path governance.
- Distinction between `spec_vol` and `spec_evol`.
- Branch-scoped reporting and feedback loops.
- Selective staging and small commit discipline.

External references do better than current Entropiq practice on:

- Packaging reusable operating methods as shareable skills and commands.
- Making evidence graphs and audit reports visually inspectable.
- Providing lightweight entry points for common loops.
- Separating public reusable primitives from private project ritual.
- Offering CLI/plugin surfaces that can enforce rather than remind.

Minimum durable method:

- Capture intention with review state.
- Create a scoped branch plan with allowed/forbidden paths.
- Run short action loops with explicit stop conditions.
- Record spec evolution without overwriting intent.
- Verify according to risk category.
- Publish decisions and reusable method artifacts separately from private project state.
- Add mechanical enforcement only for objective, repeated failures.

Reusable naming conventions:

- `SPEC_VOL_<TOPIC>.md`: validated user will.
- `SPEC_EVOL_<TOPIC>.md`: controlled evolution after validation.
- `SPEC_STUDY_<TOPIC>.md`: research/watch artifact before validation.
- `BRANCH.md`: branch-local execution contract.
- `PLAN.md`: multi-branch conductor view.
- `DECISION_<TOPIC>.md`: high-cost decision with rationale and rollback.
- `REPORT_<TOPIC>.md`: audit or publication artifact.

## Watch items

- Verify current GitHub Spec Kit conventions before publishing compatibility claims.
- Verify current Codex plugin/skill packaging constraints before committing to file layout.
- Verify Claude and Gemini command/plugin conventions before shipping cross-agent templates.
- Explore whether Graphify output should become a default report format for incident audits or only an optional publication path.
- Decide whether Entropiq should publish a standalone CLI or first ship repo-local make targets.

## Architecture hypothesis

The method should publish as layered artifacts:

- Rules: repo-local policy for commands, branches, commits, tests, and security.
- Specs: validated `SPEC_VOL` for intent and `SPEC_EVOL` for controlled evolution after review.
- Skills/plugins: reusable agent behaviors for planning, conductor reports, verification, graphification, and release discipline.
- Templates: branch plans, PR bodies, benchmark matrices, and decision records.
- CLI/API hooks: optional enforcement points for projects that want stricter automation.

The preferred sequencing is:

- Study and review: finish benchmark, mark open questions, and get human validation.
- Template extraction: publish neutral markdown templates without enforcement.
- Skill/command packaging: wrap templates in Codex/Claude/Gemini-compatible operating procedures.
- Repo-local enforcement: add small make-backed checks for objective failures.
- Public packaging: publish CLI/plugin/npm only after the checks prove useful in Entropiq.

## study_evol rules

- Keep developer-agent skills separate from BR19 product skills until integration is explicitly designed.
- Prefer public, reusable primitives over project-specific rituals when publishing.
- Prefer mechanical checks for repeated failures and written guidance for judgment-heavy behavior.
- Do not add enforcement until the benchmark identifies the target behavior and rollback path.
- Use Graphify-style evidence when comparing methods, not preference-only claims.

## Expected output

- A best-of-breed benchmark document.
- A publication strategy for skills, plugins, templates, and optional packages.
- A short enforcement roadmap.
- Clear handoff notes to BR19 for product skill catalog implications.

## Handoff notes

BR19 should receive:

- Skill manifest lessons: clear name, purpose, inputs, outputs, permissions, examples, and audit trail.
- Runtime safety lessons: sandboxing must be paired with explicit allowed capabilities and reviewable execution logs.
- Catalog UX lessons: discovery should show intent, trust level, permissions, and expected artifact type.
- Memory lessons: product skills need durable user/project memory boundaries, not opaque agent-local memory.

BR23 should receive:

- Framework comparison dimensions for loop control, verification, state graphs, and human approval.
- Evidence that orchestration methods matter as much as runtime frameworks.

BR24 should receive:

- No direct implementation dependency, but CI/action upgrades should preserve room for future command and enforcement hooks.

BR10 should receive:

- Multi-agent plugin lessons for VSCode: branch scope visibility, launch packet generation, stop conditions, and handoff reports.

Future CLI work should receive:

- The objective enforcement candidate list.
- The read-heavy-first hook model.
- The requirement that CLI checks never replace human product-spec validation.
