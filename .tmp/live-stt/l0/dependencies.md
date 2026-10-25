# L0 SDK, artifact, toolchain and license inventory

Frozen 2026-10-25 UTC. [Baseline](baseline.md) identifies source commits. Registry observations below are read-only public metadata, never installed packages or runtime qualification. Candidate version freezes are review inputs; no dependency is added by L0.

## SDKs and protocol ownership

| Stage / candidate | Exact observed version; license | Admission decision / owning lot |
|---|---|---|
| Existing mesh/gateway/config | llm-mesh 0.27.1, gateway 0.21.0, cluster-mesh source 0.22.1; MIT | Keep existing custody/routing/dispatch. Mesh has no vendor runtime SDK dependency; speech gets a neutral port, not a new router. L1/L1c/L8. |
| OpenAI TS SDK | `openai@7.43.0`; Apache-2.0; Node >=22 | Candidate only. L9/L10/L11 verify each separate live/transcription/Realtime schema; exact r3 model names remain unverified, with no substitution. Native WebSocket/fetch adapter remains possible. |
| Gemini JS SDK | `@google/genai@2.31.0`; Apache-2.0; Node >=20 | Candidate only. L12 pins Live schema, model profile, async cancellation and usage; no inherited OpenAI event assumptions. |
| Mistral JS SDK | `@mistralai/mistralai@3.3.0`; Apache-2.0; engines unspecified | Candidate only. L13 must verify realtime-v3 and TTS transport/schema coverage; SDK presence does not prove it. |
| Claude agent SDK | `@anthropic-ai/claude-agent-sdk@0.3.310`; `SEE LICENSE IN README.md`; Node >=18 | Conditional L14a alternative to newer h2a runner. License/CLI redistribution and exact streaming interrupt/hooks remain G-CLAUDE/G-LICENSE; never label it MIT. |
| Nova transport | `@aws-sdk/client-bedrock-runtime@3.1156.0`; Apache-2.0; Node >=20 | Unadmitted optional route under G-AWS; exact model, region and price absent. |
| Second local streaming/TTS candidate | `sherpa-onnx-node@2.0.0`; Apache-2.0 package | Unadmitted; individual FR/EN acoustic models and voices have separate licenses, digests and native requirements. |
| h2a transport/native CLI | Remote runtime 0.98.7 MIT; `ws ^8.20.1`, `node-pty ^1.1.0` in manifest | Ranges are not qualified artifact pins. Existing h2a namespace/launch owner supplies exact lock, CLI version/schema and native installation receipts. No new PTY addon in speech. |
| Local first implementation | `faster-whisper-ts@1.2.1`; MIT; Node >=20 | Local source frozen; isolate synchronous inference in a worker. Requires the native inventory below before admission. |
| Second local implementation | ggml-org/whisper.cpp native C/C++ or WASM | Source revision/library protocol/artifact digest not yet qualified. Do not confuse the unrelated npm name `whisper.cpp` with a vetted ggml build. L3b remains conditional. |
| Local TTS | eSpeak NG, candidate 1.52.0, GPL-3.0 family | Exact shipped artifact/license text/voices to verify. Native executable and WASM linking/distribution assessed separately. Browser candidate withheld until G-LICENSE. |
| Browser/device transports | AudioWorklet/getUserMedia/workers; Node native helpers to qualify | No browser-native ASR/TTS default; helper/version/platform not frozen as admitted. L4/L17/L21 need explicit manifest entries. |

Registry `.dist.integrity` freezes for the six external SDK candidates, in the table's order (OpenAI through sherpa):

```text
openai@7.43.0 sha512-fBjKaDFG8AVfkGYoIo/E+xNRlNk7nx2nQ9GoQtXfePzPjg4QcT6nejkhXayJnEwSpFGfthOrAPI2KXj5yAqg9A==
@google/genai@2.31.0 sha512-u1fw0qEiuWwNcjZixJFRfQF0awQnHb/rBBQUeiYGF+nmTXQCvcgpR2UMhKU9KNdnZdYhahY5jwS6nJ2V2tGtDA==
@mistralai/mistralai@3.3.0 sha512-b5NSkQ8lFBxwZfA4Vj5oHxs7Jw7VrZRI2E9g95sigQiTi3NsQ//o6y3nDXjKUPWjksfagjH3STEFCYBg19SMvg==
@anthropic-ai/claude-agent-sdk@0.3.310 sha512-fo+sr+9Ks73P001f6XKRQlyzfIBAJMgXArLUkH5Tu98NikRDZeGtFQVj23d5/hj2ijpFgzffrr4fHywY9qUkoQ==
@aws-sdk/client-bedrock-runtime@3.1156.0 sha512-YtYsel8aoGP0K//ZO4qqgab6W/wYKHL+8MiWE4Z2SKKWz7MbVWMfUKKySdAle5RcE1yTviRF2RMlXE5MVPW/mA==
sherpa-onnx-node@2.0.0 sha512-c/FGNV77jNWENxReoMrL3LCPGQFP4nV/B1uWqqx5pC2gUEkfu3Wxa9B9NLjt9qrC0xe/57JgamkZyvAeI2Wifw==
```

Source: `https://registry.npmjs.org/<name>/latest`, fetched 2026-10-25; future admission must request the exact version, verify tarball integrity, license contents and SBOM. Registry metadata licenses do not certify transitive/model/voice redistribution.

## faster-whisper install/build inventory

| Component | Observed source / lock | Decision and missing evidence |
|---|---|---|
| Postinstall | `package.json`: `npm run build:native`; `scripts/build-native.js` invokes `cmake -S ... -B ...`, then `cmake --build ... -j` | Static call chain contains no interpreter. Current parallel build is unbounded; build owner must bound jobs within locked ENV compose execution. No installer executed in L0. |
| Native bridge | `whisper_bridge/CMakeLists.txt`: CMake >=3.14, C++17, only vendored include/lib search, rpath relative to bridge | Does not rebuild CTranslate2. Missing original .so provenance cannot be cured by rebuilding the bridge alone. |
| Koffi | Exact lock 2.15.6, MIT; install `node src/cnoke/cnoke.js -P . -D src/koffi --prebuild` | Prefetch the matching prebuild or qualify CMake path and every child process. Do not allow fallback to node-gyp or an undeclared download. |
| ONNX Runtime | Exact lock 1.24.3, MIT; postinstall `node ./script/install` | Public script metadata defaults Linux x64 to CUDA12 NuGet downloads. A CPU qualification must explicitly skip that path and prove bundled CPU binaries suffice. |
| FFmpeg | Manifest includes `@ffmpeg/core ^0.11.0`, `@ffmpeg/ffmpeg ^0.11.6`, util ^0.12.2; source also uses system FFmpeg | Pin the actually executed binary/build flags; LGPL/GPL codec/linking implications require exact build notices, not the wrapper's license. |
| Silero VAD | Vendored `assets/silero_vad_v6.onnx` | Hash below; upstream origin/revision and model license/notice still required. |
| Whisper tiny | Fetch helper uses `Systran/faster-whisper-tiny@d90ca5fe260221311c53c58e660288d3deb8d356` | Helper checks file presence, not content digest; it can copy an unverified cache or download. Do not run it for admission; replace provisioning with verified manifest consumption in the owning lot. |
| Whisper base | Required second model, no revision/digest supplied by inspected helper | Unadmitted until its converted artifact source, per-file digests and license are frozen. Never reduce M1 to tiny. |

Static skip-path proof: `onnxruntime-node@1.24.3/script/install-utils.js:236` reads `ONNXRUNTIME_NODE_INSTALL`; `install.js:66` exits when parsed flag is false (`skip`). For the proposed CPU bundle set `ONNXRUNTIME_NODE_INSTALL=skip` and retain verified bundled CPU libraries. This proves the script branch only. **No offline install/build/inference proof exists**, so the current bundle is rejected for runtime admission until G-NATIVE passes. Safely skipping a download is not proof that a missing binary has been supplied.

Installer source receipts fetched as text from `https://unpkg.com/onnxruntime-node@1.24.3/script/`, never executed:

| File | SHA-256 |
|---|---|
| `install.js` | `4c97bb4a70454c18caea9217cc5da39a35e4e53ea6ee8454ed864fdabfc46b2d` |
| `install-utils.js` | `b8890f3eb40b50b5e4ca61d6b6b328d017660319ee326ca3db00709de1218579` |
| `install-metadata.js` | `2cfbb2fcf1f170d5da564c0be3222821050bcbd282c9e0493e9433649ac2f130` |

## Local artifact receipts

Hashes cover the actual local bytes at the source HEAD in [baseline](baseline.md). They identify observations, not licensed upstream provenance or signatures.

| Relative to faster-whisper checkout | SHA-256 | Admission |
|---|---|---|
| `whisper_bridge/lib/libctranslate2-5a650b64.so.4.7.1` | `f67d1930f3f832e7530b3d8c8bb18fcadf9ae7e5f68032a1f4efc5b5acedb56c` | Linux x86_64 only; original URL/extraction/build receipt missing; CTranslate2 MIT source notice exists |
| `whisper_bridge/lib/libgomp-e985bcbb.so.1.0.0` | `a43904e4fa297301d4640dc1bb3c8a3480b406f99e498eba9b1914b68aab604a` | Origin and exact GPL/runtime-exception notice to establish; cannot infer it from CTranslate2's MIT file |
| `assets/silero_vad_v6.onnx` | `914fd98ac0a73d69ba1e70c9b1d66acb740eff90500dfde08b89a961b168a6a9` | Model provenance/license pending |
| `scripts/build-native.js` | `d090af6dee2f4fb2adc7226344ebe34aac159aa12249f5a68aca3dc3981a8a66` | Matches newer upstream script; no origin claim for bundled .so files |

The possible wheel origin of the .so files remains unverified. Require original immutable URL/digest, extraction recipe and notices, or rebuild CTranslate2/libgomp from pinned sources under the same gate. A binary obtained from a wheel need not require an interpreter at runtime; that observation does not waive provenance.

## Permitted toolchain boundary and release blockers

Permitted path: Node >=22 for the frozen SDK set, TypeScript, CMake/C++17 and qualified native/WASM artifacts; CPU Linux x86_64 is the first experiment. GPU, Windows and macOS have separate manifests/receipts. Existing host C++/FFmpeg presence is not a qualification environment; host CMake/eSpeak were not found in the inspection.

No image/VM digest or exact compiler/SDK bundle has been supplied, so **no toolchain is admitted**. Muse and the build/security owner must freeze image/VM digest, Node/compiler/CMake/ONNX/Koffi versions, SBOM and artifact manifest before L3/L4. Candidate compiler minimums above are constraints, not immutable pins. A newly required build target belongs to the build owner; never use ad-hoc Docker or install on the host.

The receipt must prove absent `python`/`python3`, no interpreter or node-gyp process, bounded build jobs, deny-network installation/build and representative STT/TTS/device execution after controlled digest-checked provisioning. It must cover clean installs, not only already-populated node_modules. Failure leaves the tuple unavailable or selects a separately qualified artifact; there is no exception to the zero-Python requirement.

eSpeak NG native aggregation is not approval to embed its GPL WASM in the MIT application. Freeze license/version/voice/build materials and distribution boundary with rhanka's build/license lane; if incompatible, name and pin a compatible local WASM TTS replacement before L17. No such cleared replacement was supplied at L0; browser-local TTS remains a visible open gate, with no implicit network-backed substitute.
