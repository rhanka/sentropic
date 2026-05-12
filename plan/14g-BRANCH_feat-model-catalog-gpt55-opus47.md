# Branch Plan Stub: BR-14g Model Catalog GPT-5.5 / Opus 4.7

Current coordination source:

- `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14g `feat/model-catalog-gpt55-opus47`

Ordering rule:

- BR-14g starts after BR-14c freezes and activates the `@sentropic/llm-mesh` public model-profile contract in the live application runtime.
- BR-14g must land before BR-14b modularizes chat-service behavior above the mesh runtime.
- BR-14g must not perform runtime dispatch migration or chat extraction; BR-14c owns runtime migration and BR-14a owns chat extraction.

Scope summary:

- Pivot OpenAI default reasoning model from GPT-5.4 to GPT-5.5.
- Keep GPT-5.4 Nano available and unchanged.
- Pivot Anthropic Claude Opus from Opus 4.6 to Opus 4.7.
- Update model catalog entries, provider profiles, legacy default cutover rules, context budgets, UI/API labels, and deterministic tests.
- Verify provider API model identifiers at branch start before implementation.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Include file-level updates for `packages/llm-mesh`, `api/src/services/model-catalog.ts`, provider adapters, model-selection legacy rules, API tests, package tests, and any UI display tests if labels surface in UI state.
- Run deterministic catalog tests first; live-provider validation is optional and must be isolated by provider.
