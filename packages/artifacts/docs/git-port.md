# GitPort: enrolled GitHub App adapter

This is the SG2 server adapter for G0 FROZEN v3. Production activation remains
gated on SG0-app enrollment acceptance, SG0-net egress qualification and the real
forge probe receipts. Fake tests establish package behavior; they do not certify
GitHub or either initial installation. No witness probe has been run by this lane.

## Host composition

Import `createGitPort` and `createGitHubForge` from `@sentropic/artifacts`.
Inject the scope-filtered SG1 registry, SG0-app's `GitInstallationLeasePort`,
the current human directory, the App bot committer identity and an `authorize`
callback. That callback must check current repository code rights on every
operation and the authenticated artifact owner on every write. Targets are
server-derived binding/registry context, including `principalId`, `subPath` and
the descriptor's `outputDir`; they are never forwarded tool arguments.

```ts
const git = createGitPort({
  registry,
  leases: clusterMeshEnrollment,
  forge: createGitHubForge(),
  directory: humanDirectory,
  committer: appBotIdentity,
  authorize: currentCodeAndOwnerRights,
  cursorKey: hostCursorKey,
});
```

The cursor key is a host-owned MAC key of at least 32 bytes, shared across trusted
adapter replicas. It is separate from forge credentials. Never mount it in build
or live workers. The adapter belongs only in the qualified SG0-net service,
with authenticated broker access and egress to the fixed GitHub API/git origins.
Artifact source, live/build pods and clients never receive a lease or an App key.

Every operation acquires a fresh cluster-mesh lease. There is no token cache,
signing key, installation id, PAT option or credential fallback. Before forge
work, the adapter verifies exact `contents:write` + `metadata:read` permissions,
an opaque credential version, and expiry beyond a 30-second margin. An
authenticated repository lookup verifies that the lease's repository id matches
the host registry locator. Each subsequent forge call checks expiry and local
revocation fencing again. Wire the SG0-app invalidation callback to `git.invalidate`
on every adapter replica, and fence dependent jobs through the host as specified
by SG0-app. Pass its full scope/repo/installationRef/credentialVersion tuple.
The event names the superseded lease epoch, which stays fenced across duplicate
or reordered notifications. A successful App-key rotation mints replacement
leases under a new epoch; that replacement epoch is not the invalidation target.

## Reads and writes

`resolveRef` returns the full SHA; subsequent `read` calls require that SHA.
Registered sources can be read at main, tag or other valid refs independently
of write authority. Each page rechecks rights. A MAC-bound cursor includes a
digest of principal, scope, target, SHA and requested paths; substitutions fail
before requesting a lease. Source pages expose UTF-8 text or base64 bytes and
explicit `too_large` / `over_total_budget` omissions. UTF-8 BOMs are preserved.
Secret paths and symlinks/gitlinks are excluded from enumeration; explicit unsafe
paths fail. Embedded private-key material is also refused when encountered.

Traversal uses nonrecursive GitHub directory trees at immutable tree SHAs.
A truncated directory response is an availability failure, never an incomplete
success. Enumeration is bounded at 4,096 distinct directory objects, 1,000,000
entries and depth 128. It is repeated for each page, so hosts should measure
call cost before selecting page sizes. Crossing a bound is `limit_exceeded`.

Default limits are 100 entries/page (configurable up to 255), 1 MiB/file and
8 MiB cumulative returned bytes across a paged read. Commit batches have at most
255 paths and the same file/total byte limits. Paths have at most 1,024 UTF-8
bytes; messages have at most 16,384 UTF-16 units. These are adapter bounds pending
P3/P10 evidence, not claims about forge limits. SG3 separately owns durable
30 commits/hour/principal and 60 commits/hour/artifact counters.

All requested paths, write bounds and missing-human linkage are checked before
lease acquisition or forge access. `.env*`, private-key names/extensions,
`.git`, `.github`, `.ssh`, traversal, alternate separators and encoded aliases
are refused. Writes also refuse the descriptor output subtree. All create,
replace and delete paths must match host `writablePaths` without matching a
`refusedWritePaths` denial. Basename denials such as `package*.json` apply at
every depth. Denials win. The A1 host registry must supply:

```ts
allowedSubPaths: [''],
writablePaths: ['ui/**', 'packages/*/src/**'],
refusedWritePaths: ['.github/**', 'deploy/**', 'api/**', '.track/**', 'package*.json'],
```

`commit` consumes materialized full-text changes (`null` deletes). SG3 applies
exactly-once edits in memory at `expectedHeadSha` before this step. Existing file
modes are preserved; new files are regular blobs. The author comes from the
authenticated human directory; the host supplies a probe-qualified noreply or
service address, never an MCP-provided email. The App bot is the committer.
The server appends the three frozen artifact/invocation/base trailers.
Persist `createdAt` with SG3's durable intent and reuse it on replay: both forge
identity timestamps use that value. One batch creates one tree and one child
commit whose only parent is `expectedHeadSha`.

The ref update uses smart HTTP receive-pack with the exact old and new SHA,
an empty pack (objects already exist through REST), and `report-status`.
There is no REST ref PATCH or force option. Fast-forward-only REST updates alone
cannot prove CAS when a concurrent actor rewinds to an ancestor. P1 must verify
this smart-HTTP path on the enrolled witness before activation.

`git_head_moved` carries expected/actual SHAs; path refusals are typed 422s;
missing enrollment and forge outages close as `capability_unavailable`.
An explicit forge rejection with an unchanged head is `git_ref_not_allowed`.
`GitPortAdvanceUnknown` signals an indeterminate update acknowledgement through
`commitState: 'unknown'`. SG3 must reconcile through `inspectCommit`, parent SHA
and the invocation trailer, with the original durable key; it must not issue a
fresh invocation blindly. Durable idempotence, binding transactions, audit,
build/publication jobs and release CAS remain SG3/SG4 responsibilities.

## Test-only witness

`tests/fixtures/git-port-witness.ts` exports `createEnrolledWitnessGitPort`.
It returns nothing by default, for unready enrollment, without an enrollment
receipt, or without a host-injected lease port. An enabled witness is restricted
to the enrolled scope/repo/reference tuple and uses the real fixed-origin forge.
It does not discover environment credentials, create an App or enroll a repo.
Keep it outside production exports. The host qualification harness supplies the
verified SG0-app enrollment and records P1–P3/P5/P9/P10 receipts without tokens.

Scoped local verification: `make test-artifacts SCOPE=tests/git-port` with the
lane's isolated test ENV and all ports, through `docker-slot.sh`. HTTP tests use
fake responses only; no default test contacts GitHub.
