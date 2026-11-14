# VD-2.0 spike evidence

**Not qualified. D12 is open. This branch is a diagnostic spike, not a compile service.**

The requested exit gate has not been met. Successful probe execution must not be
read as approval of the sixteen-question gate or of any live latency criterion.
The production code and deployment configuration are unchanged. Only disposable
measurement pods used the alternate CPU settings.

## Reproduce

Run from `e2e/tests/harness` through the repository's `docker-slot.sh`:

```sh
make prepare API_PORT=9360 UI_PORT=5560 MAILDEV_UI_PORT=1460 ENV=feat-v8-spike
```

Then, from `packages/cluster-mesh/tests/compile-spike`, run `make bundle probe adapter export ENV=feat-v8-spike`
through the same slot wrapper. From the harness directory run
`make test-e2e API_PORT=9360 UI_PORT=5560 MAILDEV_UI_PORT=1460 ENV=feat-v8-spike` through the wrapper.
The compiler bootstrap must exist before compiler-worker tests. The committed
tool lock and image digest freeze the local tools. Install scripts are disabled.
The prerelease Vue pin does not satisfy the DS package's stable `^3` peer range;
`--legacy-peer-deps` is confined to these diagnostic tools and preserves that pin.
No application or compiler bundle is fetched from a public CDN at runtime.

## Sixteen-question ledger

| Q | Observed result | Evidence and remaining requirement |
|---|---|---|
| 1 | Real addon loads in deployed sentropic API image, Node v24.22.1; Python, g++ and make absent at checked runtime paths | Image `sha256:a81f6db4db6ecd5f4c8aad05ca01c8bb13b5c4542c40118ea48b897ab4971c26`. Existing named immo kubeconfig returns Unauthorized; deployed immo image unverified. Local immo image cannot resolve addon from `/workspace`. Both-host exit condition remains open |
| 2 | Shared browser compiler/Sucrase bundle executes in the real addon and actual SandboxRuntime for S/M/L | `bootstrap.mjs`, `packages/skills/tests/sandbox/v8-spike.mjs`; cold adapter probes N=1 per fixture are feasibility checks, not latency qualification. Full host/class memory and cold/warm matrix remains open |
| 3 | Disposal interrupts loops of real parse/script/template/style/TypeScript work | `cancel-probe.mjs`, `evidence/cancel.json`: N=20 per stage, monotonic host clock from dispose through rejection. This does not prove the adapter's whole-request deadline or AbortSignal behavior |
| 4 | Exact serialized output equality between real addon and all three browser workers for S/M/L; four NFC witnesses equal | `00-v8-compiler.spec.ts`; N=1 per fixture/engine. No claim of exhaustive Unicode equality; ASCII path restriction stays |
| 5 | Relative rolled-up `.d.ts` resolves through virtual `fileExists/readFile`; bare package type import is refused by browser compiler | `evidence/compiler-probe.json`. A package-name map alone is insufficient: the host/linker must expose relative virtual type paths. DS delivery format is not frozen by this partial spike |
| 6 | MapLibre 6.4.1, 6.14.0 and PDF.js 4.10.38 start real same-origin workers in Chromium/Firefox/WebKit; no blob worker, fake-worker warning or CSP violation observed | `00-v8-preview.spec.ts`: 6.4.1 shared relative module fetched; 6.14.0 worker is self-contained; document import-map control refused. Frame control observes actual frame-src refusal. Rendered map/PDF and isolated opaque-origin cause are not qualified |
| 7 | Correct/altered import-map integrity responses are recorded per engine under hashed inline import map and exact application headers | `00-v8-delivery.spec.ts`. Inspect `alteredRefused` in browser evidence; probe success does not imply integrity support. Separate preload-SRI control remains open |
| 8 | Published DS 0.39.0 closure is 1,919 files, 3,771,592 bytes, plus three shell files | `closure.mjs`, `evidence/closure.json`; static inventory N=1, no duration percentiles. Exceeds 255 files, below 64 MiB. Analysis bundling is not shipped; preview serves original modules. New per-component DS publication is a separate prerequisite |
| 9 | JS stylesheet import removal, package @import rewriting, relative font URLs and cascade witness match Vite in three engines on MapLibre/Inter fixture | `00-v8-css.spec.ts`. Actual DS themes 0.12.0 reference build is separately refused by Vite/lightningcss (`Invalid token in pseudo element`, orphan `color-scheme` declaration). No CSS fix or disabled minifier hides this refusal |
| 10 | Pinned development runtime rerenders and recreates S/M Vapor components without bundler in all engines, under Vapor and classic parents | `hmr-server.ts`, `00-v8-hmr.spec.ts`: sibling survives rerender and classic-parent recreation; Vapor-parent recreation resets it. N=20 per case is diagnostic, not required N=200 acceptance. Full own/child state witnesses, child registerHMR slowdown and resolution-corrected latency gate remain open |
| 11 | Browser SFC compiler contains CSS parser and runs caller PostCSS declaration pass | `evidence/compiler-probe.json`: visited declaration, red becomes blue, no errors |
| 12 | Sucrase strips type imports and preserves JSON assert attribute | `evidence/compiler-probe.json`. This alone does not make assert syntax browser-loadable. Real workspace graph resolution, JSON module rewrite and four geo source entry graphs remain open; no production linker is claimed |
| 13 | Retained S/style misses target at 500m and with verified unlimited quota; 21 block-edit cases match fresh whole-SFC output | Performance table below and `evidence/compiler-probe.json`. S/M/L full cold/fresh/retained matrix, two-session application graph memory, snapshots and d2-4 repeat remain open. Node flavor read denied to tenant account |
| 14 | Three browser workers execute same bootstrap on all three fixtures and match bytes | `00-v8-compiler.spec.ts`; cold/warm N=200 latency series remain open, no worker-latency PASS |
| 15 | Pre-armed imports evaluate after held responses, including a 12-second direct-origin hold, in all engines | `00-v8-delivery.spec.ts`: short series N=20, long hold N=1. Actual consumer edge renewal and announcement-path comparison remain open; no infinite-wait guarantee is inferred |
| 16 | Page clock resolution sampled under unchanged headers in each engine | `00-v8-delivery.spec.ts`; crossOriginIsolated is recorded. Region/Montréal per-hop transit, ping uncertainty, MCP request construction and durable draft-store round trip remain unmeasured; no cross-clock subtraction or synthetic per-hop numbers |

## D12: measured compile miss

Host image and Node are those of Q1. The disposable pod has 512 MiB memory.
`performance.now()` is the monotonic host clock. Each sample includes the addon
invocation, compile, result copy and return; 20 warm-ups are discarded, followed
by 200 edits on a 250 ms cadence. The scope/path is fixed at `Fixture.vue` in
these bounded fixtures; this is not a general-purpose memo-key implementation.

| Effective cgroup CPU | State / fixture | N | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---:|---:|---:|---:|---:|
| `50000 100000` | retained S/style | 200 | 1.680124 | 4.267401 | 9.488460 | 16.683764 |
| `50000 100000` | fresh context S/style | 200 | 198.442660 | 283.331325 | 291.639788 | 297.659968 |
| `10000 100000` | retained S/style | 200 | 1.775663 | 5.359485 | 103.038036 | 201.988467 |
| `max 100000` | retained S/style | 200 | 1.765661 | 3.952055 | 7.570029 | 21.873388 |

The retained S/style criterion is p50 ≤0.5 ms and p95 ≤1.5 ms: **FAIL** at
500m and at verified unlimited quota. Fresh-context data is outside the warm-live
claim and receives no warm-live verdict. Omission of a CPU limit originally
triggered namespace admission's 100m default; that series is preserved under
its actual effective budget, not labeled unlimited. Explicit zero CPU quantities
produced `cpu.max = max 100000` in the final disposable pod.

Bootstrap durations are separate in the raw records (N=1 retained startup;
N=200 for fresh contexts). Resident memory is a post-series observation, not
application-graph session-capacity evidence. The measurements use the real addon
directly for context lifecycle comparison; actual SandboxRuntime feasibility
has its separate cold probe. No claim equates an unadapted runtime with a warm pool.

No criterion is widened. No render, hook, registration or wait is deducted from
the whole page interval. The required owner decision remains pending; increased
CPU alone is not demonstrated to resolve this miss. Do not advance the gated
compile stage or claim the VD-2.0 exit gate on these results.

Page diagnostics are also above the replacement budget: Chromium M/Vapor reload,
N=20, p50=9.4 ms and p95=10.1 ms before adding its 0.1 ms clock resolution.
Firefox and WebKit have a measured 1 ms clock step; Chromium has 0.1 ms.
All three refused the altered import-map integrity control. These are local-host
diagnostics, not regional N=200 gate results. Raw marks and every case's percentiles
are retained in `evidence/browser.json`; no successful test label excuses the misses.

## Handoff and cleanup

- s-conductor, designated Track writer: import `BRANCH.md`, attach D12 evidence,
  retain the unopened D13 profile/sum decisions, and assign the unresolved ledger
  requirements before accepting VD-2.0. No concurrent `.track` write was made.
- k8s owner: provide node flavor and coordinate a d2-4 repeat; acceptance is the
  same frozen series with effective cgroup resources recorded, without wider targets.
- i-cond: restore the named kubeconfig or provide a verified deployed MCP image
  receipt; acceptance is real addon load in that image with no build toolchain.
- DS conductor: review imported-type virtual paths, closure file count and malformed
  published theme; acceptance is a pinned browser closure and successful unchanged Vite baseline.
- Test pods are deleted after evidence collection; no shared pod resource settings
  are changed. Local Docker tools use only this lane's volume and disposable containers.
