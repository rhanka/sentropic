# Sandbox node daemon (S1-A1a)

In-memory execution-node daemon implementing the frozen
`spec/SPEC_EVOL_SANDBOX_NODE.md` contract against an injectable runtime
adapter. No Python. No stack required for unit tests.

## Layout

- `src/errors.ts` — typed `ExecutionNodeError` + contract code to HTTP status.
- `src/tickets.ts` — Ed25519 execution-ticket issue/verify (30 s TTL).
- `src/runtime-adapter.ts` — `RuntimeAdapter` interface, `FakeRuntimeAdapter`
  (tests), `RunscRuntimeAdapter` (`runsc --network=none`, systrap).
- `src/admission.ts` — per-tenant quotas + WFQ 1:1 pending drain.
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

- `make up-api-test API_PORT=8795 UI_PORT=5181 MAILDEV_UI_PORT=1088 ENV=test-sandbox-node`
- `make test-api-endpoints SCOPE=apps/sandbox-node/tests API_TEST_ARGS="--config ../apps/sandbox-node/vitest.config.ts --no-file-parallelism" API_TEST_WORKERS=1 ENV=test-sandbox-node`
- `make exec-api CMD="npx --no-install tsc --project ../apps/sandbox-node/tsconfig.json" ENV=test-sandbox-node`
- `make down ENV=test-sandbox-node`
