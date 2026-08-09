# @sentropic/llm-mesh

Provider-agnostic model runtime, enrollment, and routing control plane.

`@sentropic/llm-mesh` owns provider/model capabilities, enrolled account
eligibility, credentials, health, routing policy, affinity, and the versioned
model-equivalence council. It returns opaque route plans and prepared attempts;
neither a gateway nor another consumer receives provider credentials or raw
account identifiers.

## Public Scope

- Providers: OpenAI, Google Gemini, Anthropic Claude, Mistral, Cohere.
- Auth sources: direct token, user token, workspace token, environment token,
  Codex account, Cloud Code account, and Claude Code account.
- Normalized stream events: `reasoning_delta`, `content_delta`, `tool_call_start`, `tool_call_delta`, `tool_call_result`, `status`, `error`, `done`.
- Provider adapters: OpenAI, Gemini, Anthropic Claude, Mistral, and Cohere.
- Enrolled runtimes: `CodexRuntimeClient` and `CloudCodeRuntimeClient` execute
  canonical requests without exposing their account tokens.
- Routing strategies: last successfully enrolled first (default), ordered, or
  round-robin across new affinities only, with per-model/capability/intent rules.

Caller authentication, wire translation, financial metering, and response
commitment remain outside this package. CLI enrollment uses an encrypted local
keyring; portal mode remains injection-only. Override the CLI keyring directory
with `SENTROPIC_LLM_MESH_KEYRING_DIR` when runtime isolation requires it.

`CloudCodeRuntimeClient` projects function parameter schemas onto the JSON
Schema subset accepted by the Cloud Code Gemini wire. Tool names, properties,
required fields and supported constraints are preserved; unsupported
validation-only keywords are omitted before dispatch rather than causing an
upstream 400 for rich Claude Code tool catalogs.

## Routing policy

`DEFAULT_ROUTE_POLICY` uses the latest successful enrollment, a strict sticky
account, same-transport preference, at most three attempts, and a five-minute
negative-health cache. `retest-preferred` is the default fallback mode: a failed
preferred route is suppressed until its TTL expires, then tested again.
`one-way` promotes a successful fallback instead. Override `negativeCacheTtlMs`
between 1 second and 1 hour.

Suffixed Claude launch aliases expose the owner-ratified Codex and Cloud Code
targets returned by `createCanonicalTargetCandidatesResolver()`. An ordered
policy can therefore place either enrolled transport first and keep the other
as bounded pre-byte fallback. Bare provider model ids remain provider-faithful;
these explicit alias routes do not create general model equivalence.

Equivalent-account rotation is disabled by default. Enabling
`rotateEquivalentAccounts` may move an affinity to another account and lose
provider-side prompt/session cache continuity; such a move is exposed as an
audited rebind with `cacheContinuityRisk: true`. Mesh preserves account and
stable-session affinity, but does not claim or manage a provider prompt cache.

The built-in equivalence council fails closed: a model is either covered by
fresh benchmark evidence or explicitly excluded. Update its pinned source and
generated artifact together:

```sh
make refresh-llm-model-equivalences
make check-llm-model-equivalences
```

Create the gateway-facing planner from the same facade that owns enrollment:

```ts
import { createLlmMeshFacade } from '@sentropic/llm-mesh/facade';

const facade = createLlmMeshFacade({ mode: 'cli', configResolver });
const routePlanner = facade.createRoutePlanner(runtime, {
  affinityAudit: (event) => audit.write(event),
});
```

Every completed enrollment persists its `ownerScopeRef`. The planner lists and
prepares only accounts whose owner scope exactly matches the authenticated
`VerifiedRoutingSubject`; changing a bearer/session principal does not change
that owner scope or its affinities. Older local keyring records that predate
owner tagging fail closed unless the host explicitly binds them once:

```ts
const facade = createLlmMeshFacade({
  mode: 'cli',
  configResolver,
  legacyAccountOwnerScopeRef: stableLocalOwnerRef,
});
```

That migration option is only for pre-ownerScope local records. New enrollment
always takes ownership from `StartEnrollmentInput.ownerScope`.

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
