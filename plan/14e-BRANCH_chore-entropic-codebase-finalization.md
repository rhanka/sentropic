# Branch Plan Stub: BR-14e Entropic Codebase Finalization

Current coordination source:

- `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14e `chore/entropic-codebase-finalization`

Ordering rule:

- BR-14e runs after BR-14c, BR-14b, and BR-14a have settled package/runtime/chat boundaries.
- BR-14e runs before BR-14d executes the final operational transition, so deployment objects receive stable code names.

Scope summary:

- Final inventory of `top-ai`, `top_ai`, `topai`, `TOP_AI`, `Top AI Ideas`, `top-ai-ideas`, `@top-ai`, and old hostnames.
- Rename non-chat and non-LLM code names: API/UI package names, public API labels, auth email branding, import/export source markers, report labels, tests, fixtures, and shared app prefixes.
- Classify allowed residuals: business-case references, temporary compatibility aliases, and historical docs.
- Produce a residual-name report for BR-14d.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Include the inventory command, allowlist format, affected file groups, API/UI test list, and rollback notes.
