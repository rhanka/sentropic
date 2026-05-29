/**
 * @sentropic/cowork-desktop — Sentropic Cowork desktop binary library.
 *
 * Public surface:
 *  - `capability/*`  — DesktopCapabilityProvider seam + mock + Windows provider.
 *  - `consent/*`     — per-tool default-deny consent model (over the bridge schema).
 *  - `tools/*`       — screen_capture (eyes) + input_action (hands) executors,
 *                      and the consent-gating `runDesktopToolCall` dispatcher.
 *  - `enroll/*`      — device-code enrollment client.
 *  - `registry/*`    — presence registry client (desktop_cowork).
 *  - `storage/*`     — Node file-backed StorageAdapter + ConsentStore.
 *  - `runner/*`      — CoworkRunner gluing the SSE round-trip to the tools.
 *
 * Real eyes/hands run on Windows only (BR-41a Lot 4 ships Linux-buildable +
 * mock-testable; native verification is UAT). Packaging is Lot 5.
 */

export * from './capability/index.js';
export * from './consent/index.js';
export * from './tools/index.js';
export * from './enroll/index.js';
export * from './registry/index.js';
export * from './storage/index.js';
export * from './runner/index.js';
