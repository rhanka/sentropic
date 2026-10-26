# Artifacts 0.2.0 transport migration

The registry baseline checked for this change is `@sentropic/artifacts@0.1.4`.
Radar 0.1.2 and upstream 0.1.4 hosts must migrate their composition before
loading the 0.2.0 HTTP or MCP surface. Publication is a separate owner-approved
release step; this branch does not publish packages.

## Required host composition

Compile an explicit immutable profile with `compileArtifactsProfile`. Radar
selects `artifacts_ensure`, `artifacts_publish`, `artifacts_list` and
`artifacts_get`. Pass the same compiled profile to `createHttpArtifactApp`,
the MCP adapter/executor and `createArtifactsRegistryDefinition`. Empty
selection exposes nothing. Missing configuration fails construction.

Supply a raw PostgreSQL pool to `createPostgresCommitExecutor` and a
transaction-bound policy participant factory to `createArtifactCommitCoordinator`.
The coordinator owns BEGIN, key locking, COMMIT, rollback and release.
Remove session advisory-lock wrappers, pool-routing proxies, nested BEGIN
and no-op release wrappers from the old provider composition.

Create one trusted `ArtifactInvocationContext` for every request, containing
the verified actor, trusted scope, invocation ID and `authorizeCommit` guard.
Pass it to `app.execute(request, invocation)` or `app.handle(request, invocation)`.
Accounting hosts call `execute` once and project its typed outcome themselves.
Do not call both methods for the same operation. The MCP adapter requires
`createInvocation` and verifies its actor against `ctx.principal.sub`.
HTTP and MCP must use the identical canonical verified actor string.

Supply one qualified `createRadarKeyDerivation` binding to both transports.
Caller arguments contain the original caller key; actor, scope, internal key,
hash and guard come from the host. An optional platform envelope must exactly
match the argument key. Keep publication URLs under one shared
`publicationUrls` policy so HTTP and MCP return identical receipts.

## Public coordinator example and cleanup

The packed `examples/radar-commit-setup.ts` uses public entrypoints only:
`@sentropic/artifacts/adapters/postgres-commit`, `/server/commit-contract`
and `/mcp-core`. The commit contract exports `CommitExecutor`,
`CommitCoordinatorOptions`, `ArtifactPolicyDriver` and `CoordinatorTestPoint`.
The example compiles the frozen `ArtifactProviderProfile` shape, binds policy
reads/quota to the acquired PostgreSQL transaction and mints its guard fence.

Before activation, configure `cleanupWindowMs` on guarded publication and
start a cleanup scheduler; the example supplies a 30-second preparation
lifetime and a one-second serialized sweep. Each sweep processes at most
100 attempts. Capacity, sweep cadence and storage availability determine
whether the configured deadline is met; failed cleanup remains observable debt.
Reads are limited to the same batch size, with unsettled debt first. Settled
attempts receive metadata-only existence checks for 60 seconds after their
deadline; subsequent orphan recovery uses the host's ordinary GC. No cleanup
or inspection downloads blob contents. Invalid metadata is retained as failed
debt, excluded from subsequent sweeps, and returned in inspection's
`invalidIntents`; the sweep reports it after processing the remaining batch.

`/server/object-intents` exposes `inspectPreparations(host, artifactId)` and
`scheduleBoundedPreparationCleanup(host, throughMs)`. Bind `host.intents`
to the PostgreSQL artifact store, plus `blobs`, `refs` and `claims`.
Keep the claim store's transaction open through external DELETE, then commit
or roll back and release it, as `startRadarPreparationCleanup` demonstrates.
Inspection returns `attempts`, `protectedKeys` and `abandonedKeys`; every
attempt retains its ID, invocation, blob keys, preparation time and deadline.
Cleanup invalidates expired preparations before removing their pins, retains
other references/pins, and never promotes an abandoned attempt to success.

`/testing` exports `pausePurgeBeforeDelete(host, artifactId)` and
`inspectDeletionClaims(host)`. Bind the test host's `storageScopeId`, `blobs`,
inspectable `claims`, and `purge(artifactId, deletingBlobs)` callback. The
callback must commit its durable `purge:<artifactId>` claims and use the
supplied deletion adapter for that purge only. The pause returns `claimId`,
`blobKeys`, `release()` and `finished`; release it in a `finally` block.
Inspection reads durable claim history without releasing exclusion or
granting publication authority. The seams do not alter L3 ports or profiles.

## Domain adapters and transaction boundaries

`ensureHost.lockBinding` and `resolveBinding` receive the coordinator's
transaction client. Resolve the binding and write ACL/lifecycle state on that
same client. Concurrent commands must serialize on the binding identity,
including when their caller keys differ. Replay resolves current identity
under this lock and compares it to the stored receipt. Missing or changed
targets deny before the host guard; explicit replay requires a binding.

Use `createGuardedEnsureService` and `createGuardedPublicationService` for
custom services. Pass the request-bound host guard as `publishFinalized(input)`'s
optional `authorizeCommit` field to preserve host approval policy and refusal codes;
it runs after lifecycle, ACL and policy revision checks. When omitted, publication
uses `participant.checkApproval` and denies unapproved or expired commits.
HTTP/MCP pass the invocation's host guard automatically.
The canonical coordinator exposes `finalizeOperation` and
`replayOperation` with the frozen L0 inputs. Bind fresh domain request plans
through its `operations` option; no process-local replay cache is used.
Provider adapters use `finalizePrepared` and `replayPrepared` on that same
coordinator. Guards run after all blocking waits and must be side-effect-free.
Policy/quota registration is trusted construction, never a public argument.

`ArtifactCommitParticipant.readAdmission` reads current approval/revision on
the leased transaction. Keep policy locks through COMMIT. Quota reservation
is provisional and rolls back with denial. Object authorization also runs
for replay; a stored success alone confers no authority.

Use `createPostgresGcService(executor, refsForTransaction)` for PostgreSQL GC.
The reference-store factory must bind its reads to the supplied client.
GC keeps the transaction and digest exclusion through external deletion and
claim completion. Do not pass a raw pool to transaction-scoped deletion claims.

## Durable state and failures

Stop old writers before enabling the new composition. Apply migrations
`0001_artifacts.sql`, `0002_lifecycle.sql` and additive `0003_coordinator.sql`.
Preserve historical rows and objects. Supply `legacyRecords`, using
`createPostgresLegacyArtifactRecords(pool)` for PostgreSQL. An empty inventory
reader is appropriate only for a verified fresh store.

Ambiguous legacy keys and unknown command codecs return a stable
503 `capability_unavailable`, non-retriable migration condition. They are
never promoted to newly authorized successes and never trigger allocation
under another key. Reconcile actual pilot inventory separately; unknown
historical array order cannot be recovered from a sorted manifest.

New receipts store the ordered `artifacts-command/v1` identity in
`artifacts.operation_receipts`. Manifest digests retain their historical
codec. A denied attempt has no success receipt; reauthorization may retry the
same key. An unknown COMMIT outcome requires the same key and a fresh guarded
lookup. Private failure causes remain internal. HTTP and MCP project the same
public code and retry classification; status 503 alone does not imply retry.

Public host imports are `@sentropic/artifacts/server/commit-contract`,
`@sentropic/artifacts/server/outcome-contract` and `@sentropic/artifacts/testing`.
The `/mcp-core` runtime stays independent of the MCP platform runtime.
For tests that subscribe after arrival, explicitly arm barrier points with
`createArtifactCommitBarrier({ points: ['before_commit'] })`. Other arrivals
remain observational; a barrier cannot grant authority or certify success.
