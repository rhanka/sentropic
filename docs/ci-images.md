# CI toolbox and production API

CI builds two images from `api/Dockerfile`. Only `production` ships. Its default
command is `node dist/index.js`; the same image serves the standalone IdP with
`node apps/auth-idp/dist/index.js`. API boot runs the database migrations. The
runtime filesystem contains neither npm/npx, their global npm dependency tree,
nor the root npm cache.
The inherited build layers still contain build tooling; this change removes it
from the runtime filesystem rather than redesigning the production base stage.

The `ci-tools` target contains npm, development dependencies, source tests, built
workspace packages, Playwright and system Chromium. It never becomes the deployed
API image. `docker-compose.ci.yml` keeps its source API and the production SUT in
separate services without mounting the checkout over either workspace.

| Existing CI suite | Runner | Server under test |
| --- | --- | --- |
| API unit, queue, AI, security, artifact-store, object-registry, outbox, four endpoint shards | Toolbox | Source API in toolbox where needed |
| API smoke and limit matrix entries | Toolbox | Production `api-sut` over HTTP |
| Restored database smoke | Toolbox | Production `api-sut`, booted after restore |
| IdP screen smoke | Toolbox Chromium/Playwright | Compiled production `auth-idp` |
| E2E and VSCode E2E | Existing E2E runners | Production API |

The API matrix keeps its 15 entries. Smoke and limit run once as their existing
matrix entries. IdP and restore retain their separate existing jobs; CI does not
add a duplicate source run of these suites.

## Cache

`make api-tool-version` hashes tracked and non-ignored source inputs, paths and
contents, including Dockerfile, workspace manifests/lockfiles, test tooling and
the browser dependency lockfile. CI caches `api-tool-image.tar` under an exact
OS/content-tag key, with no fallback key. A hit loads the archive and skips build
and save. A miss uses `make build-api-tool-image`, which first reuses a local tag,
then tries the registry tag, then builds. `make publish-api-tool-image` exists for
authorized registry reuse; this branch does not publish it automatically.

Source changes invalidate the toolbox because it embeds source. An unchanged
checkout reuses it; this is not a dependencies-only cache. Base-image updates
under a mutable tag do not invalidate the input hash. Updating base tags or an
explicit cache-key version is required when refreshing those images.

## Production identity and tag-collision guard

Build/save records Docker's immutable image config ID in
`.tmp/ci-prod-image/api-image-id`, transported alongside `api-image.tar`. Load
rejects a canonical tag whose ID differs from the receipt. Compose and the API
container scan use that ID when present. E2E, VSCode and publication always load
the current workflow's API artifact, rather than substituting a registry image.
Production tag inputs include API migrations and compiled IdP/screen sources.

Publication (`make publish-api-image` / `scripts/publish-api-image.sh`) verifies the
receipt and inspects the remote registry manifest (`docker manifest inspect`) before pushing:
- **Absent**: If the target tag does not exist in the registry (identified strictly by an exact, case-sensitive missing-manifest signal on inspect stderr), publication proceeds normally.
- **Exists with identical digest**: If the tag exists and its remote config digest matches the local artifact (`API_IMAGE_REF`), push is skipped idempotently without re-pushing or overwriting.
- **Exists with different digest (collision)**: If the tag exists and points to a different config digest, publication immediately FAILS with a non-zero exit code and an explicit collision error. Immutable release tags must never be overwritten.
- **Registry inspect error**: Any other inspection failure (such as credential helper, network, or authorization failures) fails closed and halts publication.

This provides local artifact/config identity, not a complete OCI manifest digest or a deployed Pod imageID proof. Registry digest receipts, registry-enforced immutable tags and deployment evidence remain follow-ups. Clear the generated receipt when intentionally returning a checkout to tag-based use.

Because remote registries may lack native immutable tag enforcement, an inspect-then-push sequence contains an inherent time-of-check to time-of-use (TOCTOU) window. In CI, this window is serialized by the GitHub Actions concurrency group `concurrency: api-image-publication` in `.github/workflows/ci.yml`.

### Content-addressed tag format whitelist vs moving tags

- **Immutable release tags**: Canonical content-addressed tags (`API_VERSION` hashes) represent immutable production releases. `scripts/publish-api-image.sh` strictly enforces a format whitelist requiring exactly 6 lowercase hexadecimal characters (`^[0-9a-f]{6}$`). The collision guard prevents overwriting existing tags with different digests and ensures idempotency when tags already exist with matching digests.
- **Moving / alias tags**: Pointers such as `main`, `latest`, `staging`, or `v1` must NOT be published through `publish-api-image.sh` and are rejected by the 6-hex format whitelist. The `main` alias is promoted directly from the verified local ID via `make publish-api-main-image` without re-pulling.

### Historical incident context

Tag collision detection was initially introduced in commit `ec018720d` ("ci: carry the qualified API artifact through E2E and publication") to guard against artifact drift. The guard has been formalized into `scripts/publish-api-image.sh` and regressed mechanically via `make test-ci-api-tag-guard` (`scripts/test-api-tag-guard.sh`) to guarantee idempotent skipping on matching digests, strict rejection on mismatching digests, failsafe closure on inspection or network errors, and explicit moving tags semantics.

## Local checks and security

Use disposable `ENV=test-*` or `ENV=e2e-*` only. CI startup and restore targets
reject other environments. For this branch, pass
`API_PORT=9491 UI_PORT=5691 MAILDEV_UI_PORT=1591 ENV=test-ci-prod-image-sut` last,
with inert provider configuration and a local registry value.

`make up-api-test-ci` starts the cached source API. For a production HTTP suite,
use `make up-api-sut test-api-smoke API_TEST_CI=1 API_TEST_SUT=1` with the same
environment arguments. Limit uses `DISABLE_RATE_LIMIT=false`; startup translates
this to an empty application switch because the application treats nonempty
strings as disabled. The runner still receives `false` and executes enforcement
assertions. IdP uses `make up-idp-sut smoke-idp-screens-ci`, with an HTTPS callback
and a fresh user in the disposable fixture. Restore uses
`make restore-api-sut verify-api-sut-restart test-api-smoke-restore` with
`BACKUP_FILE=<dump basename> API_TEST_CI=1 API_TEST_SUT=1`.

API and toolbox scans both use the existing HIGH/CRITICAL compliance gate via
`make test-api-security-container` and `make test-api-tool-security-container`.
Scan failures remain blocking for both production and toolbox images; no severity
change or vulnerability-register exception is introduced.
Use `make down-api-ci` to stop this branch's stack.

The toolbox rebuilds its legacy esbuild 0.19.12 and 0.18.20 binaries with pinned
Go 1.26.7, retaining the existing Node interfaces. Only the rebuilt binaries are
copied from the compiler stage. Bundled npm ip-address/pacote receive their fixed
versions. `make test-ci-api-tool-runtime` verifies npm/npx and executes TypeScript
transforms through both esbuild Node interfaces on cache hits and fresh builds.

`make test-ci-api-tooling` regresses the empty registry reference, quiet cache
fallback and `tools/` hash invalidation with a controlled Docker command stub.
`make test-ci-api-runtime` checks the recorded production artifact for CLI,
global npm tree and cache absence. Both checks run in CI before qualification.
