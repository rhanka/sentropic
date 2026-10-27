# @sentropic/live-speech

Local speech-to-text registry adapter (r3 L3). A rolling-window session drives an
isolated `worker_threads` worker that hosts the real faster-whisper engine; unit
tests inject scripted fakes through the same port. No microphone, no paid API,
no audio in logs — only sample counts, revisions and text cross the seam.

## Layout

- `src/node/local-stt.ts` — session: energy-gated endpointing, one final per
  utterance, word-anchored overlap stitching, bounded window decodes in flight
  (`maxInflightWindows`, default 1).
- `src/node/utterance-buffer.ts` — sample accumulation and rolling windows.
- `src/node/reconciler.ts` — committed-hypothesis stitching with overlap dedupe.
- `src/node/worker-port.ts` — `NodeWorkerClient` transport over `worker_threads`.
- `src/node/device.ts` — OS audio-device port; `ArecordDevice` spawns the vetted
  `arecord` binary with an explicit argv (no shell), S16_LE stdout to frames.
- `src/node/capture.ts` — mic session: mic-off default, mute independent of VAD,
  dBFS level meter, bounded mailbox with drop counter, device-loss auto-close.
- `src/node/terminal-control.ts` — key controller on its own TTY: toggle (`m`),
  explicit on/off (`[`/`]`), immediate stop (`s`); push mode fails closed
  without a qualified hold source; never forwards keys, restores raw mode.
- `src/node/profiles.ts` — independently pinned `local-tiny` / `local-base`.
- `src/node/engines/faster-whisper.mjs` — the real engine behind the worker.
- `bench/` — session-level bench plus §8.1 receipts.

## Profiles and pins

Each profile pins its own engine version, Hugging Face origin/revision/license,
model directory name, the SHA-256 of every loaded model file, and the engine's
Silero VAD asset. The model directory resolves from the selected profile and is
hash-checked before the worker reports ready; any mismatch fails closed. L3
endpoint VAD is the frame-energy gate; the Silero asset is pinned for later lots.

## Tests and bench

- `make test-live-speech ENV=test-stt-l3` — typecheck plus vitest (node env).
- `make bench-live-speech OUT=<receipt>` — bench lane in the pinned image; a
  measured row needs the qualified host provisioning from `bench/` receipts.

UNPUBLISHED — npm publication deferred to Lp0/Lp1.
