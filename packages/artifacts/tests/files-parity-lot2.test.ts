/**
 * Files parity LOT 2 — acceptance suite (design-lot2 §A/§B/§D, review r1 binding).
 *
 * (a) Browser upload page: PNG + PDF + WOFF2 fixtures travel browser → S3
 *     only; zero file bytes in any MCP payload; the model retrieves uploadIds
 *     via `artifacts_list_assets {pageSessionId}` and publishes assets-only.
 *     Negatives: token reuse, expired page, foreign-body artifactId, renamed
 *     executable refused 422 with no pin, CSRF origin/header, page quota.
 * (b) `artifacts_list_assets` staged/released/all + page filter + paging;
 *     released listing needs the source right, staged is owner-only.
 * (c) `artifacts_publish_bundle_v2`: copy/carry/keepUnmodifiedPaths, foreign
 *     copy refused, no source right refused, one bad ref commits nothing.
 * (d) `get_source` caps: oversize manifests return omitted entries, prior
 *     successful reads stay byte-identical. HTTP Range: 206/416/ignored.
 * (e) GC: consumed pins unpinned, staged TTL, orphan keys, scope quota race,
 *     metric events without identifier labels. 21 frozen definitions pinned.
 */
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, type ArtifactProviderProfile } from '../src/profile/index.js';
import { checksumHeaderValue, stagingKey } from '../src/server/uploads.js';
import { createHmacUploadPageCookieSigner, createMemoryUploadPageStore, createUploadPageService } from '../src/server/upload-page.js';
import type { ArtifactsMetricEvent } from '../src/server/metrics.js';
import { createTransportWorld } from './fixtures/transport-world.js';

const SCOPE = 'scope-l7';
const CONTROL_ORIGIN = 'https://control.test';
const S3_ORIGIN = 'https://s3.test';
const sha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function seededBytes(seed: number, size: number, header: number[]): Uint8Array {
  const out = new Uint8Array(size);
  out.set(header, 0);
  let x = (seed >>> 0) || 1;
  for (let i = header.length; i < size; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}
const pngBytes = (seed: number, size: number): Uint8Array =>
  seededBytes(seed, size, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdfBytes = (size: number): Uint8Array =>
  seededBytes(11, size, [0x25, 0x50, 0x44, 0x46, 0x2d]);
const woff2Bytes = (size: number): Uint8Array =>
  seededBytes(13, size, [0x77, 0x4f, 0x46, 0x32]);

/** LOT 2 host profile: LOT 1 upload capabilities plus the three new tools. */
function lot2Profile(): ArtifactProviderProfile {
  return {
    ...RADAR_ARTIFACTS_PROFILE,
    selectedCapabilities: ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
      'artifacts_get_source', 'artifacts_create_upload', 'artifacts_commit_upload', 'artifacts_publish_bundle',
      'artifacts_create_upload_page', 'artifacts_list_assets', 'artifacts_publish_bundle_v2'],
    operations: [
      { operation: 'ensure', limits: { bindingNameMinUnits: 1, bindingNameMaxUnits: 128,
        idempotencyKeyMaxUnits: 256 }, defaults: { parameters: {} } },
      { operation: 'publish', limits: { idempotencyKeyMaxUnits: 256, publishFilesMin: 1, publishFilesMax: 32,
        maxDecodedFileBytes: 65536, maxDecodedTotalBytes: 65536,
        releaseFilesMax: 255, releaseFileBytesMax: 16 * 1024 * 1024, releaseTotalBytesMax: 64 * 1024 * 1024 },
        defaults: { profile: {} } },
      { operation: 'list', limits: { listLimitMin: 1, listLimitMax: 100 }, defaults: { limit: 20, offset: 0 } },
      { operation: 'get', limits: {}, defaults: {} },
      { operation: 'list_versions', limits: {}, defaults: {} },
      { operation: 'get_source', limits: {}, defaults: {} },
      { operation: 'revert', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
      { operation: 'create_upload', limits: {}, defaults: {} },
      { operation: 'commit_upload', limits: { idempotencyKeyMaxUnits: 256 }, defaults: { profile: {} } },
      { operation: 'publish_bundle', limits: { idempotencyKeyMaxUnits: 256 }, defaults: { profile: {} } },
      { operation: 'create_upload_page', limits: {}, defaults: {} },
      { operation: 'list_assets', limits: { listAssetsLimitMin: 1, listAssetsLimitMax: 255 },
        defaults: { limit: 20 } },
      { operation: 'publish_bundle_v2', limits: { idempotencyKeyMaxUnits: 256 }, defaults: { profile: {} } },
    ],
    rules: { ...RADAR_ARTIFACTS_PROFILE.rules,
      mimeTypes: ['text/html', 'application/json', 'image/png', 'application/pdf', 'font/woff2', 'video/mp4'] },
  };
}

type World = ReturnType<typeof createTransportWorld>;

function scannedMcp(world: World) {
  const leaks: unknown[] = [];
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (value.length >= 8 && value.every((entry) => typeof entry === 'number')) leaks.push(value);
    } else if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) scan(entry);
    }
  };
  return {
    leaks,
    async invoke(tool: string, args: Record<string, unknown>) {
      scan(args);
      return world.mcp.invoke({ tool, invocation: world.invocation(), args });
    },
  };
}

function unwrap<T>(body: unknown): T {
  return ((body as { output?: unknown }).output ?? body) as T;
}

async function ensureArtifact(world: World, mcp: ReturnType<typeof scannedMcp>, binding: string): Promise<string> {
  const ensured = await mcp.invoke('artifacts_ensure', { bindingName: binding, idempotencyKey: `ensure-${binding}` });
  expect(ensured.status).toBe(201);
  return (unwrap<{ artifactId: string }>(ensured.body)).artifactId;
}

function makePage(world: World, events: ArtifactsMetricEvent[], now: () => Date) {
  return createUploadPageService({
    pages: createMemoryUploadPageStore(now),
    sessions: world.uploadSessions,
    staging: world.uploadStaging,
    signer: world.uploadSigner.signer,
    blobs: world.blobs,
    refs: world.refs,
    idempotency: world.uploadIdempotency,
    cookieSigner: createHmacUploadPageCookieSigner({ secret: 'page-test-secret' }),
    controlOrigin: CONTROL_ORIGIN,
    pageBaseUrl: CONTROL_ORIGIN,
    s3Origins: [S3_ORIGIN],
    profile: { maxFiles: 255, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024,
      mimeTypes: ['text/html', 'application/json', 'image/png', 'application/pdf', 'font/woff2', 'video/mp4'] },
    metrics: { emit: (event) => { events.push(event); } },
  }, { now, ids: () => randomUUID() });
}
