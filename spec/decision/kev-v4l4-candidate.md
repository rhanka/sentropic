# Kev V4-L4 local native candidate

Owner decision, 2026-10-28: L4-A, Kev Q8_0 executed locally using native llama.cpp. The module remains in `@sentropic/llm-mesh/decision`; hosting and filesystem custody belong to its host. No Python, conversion, remote inference or new package is involved.

## Immutable inventory and provenance

The machine-readable source is `scripts/decision/kev-manifest.json`. The library's `KEV_INVENTORY` binds the exact model and runtime tuple into the compilation/schema/execution digests and evaluator revision.

| Component | Pin and evidence |
|---|---|
| Model | `ggml-org/Kev-4B-GGUF` at `f4624b6bb7072f1bab726a622c1cad3f96030b9e`, `Kev-4B-Q8_0.gguf`, 4,483,801,504 bytes |
| Model SHA-256 | `7c2ebed90560522c2801389db482ac1dc4c36d828f201f6074c1d60e433948da` |
| Model licence | Apache-2.0, as declared by the immutable model card; source adapter `jaredpalmer/kev-4b`, base `Qwen/Qwen3.5-4B-Base` |
| Conversion | Model card names `ggml-org/convert`; exact conversion commit and exact source/base revisions remain unverified |
| Runtime | `ggml-org/llama.cpp`, release `b11954`, source `f1a7dea99aae1623bad10c4ce31fe220033ab7f6`, MIT |
| Distribution | Upstream `llama-b11954-bin-ubuntu-x64.tar.gz`, Linux x64 CPU, 22,644,804 bytes |
| Archive SHA-256 | `9e43757438fe70dee5ca759c718bf0b17df7760916c3714092a3a63e22e11fbc` |
| Server SHA-256 | `d198b4a5156c34279cf75346451d2e17acafa8188edee4d00e3042a727f01259` |
| Server implementation SHA-256 | `e9617b6f102a7301dd9b417726e6972234b6fa68e02b14b9874f689abfd8ba7a` |

The provisioning target re-reads the immutable HF LFS pointer and GitHub release metadata, verifies their declared tuple, verifies downloaded bytes, and compares extracted runtime file contents against the verified archive. GitHub's release digest identifies the publisher's archive; an independent build attestation, reproducible build and complete compiler/toolchain provenance are unverified. The archive's MIT notice stays beside its binaries. This release qualification does not transfer an audit of the existing application stack to llama.cpp.

Sources: [immutable HF LFS pointer](https://huggingface.co/ggml-org/Kev-4B-GGUF/raw/f4624b6bb7072f1bab726a622c1cad3f96030b9e/Kev-4B-Q8_0.gguf), [immutable model card](https://huggingface.co/ggml-org/Kev-4B-GGUF/blob/f4624b6bb7072f1bab726a622c1cad3f96030b9e/README.md), [runtime release](https://github.com/ggml-org/llama.cpp/releases/tag/b11954), [pinned System One contract](https://github.com/ggml-org/llama.cpp/blob/f1a7dea99aae1623bad10c4ce31fe220033ab7f6/tools/server/README.md#post-v1systemone-typesafe-compatible-system-one-api).

## Transport, identity and admission

The fixed endpoint is `http://127.0.0.1:8797/v1/systemone`. No caller endpoint, redirect, retry, fallback, chat generation or CLI route is available. The dedicated adapter advertises evaluator discovery only and must be explicitly placed in the host registry and exact evaluator allowlist. The host supplies `KEV_LOCAL_API_KEY` through its existing environment-token custody port; the native process accepts a temporary key file.

The host's `verifyInventory(signal)` port attests actual local model bytes, native binary/runtime provenance, process ownership and configuration. Supplying the exported tuple without inspecting the host is insufficient. Before and after the single POST, the transport validates that attestation and exactly one `/v1/models` entry with the pinned served ID and native `decisions` modality. The native response must independently name the same model. An absent or different identity, filename, revision, hash, quantization or runtime refuses evaluation. A single-model server ignoring the request's `model` field cannot select a different artifact through this transport.

The smoke verifier hashes the actual model and native server/library, verifies the owned process command line and its mapped model inode, and binds all of that to the inventory. This requires a trusted local host; the HTTP alias is not cryptographic remote attestation. The receipt's served evaluator/model is reconstructed only after adapter and host validation. Experimental receipts explicitly carry provisional identity.

Binary, choice and graded compilation uses the pinned System One question contract and the existing native distribution validator. There is one named question, no generated prose score, no scalar repair and no explanation. The native discriminator, exact choice domain, level legend, probabilities, expected score and provider counters remain binding. Raw native payloads are not exposed.

## Execution and cost bounds

The qualified runtime recipe fixes CPU execution, one parallel slot, 2,048 context tokens, four inference/batch threads, 512 batch/microbatch tokens, zero GPU layers, disabled context shift, no prompt-cache RAM and no web UI. The library admits at most 8 KiB of combined state/question and 256 KiB total request JSON. Native over-context errors are refused without truncation or retry. Responses, including inventory, are capped at 64 KiB; one deadline covers verification, inventory, execution and response consumption, with at most 60 seconds per library call. Cancellation fences late egress even if an injected port ignores its signal.

The contract's disabled cache denotes library response caching. The pinned native runtime retains active-slot KV prefix reuse; `--cache-ram 0` disables idle-slot prompt-cache storage. The smoke log records that reuse on its second question. No retention or zero-retention guarantee follows from this recipe; stopping the owned process ends its active slot lifecycle.

Local accounting requires a host-authoritative positive bounded `call-rate` tariff with zero token rates. No default price or claim of free compute is supplied. The host must price its bounded local allocation, including attributable hardware, energy and operational costs. Admission, durable dispatch marking, settlement and receipt persistence remain the existing host's responsibilities. The smoke uses an explicitly synthetic 100 micro-USD call tariff and a process-local ledger solely to exercise protocol accounting; neither establishes a deployment compute price nor qualifies financial durability.

## Opt-in local procedure

All make invocations use `ENV=test-decision-l4` last and ports `API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097`. Run container checks/builds under `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`; the two local targets acquire that same lock internally. Never wrap these two self-locking targets in another flock.

1. `make decision-kev-provision API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097 ENV=test-decision-l4`
2. `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make build-llm-mesh API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097 ENV=test-decision-l4`
3. `make decision-kev-smoke API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097 ENV=test-decision-l4`
4. `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make down API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097 ENV=test-decision-l4`

The cache is shared across worktrees at `/home/antoinefa/src/sentropic/tmp/cache/decision-v4l4`; the model occupies one file. Provisioning never deletes unrelated cache entries. Local targets reject `CI`/`GITHUB_ACTIONS` and any other environment. The smoke refuses occupied ports, owns one native process with a 180-second lifetime cap, makes at most three typed attempts, removes its own temporary credential and stops its own process on exit. Node executes the integration client in an ephemeral Docker container; llama.cpp itself runs as the native host binary. Fixtures cover CI without downloading weights or running inference.

## Local evidence, 2026-10-28

Model/source/archive checks passed. A first attempted call failed before POST because the sandbox PID namespace hid the native process from Docker; separate custody-only diagnostics then exposed the host ptrace restriction on memory mappings. The host now answers fresh nonce-bound mapping checks itself, while the client verifies process arguments and actual file hashes. These diagnostics performed no inference. The two remaining authorized attempts succeeded with independently persisted experimental receipts:

| Kind | Input/output tokens | End-to-end latency, including repeated artifact hashing | Served identity |
|---|---|---|---|
| Binary | 27 / 0 | 5,060 ms | `kev-q8-7c2ebed90560522c-b11954` |
| Choice | 30 / 0 | 5,151 ms | `kev-q8-7c2ebed90560522c-b11954` |

Both receipts have one attempt, settled synthetic call accounting and provisional evaluator identity; neither call was truncated. Native process high-water RSS was 4,669,472 KiB (about 4.45 GiB); it had 39 total threads including server workers, with four configured inference/batch threads. This is a two-call protocol smoke, not a throughput or quality benchmark. Graded native decoding is fixture-tested against the pinned documented contract; no extra native graded attempt was made. The owned native process and temporary credential were removed, and `make down` completed.

Raw local evidence stays in the ignored cache: `smoke-results.json`, `resource.txt`, `server.log`, `release.json`, `model-lfs.txt`, `runtime-sha256.txt` and `verified-manifest.json`. The first failed-attempt evidence is represented in this record; the current smoke-results file holds the two successful receipts. Full library validation passed 90 test files / 1,569 tests, plus typecheck, lint and build. P26–P28 are deterministic fixtures, including wrong file/revision/hash/quantization/runtime, post-dispatch inventory changes, changed execution scopes and absent allowlists.

## Qualification and update policy

The shipped catalogue descriptor remains unqualified and has no accepted served IDs. A verified local tuple can enable only an explicit experimental composition via `createKevQualificationDescriptor`. Contract/identity smoke results do not establish criterion calibration, task quality, production readiness, retention guarantees or measured compute pricing. L5 gates and the L6 held-out human-labelled campaign remain required.

The runtime host owner monitors upstream releases and security notices. An update is a new immutable model/runtime tuple: review the source/release diff and notices, verify provenance, pin all bytes and settings, re-run protocol, identity, wrong-selection and resource checks, and re-run affected calibration before promotion. Never use an auto-updater, mutable tag or on-demand model substitution. Preserve the previously validated tuple and artifact for rollback. A source build is a separate candidate requiring pinned build image/tools/dependencies, CMake options, logs and output digests; it cannot inherit this release-binary qualification.
