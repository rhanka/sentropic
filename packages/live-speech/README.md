# @sentropic/live-speech

Provider-neutral coordination for live speech. The L2 core owns durable submission identity,
cancellation tombstones, dispatch gates, effect uncertainty, playback epochs and operational receipts.
It performs no inference, capture, native tool execution or provider-history writes.

## Integration contract

Construct `SpeechCoordinator` with a trusted session-scoped `Journal`, opaque `ControlPort`,
`TrustedAuthority`, immediate playback-stop callback and authority clock. Session identity comes from
authenticated admission, including tenant, principal, target, source generation, controller epoch and
consent revision. The journal must atomically persist transactions before acknowledging them, serialize
all writers across controllers/processes, roll back exceptions and isolate returned values from storage.
`SessionJournal` implements isolated transactions, rollback and bounded CAS retries over the host's
linearizable durable `AtomicJournalStorage` primitive. Restoring the same storage key retains fences,
effects, admissions and accepted risk. The package supplies no production in-memory persistence or
independent billing ledger.

`createSession` requires interception coverage for every enabled tool class. A runtime integration must
route every admission through `admitTool`, including known-safe reads, approvals, native tools and
delegated work. Declared coverage alone does not qualify a runtime; prove it with fixture invocation
records. Uninterceptable classes must be disabled. Only the runtime authority can report terminal states.

Commit an immutable final input reference once, persist its epoch/submit key, then call `send`.
Never retry an uncertain native start: `recover` queries the original submission. A late native ID
binds to its original tombstone and is interrupted without becoming a new live turn. Opaque native
history is owned by its existing controller; consume each `toolResult` once under its original call ID.
Later effect evidence updates the journal without emitting a second history result.

Stop clears local playback before waiting for journal or network work. A durable fence receipt means
dispatch has closed; native terminal acknowledgement and effect settlement remain separate. Pending
or unknown effects prohibit mutations in subsequent turns. Only allowlisted read-only status tools and
text clarification can proceed. Risk acceptance requires authenticated typed confirmation bound to the
current scope, selected effect IDs, displayed uncertainty and barrier revision. It records uncertainty,
never success, rollback, termination or permission to replay. Every new mutation needs new explicit
authorization for its exact argument digest and a new action ID. Old fences remain closed.

Use a storage adapter that bounds journal retention and session size under the host's admission policy.
Never serialize audio, partial transcripts, credentials or raw tool arguments into control/usage logs.
Minimized operation/evidence descriptions must be supplied by the authority, not copied from tool output.

## Playback and usage

`Playback` keeps PCM16 media transient, with at most 250 ms queued. Frames must match connection/turn
epochs and exact item sequence/offsets. A generation-done marker is separate from rendered samples.
The renderer reports cumulative samples actually played plus uncertainty; progress is monotonic and
clamped to generated samples. Stop invalidates that epoch even if late frames arrive on another channel.

`UsageReceipts` records one estimate and signed revision-deduplicated adjustments under one operation
identity. These are operational receipts for the existing ledger integration, not cloud spending authority.
Backend spend/tokens may remain unknown; local speech has zero external speech charge. L8 must bind
durable reservations and the shared ledger before any paid speech route is admitted.

## Verification and downstream work

Run `make test-live-speech`, `make typecheck-live-speech`, `make lint-live-speech` and
`make build-live-speech` with a dedicated `ENV=test-*` last. On shared machines wrap each command in
the repository's Docker flock and run `make live-speech-down` afterwards. The gates use the existing
Compose qualification service, no published ports and only transient container dependency trees.

L3 can add `src/node/local-stt.ts` and its worker behind the existing llm-mesh speech adapter contract.
This core is engine independent; final-transcript references feed `commit`, and qualified VAD/key/Stop
events call `interrupt`. L3 must retain profile/model/artifact selection, bounded windows and exactly one
final per utterance. This package does not qualify microphones, engines, latency, native fences or cloud
tuples. Lp0 publication and installed-consumer evidence remain required before cross-repo L5 adoption.
