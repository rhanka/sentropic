# Fixed finding: CI-LOCK-2026-10-29

On 2026-10-29 at 18:45:50 UTC, four PR runs failed in `cluster-mesh-workspace` while resolving `@aws-sdk/credential-provider-web-identity@^3.972.85`. That version was published at 18:46:26 UTC. The committed root lock contained 3.972.67, but the cold workspace installed an independent registry graph. Earlier Rollup 4.66.0 and `@types/estree` 1.0.10 failures had the same cause. Besides availability failures, these paths admitted newly published transitive code without a reviewed lock change.

| Surface | Frozen input | Enforcement |
| --- | --- | --- |
| Package build, test, lint and publication tools | `scripts/ci/tool-locks.json`, one manifest and complete npm v3 lock per tool profile | `locked-tools.mjs` copies that profile into disposable storage and runs `npm ci`; unknown profiles fail |
| Cold cluster-mesh workspace | Shallow tool profile, including optional peer tooling | Same `npm ci`, preserving nested transitive dependencies and explicit workspace links |
| API, UI, IdP, E2E and mock container installs | Committed root or component lock, including the E2E npm bootstrap lock | `npm ci` only; missing locks fail without an install fallback |
| Storage and comments dependency qualification | Committed `*.package-lock.json` beside each qualification manifest | Copy manifest and lock together, then `npm ci` |
| Installed-consumer qualification | Explicit candidate archives plus registry records from the committed root, selected fixture, tool and historical consumer closure locks (`scripts/ci/consumer-locks.json`) | `locked-consumer.mjs` exposes only these versions and integrity values through `frozen-registry.mjs`; no live registry packuments are queried |
| Executable dispatch | Binaries installed by the preceding locked install | `npx --no-install`; no implicit tool download |

Consumer tests still use npm's real install and peer-conflict behavior, install actual archives, and retain their no-workspace-link assertions. Their exception permits candidate archives, including a post-publication primary whose bytes are integrity-verified before installation. Every other registry version comes from a committed lock. Candidate tarballs are served from the explicit staging directories; retained consumer locks are normalized to candidate files and canonical locked registry URLs so subsequent `npm ci` works after the temporary registry closes. Each solve uses a fresh metadata cache.

This freezes dependency selection and integrity, not registry availability. A locked archive can still be unavailable; the run fails instead of choosing a newer version. Existing image, artifact, SAST and dependency audit gates retain their separate coverage.

`make test-ci-lockfile-installs` runs in the existing always-scheduled manifest validation job. It rejects raw install/exec commands and download-capable npx paths, checks locked version/integrity records, refuses unknown tool profiles, and exercises an actual candidate installation followed by an offline lock replay. Explicit dependency authoring targets (`lock-*`, `install-ui*`, `install-api*` and the existing L5 snapshot mode) are maintenance operations, not CI install paths. Tool lock renewal is explicit through `make lock-ci-tools`; it refuses CI and produces a diff for review. Add a new tool profile's manifest and lock together, then run the guard and the affected package gate.

Validation evidence is recorded in the PR and its exact-head Actions run; no vulnerability suppression is introduced by this finding.
