# SPEC EVOL - Model Providers and SSO Federation

Status: Draft for roadmap orchestration (2026-02-22)

## 1) Objective
Deliver a production-ready multi-provider AI runtime and identity federation in two milestones:

- Milestone W1 (deadline: 2026-03-01)
  - At least 2 model providers available in runtime (`OpenAI`, `Google/Gemini`).
  - OpenAI/ChatGPT SSO enabled for admin and standard users.
- Milestone W2 (deadline: 2026-03-08)
  - Expand to 4 model families (`OpenAI`, `Gemini`, `Claude`, `Mistral`).
  - Google SSO enabled for admin and standard users.

## 2) Scope

In scope:
- Provider abstraction layer (single contract, provider-specific adapters).
- Model catalog and routing policy.
- Credential resolution order (global workspace key vs per-user BYOK).
- SSO federation adapters and account-linking flow.
- RBAC-safe access for admin/user across all auth providers.
- API and UI contracts for model/provider selection.

Out of scope:
- Billing and quota monetization.
- Full enterprise SCIM provisioning.
- Cross-region data residency controls beyond provider selection.

## 3) Existing baseline
Relevant references:
- `spec/SPEC.md`
- `spec/WORKFLOW_AUTH.md`
- `spec/SPEC_ADMIN_USERS.md`
- `spec/SPEC_CHATBOT.md`
- `TODO.md` (`AI optim`, `SSO`, `models` items)

Current state summary:
- Auth and session flows are WebAuthn-first.
- AI runtime is mostly OpenAI-centric.
- Model switching in chat is not complete (`SPEC_CHATBOT.md`, CU-006/CU-007).

## 4) Target capabilities

### 4.1 Provider runtime
- Introduce `ProviderRuntime` interface:
  - `listModels()`
  - `generate()`
  - `streamGenerate()`
  - `validateCredential()`
  - `normalizeError()`
- Register providers in a dynamic registry (`provider_id`, `status`, `capabilities`).
- Preserve existing SSE semantics (`chat_stream_events`) independently of provider.

### 4.2 Model catalog
- Maintain a canonical model catalog with:
  - `provider_id`
  - `model_id`
  - `reasoning_tier`
  - `supports_tools`
  - `supports_streaming`
  - `is_default` by context (`chat`, `structured`, `summary`, `doc`).
- Expose catalog via API for UI selectors and plugin runtimes.

### 4.3 Credential policy
- Credential precedence:
  1. Explicit per-request credential reference (if allowed).
  2. User BYOK credential.
  3. Workspace/global credential.
- Enforce encryption-at-rest and redacted logs.
- Add explicit health checks for provider credential validity.

### 4.4 SSO federation
- Introduce provider-agnostic SSO adapter for OIDC/OAuth providers.
- Add login and callback flows for:
  - OpenAI/ChatGPT (W1 target)
  - Google (W2 target)
- Keep existing WebAuthn login path available (no regression).
- Support linking/unlinking SSO identities from existing users.

## 5) Branch plan

- `feat/model-runtime-openai-gemini` (W1)
  - Provider contract + registry + OpenAI/Gemini adapters.
  - Catalog endpoint + routing.
- `feat/sso-chatgpt` (W1)
  - OpenAI/ChatGPT SSO end-to-end.
- `feat/model-runtime-claude-mistral` (W2)
  - Anthropic + Mistral adapters and catalog expansion.
- `feat/sso-google` (W2)
  - Google SSO end-to-end.

## 6) Acceptance criteria

W1:
- Two providers are selectable and functional in chat and structured flows.
- OpenAI/ChatGPT SSO works for admin and user roles.
- No regression on existing WebAuthn login and session refresh.

W2:
- Four providers are available and testable (`OpenAI`, `Gemini`, `Claude`, `Mistral`).
- Google SSO is functional with account linking.
- Provider outage on one adapter does not break all runtime flows.

## 7) Open questions

- `MPA-Q1`: What is the canonical naming/versioning policy for model IDs exposed in UI?
- `MPA-Q2`: Should SSO users be auto-linked by email, or require explicit user confirmation?
- `MPA-Q3`: Are admins allowed to enforce provider deny/allow lists per workspace?
- `MPA-Q4`: What is the compliance baseline for provider request/response retention?
- `MPA-Q5`: Do we require provider-level fallback in the same request, or only user-driven retry?

## 8) Risks

- Provider SDK/API instability across releases.
- SSO edge-cases with account linking and duplicate identities.
- Regression risk in streaming/tool-call orchestration when introducing adapters.
