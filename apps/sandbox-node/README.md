# Sandbox node daemon (S1-A1a)

In-memory execution-node daemon implementing the frozen
`spec/SPEC_EVOL_SANDBOX_NODE.md` contract against an injectable runtime
adapter. No Python. No stack required for unit tests.

## Layout

- `src/errors.ts` — typed `ExecutionNodeError` + contract code to HTTP status.
- `src/tickets.ts` — Ed25519 execution-ticket issue/verify (30 s TTL).
- `src/runtime-adapter.ts` — `RuntimeAdapter` interface, `FakeRuntimeAdapter`
  (tests), `RunscRuntimeAdapter` (`runsc --network=none`, systrap).
- `src/admission.ts` — one warm session/tenant, complete memory.current reservations.
- `src/build-queue.ts` — one global publish build, bounded strict tenant alternation.
- `src/custody.ts` — fsync-persisted monotone revocation and stream fencing.
- `src/service.ts` — public mTLS bootstrap and job-alerts heartbeat.
- `src/audit.ts` — append-only audit log (every row carries `tenant_id`).
- `src/mounts.ts` — per-tenant read-only base mounts + `/workspace` overlay.
- `src/daemon.ts` — lifecycle automaton, tenant isolation, idempotence.
- `src/index.ts` — `createExecutionNode` composition root.

## Contract notes

- `contractVersion` is `execution-node.v1`
  (`apps/sandbox-node/src/contract.ts`).
- Normative cycle: `creating -> standby | running -> stopping ->`
  `stopped-output-retained -> exported -> destroyed` (`failed -> destroyed`).
- Box network is always `none`; writes are allowed under `/workspace` only.
- The real `runsc` adapter compiles everywhere but only spawns `runsc`
  where the binary exists (`hasRunsc()` gate, tests skip otherwise).

## Qualification

Unit tests need no stack (fake adapter, no database):

- `make -f Makefile -f apps/sandbox-node/checks.mk check-sandbox-node ENV=test-sandbox-node`
- `make -f Makefile -f apps/sandbox-node/checks.mk build-sandbox-node-artifact ENV=test-sandbox-node`

See OPERATOR.md for d2-4 limits and the standalone VM systemd/cloud-init
delivery contract. The bootstrap advertises only delivered operations;
unit success does not qualify the host lifecycle or real export reader.
