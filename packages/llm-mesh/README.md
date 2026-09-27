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

## Claude subscription enrollment (LOT 1)

The facade supports browser PKCE enrollment and renewable Claude CLI credential
import, durable ordinary seats, and refresh on acquire. Hosts without a qualified
official CLI runner remain **enrollment only**, execution **`not-covered`**.
The LOT 2 bridge below provides the host injection seam.

```ts
import { createLlmMeshFacade } from '@sentropic/llm-mesh/facade';
import type { EnrollmentCompletion } from '@sentropic/llm-mesh/enrollment';

const facade = createLlmMeshFacade({
  mode: 'cli',
  configResolver: { async resolveConfig() { return {}; } },
});
const session = await facade.enroll('claude-code', {
  configRef: 'claude-code', mode: 'cli', redirectUri: '', ownerScope: verifiedOwner,
});
// A trusted local component opens session.url and captures <code>#<state>.
// Capability-check optional methods when supporting older mesh versions.
if (!facade.completeClaudeEnrollment) throw new Error('Claude enrollment unavailable');
const completion: EnrollmentCompletion = await facade.completeClaudeEnrollment(
  session.enrollmentId, maskedCodeInput, verifiedOwner,
);
```

The authenticated host supplies the owner. Code/credential inputs and the
authorization URL stay inside trusted local UI/provider/storage components:
never put them in agent or MCP arguments, shell text, argv, environment variables,
logs, traces, snapshots, history, clipboard diagnostics or exception receipts.
Completion/list results contain only public account references and labels. A
browser session expires after 15 minutes; each completion is one-use, with strict
state, cancellation and a 30-second token-request deadline. Failed/ambiguous
exchanges require a fresh enrollment; codes are never retried automatically.

`{}` selects the provisional A2 profile `claude-code-oauth-2.1.80-v1`, sourced from
the [official 2.1.80 package](https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.80).
Current provider acceptance remains unverified. Nonempty resolver results must be
complete profiles: `id`, `authorizationUrl`, `tokenUrl`, `clientId`, `redirectUri`,
`authorizationScopes`, `refreshScopes`, `requiredScopes`, `source`. URLs use HTTPS;
required scopes include `user:inference` and must occur in authorization/refresh
scopes. IDs are immutable; the bundled ID cannot be redefined. Redirect input must
be empty or exactly the configured manual callback. No client secret is required.
Custom refresh resolves the stored ID and requires an exact version match; keep
old profiles available while grants exist. Bundled refresh bypasses the host
resolver. Unknown IDs and legacy `v1.0.0` require reauthentication before HTTP.

For sessionless paste, the trusted component calls the optional
`facade.completeClaudeCredentialImport(maskedCredentialJson, verifiedOwner)`.
Accept either the full JSON document containing `claudeAiOauth` or that inner
object: `accessToken`, `refreshToken`, `expiresAt` (epoch milliseconds), `scopes`.
The limit is 64 KiB in UTF-8. Access-only strings/setup tokens are refused; missing
refresh material, blank/CR/LF tokens, invalid expiry or incompatible scopes fail.
Unknown fields and descriptive identity data are discarded; labels use opaque
random account IDs. Valid past expiry is accepted offline and refreshed on first
acquire. Import uses the host's `claude-code` profile, never a profile in the paste.

CLI mode defaults to an encrypted file keyring. Portal mode defaults to memory;
provide a durable keyring with atomic owner claims for restart persistence.
Both paths save the envelope, public record and index before local eligibility.
Refresh stays single-flight through validation, save and publication. Local storage
or preparation outages before a provider request are retryable; terminal errors or
failures after a request may have been sent require reauthentication. Scope metadata
records the actual validated grant scopes.
One grant means one mesh account and one refresh holder. Imports with a refresh
token already stored for a Claude account of the same owner are refused with
"This Claude credential is already enrolled"; comparisons stay in process.
Use one credential-owning service per grant. Before importing, disable/logout the
source CLI and record transfer evidence; copying a file does not transfer refresh
ownership or create a new provider device. Local removal does not prove provider
revocation. Custody-managed access projections belong to the separate custody host,
not this ordinary local enrollment/refresh path.

### Terms of use

This tool demonstrates feasibility. **Owner decision:** “each user assumes”
responsibility for compliance and the risks of account suspension or refused calls.
This is the owner's allocation of responsibility, not Anthropic permission.

Established distinctions, **verified (source, 2026-09-26)** in
[Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance.md):

| Account | Publicly established | Unverified for this mesh deployment |
| --- | --- | --- |
| Individual Pro/Max | [Consumer Terms](https://www.anthropic.com/legal/consumer-terms); ordinary native-app OAuth use. Developers may not route requests through Free/Pro/Max credentials on users' behalf. | Permission for mesh enrollment/storage/execution. |
| Organization Team/Enterprise | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms); ordinary native-app OAuth use. General third-party Claude.ai login and credential/session-token collection, storage and intermediation restrictions still apply. | Organization-specific agreements/exceptions; the individual-plan routing sentence establishes no organizational exemption. |
| API key / [Console](https://platform.claude.com/) | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms); recommended developer authentication. Customer-managed keys for authorized users are permitted subject to billing to the key owner and the stated no-resale/intermediation conditions. | Compliance of the actual deployment; API-key guidance does not authorize subscription-token substitution. |

**Verified (source):** the same page permits hosting the unmodified official binary
under stated conditions: Commercial Terms, no built-in auth method restricted,
end-user authentication/direct billing, and no paying/reselling/intermediating their
usage. It preserves end users' own subscription sign-in to that binary.
**Unverified:** whether mesh credential projection and runner restrictions meet
those conditions; executing the official binary alone does not establish permission
to enroll, store or intermediate subscription credentials.

## Claude official CLI execution (LOT 2 mesh bridge)

`ClaudeCodeRuntimeClient` implements the Anthropic client slot and accepts a
host-provided `ClaudeCodeCliRunner`. The host executes the unmodified official
`claude` subprocess; llm-mesh imports no process API and provides no runner,
Messages transport, client headers, runtime refresh or automatic retry.

```ts
import { ClaudeCodeRuntimeClient, createDefaultProviderAdapters } from '@sentropic/llm-mesh';
import type { AnthropicAdapterClient, ClaudeCodeCliRunner, ClaudeCodeCliCapabilities } from '@sentropic/llm-mesh';

// Trusted host supplies these after qualifying the exact CLI and isolated runner.
declare const runner: ClaudeCodeCliRunner;
declare const capabilities: ClaudeCodeCliCapabilities;
declare const directAnthropicClient: AnthropicAdapterClient;
const adapters = createDefaultProviderAdapters({
  anthropic: new ClaudeCodeRuntimeClient({ runner, capabilities, fallback: directAnthropicClient }),
});
```

Only `account-transport` with provider `claude-code`, and `claude-code-account`,
reach the runner. Other auth delegates to the supplied direct client, or is
refused when no fallback exists. Conflicting request auth is removed; the selected
auth remains in the context. Unresolved auth callbacks without a trusted context
are refused. A seat failure never falls
back to metered API authentication. The in-process input contains only access
token, finite unexpired epoch-millisecond expiry and the actual grant scopes,
the projected request, and an abort signal. Ordinary scopes come from
`material.metadata.scopes`; access-only custody uses trusted
`material.descriptor.metadata.scopes`, filling absent scopes from trusted resolution
`descriptor.metadata.scopes`; explicit invalid scopes are never replaced.
No refresh token, headers, account metadata or request auth reaches the runner.

The versioned capability profile requires `cliVersion`, `source` and
`qualificationRef` for protocol `claude-code-stream-json-v1`. These references are
trusted host attestations, not verification by mesh. Default request support is
an explicit `modelId` and one user text message. Only this baseline is expected to
qualify with the official CLI; `history` and `tools` are expected **`not-covered`**
unless M3 proves otherwise, with separate source/qualification references.
**Verified (source):** the [SDK input contract](https://platform.claude.com/docs/en/agent-sdk/typescript)
uses `SDKUserMessage` streams. “All CLI stream-json input is user-only” remains
**unverified**: the inspected official 2.1.80 parser also accepts assistant/system
records (spec A7). Neither fact proves history or mesh-owned tool continuation.
The tool subset accepts JSON function
schemas, complete call IDs/arguments and matching string results; it rejects
incomplete histories and unsupported extras. System/developer prompts, media,
reasoning, sampling/token limits, structured output, forced/parallel tools and
provider overrides are refused before running. Callers using `createLlmMesh` may
use its model-selection contract; mesh resolves it to `modelId` and removes `model`
before delegation. Direct runtime-client calls must supply `modelId` and omit
`model`; this client does not resolve aliases or choose a default model.

The host must prove isolated credential/config files, environment allowlisting,
tool/hook/MCP confinement, bounded parsing, cross-process serialization,
descendant reaping/cleanup and zero child refresh. Abort and consumer early-close
signal cancellation; the trusted host owns process termination. A final runner
result must certify successful cleanup, followed by EOF.

Production must enforce default-deny egress for the runner's **whole process tree**
using a network namespace or equivalent: allow only qualified inference origins,
block the OAuth token endpoint and all alternate destinations, and prevent bypass
by descendants, proxies, direct IPs or inherited host access. Shared inference/token
origins require enforceable endpoint separation or refusal. The M5 probe is a
regression check, not this enforcement. Its fixture CA/DNS overrides and fake token
endpoint are test-only; production denies those overrides and token egress.

The host prefers verified tmpfs (e.g. `$XDG_RUNTIME_DIR`); otherwise it uses a
dedicated 0700 directory, with exclusive 0600 files, `O_EXCL | O_NOFOLLOW` and
`lstat` checks. SIGKILL/crash can bypass cleanup and leave an access-only file.
A supervisor reaps descendants; orphan sweeps run at the next runner start **and
host boot**, using lock/PID/start/boot identity and a configured staleness threshold
(default five minutes, with retry for younger orphans). Live or ambiguous owners
prevent deletion. Sweeps delete within the dedicated root without following
symlinks or reading credential contents; tmpfs/deletion do not guarantee erasure
from swap, dumps or storage.

The projection contains the **real expiry**, never a refresh token. Writing an
earlier timestamp cannot shorten provider validity. The host can refuse remaining
TTL above `maxRemainingTtlMs` or below its run deadline. Running immediately after
refresh improves freshness but usually maximizes remaining TTL and does not reduce
exposure; it may conflict with that maximum. Cleanup cannot revoke a stolen token.
These host requirements are **unverified implementations** until qualified in h2a.
The precise contract,
proposed h2a tests and fake-credential M5 counting probe are in
[`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md`](../../spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md).
No real CLI qualification is claimed by the mesh fake-runner tests. Until the
host supplies a qualified runner, seats remain **enrollment only** and execution
is **`not-covered`**. The Terms of use and suspension/refused-call risks above
apply equally when the official CLI executes requests.

## Route quote

`quoteRoute(input, { council, profiles })` (or `routePlanner.quote(input)`)
returns side-effect-free candidate and usage bounds for budget admission. It is
synchronous, reads no clock (`now` is an input), performs no I/O and never calls
the account directory. The quote lists every model any plan could select for
the request (aliases, fallbacks and fresh council equivalents, filtered by
required capabilities but not by accounts or health), at most
`MAX_ROUTE_QUOTE_CANDIDATES` (16), with the policy attempt cap (1..8) and a
per-attempt allowance derived from the caller ceiling. Output allowance is
bounded by a model's `maxOutputTokens`; input above a declared context window
is refused. Candidates that may run on the Codex transport carry
`outputCeilingEnforced: false` because that wire cannot send an output limit.
Errors are `RouteQuoteError` codes `unknown-model`, `capabilities-unmet`,
`invalid-ceiling` and `too-many-candidates`. Mesh never reads prices or
budgets.

Pass the quote to `plan({ ..., quote })`: the plan keeps only quoted targets,
caps attempts at `quote.maxAttempts`, and throws `RoutePlanError` code
`quote-mismatch` when the quote reference, council or policy revision differs,
or when no planned route is covered by the quote. A pinned plan evaluates
council freshness at `quote.quotedAt` (the quote's `now`), shares its target
resolution with `quoteRoute`, and ignores a sticky affinity whose target the
quote does not cover. `requiredCapabilities` order does not affect `quoteRef`.

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
