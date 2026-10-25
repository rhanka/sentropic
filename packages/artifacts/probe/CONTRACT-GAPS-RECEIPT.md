# Artifacts #861 contract gaps candidate receipt

- Candidate: `@sentropic/artifacts@0.2.0`; pack only, no publication.
- Base: `origin/feat/immo-861-integration` at `082fe4c60`.
- Packed implementation: `62dc8de0fefcd59ceb833472379535f035550e85`; subsequent receipt/branch changes are documentation only.
- Archive: `tmp/contract-gaps/sentropic-artifacts-0.2.0.tgz` in this worktree.
- SHA-256: `6122ed8d2adea53be6366918f7df83238e8a7bd0596fdd48b0be752497f2ae82`.
- Integrity: `sha512-h/loHGv1vEkYnio3awGww9Nu++5qxcTWvN0hQ19zIrfjmSK9EYIpnSBy47zCRdMJXg19U1nyRuGrfqQZRtxv5g==`.

## Verification

Every Docker/test command used `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`
and the existing `docker-compose.immo-861.yml` qualification service, with
`ENV=test-861-gaps` last. `make down` removed the isolated stack between steps.

The following targets use `make -f packages/artifacts/probe/contract-gaps.mk`:
Offline gates supplied `OFFLINE_TOOLS=../861-integration/node_modules`;
lint additionally supplied `OFFLINE_LINT_TOOLS=../861-L8d/tmp/l8d/radar/node_modules`.
These are explicit local cache selections, not recipe defaults. Portable defaults
use this checkout's `node_modules` and `$(HOME)/.npm/_cacache`; all are overridable.

| Target | Result |
| --- | --- |
| `offline-build` | Platform/artifacts build and frozen contract type compilation passed. |
| `offline-unit` | 440 tests passed, 35 files, zero skips. |
| `offline-integration` | 172 PostgreSQL/MinIO integration/E2E tests passed, 12 files, zero skips. |
| `offline-packed` | Exact archive installed in a fresh consumer; shipped example and public API type fixture compiled. |
| `offline-lint` | Recommended TypeScript ESLint rules passed, zero errors/warnings. |
| `qualification-paths` | Portable defaults and explicit overrides passed from a temporary checkout directory. |

Toolchain: TypeScript 5.4.5, Vitest 4.1.5, pg 8.22.0, AWS S3 SDK 3.1095.0,
Node declarations 22.20.4 (cached archive SHA-512 checked), ESLint 9.39.4 and
typescript-eslint 8.59.4. These cached Vitest/lint versions differ from the
normal make recipes' 4.1.0/10.0.2/8.56.1. Registry TLS failures prevented the
normal dependency installation; no test assertion, timeout or lint rule was relaxed.
External tools were mounted read-only and copied inside disposable containers;
sibling `@sentropic` sources were excluded. The public consumer installed the
artifacts archive and the retained public platform archive, then received only
external tool dependencies. It had no source links to workspace packages.

The packed-example test first failed because the example was absent. Preparation
and purge tests first failed on missing exports; delayed-PUT recovery reproduced
an incorrectly settled inventory before its correction. PostgreSQL tests cover
cleanup winning over finalization, both purge race orders, claim inspection and
exclusion through DELETE, shared-byte retention and fresh preparation after erasure.

`l0-freeze/**`, `src/server/commit/types.ts` and `src/profile/**` are byte-identical
to the base. `make scope-check` passed before every commit; branch verification
and whitespace checks passed. Candidate version remains the integration owner's
reserved 0.2.0; this authoring branch does not publish or qualify Radar-owned gaps.

## Delivery status

Branch `fix/artifacts-861-contract-gaps` is pushed to origin at implementation SHA
`62dc8de0fefcd59ceb833472379535f035550e85` in draft PR
https://github.com/rhanka/sentropic/pull/750 against `feat/immo-861-integration`.
The final receipt/branch commit follows that tested implementation. CI has no
automatic trigger for this base; final delivery dispatches `ci.yml` on the PR
branch and reports the exact resulting head SHA and Actions URL.

Opus r1 regressions failed before their fixes: PostgreSQL query filtering/bounds,
full-download refusal, missing legacy `preparedAtMs`, orphan-first purge and
portable qualification defaults. All now pass. Sweeps prioritize unsettled debt,
limit reads, and retire settled residual checks 60 seconds after the deadline.
Existence checks never download contents; invalid intents remain inspectable
failed debt and cannot repeatedly occupy the cleanup batch.
