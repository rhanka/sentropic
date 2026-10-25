# Artifacts #861 contract gaps candidate receipt

- Candidate: `@sentropic/artifacts@0.2.0`; pack only, no publication.
- Base: `origin/feat/immo-861-integration` at `082fe4c60`.
- Packed source/documentation: `ac19bd960`; subsequent changes affect qualification and branch records only.
- Archive: `tmp/contract-gaps/sentropic-artifacts-0.2.0.tgz` in this worktree.
- SHA-256: `fb03b9c4da9d9b64cbc471efa36699c4ae60233bc336d672335af1af4e0709f2`.
- Integrity: `sha512-d0hfOahVwN6Bmdk38K+EPZ/D0wKwHZTI3mFgVsbshsxYtDjuqiLcNdL9T05IoCeAjJoqjw7DgYnrXiv1hQG8ag==`.

## Verification

Every Docker/test command used `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`
and the existing `docker-compose.immo-861.yml` qualification service, with
`ENV=test-861-gaps` last. `make down` removed the isolated stack between steps.

The following targets use `make -f packages/artifacts/probe/contract-gaps.mk`:

| Target | Result |
| --- | --- |
| `offline-build` | Platform/artifacts build and frozen contract type compilation passed. |
| `offline-unit` | 437 tests passed, 35 files, zero skips. |
| `offline-integration` | 171 PostgreSQL/MinIO integration/E2E tests passed, 12 files, zero skips. |
| `offline-packed` | Exact archive installed in a fresh consumer; shipped example and public API type fixture compiled. |
| `offline-lint` | Recommended TypeScript ESLint rules passed, zero errors/warnings. |

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

Push was attempted through make and failed during GitHub TLS negotiation. HTTP/1.1
and TLS 1.2 checks failed, the GitHub connector transport was unavailable, and
existing SSH authentication was refused. The completed local branch has not been
pushed; draft PR creation and CI inspection remain pending external connectivity.
