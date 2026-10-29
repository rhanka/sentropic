# Trivy S2b: hardened option B preparation

Qualification follow-up: [live trials, bounded Java fix and per-blocker verdicts](trivy-s2b-qualify.md). The current image/verifier candidates are denied admission by real HIGH/CRITICAL findings; service remains OFF.

This is an unqualified preparation lane. The daily service remains disabled, S2a still emits incomplete coverage, and no scheduler or automatic merger is introduced. The owner has not answered the dossier; its stated default authorizes preparing B while preserving qualification blockers. No toolbox Dockerfile is changed.

The binding dossier is `dossier-r2.md`, SHA-256 `b4de75e7e2d5bca48ea1d9571c797d65c0e9262259c54d772a57f2f81c9817a1`, in the conductor's `.tmp/dossier-trivy-s2b/`. The approved plan is `.tmp/daily-sec-fix/spec-plan.md` r4. Dependencies [S1 #732](https://github.com/rhanka/sentropic/pull/732) and [S2a #786](https://github.com/rhanka/sentropic/pull/786) are merged and ancestors of this branch's base `213638676`.

## Frozen source identities

The author retrieved the following from Docker Hub's registry API on 2026-10-29, hashing the raw response bytes before parsing. The checked-in policy is `.security/trivy-toolchain.json`; neither a release checksum fetched at runtime nor a valid signature can substitute a different image.

| Object | Reviewed author pin |
| --- | --- |
| Repository | `aquasec/trivy` |
| OCI index | `sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c` |
| `linux/amd64` manifest | `sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df` |
| Platform config | `sha256:ac7fdaf3e1f1442ec467a00d1ec900bc8dc20f694d172b11ff43d32f83162fb6` |
| Version and source revision | `0.76.1`, `e713f67f7d54decdcd9b3132c9751833dcced698` |
| Compressed platform layers | 63,450,019 bytes, from manifest descriptors; transfer/runtime cost unmeasured |

The index contains exactly one `linux/amd64` descriptor matching the pinned manifest and its size. The manifest links the pinned config and four compressed layers. The config's version, revision and platform agree with [tag v0.76.1](https://github.com/aquasecurity/trivy/tree/v0.76.1). GitHub's release API reports the release immutable, published 2026-10-21. No release archive is installed in B.

Author review also checked these live source advisories:

- [GHSA-mcj4-mphf-j9ff](https://github.com/aquasecurity/trivy/security/advisories/GHSA-mcj4-mphf-j9ff): OCI artifact path traversal affects versions below `0.71.1`. The prepared scanner exceeds that minimum. Acquisition ignores artifact titles, uses fixed filenames and rejects unsafe archive paths and links before extraction.
- [GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23): compromised release credentials published malicious `0.69.4`; the current advisory also records malicious Docker Hub `0.69.5`/`0.69.6`. Publisher signatures and release immutability do not establish safe content. These candidate pins require independent content/runtime review and ongoing scanner vulnerability tracking before admission.

## Signature evidence and its limits

The upstream [signature guide](https://github.com/aquasecurity/trivy/blob/v0.76.1/docs/getting-started/signature-verification.md) permits a broad workflow identity expression. This preparation narrows it to:

```text
issuer: https://token.actions.githubusercontent.com
identity: https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1
```

Cosign `v3.0.2` native Linux amd64, downloaded from the Sigstore GitHub release and matched to frozen SHA-256 `46dbdcb5467a3dfec2526923d0b3365e40c8d9dc00ec23d5aca3437449e8cbfd`, verified the exact index successfully with those constraints. Its log reports claims, transparency-log inclusion and certificate-chain verification. The verification-output SHA-256 is `1016520d86ff108a739c63a450f7df844bee83e17211977d4cefd370f426c078`.

Docker Hub publishes two Sigstore bundle referrers for this index. The legacy `.sig` tag returns 404; absence of that tag is not signature absence. The retrieved bundle layer hashes are:

```text
sha256:e32151ef4929d001118616a1448426b6816c02605d3e7dcd956ecea6d5232a98
sha256:00a4a3296848d3040423117cf0cead81b40b75aa3a3b9e01319ee486d79c3eb9
```

Raw index/manifest/config bytes, bundles, verifier hash/version, verification result, advisory/release responses and cached Sigstore roots are retained in the conductor's `.tmp/sec-s2b-evidence/`. They contain public upstream material. The platform manifest has an attestation referrer, without a separate image signature observed; policy requires the signed-index-to-platform link and does not invent a second signature requirement.

This is an author cryptographic observation, not verifier admission. The Cosign release is not marked immutable by GitHub; its verifier supply chain, retained trust material, offline verification and independent review remain open. No Cosign image, installer action or new third-party workflow action is introduced.

## DB acquisition and sandbox contract

Only `ghcr.io/aquasecurity/trivy-db:2` and `ghcr.io/aquasecurity/trivy-java-db:1` may supply vulnerability data. The separately declared IaC source is `ghcr.io/aquasecurity/trivy-checks:1`, still unqualified. There are no mirrors. Caller flags, PR configuration and `TRIVY_*` environment variables do not enter acquisition. Registry tokens are anonymous read-only tokens; blob redirects permit only GHCR's HTTPS delivery host without forwarding the token.

Each campaign resolves each data kind once, including failed acquisition. It verifies the manifest and streamed layer hashes, extracts only the two expected regular files, bounds expanded bytes, checks schema and UTC dates, and publishes the cache by atomic directory rename. The receipt preserves origin, manifest/layer digests, source metadata hash, local file hashes, schema, scanner compatibility and observation/download/update/next-update dates. Restoration rechecks every file against the trusted receipt hash. Cache roots must be private and separate from candidate-writable data.

Freshness requires `UpdatedAt <= DownloadedAt <= now <= NextUpdate` and an update age of at most 24 hours. Before/after comparisons carry the same immutable snapshot receipts; expiry before merge requires both inputs rescanned with fresh data. OCI integrity plus allowed TLS origin is the established DB guarantee; no DB publisher signature is claimed.

The author exercised real acquisition on 2026-10-29. The vulnerability DB passed ingestion and restoration with manifest `sha256:5fc850fb746fbaa2b4e80698ca587653f318c2cf91eaf5a14f7f1a1e9d4573a6`, layer `sha256:dbbd9bf4fbe51bd9d84eec11237105dcdf50ddb35652ebbfdea38f51a57b1ecd` and local DB `sha256:ad47d4d7f64fb08225e3d0c9f59118e724ecf82a14d5502fff71c742d6cb24b4`. Its next update is 2026-10-30T01:22:22Z; this dated observation is not reusable after expiry. Receipt SHA-256: `39ad944fd5a3cf5d24949e90e4547ea1799201de9ffed5cab1fca81fa2cd43db`.

Java acquisition correctly refused the live 991,026,356-byte compressed layer against the prepared 512 MiB layer bound. No Java bytes were downloaded, no bound was silently raised and no coverage was declared. The conductor must qualify Java's compressed/expanded disk, memory and transfer costs and review an appropriate bound, or prove this surface inapplicable, before image execution. The preparation command exited nonzero as designed and its environment was torn down.

Acquisition has three attempts, 30-second request bounds and a 120-second shared budget. `429`/`5xx` honors bounded `Retry-After`; an excessive or malformed delay stops. There is no switch to a floating scanner tag or another repository. Valid cached snapshots can support local archive scans without acquisition; missing, corrupt, stale or incompatible bytes fail closed.

Prepared image plans use the platform digest, `--pull=never`, non-root execution, dropped capabilities, a read-only root, bounded resources and read-only DB/target mounts. They expose no Docker socket, auth home, writer/provider token or caller environment. Remote scans require immutable target/source-SHA/platform provenance from a trusted main-CI resolver; archive scans also verify the archive hash and use `--network none`. Updates, version checks and telemetry are disabled explicitly. All severities remain in raw reports; wrong targets, incomplete expected result inventories, concatenated JSON and process errors are rejected. Real archive/report identity compatibility still needs qualification.

Java DB is mandatory in the preparation API until applicability is proven; it is never silently disabled. IaC remains explicitly blocked rather than using embedded or downloaded replacement rules. `executeImageScan` refuses execution against the checked-in unqualified policy. This API is for a trusted supervisor, not a candidate-supplied JSON admission interface; S3 must qualify receipt custody and immutable-target discovery before integration.

## Operator commands

Run from `tmp/worktrees/sec-s2b`, under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, then run `make down ENV=test-sec-s2b`. No application stack or host ports are needed.

```text
make security-daily-trivy-status ENV=test-sec-s2b
make security-daily-trivy-prepare ENV=test-sec-s2b
make test-security-daily ENV=test-sec-s2b
make test-security-parser ENV=test-sec-s2b
```

Status and preparation intentionally exit nonzero and emit `coverage-blocked`, even if DB ingestion succeeds. The prepare target uses the existing pinned Node image and a separate host cache volume. It does not execute Trivy, publish reports, activate the service or change qualification flags.

## Remaining qualification evidence

| Gate | Evidence still required; owner: conductor unless stated |
| --- | --- |
| Scanner/verifier admission | Independent content and dependency inventory of the exact image and verifier, zero-Python runtime proof, trusted verifier/bundle/root custody and actual offline verification |
| DB and ancillary coverage | Fresh production DB receipts, DB trust-level admission, Java sizing/acquisition or evidenced non-applicability, frozen IaC rules and complete report adaptation |
| Targets | Three canonical main images, immutable digests with trusted source-SHA/platform receipts, complete raw all-severity output, scanner-image vulnerability inventory |
| Failure handling | Real network-cut and rate-limit cases, cache absent/corrupt/stale/incompatible, malicious source/config, expiry before merge and snapshot-change pair invalidation |
| Isolation | Runner process/mount/credential inventory; isolated rebuild fallback with no shared daemon or secrets |
| Performance | Cold/warm bytes, extraction, DB refresh, remote scan and rebuild measurements; full CI critical path to `ci-gate` at most 600 seconds, runner queue separately |
| Rollback | Restore a previously qualified scanner/runtime/policy and still-fresh compatible DB; until any set is qualified, return to the explicitly blocked S2a state |
| Service activation | S2c native SAST, S3 collector/custody and subsequent approved plan gates; current service stays off |

Fixture success and green PR CI establish implementation checks only. They cannot mark any missing gate qualified. A future admission must be a reviewed trusted-policy change with exact evidence, not a runtime boolean or environment override.
