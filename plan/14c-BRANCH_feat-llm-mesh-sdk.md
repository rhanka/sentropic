# Branch Plan Stub: BR-14c LLM Mesh SDK

Current coordination source:

- `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`

Branch:

- BR-14c `feat/llm-mesh-sdk`

Ordering rule:

- BR-14c is the first BR-14 implementation branch.
- It defines the `@entropic/llm-mesh` public model-access contract before BR-14b runtime migration and BR-14a chat SDK extraction.

Scope summary:

- Publishable npm package boundary for `@entropic/llm-mesh`.
- Providers: OpenAI, Anthropic/Claude, Google/Gemini, Mistral, Cohere.
- Auth modes: direct token, user token, Codex-account mode.
- Later account targets prepared: Gemini Code Assist, Claude Code.
- Normalized streaming, tool capability, and model capability contracts.

Before implementation:

- Create a full `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
- Include file-level API/package tests and live-provider test split strategy.
