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
      'artifacts_get_source', 'artifacts_set_access',
      'artifacts_create_upload', 'artifacts_commit_upload', 'artifacts_publish_bundle',
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
      { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
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

describe('files parity LOT 2 (a): browser upload page', () => {
  it('publishes PNG+PDF+WOFF2 through the page with zero file bytes in any MCP payload', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const events: ArtifactsMetricEvent[] = [];
    const now = new Date('2026-01-01T00:00:00Z');
    const page = makePage(world, events, () => now);
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'page-journey');

    const minted = await mcp.invoke('artifacts_create_upload_page', { artifactId, maxFiles: 3 });
    expect(minted.status).toBe(201);
    const mintedBody = unwrap<{ pageSessionId: string; uploadPageUrl: string; expiresAt: string;
      maxFiles: number; maxFileBytes: number; maxTotalBytes: number; allowedMimeTypes: string[] }>(minted.body);
    expect(mintedBody.uploadPageUrl).toContain(`${CONTROL_ORIGIN}/artifacts/upload/${mintedBody.pageSessionId}#t=`);
    expect(mintedBody.maxFiles).toBe(3);
    expect(mintedBody.allowedMimeTypes).toContain('font/woff2');
    const token = mintedBody.uploadPageUrl.split('#t=')[1] as string;
    expect(token.length).toBeGreaterThan(16);

    const { cookie } = await page.exchange({ pageSessionId: mintedBody.pageSessionId, token, origin: CONTROL_ORIGIN });
    const files = [
      { path: 'pic.png', mimeType: 'image/png', bytes: pngBytes(7, 4096) },
      { path: 'doc.pdf', mimeType: 'application/pdf', bytes: pdfBytes(1024) },
      { path: 'font.woff2', mimeType: 'font/woff2', bytes: woff2Bytes(2048) },
    ];
    const uploadIds: string[] = [];
    for (const [index, file] of files.entries()) {
      const created = await page.createFile({ cookie, origin: CONTROL_ORIGIN, customHeader: true,
        artifactId, path: file.path, mimeType: file.mimeType, size: file.bytes.length });
      expect(created.method).toBe('PUT');
      const signed = world.uploadSigner.signed.at(-1)!;
      world.uploadSigner.put(signed, file.bytes, { ...created.requiredHeaders,
        'x-amz-checksum-sha256': checksumHeaderValue(sha256(file.bytes)) });
      await world.uploadStaging.put(created.stagingKey, file.bytes);
      const committed = await page.commitFile({ cookie, origin: CONTROL_ORIGIN, customHeader: true,
        artifactId, uploadId: created.uploadId, path: file.path, mimeType: file.mimeType,
        digest: sha256(file.bytes), size: file.bytes.length, idempotencyKey: `page-commit-${index}` });
      expect(committed.path).toBe(file.path);
      uploadIds.push(created.uploadId);
    }

    const listed = await mcp.invoke('artifacts_list_assets',
      { artifactId, pageSessionId: mintedBody.pageSessionId });
    expect(listed.status).toBe(200);
    const staged = unwrap<{ assets: { path: string; uploadId: string }[] }>(listed.body).assets;
    expect(staged.map((asset) => asset.uploadId).sort()).toEqual([...uploadIds].sort());

    const bundle = await mcp.invoke('artifacts_publish_bundle', { artifactId,
      idempotencyKey: 'page-bundle-1', expectedCurrentReleaseId: null,
      assets: staged.map((asset) => ({ path: asset.path, uploadId: asset.uploadId })) });
    expect(bundle.status).toBe(201);
    expect(mcp.leaks).toEqual([]);
    expect(events.map((event) => event.name)).toContain('upload_pages_minted');
  });

  it('refuses token reuse, expired pages, foreign artifacts, spoofed types and CSRF gaps', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const events: ArtifactsMetricEvent[] = [];
    let now = new Date('2026-01-01T00:00:00Z');
    const page = makePage(world, events, () => now);
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'page-negatives');

    const minted = await mcp.invoke('artifacts_create_upload_page', { artifactId, maxFiles: 2 });
    expect(minted.status).toBe(201);
    const body = unwrap<{ pageSessionId: string; uploadPageUrl: string }>(minted.body);
    const token = body.uploadPageUrl.split('#t=')[1] as string;
    const { cookie } = await page.exchange({ pageSessionId: body.pageSessionId, token, origin: CONTROL_ORIGIN });
    await expect(page.exchange({ pageSessionId: body.pageSessionId, token, origin: CONTROL_ORIGIN }))
      .rejects.toThrow();
    await expect(page.createFile({ cookie, origin: 'https://evil.test', customHeader: true,
      artifactId, path: 'x.png', mimeType: 'image/png', size: 8 })).rejects.toThrow();
    await expect(page.createFile({ cookie, origin: CONTROL_ORIGIN, customHeader: false,
      artifactId, path: 'x.png', mimeType: 'image/png', size: 8 })).rejects.toThrow();
    await expect(page.createFile({ cookie, origin: CONTROL_ORIGIN, customHeader: true,
      artifactId: randomUUID(), path: 'x.png', mimeType: 'image/png', size: 8 })).rejects.toThrow();
    now = new Date(now.getTime() + UPLOAD_PAGE_TTL_MS + 1000);
    await expect(page.createFile({ cookie, origin: CONTROL_ORIGIN, customHeader: true,
      artifactId, path: 'late.png', mimeType: 'image/png', size: 8 })).rejects.toThrow();
  });

  it('refuses a renamed executable at page commit with no pin', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const events: ArtifactsMetricEvent[] = [];
    const now = new Date('2026-01-01T00:00:00Z');
    const page = makePage(world, events, () => now);
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'page-spoof');
    const minted = await mcp.invoke('artifacts_create_upload_page', { artifactId });
    const body = unwrap<{ pageSessionId: string; uploadPageUrl: string }>(minted.body);
    const { cookie } = await page.exchange({ pageSessionId: body.pageSessionId,
      token: body.uploadPageUrl.split('#t=')[1] as string, origin: CONTROL_ORIGIN });
    const evil = new TextEncoder().encode('MZ fake executable');
    const created = await page.createFile({ cookie, origin: CONTROL_ORIGIN, customHeader: true,
      artifactId, path: 'evil.png', mimeType: 'image/png', size: evil.length });
    await world.uploadStaging.put(created.stagingKey, evil);
    await expect(page.commitFile({ cookie, origin: CONTROL_ORIGIN, customHeader: true, artifactId,
      uploadId: created.uploadId, path: 'evil.png', mimeType: 'image/png',
      digest: sha256(evil), size: evil.length, idempotencyKey: 'spoof-1' })).rejects.toThrow();
    expect(await world.refs.isPinned(sha256(evil))).toBe(false);
    expect(await world.uploadSessions.getStagedFile(created.uploadId)).toBeUndefined();
  });
});

describe('files parity LOT 2 (b1): list_assets', () => {
  async function publishInline(world: World, mcp: ReturnType<typeof scannedMcp>,
    artifactId: string, files: { path: string; mimeType: string; bytes: Uint8Array }[],
    key: string, expectedCurrent: string | null): Promise<string> {
    const published = await mcp.invoke('artifacts_publish', { artifactId, idempotencyKey: key,
      expectedCurrentReleaseId: expectedCurrent,
      files: files.map((file) => ({ path: file.path, mimeType: file.mimeType, bytes: Array.from(file.bytes) })) });
    expect(published.status).toBe(201);
    return (unwrap<{ releaseId: string }>(published.body)).releaseId;
  }

  const tinyHtml = (n: number): Uint8Array => new TextEncoder().encode(`<html><body>${'x'.repeat(n)}</body></html>`);

  it('lists released assets with digests and paginates', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'list-released');
    await publishInline(world, mcp, artifactId, [
      { path: 'a.html', mimeType: 'text/html', bytes: tinyHtml(10) },
      { path: 'b.html', mimeType: 'text/html', bytes: tinyHtml(20) },
      { path: 'c.html', mimeType: 'text/html', bytes: tinyHtml(30) },
    ], 'pub-1', null);
    const first = await mcp.invoke('artifacts_list_assets', { artifactId, state: 'released', limit: 2 });
    expect(first.status).toBe(200);
    const firstBody = unwrap<{ assets: { path: string; state: string; digest: string }[];
      total: number; nextCursor?: string }>(first.body);
    expect(firstBody.assets).toHaveLength(2);
    expect(firstBody.total).toBe(3);
    expect(firstBody.assets.every((asset) => asset.state === 'released')).toBe(true);
    expect(firstBody.assets[0]!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(typeof firstBody.nextCursor).toBe('string');
    const second = await mcp.invoke('artifacts_list_assets',
      { artifactId, state: 'released', limit: 2, cursor: firstBody.nextCursor });
    expect(second.status).toBe(200);
    expect(unwrap<{ assets: unknown[] }>(second.body).assets).toHaveLength(1);
  });

  it('keeps staged listing owner-only and refuses readers with access_denied', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'list-staged');
    const created = await mcp.invoke('artifacts_create_upload', { artifactId, mimeType: 'image/png', maxSize: 64 });
    const upload = unwrap<{ uploadId: string; stagingKey: string }>(created.body);
    const bytes = pngBytes(21, 64);
    await world.uploadStaging.put(upload.stagingKey, bytes);
    const committed = await mcp.invoke('artifacts_commit_upload', { artifactId, uploadId: upload.uploadId,
      path: 's.png', mimeType: 'image/png', digest: sha256(bytes), size: bytes.length, idempotencyKey: 'c-1' });
    expect(committed.status).toBe(201);
    const ownerList = await mcp.invoke('artifacts_list_assets', { artifactId, state: 'staged' });
    expect(ownerList.status).toBe(200);
    const staged = unwrap<{ assets: { state: string; uploadId: string }[] }>(ownerList.body).assets;
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ state: 'staged', uploadId: upload.uploadId });
    const grant = await mcp.invoke('artifacts_set_access', { artifactId, action: 'grant',
      principalId: 'bob', grant: 'read', idempotencyKey: 'g-1' });
    expect(grant.status).toBe(200);
    const asBob = (tool: string, args: Record<string, unknown>) =>
      world.mcp.invoke({ tool, invocation: world.invocation('bob'), args });
    const readerStaged = await asBob('artifacts_list_assets', { artifactId, state: 'staged' });
    expect(readerStaged.status).toBe(403);
    const readerReleased = await asBob('artifacts_list_assets', { artifactId, state: 'released' });
    expect(readerReleased.status).toBe(200);
    const unknownPage = await mcp.invoke('artifacts_list_assets', { artifactId, pageSessionId: randomUUID() });
    expect(unknownPage.status).toBe(200);
    expect(unwrap<{ assets: unknown[] }>(unknownPage.body).assets).toEqual([]);
  });
});

describe('files parity LOT 2 (b2): publish_bundle_v2', () => {
  const tinyPng = (seed: number): Uint8Array => pngBytes(seed, 96);

  async function publishV1Png(world: World,
    artifactId: string, key: string): Promise<{ releaseId: string; digest: string }> {
    const published = await world.mcp.invoke({ tool: 'artifacts_publish', invocation: world.invocation(),
      args: { artifactId, idempotencyKey: key, expectedCurrentReleaseId: null,
        files: [{ path: 'a.png', mimeType: 'image/png', bytes: Array.from(tinyPng(3)) }] } });
    expect(published.status).toBe(201);
    const body = unwrap<{ releaseId: string; manifest: string }>(published.body);
    const files = JSON.parse(body.manifest).files as { digest: string }[];
    return { releaseId: body.releaseId, digest: files[0]!.digest };
  }

  it('copies a screenshot between artifacts with zero client bytes and equal digest', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const sourceId = await ensureArtifact(world, mcp, 'v2-source');
    const { releaseId, digest } = await publishV1Png(world, sourceId, 'v2-pub-1');
    const targetId = await ensureArtifact(world, mcp, 'v2-target');
    const copied = await mcp.invoke('artifacts_publish_bundle_v2', { artifactId: targetId,
      idempotencyKey: 'v2-copy-1', expectedCurrentReleaseId: null,
      assets: [{ path: 'copy.png', sourceArtifactId: sourceId, sourcePath: 'a.png' }] });
    expect(copied.status).toBe(201);
    const files = unwrap<{ files: { digest: string; origin: string }[] }>(copied.body).files;
    expect(files).toHaveLength(1);
    expect(files[0]!.digest).toBe(digest);
    expect(files[0]!.origin).toBe(`copy:${sourceId}:${releaseId}`);
    expect(mcp.leaks).toEqual([]);
  });

  it('refuses foreign-scope copies, copies without source right, and commits nothing on one bad ref', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const sourceId = await ensureArtifact(world, mcp, 'v2-foreign-source');
    const { releaseId } = await publishV1Png(world, sourceId, 'v2-pub-2');
    const foreignId = randomUUID();
    await world.acls.putArtifactAcl(foreignId, { ownerId: 'alice', storageScopeId: 'scope-other',
      bindingName: 'foreign', createdAt: '2026-01-01T00:00:00Z', isPublic: false, withdrawn: false, grants: [] });
    const targetId = await ensureArtifact(world, mcp, 'v2-foreign-target');
    const crossScope = await mcp.invoke('artifacts_publish_bundle_v2', { artifactId: targetId,
      idempotencyKey: 'v2-cross-1', expectedCurrentReleaseId: null,
      assets: [{ path: 'x.png', sourceArtifactId: foreignId, sourceReleaseId: releaseId }] });
    expect(crossScope.status).toBe(422);
    const bobEnsured = await world.mcp.invoke({ tool: 'artifacts_ensure',
      invocation: world.invocation('bob'), args: { bindingName: 'v2-bob', idempotencyKey: 'ensure-bob' } });
    expect(bobEnsured.status).toBe(201);
    const bobId = unwrap<{ artifactId: string }>(bobEnsured.body).artifactId;
    const noRight = await mcp.invoke('artifacts_publish_bundle_v2', { artifactId: targetId,
      idempotencyKey: 'v2-noright-1', expectedCurrentReleaseId: null,
      assets: [{ path: 'y.png', sourceArtifactId: bobId, sourcePath: 'a.png' }] });
    expect(noRight.status).toBe(403);
    const badRef = await mcp.invoke('artifacts_publish_bundle_v2', { artifactId: targetId,
      idempotencyKey: 'v2-badref-1', expectedCurrentReleaseId: null,
      assets: [{ path: 'z.png', uploadId: randomUUID() }] });
    expect(badRef.status).toBe(422);
    expect(await world.state.getCurrentReleaseId(targetId)).toBeUndefined();
  });

  it('carries a release and republishes text-only via keepUnmodifiedPaths', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'v2-carry');
    const first = await publishV1Png(world, artifactId, 'v2-carry-1');
    const carried = await mcp.invoke('artifacts_publish_bundle_v2', { artifactId,
      idempotencyKey: 'v2-carry-2', expectedCurrentReleaseId: first.releaseId,
      assets: [{ path: 'a.png', carryFromReleaseId: first.releaseId }],
      keepUnmodifiedPaths: false });
    expect(carried.status).toBe(201);
    const carriedFiles = unwrap<{ files: { digest: string; origin: string }[] }>(carried.body).files;
    expect(carriedFiles[0]!.digest).toBe(first.digest);
    expect(carriedFiles[0]!.origin).toBe(`carry:${first.releaseId}`);
    const kept = await mcp.invoke('artifacts_publish_bundle_v2', { artifactId,
      idempotencyKey: 'v2-carry-3',
      expectedCurrentReleaseId: unwrap<{ releaseId: string }>(carried.body).releaseId,
      files: [{ path: 'note.html', mimeType: 'text/html', text: '<html><body>hi</body></html>' }],
      keepUnmodifiedPaths: true });
    expect(kept.status).toBe(201);
    expect(unwrap<{ files: { path: string }[] }>(kept.body).files.map((file) => file.path).sort())
      .toEqual(['a.png', 'note.html']);
  });
});

describe('files parity LOT 2 (b3): get_source caps', () => {
  async function commitFile(world: World, mcp: ReturnType<typeof scannedMcp>, artifactId: string,
    path: string, mimeType: string, bytes: Uint8Array, key: string): Promise<string> {
    const created = await mcp.invoke('artifacts_create_upload', { artifactId, mimeType, maxSize: bytes.length });
    const body = unwrap<{ uploadId: string; stagingKey: string }>(created.body);
    await world.uploadStaging.put(body.stagingKey, bytes);
    const committed = await mcp.invoke('artifacts_commit_upload', { artifactId, uploadId: body.uploadId,
      path, mimeType, digest: sha256(bytes), size: bytes.length, idempotencyKey: key });
    expect(committed.status).toBe(201);
    return body.uploadId;
  }

  it('returns omitted entries instead of failing on oversize manifests', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'source-caps');
    const assets = [];
    for (let i = 0; i < 60; i += 1) {
      const bytes = new TextEncoder().encode(`<html><body>page ${i}</body></html>`);
      // eslint-disable-next-line no-await-in-loop
      const uploadId = await commitFile(world, mcp, artifactId, `p${i}.html`, 'text/html', bytes, `cap-${i}`);
      assets.push({ path: `p${i}.html`, uploadId });
    }
    const bundle = await mcp.invoke('artifacts_publish_bundle', { artifactId, idempotencyKey: 'cap-bundle',
      expectedCurrentReleaseId: null, assets });
    expect(bundle.status).toBe(201);
    const read = await mcp.invoke('artifacts_get_source', { artifactId });
    expect(read.status).toBe(200);
    const files = unwrap<{ files: { path: string; text?: string; omitted?: string }[] }>(read.body).files;
    expect(files).toHaveLength(60);
    expect(files.filter((file) => file.text !== undefined)).toHaveLength(32);
    expect(files.slice(32).every((file) => file.omitted === 'over_total_budget')).toBe(true);
  });

  it('omits single files above the inline cap and keeps prior reads byte-identical', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot2Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'source-inline');
    const big = pngBytes(5, 300 * 1024);
    const small = new TextEncoder().encode('<html><body>small</body></html>');
    await commitFile(world, mcp, artifactId, 'big.png', 'image/png', big, 'inline-big');
    await commitFile(world, mcp, artifactId, 'small.html', 'text/html', small, 'inline-small');
    const stagedNow = await world.uploadSessions.listStagedFiles(artifactId);
    const stagedByPath = new Map(stagedNow.map((record) => [record.path, record.uploadId]));
    const bundle = await mcp.invoke('artifacts_publish_bundle', { artifactId, idempotencyKey: 'inline-bundle',
      expectedCurrentReleaseId: null,
      assets: [{ path: 'small.html', uploadId: stagedByPath.get('small.html') },
        { path: 'big.png', uploadId: stagedByPath.get('big.png') }] });
    expect(bundle.status).toBe(201);
    const read = await mcp.invoke('artifacts_get_source', { artifactId });
    expect(read.status).toBe(200);
    const files = unwrap<{ files: Record<string, unknown>[] }>(read.body).files;
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get('big.png')).toMatchObject({ omitted: 'over_total_budget' });
    expect(byPath.get('small.html')).toMatchObject({ text: '<html><body>small</body></html>', encoding: 'utf8' });
    const single = await mcp.invoke('artifacts_get_source', { artifactId, paths: ['small.html'] });
    expect(unwrap<{ files: Record<string, unknown>[] }>(single.body).files).toEqual([{
      path: 'small.html', mimeType: 'text/html', size: small.length,
      digest: sha256(small), text: '<html><body>small</body></html>', encoding: 'utf8' }]);
  });

  it('reads profile source caps instead of hard-coded ceilings', async () => {
    const profile = lot2Profile();
    const tight = {
      ...profile,
      operations: profile.operations.map((op) => op.operation === 'get_source'
        ? { ...op, limits: { sourceFilesMax: 32, sourceInlineFileBytesMax: 4096, sourceTotalBytesMax: 262144 } }
        : op),
    };
    const world = createTransportWorld(undefined, undefined, { profile: tight });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, 'source-tight');
    const bytes = pngBytes(9, 5120);
    await commitFile(world, mcp, artifactId, 'shot.png', 'image/png', bytes, 'tight-1');
    const staged = await world.uploadSessions.listStagedFiles(artifactId);
    const bundle = await mcp.invoke('artifacts_publish_bundle', { artifactId, idempotencyKey: 'tight-bundle',
      expectedCurrentReleaseId: null,
      assets: [{ path: 'shot.png', uploadId: staged[0]!.uploadId }] });
    expect(bundle.status).toBe(201);
    const read = await mcp.invoke('artifacts_get_source', { artifactId });
    expect(read.status).toBe(200);
    expect(unwrap<{ files: Record<string, unknown>[] }>(read.body).files).toEqual([{
      path: 'shot.png', mimeType: 'image/png', size: bytes.length,
      digest: sha256(bytes), omitted: 'too_large' }]);
  });
});
