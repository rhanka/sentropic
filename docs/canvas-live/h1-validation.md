# H1 provider and admission preparation

Scope: approved host plan r3 H1 only, based on H0 merge `a3204932e`. Plan SHA-256: `a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7`. Frozen DS specification SHA-256: `161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834`, verified against the DS worktree. Author declaration: codex / gpt-6.1-sol / high.

No application consumer is switched. No route, namespace cutover, dependencies, migration or editor changes. `migrated 0/24`. Locks endpoint regression files remain unchanged because their wiring remains unchanged.

## Authority and ownership

`AdmissionAuthority` obtains tenant, workspace and actor from a host authentication port, compares caller actor identity/kind, checks document/field/operation grants, and reauthorizes each operation against both persisted admission bounds and current grants. Actor presentation comes from the host. The atomic storage callback must serialize per complete tenant/workspace/document/actor key. Its record contains session ID, profile/schema facts and the admission epoch. A reconnect/recreated service retains the epoch; only explicit close and new admission mint a new one.

`LiveSessionProvider` joins admission, preserved-draft recovery and binding allocation. Mismatch refuses before registry allocation and captures the offline draft. Recovery state is keyed by tenant/workspace/document/actor/draft, with a persistent pending-draft pointer so changing the handshake facts or restarting cannot bypass acknowledgement. The client-upgrade branch retains bytes; the draft-migration port receives only a copy of the preserved draft and schema facts. Preparation and actor acknowledgement are separate stored changes. Original bytes remain intact.

`SessionRegistry` owns one document resource per tenant/workspace/document. Each local mount has an independent lease; fields use `field:<key>` and `fieldmeta:<key>`, including a legitimate field named `meta`. Only host schema facts use root `meta`. Empty, duplicate and colon-containing descriptor keys refuse before the resource factory. Binding resolution checks document, session and field together and requires an active lease for the actor/admission. Last release closes the transport; retained document state is preserved. Actor updates deliver both actor identity and awareness client ID and remove departing/revoked participants.

The UI adapter delegates all L0 methods to existing `object-lock.ts`, including TTL renewal through lock acquire. It consumes existing streamHub `lock_update`/`presence_update` events and re-reads snapshots rather than trusting event payloads. Every stream ping also re-reads, covering recovery on the first recovered ping without a second SSE connection. Subscriptions cancel pending delivery and detach from streamHub on release. Controlled fields use L0 lock gating; live fields use edit authority and admission together.

## RED and GREEN evidence

| Witness | Observed RED | Observed GREEN |
| --- | --- | --- |
| Admission: epoch/restart, foreign tenant/workspace/document, forged actor, denied field, viewer/downgrade, revocation, profile and older/newer epoch | 10 failures at `708de0636`, executable unimplemented operations | 10 passed |
| Binding registry: two fields, duplicate mounts, full identity, tenant isolation, explicit actor/awareness updates and revocation | 8 failures at `708de0636` | 8 passed |
| Draft recovery: immutable original bytes, both branches, missing/wrong actor/tenant/epoch acknowledgement, repeated refusal | 3 failures at `708de0636` | 3 passed |
| Joined schema recovery before binding, both branches, restart | 2 failures at `fafb59fb0`/working tree, then committed in `3577c3091` before implementation | 2 passed |
| L0 provider: all lock/presence methods, authoritative stream recovery, scope refusal, controlled/L2 gating | 5 failures at `6dd17b1e3` | 5 passed |
| Descriptor refusal regression | Supplemental regression coverage; parameterized input arrays corrected after Vitest expanded them into columns | 4 passed |

Measured focused totals: **27 API + 5 UI tests passed**. RED results are behavior assertions on callable ports, not missing-import/build errors. Initial UI bootstrap failed before discovery because `.svelte-kit/tsconfig.json` was absent; `svelte-kit sync` fixed the environment before the actual 5-test RED run. Initial Docker Buildx write failed inside the filesystem sandbox; authorized escalation allowed the bootstrap to complete.

API typecheck and lint exited 0 (lint: 219 warnings, zero errors). UI `npm run check` and `npm run lint` through `make sh-api` exited 0 (svelte-check: zero errors, six warnings). Final exact-head CI is reported on the PR/handoff, avoiding a receipt commit that would move that head.

## Reproduction and isolation

Worktree `tmp/worktrees/canvas-h1`; `ENV=test-canvas-h1`; ports API 8800, UI 5200, Maildev UI 1100. Every Docker operation uses `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock` per the owner packet; each step ends in `make down` with the same environment and ports. No development stack or data is used. No Python commands or AI commit trailers are introduced.

Use the existing repository `test-api-unit` target's `API_TEST_RUN` port with `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps` for API tests. Set `SCOPE='tests/unit/canvas-live-admission.test.ts tests/unit/canvas-live-provider.test.ts tests/unit/canvas-live-recovery.test.ts'`. For the UI scoped run use that same disposable Compose runner with `-w /workspace/ui` and `SCOPE=tests/adapters/canvas-live-provider.test.ts`; Vitest reads the UI config. This runs no API/UI server or database. Pass `API_PORT=8800 UI_PORT=5200 MAILDEV_UI_PORT=1100 ENV=test-canvas-h1` last, with ENV last of all.

The local dependency image is pinned with `API_IMAGE_REF=rg.fr-par.scw.cloud/nc-reg/sentropic-api:5462eb`; source is mounted from this worktree and dependencies come from its isolated Compose volume. Bootstrap is the existing `prepare-node-workspace` target. API verification uses `make -o prepare-node-workspace typecheck-api lint-api` after bootstrap. UI scripts run inside the existing `make sh-api` disposable Compose shell, working directory `/workspace/ui`.

Every commit uses `make scope-check`. The first uses the repository Docker target. Subsequent runs use an untracked task makefile selecting the installed host harness with the same C2 arguments and changed-path union, avoiding a separate Docker tooling build for each atomic commit. C1 uses the actual git branch as `--current-branch` and exact `feat/canvas-live-h1` as `--expected-branch`. Track imports remain with the designated conductor; no `.track` state is changed.

## Gates retained

- **Published CL-1M:** host preparation shapes remain local. Import the published DS pure types at the adapter boundary and record exact package/digest plus compile conformance before production adoption. No package availability or final DS type conformance is claimed here.
- **H2:** injected atomic admission/draft storage must be backed by the durable journal/store. The restart witnesses recreate services over retained fake records; they are not a process-kill or durable-store qualification.
- **H3 / F2:** the resource factory must supply real Y.Doc/Y.Text/Y.Map/Awareness, real transport, ingress validation, and the editor-graph binding source. The actor update delivery here is exercised through fakes; full `(awarenessClientId, actorId)` verification and cross-field caret rejection through the DS decoration plugin remain the H3/CL-3 F2 gate.
- **H4/H5/H10:** agent patches, durable receipts/inverses, conditional publication and production activation are downstream. Same-block editing remains the owner requirement; these H1 results do not announce a deployed multi-user/AI session.
