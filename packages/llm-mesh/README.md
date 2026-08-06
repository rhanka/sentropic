# @sentropic/llm-mesh

Provider-agnostic TypeScript contracts for Sentropic model access.

This package boundary is the BR-14c model-access runtime extraction. It defines public provider/model IDs, capability metadata, normalized generation and streaming shapes, tool-use types, structured-output flags, authentication source types, deterministic provider adapter scaffolds, and retryable error metadata. BR-14c also cuts the Sentropic application LLM runtime over to this package and prepares the package for npm publication.

## Public Scope

- Providers: OpenAI, Google Gemini, Anthropic Claude, Mistral, Cohere.
- Auth sources: direct token, user token, workspace token, environment token, Codex account.
- Future account transport extension points: Gemini Code Assist and Claude Code.
- Normalized stream events: `reasoning_delta`, `content_delta`, `tool_call_start`, `tool_call_delta`, `tool_call_result`, `status`, `error`, `done`.
- Provider adapters: OpenAI, Gemini, Anthropic Claude, Mistral, and Cohere scaffolds accept injected clients for deterministic tests; they do not perform live SDK calls by default.

Application wiring, encrypted storage, quotas, retries, UI behavior, and concrete live provider credential storage remain outside this package contract. The application runtime may provide those integrations through the package's resolver and adapter hooks.

## Cloud Code OAuth client rotation

The embedded Antigravity OAuth client credential is distributable client configuration, not a
user access or refresh token. Source and npm artifacts are built from the same checked-in value.

Rotate it from a protected `0600` file, then bump the package version in the same pull request:

```sh
make rotate-llm-mesh-cloud-code-oauth \
  CLOUD_CODE_OAUTH_CLIENT_SECRET_FILE=/absolute/path/to/client-secret
```

Recovery from an official Antigravity binary is fail-closed and requires both the pinned binary
checksum and the expected credential fingerprint:

```sh
make rotate-llm-mesh-cloud-code-oauth-from-agy \
  AGY_BINARY=/absolute/path/to/antigravity \
  AGY_BINARY_SHA256=<verified-binary-sha256> \
  CLOUD_CODE_OAUTH_EXPECTED_SHA256=<approved-credential-sha256>
```

Update the GitHub Actions secret `LLM_MESH_CLOUD_CODE_OAUTH_CLIENT_SECRET` before merging. The
main-branch publish job rebuilds the package, compares source and `dist` to that protected
reference, rejects credential fragments outside the intended module (including source maps), and
only then publishes through npm OIDC provenance. The workflow never writes the value to logs.

Published versions are immutable. Keep the previous and replacement clients valid for an agreed
grace period, or explicitly accept that revocation breaks enrollment for older package versions.
