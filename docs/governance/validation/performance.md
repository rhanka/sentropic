# Portable Chromium performance — 2026-10-21

Baseline: clean `222d7c106`, branch verified and pulled. Final application: `910110efb`; portable SHA-256 `7aa3bcea29c476e744a0e39ecbc49a1c1c527be5a757ea80c4507116b4de9876`.
Playwright 1.63 Chromium, offline `file://`, 1920×1080, same host. Three tabs load concurrently. Load ends at a visible diagram and ready fonts; expansion follows. Values below are per tab; ranges cover all three tabs. Other host workloads affect wall times.

| Scenario | Load ms before → after | Long-task total ms before → after | JS heap MB before → after | Idle task ms / 10 s before → after |
| --- | --- | --- | --- | --- |
| One tab, collapsed | 248 → 161 | 146 → 63 | 9.72 → 9.71 | 0.95 → 1.00 |
| One tab, expand all | 389 → 182 | 298 → 70 | 9.88 → 9.40 | 1.08 → 0.98 |
| Three tabs, collapsed | 373–378 → 164–165 | 108–122 → 62–65 | 9.69–9.72 → 9.65–9.69 | 0.74–1.03 → 0.74–0.99 |
| Three tabs, expand all | 209–215 → 176–183 | 98–107 → 71–73 | 9.77–9.85 → 9.40–9.55 | 0.95–1.15 → 0.97–1.18 |

Single-tab initial breakdown before → after: HTML parse **30.57 → 28.62 ms**, script **122.28 → 58.67 ms**, layout **16.67 → 10.81 ms**, paint **2.09 → 2.08 ms**. Layout count: **17 → 3**. Script CPU uses CDP Performance metrics; parse/paint use timeline events. Long tasks include the requested expansion; heap is used heap after settlement, without forced GC; MB is decimal.
Connected DOM nodes / SVG namespace elements: **925 / 186** collapsed and **2,203 / 535** expanded, unchanged. DOM element counts are 326 / 998; CDP totals including detached/internal nodes are 1,405 / 3,102. The supplementary `node-counts.json` uses a tree walker and namespace filtering; the earlier trace reports' `svgNodes` field counts SVG descendants, including foreignObject HTML.
Across all four scenarios, idle application script, animation-frame callbacks and ResizeObserver callbacks are **zero**, before and after. Measured main-thread task CPU stays below **0.012% per tab**; renderer process CPU is **0–0.2% before, 0–0.1% after** over ten seconds. The owner's continuous idle saturation was not reproduced on the baseline.
Portable size: **1,688,830 → 1,655,159 bytes**. Historical owner-feedback images are absent from both portable files and checked by the regression.

Worst complete-matrix click: **766 → 380 ms** (600 interactions each). Worst separate 120-change-per-language stress click: **1,479 → 341 ms** (240 interactions each). All existing **1,800 ms** deadlines remain unchanged. An intermediate build still expired at French change 24; it was rejected before the final viewer correction.

CPU profiles identified visibility-grid scans, repeated label measurement, frame sizing and viewer fitting. The fix sweeps grid intervals with identical adjacency, bounds text/route caches, ships prepared navigation instead of constructing unused source scenes, defers the closed viewer SVG, batches/idempotently writes control geometry, coalesces sizing onto one requested frame, and updates only the active SVG while the modal is open. Closing restores the current inline scene. Viewer dimensions refresh on opening and resize.

Verification: **102 scenes / 732 edges**, zero geometry failures; **240 identical full folded-scene SHA-256 comparisons**; **16 screenshots with zero changed pixels**, desktop/mobile, FR/EN, light/dark; source/content checks pass, including 32 slides and 52 needs. The shipped file loads its title and visible diagram without console errors or network requests. Both final stress campaigns pass.
New `check-performance` joins `validate`: four offline scenarios, bounded load/heap, unchanged expansion deadline, ten-second idle script/task limits and zero recurring frame/resize callbacks. No persistent polling is added to the application.

Reproduce from `docs/governance/kit`: `make check-source check-geometry check-browser check-performance check-content ENV=test-governance-contract`.
To profile the shipped file: `make check-performance PROBE_MOUNTS='-e PERF_ARTIFACT=/inputs/governance-r11-portable.html' ENV=test-governance-contract`.
Local raw evidence: `kit/.cache/performance-{before,after}.json`, matching timeline traces, load/fold CPU profiles, `browser-{before,after}.json`, `stress-{before,final}.log`, `folds-{before,cached}.json`, `node-counts.json`, and `visual-diff.json`. These diagnostic artifacts are ignored; delivery checksums cover the committed report, source and portable.
