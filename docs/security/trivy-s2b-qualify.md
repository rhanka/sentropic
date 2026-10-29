# Trivy S2b qualification: NOT QUALIFIED

Observed 2026-10-29, from `origin/main` `c37662a208a19ae12377d1a0aec2c7610c4bc0aa`, branch `feat/sec-s2b-qualify`. The daily auto-fix service remains OFF. Scanner/verifier admission is denied by actual HIGH/CRITICAL findings. No activation commit is appropriate. S2c native SAST and S3 custody remain separate gates.

The [receipt index](sec-s2b-qualify/files.json) identifies 77 public source records with SHA-256, original byte size and the hash of the published JSON value. JSON is minified into concern-specific bundles; text is preserved as JSON strings. Full all-severity reports, findings, package inventories, source identities and diagnostics are retained. Registry credentials are absent. These are dated observations, not perpetual admission or claims of a clean scan.

## Verdict per blocker

| Blocker | Verdict | Evidence / exact missing input |
| --- | --- | --- |
| Independent image admission | **STILL BLOCKED** | [Self-scan](sec-s2b-qualify/self-scans.json): 1 CRITICAL, 2 HIGH, 1 MEDIUM, 22 LOW, 5 UNKNOWN. CRITICAL `CVE-2026-111497` in `brotli-libs 1.2.0-r1`; HIGH `CVE-2026-92392` in `libcurl 8.22.0-r0` and `CVE-2026-116587` in `go-jose/v4 v4.1.5`. Required: a reviewed replacement image pin with these findings resolved and independent content admission. No scanner or severity is removed. |
| Independent verifier admission / offline trust | **STILL BLOCKED**; offline cryptographic trial **CLOSED** | [Verifier report](sec-s2b-qualify/self-scans.json): 2 CRITICAL, 60 HIGH, 65 MEDIUM, 5 LOW, 4 UNKNOWN. Includes `CVE-2025-68121` in Go 1.25.1 and `CVE-2026-33186` in gRPC 1.75.1. Required: a patched native verifier with frozen reviewed hash and independent dependency/root-custody admission. [Offline verification](sec-s2b-qualify/toolchain.json) returned `Verified OK` with networking disabled. Independent review selection remains [unavailable](sec-s2b-qualify-review.md). |
| Zero-Python inventory | **CLOSED** for the exercised qualification chain | [Toolchain](sec-s2b-qualify/toolchain.json): complete scanner filesystem/APK inventory, 375 Trivy and 281 Cosign Go dependency entries, native binary hashes and compiler versions. No Python interpreter, pip, libpython or site-packages match. [Sandbox probe](sec-s2b-qualify/performance.json) finds no Python executable in the pinned Node runtime. Target scanner process/mount inventories are retained in each target bundle. This does not admit S2c or a future builder. |
| Java sizing / acquisition / compatibility | **CLOSED** for this snapshot and bounded fix | [Acquisition](sec-s2b-qualify/acquisition.json): real download, archive listing, ingestion and hash-checked restoration. [Positive control](sec-s2b-qualify/java-control.json): offline `rootfs` scan detects `CVE-2021-44228` in real Log4j 2.14.1; debug log confirms local Java DB use. Effective Java freshness expires 2026-10-30T01:08:14Z under the 24-hour limit, even though upstream NextUpdate is later. |
| IaC rules / complete adaptation | **STILL BLOCKED** | [Frozen bundle](sec-s2b-qualify/acquisition.json) loads offline from `/cache/policy/content`; [report](sec-s2b-qualify/iac.json) detects zero Compose configuration files. A zero-result report is refused. Required: qualified native coverage for the declared Compose/Makefile surfaces, frozen rule inventory and positive/negative controls, plus complete per-document report adaptation. A successful Dockerfile scan cannot stand in for these surfaces. |
| Three immutable main targets | **STILL BLOCKED**; authenticated archive trials **CLOSED** | [API](sec-s2b-qualify/target-api.json), [toolbox](sec-s2b-qualify/target-api-tool.json), [UI](sec-s2b-qualify/target-ui.json): source/config/platform/archive hashes and all six cold/warm reports. API/UI registry configurations differ from the CI archive configurations; toolbox tag returns `no such manifest`. Required: three current canonical main image manifests whose immutable digest/config/platform match trusted source-SHA producer receipts, with an independently established expected result inventory. |
| Failure / expiry handling | **CLOSED** at the S2b validation boundary | [Twelve trials](sec-s2b-qualify/safety.json): actual network cut, actual TCP 429 exhaustion (three requests to a controlled server), unknown source, missing cache, wrong receipt, actual one-byte DB corruption, incompatible scanner, actual expired upstream metadata, future-clock expiry replay, changed comparison snapshot and two rollback refusals. Original trusted DB/receipt bytes were restored and verified. Future-clock replay is explicitly labelled; no live merger integration is claimed. S6 must consume these guards. |
| Scanner isolation | **CLOSED** for archive execution; isolated rebuild **STILL BLOCKED** | Read-only root/DB/target write attempts fail; no daemon socket or credentials enter scanner containers. Actual commands, process lists, environment **names**, mounts, network mode and resource limits are retained. Required for rebuild: an admitted isolated builder/runner with no shared daemon or secrets. The pinned Node probe has neither Docker nor BuildKit. No image rebuild occurred. |
| Cold/warm, remote/rebuild and CI performance | **STILL BLOCKED** | Measurements below. Anonymous immutable remote scan refuses access in 619 ms; this is a refusal measurement, not scan throughput. Required: successful remote scanning with a target-scoped pull route, successful isolated rebuild measurements and a full comparable CI critical path ≤600 s. The sampled successful main run takes 685 s from first job start through `ci-gate`. |
| Rollback | **CLOSED** to the permitted blocked S2a state | [Safety receipt](sec-s2b-qualify/safety.json) retains previous main policy bytes and verifies that both that policy and the current execution guard refuse admission. No previously qualified runtime exists to restore; no activation or qualified-runtime rollback is claimed. |

## Frozen runtime and signature trial

The scanner remains Trivy 0.76.1, index `sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c`, platform manifest `sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df`. Exported native binary SHA-256 is `d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83`; Go build info reports `go1.27.3`. Cosign 3.0.2 was independently downloaded and matched to frozen SHA-256 `46dbdcb5467a3dfec2526923d0b3365e40c8d9dc00ec23d5aca3437449e8cbfd`; it embeds `go1.25.1`.

The retained OCI referrer is a DSSE in-toto statement whose subject is the exact index hash. Cosign's image `verify` subcommand does not accept `--bundle`; that attempted command was rejected. The successful command uses `verify-blob-attestation --offline --bundle ... --trusted-root ... --type https://sigstore.dev/cosign/sign/v1 /evidence/index.json`, exact issuer `https://token.actions.githubusercontent.com` and exact identity `https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1`. It runs in the already pinned Node image with `--network=none`, no home/auth mounts and no insecure verification bypass. Bundle/root/index bytes and hashes are retained. Roots originate from the prior S2b acquisition; this trial does not independently admit their custody or the verifier.

## Measured Java fix

| Measurement | Observed value |
| --- | --- |
| Compressed Java layer | 991,026,356 bytes |
| Expanded Java archive | 1,565,823,119 bytes; exactly DB + metadata regular files |
| Transfer / native archive listing | 86.364 s / 10.875 s |
| Measurement Node maximum RSS | 86,364 KiB; excludes native tar child RSS |
| Production ingestion / warm hash-checked restoration | 161.154 s / 5.046 s |
| Combined ingestion Node maximum RSS | 107,172 KiB; container limit 512 MiB, one CPU |
| Vulnerability DB ingestion / restoration | 53.231 s / 2.953 s |

The proposed policy caps Java at 1,280 MiB compressed and 2 GiB expanded, with a 120-second request limit and a 180-second network acquisition budget. Vulnerability data retains its 512 MiB compressed / 4 GiB expanded bounds and original request limits. Each data kind owns its clock so concurrent acquisitions cannot reset each other's budgets. Java may use at most 3.25 GiB for retained layer + expanded files; allocate vulnerability data separately. Archive decoding retains its existing per-process timeout. Hashing and extraction are streamed/native, never whole-archive buffering. Tests reject oversized Java/vulnerability descriptors and shared-clock leakage. All scanners/severities and fail-closed behavior remain intact.

The vulnerability manifest is `sha256:19b5d8a057520ec1b57fb0a1b5f0a1e11f856df2e8e83a3aa1b467093d0b094f`; Java is `sha256:4be191027485ae0e63bac27a7b1d5095e023625f5406d5082e5b9b757b702d96`. The full receipts include layer/file hashes, source metadata hash, schema, observed/download/update/next-update times and scanner compatibility. Trust remains allowed TLS origin + OCI integrity + trusted ingestion receipt; no DB publisher signature is asserted.

## Target and performance observations

The three archives come from successful image producer jobs in main [run 40832206894](https://github.com/rhanka/sentropic/actions/runs/40832206894), source `213638676730b25154e5fb4fda333f74da1980a3`, a verified ancestor of this branch's main base. The overall run failed; producer success is not reported as green full CI. These are historical main artifacts, not proof of current-main canonical remote identity. Compressed archive hashes were checked against authenticated Actions producer receipts; extracted configuration hashes/platforms and decompressed archive hashes are retained separately.

| Archive | Config digest prefix | Uncompressed bytes | Cold / warm scan wall time | Observed results |
| --- | --- | --- | --- | --- |
| API production | `8f455d1ffcbd` | 780,615,680 | 1.849 s / 1.855 s | Alpine + Node; 23 findings |
| API toolbox | `d83c5127af61` | 1,555,647,488 | 4.105 s / 4.124 s | Alpine, Node, four Go binaries, Cargo SBOM; 65 findings |
| UI production | `2d8732f6d58c` | 225,195,520 | 1.591 s / 2.112 s | Alpine; zero findings |

Every run uses a new container and memory scan cache. “Cold/warm” here means first/repeated archive scan with the same DB and host page cache conditions; it is not a cold registry transfer or a retained Trivy analysis-cache hit. Scanner image pull was 7.41 s initially, 0.55 s repeated; the pinned manifest lists 63,450,019 compressed layer bytes. Docker stats are point samples, not peak memory. Reports preserve all severities and no register suppression. Expected inventories shown here are observations, not an independently admitted completeness baseline.

Remote API config `42c3002b184a...` differs from archive `8f455d1ffcbd...`; remote UI config `bcbc7d9130a5...` differs from archive `2d8732f6d58c...`. Remote manifest digests observed are `7ed81ad51e2ee52b39d9bdc1ee6269b499977a8b52d37a6ebc9633400dc95c7c` and `77685984ead620a8777584c9cda6694b235f9d01a7522f0b42ba513525167b89`. No provenance is transferred between these unequal artifacts. Operator registry credentials were used only in a temporary host Docker config, removed on exit; they were never mounted into scanner containers.

Baseline [CI receipts](sec-s2b-qualify/ci.json): successful main run `40855831033` starts its first job at 10:34:07Z and completes `ci-gate` at 10:45:32Z: **685 s**, above 600 s. The initial workflow-to-first-job queue is 1,242 s; maximum per-job runner queue 388 s, sum 1,813 s (parallel queues are not additive wall time). Artifact-producing run `40832206894` takes 4,733 s from first job to failed gate; maximum job queue 1,741 s. These differently filtered DAGs are not a controlled before/after comparison. Final exact-head PR CI is linked in the PR validation receipt, separately from these historical baseline samples.

## Reproduction and validation

Hold `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` for Docker work, run from the qualification worktree, and run `make down ENV=test-sec-qualify` afterwards. Targets live in `scripts/security/daily/qualify.mk` and are opt-in experiments. No application ports or services are needed.

```text
make security-qualify-measure KIND=java ENV=test-sec-qualify
make security-qualify-image security-qualify-acquire ENV=test-sec-qualify
make security-qualify-signature ENV=test-sec-qualify
make security-qualify-measure KIND=checks ENV=test-sec-qualify
make security-qualify-targets ENV=test-sec-qualify
make security-qualify-scans security-qualify-java ENV=test-sec-qualify
make security-qualify-ancillary ENV=test-sec-qualify
make security-qualify-remote ENV=test-sec-qualify
make security-qualify-failures SECQUAL_EXPIRED_METADATA=<retained-expired-metadata.json> ENV=test-sec-qualify
make security-qualify-receipts ENV=test-sec-qualify
make test-security-daily test-security-parser ENV=test-sec-qualify
```

Inputs for target/signature reproduction are the dated Actions archives and retained prior S2b public signature material; the scripts name them explicitly. `security-qualify-targets`, `security-qualify-ancillary` and `security-qualify-remote` exit nonzero for the evidenced blockers. They must not be treated as successful qualification. The failure target intentionally mutates one private cached DB byte and its receipt, then restores and verifies original bytes in `finally` blocks; never run it against a shared/admitted cache.

Final local checks passed: 125 daily security tests; all 17 security parser cases; shell syntax checks. The archive adapter now accepts a report without `RepoDigests` only when preparation established a process-local proof after verifying archive bytes, and rechecks archive integrity after execution. Unprepared/cloned JSON, wrong config IDs and changed artifact types remain rejected. The policy's qualification/admission flags and service switch remain false. No toolbox Dockerfile, scheduler, merge workflow or activation commit is changed.
