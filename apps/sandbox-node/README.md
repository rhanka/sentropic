# Sandbox node daemon (S1-A1a)

Standalone mTLS execution-node service implementing
`spec/SPEC_EVOL_SANDBOX_NODE.md` against an injectable runtime adapter.
No Python. No stack required for local regression tests.

## Layout

- `src/errors.ts` — typed `ExecutionNodeError` + contract code to HTTP status.
- `src/tickets.ts` — Ed25519 execution-ticket issue/verify (30 s TTL).
- `src/runtime-adapter.ts` — `RuntimeAdapter` interface, `FakeRuntimeAdapter`
  (tests), `RunscRuntimeAdapter` (`runsc --network=none`, systrap).
- `src/admission.ts` — one warm session/tenant, reservation-based admission, full memory.current telemetry.
- `src/build-queue.ts` — one global publish build, bounded strict tenant alternation.
- `src/custody.ts` — fsync-persisted monotone revocation and stream fencing.
- `src/service.ts`, `src/api.ts` — public mTLS lifecycle routes, pull metrics and control-plane heartbeat.
- `src/operator.ts`, `src/node-control.ts` — k8s-signed operator JWS and node drain/heartbeat gates.
- `src/bundle.ts`, `src/base-store.ts` — digest-verified EROFS bases and private OCI bundles.
- `src/source-write.ts`, `src/output.ts` — scoped source writer and bounded quiescent archive reader.
- `src/audit.ts` — append-only audit log (every row carries `tenant_id`).
- `src/mounts.ts` — per-tenant read-only base mounts + `/workspace` overlay.
- `src/daemon.ts` — lifecycle automaton, tenant isolation, idempotence.
- `src/index.ts` — `createExecutionNode` composition root.

## Contract notes

- `contractVersion` is `execution-node.v1`
  (`apps/sandbox-node/src/contract.ts`).
- Normative cycle: `creating -> standby | running -> stopping ->`
  `stopped-output-retained -> exported -> destroyed` (`failed -> destroyed`).
- Box network is always `none`; source writes require the host-supplied devScope.
- Runtime source is read-only; build output is a separate writable bind.
- The real adapter requires a ticket verification key, rootfs/source bases,
  pinned runsc, EROFS, overlayfs, systemd and cgroup v2 on the qualification host.

## Qualification

Unit tests need no stack (fake adapter, no database):

- `make -f Makefile -f apps/sandbox-node/checks.mk check-sandbox-node ENV=test-sandbox-node`
- `make -f Makefile -f apps/sandbox-node/checks.mk build-sandbox-node-artifact ENV=test-sandbox-node`

See OPERATOR.md for d2-4 limits and the standalone VM systemd/cloud-init
delivery contract and wire protocol. Local tests cover dispatch, bundle planning,
source confinement, real filesystem archives and injected runtime failures.
They do not qualify kernel isolation or the complete runsc lifecycle on the VM.
