/**
 * Files parity LOT 1 — acceptance suite (design-r1 §B/§D, review r1 CHANGES).
 *
 * (a) The 41-file / ~9.7 MB LotAi dossier (1 HTML + 40 PNG) is published ONLY
 *     through signed PUTs: create_upload -> PUT to the presigned URL ->
 *     commit_upload -> one assets-only publish_bundle. Every MCP payload is
 *     scanned: zero file bytes may appear in any argument.
 * (b) Screenshots are served on the single-label host <artifactId>.<base>.
 * (c) A wrong size or digest at commit is refused (422 verification_failed)
 *     and pins/commits nothing.
 * (d) A bundle with one missing asset commits nothing (no release at all).
 * (e) The enforced sweeper expires stale sessions and deletes their staging.
 * (f) A strict r2 profile compiles WITH the upload tools selected (review
 *     finding 4) and runs them end to end.
 * (g) A PUT larger than the signed exact Content-Length is refused.
 * (h) The 17 pre-existing tool definitions are byte-identical (sha256 pin);
 *     artifacts_publish_bundle is appended last, frozen at birth.
 */
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARTIFACTS_TOOL_DEFINITIONS, ARTIFACTS_TOOL_NAMES } from '../src/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, type ArtifactProviderProfile } from '../src/profile/index.js';
import { parseManifest } from '../src/codecs.js';
import { createUploadSweeper } from '../src/server/gc.js';
import { checksumHeaderValue, stagingKey } from '../src/server/uploads.js';
import { createHmacGrantSigner, createMemoryTicketStore, createTicketService } from '../src/content/grants.js';
import { createContentHandler } from '../src/content/handler.js';
import { createTransportWorld } from './fixtures/transport-world.js';

const SCOPE = 'scope-l6';
const BASE = 'pages.example.test';
const sha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const blobKey = (digest: string): string => `artifacts/${SCOPE}/blobs/${digest.replace(':', '/')}`;

/** Deterministic PNG payload (magic header + seeded filler). */
function pngBytes(seed: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let x = (seed >>> 0) || 1;
  for (let i = 8; i < size; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

/**
 * LOT 1 host profile: the RADAR shape plus the three upload capabilities.
 * Inline publish stays small (64 KiB) so the 9.7 MB dossier can ONLY travel
 * through signed PUTs; the release budget carries the server maxima
 * (255 files / 16 MiB per file / 64 MiB per release).
 */
function lot1Profile(): ArtifactProviderProfile {
  return {
    ...RADAR_ARTIFACTS_PROFILE,
    selectedCapabilities: ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
      'artifacts_get_source', 'artifacts_create_upload', 'artifacts_commit_upload', 'artifacts_publish_bundle'],
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
    ],
    rules: { ...RADAR_ARTIFACTS_PROFILE.rules,
      mimeTypes: ['text/html', 'text/css', 'text/javascript', 'application/json', 'image/png'] },
  };
}

type World = ReturnType<typeof createTransportWorld>;

/** MCP surface wrapped so every argument payload is scanned for file bytes. */
function scannedMcp(world: World) {
  const leaks: unknown[] = [];
  const scan = (value: unknown, html: string): void => {
    if (Array.isArray(value)) {
      if (value.length >= 8 && value.every((entry) => typeof entry === 'number' &&
        Number.isInteger(entry) && entry >= 0 && entry <= 255)) leaks.push(value);
      else value.forEach((entry) => scan(entry, html));
      return;
    }
    if (typeof value === 'string') {
      if (html.length >= 16 && value.includes(html)) leaks.push(value);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) scan(entry, html);
    }
  };
  return {
    leaks,
    async invoke(tool: string, args: Record<string, unknown>, html: string) {
      scan(args, html);
      return world.mcp.invoke({ tool, invocation: world.invocation(), args });
    },
  };
}

/**
 * Result envelope unwrapping: v1 profiles return the raw receipt body, while
 * v2 (`resultEnvelopeVersion: 2`) returns the MCP outcome `{ok, output, ...}`
 * and the receipt lives in `output`. A real caller reads `output`; the helper
 * accepts both shapes so the same journey runs under either envelope.
 */
function unwrap<T>(body: unknown): T {
  return ((body as { output?: unknown }).output ?? body) as T;
}

async function ensureArtifact(world: World, mcp: ReturnType<typeof scannedMcp>, html: string, binding = 'lotai') {
  const ensured = await mcp.invoke('artifacts_ensure', { bindingName: binding, idempotencyKey: `ensure-${binding}` }, html);
  expect(ensured.status).toBe(201);
  return (unwrap<{ artifactId: string }>(ensured.body)).artifactId;
}

/** One file through the signed-PUT journey; returns its staged asset descriptor. */
async function uploadFile(world: World, mcp: ReturnType<typeof scannedMcp>, html: string,
  artifactId: string, path: string, mimeType: string, bytes: Uint8Array, index: number) {
  const created = await mcp.invoke('artifacts_create_upload',
    { artifactId, mimeType, maxSize: bytes.length }, html);
  expect(created.status).toBe(201);
  const body = unwrap<{ uploadId: string; uploadUrl: string; method: string; maxSize: number;
    requiredHeaders: Record<string, string>; checksumHeader: string; expiresAt: string }>(created.body);
  expect(body.method).toBe('PUT');
  expect(body.maxSize).toBe(bytes.length);
  expect(body.requiredHeaders['content-length']).toBe(String(bytes.length));
  expect(body.checksumHeader).toBe('x-amz-checksum-sha256');
  // The local agent performs the PUT straight against the presigned URL: the
  // signer double enforces the signed exact content-length and the checksum.
  const signed = world.uploadSigner.signed.at(-1)!;
  world.uploadSigner.put(signed, bytes, {
    ...body.requiredHeaders, 'x-amz-checksum-sha256': checksumHeaderValue(sha256(bytes)),
  });
  await world.uploadStaging.put(stagingKey(SCOPE, body.uploadId), bytes);
  const committed = await mcp.invoke('artifacts_commit_upload', {
    artifactId, uploadId: body.uploadId, path, mimeType, digest: sha256(bytes),
    size: bytes.length, idempotencyKey: `commit-${index}`,
  }, html);
  expect(committed.status).toBe(201);
  expect((unwrap<{ state: string }>(committed.body)).state).toBe('staged');
  return { path, uploadId: body.uploadId, digest: sha256(bytes), size: bytes.length, bytes };
}

describe('files parity LOT 1 acceptance', () => {
  it('publishes the 41-file / ~9.7 MB dossier only through signed PUTs, with zero file bytes in any MCP payload', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot1Profile() });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>LotAi dossier</title></head>` +
      `<body><h1>LotAi</h1><p>${'dossier '.repeat(120)}</p></body></html>`;
    const htmlBytes = new TextEncoder().encode(html);
    // 1 HTML + 40 PNG, total ~9.7 MiB, each PNG far above the 64 KiB inline budget.
    const targetTotal = Math.floor(9.7 * 1024 * 1024);
    const pngSize = Math.floor((targetTotal - htmlBytes.length) / 40);
    const files = [
      { path: 'index.html', mimeType: 'text/html', bytes: htmlBytes },
      ...Array.from({ length: 40 }, (_, i) => ({
        path: `shots/shot-${String(i).padStart(2, '0')}.png`, mimeType: 'image/png', bytes: pngBytes(i + 1, pngSize),
      })),
    ];
    const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
    expect(files).toHaveLength(41);
    expect(total).toBeGreaterThan(9 * 1024 * 1024);
    expect(total).toBeLessThan(64 * 1024 * 1024);

    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, html);

    // The inline channel cannot carry this dossier (64 KiB inline budget).
    // Deliberately outside the scanned wrapper: this call carries bytes to
    // prove the inline budget refuses them.
    const inline = await world.mcp.invoke({ tool: 'artifacts_publish', invocation: world.invocation(), args: {
      artifactId, idempotencyKey: 'inline-refused',
      files: [{ path: files[1].path, mimeType: 'image/png', bytes: Array.from(files[1].bytes) }],
    } });
    expect(inline.status).toBe(400);

    // Per file: create_upload -> signed PUT -> commit_upload (sequential, so
    // the 8-open-session quota is never hit).
    const assets = [];
    for (let i = 0; i < files.length; i += 1) {
      assets.push(await uploadFile(world, mcp, html, artifactId, files[i].path, files[i].mimeType, files[i].bytes, i));
    }

    // One atomic assets-only bundle release.
    const bundle = await mcp.invoke('artifacts_publish_bundle', {
      artifactId, idempotencyKey: 'bundle-lotai-1', expectedCurrentReleaseId: null,
      assets: assets.map((asset) => ({ path: asset.path, uploadId: asset.uploadId })),
    }, html);
    expect(bundle.status).toBe(201);
    const bundleBody = unwrap<{ releaseId: string; manifest: string;
      files: { path: string; mimeType: string; size: number; digest: string; origin: string }[] }>(bundle.body);
    expect(bundleBody.files).toHaveLength(41);
    expect(bundleBody.files.every((entry) => entry.origin.startsWith('upload:'))).toBe(true);

    // Zero file bytes in any MCP payload (byte arrays or the HTML text).
    expect(mcp.leaks).toEqual([]);

    // The release manifest carries all 41 files and every CAS blob exists.
    const release = await world.state.getRelease(bundleBody.releaseId);
    expect(release).toBeDefined();
    expect(await world.state.getCurrentReleaseId(artifactId)).toBe(bundleBody.releaseId);
    const manifest = parseManifest(release!.manifest);
    const manifestFiles = manifest.files as { path: string; digest: string }[];
    expect(manifestFiles).toHaveLength(41);
    for (const asset of assets) {
      const entry = manifestFiles.find((f) => f.path === asset.path);
      expect(entry?.digest).toBe(asset.digest);
      // Byte-exactness via the digest (vitest toEqual on 250 KiB buffers costs
      // ~250 ms per call in this lane, 10 s for 41 files; hashing is ~1 ms).
      const stored = await world.blobs.getBlob(blobKey(asset.digest));
      expect(stored).toBeDefined();
      expect(sha256(stored!)).toBe(asset.digest);
    }
    // Staging is drained and every session is committed.
    expect(await world.uploadStaging.listKeys(`artifacts/${SCOPE}/staging/`)).toEqual([]);
    for (const asset of assets) {
      expect((await world.uploadSessions.get(asset.uploadId))!.state).toBe('committed');
    }

    // (b) Screenshots served on the single-label host <artifactId>.<base>.
    const tickets = createTicketService({ store: createMemoryTicketStore() });
    const handler = createContentHandler({
      acls: world.acls, lifecycle: world.lifecycle, publication: world.publication, blobs: world.blobs,
      grants: createHmacGrantSigner({ secret: 'lot1-grant-secret' }), tickets, baseDomain: BASE,
      isApprovedAccount: () => true,
    });
    const host = `${artifactId}.${BASE}`;
    const issued = await tickets.issue({ subjectId: 'alice', artifactId, releaseId: bundleBody.releaseId, channel: 'stable' });
    const activation = await handler.handle({ method: 'GET', host, path: '/', actorId: 'alice', ticket: issued.ticketId });
    expect(activation.status).toBe(200);
    const cookie = activation.headers['set-cookie'] as string;
    const shot = await handler.handle({ method: 'GET', host, path: '/shots/shot-07.png', cookie });
    expect(shot.status).toBe(200);
    expect(shot.headers['content-type']).toContain('image/png');
    expect(shot.headers['x-content-type-options']).toBe('nosniff');
    expect(sha256(shot.bytes)).toBe(sha256(files[8].bytes));
    const index = await handler.handle({ method: 'GET', host, path: '/', cookie });
    expect(index.status).toBe(200);
    expect(new TextDecoder().decode(index.bytes)).toBe(html);
  });

  it('refuses a wrong size or digest at commit and pins nothing', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot1Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, '', 'wrong-commit');
    const bytes = pngBytes(99, 4096);
    const created = await mcp.invoke('artifacts_create_upload',
      { artifactId, mimeType: 'image/png', maxSize: bytes.length }, '');
    const { uploadId, requiredHeaders } = created.body as { uploadId: string; requiredHeaders: Record<string, string> };
    world.uploadSigner.put(world.uploadSigner.signed.at(-1)!, bytes,
      { ...requiredHeaders, 'x-amz-checksum-sha256': checksumHeaderValue(sha256(bytes)) });
    await world.uploadStaging.put(stagingKey(SCOPE, uploadId), bytes);

    const wrongSize = await mcp.invoke('artifacts_commit_upload', {
      artifactId, uploadId, path: 'shots/a.png', mimeType: 'image/png',
      digest: sha256(bytes), size: bytes.length + 1, idempotencyKey: 'c-size',
    }, '');
    expect(wrongSize.status).toBe(422);
    expect((wrongSize.body as { error: string }).error).toBe('verification_failed');
    const wrongDigest = await mcp.invoke('artifacts_commit_upload', {
      artifactId, uploadId, path: 'shots/a.png', mimeType: 'image/png',
      digest: sha256(pngBytes(100, 4096)), size: bytes.length, idempotencyKey: 'c-digest',
    }, '');
    expect(wrongDigest.status).toBe(422);
    expect((wrongDigest.body as { error: string }).error).toBe('verification_failed');
    // Nothing pinned, no CAS blob, session still open.
    expect(await world.blobs.listKeys(`artifacts/${SCOPE}/blobs/`)).toEqual([]);
    expect((await world.uploadSessions.get(uploadId))!.state).toBe('open');
    // The correct declaration commits.
    const ok = await mcp.invoke('artifacts_commit_upload', {
      artifactId, uploadId, path: 'shots/a.png', mimeType: 'image/png',
      digest: sha256(bytes), size: bytes.length, idempotencyKey: 'c-ok',
    }, '');
    expect(ok.status).toBe(201);
    expect(await world.blobs.getBlob(blobKey(sha256(bytes)))).toEqual(bytes);
  });

  it('commits nothing when a bundle references one missing asset', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot1Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, '', 'missing-asset');
    const bytes = pngBytes(7, 2048);
    const good = await uploadFile(world, mcp, '', artifactId, 'shots/good.png', 'image/png', bytes, 0);
    const releasesBefore = world.releases.size;

    // Unknown uploadId asset.
    const badUpload = await mcp.invoke('artifacts_publish_bundle', {
      artifactId, idempotencyKey: 'bundle-bad-upload', expectedCurrentReleaseId: null,
      assets: [{ path: 'shots/good.png', uploadId: good.uploadId },
        { path: 'shots/ghost.png', uploadId: randomUUID() }],
    }, '');
    expect(badUpload.status).toBe(422);
    expect((badUpload.body as { error: string }).error).toBe('verification_failed');

    // CAS asset whose blob was never pinned.
    const missing = sha256(pngBytes(8, 2048));
    const badCas = await mcp.invoke('artifacts_publish_bundle', {
      artifactId, idempotencyKey: 'bundle-bad-cas', expectedCurrentReleaseId: null,
      assets: [{ path: 'shots/good.png', uploadId: good.uploadId },
        { path: 'shots/cas.png', digest: missing, size: 2048, mimeType: 'image/png' }],
    }, '');
    expect(badCas.status).toBe(422);

    // No release was created for the artifact.
    expect(await world.state.getCurrentReleaseId(artifactId)).toBeUndefined();
    expect(world.releases.size).toBe(releasesBefore);
  });

  it('expires stale upload sessions through the enforced sweeper', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot1Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, '', 'sweeper');
    const bytes = pngBytes(11, 1024);
    const created = await mcp.invoke('artifacts_create_upload',
      { artifactId, mimeType: 'image/png', maxSize: bytes.length }, '');
    const { uploadId, requiredHeaders } = created.body as { uploadId: string; requiredHeaders: Record<string, string> };
    world.uploadSigner.put(world.uploadSigner.signed.at(-1)!, bytes,
      { ...requiredHeaders, 'x-amz-checksum-sha256': checksumHeaderValue(sha256(bytes)) });
    await world.uploadStaging.put(stagingKey(SCOPE, uploadId), bytes);

    // Not yet stale: the sweeper does nothing.
    const sweeper = createUploadSweeper({ sessions: world.uploadSessions, staging: world.uploadStaging });
    expect(await sweeper.sweep()).toEqual({ expired: [], deletedKeys: [], failures: [] });

    // Past expires_at: expired + staging object deleted.
    const report = await sweeper.sweep(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(report.expired).toEqual([uploadId]);
    expect(report.deletedKeys).toEqual([stagingKey(SCOPE, uploadId)]);
    expect(await world.uploadStaging.get(stagingKey(SCOPE, uploadId))).toBeUndefined();
    expect((await world.uploadSessions.get(uploadId))!.state).toBe('expired');

    // Committing the expired session is refused.
    const commit = await mcp.invoke('artifacts_commit_upload', {
      artifactId, uploadId, path: 'shots/a.png', mimeType: 'image/png',
      digest: sha256(bytes), size: bytes.length, idempotencyKey: 'c-expired',
    }, '');
    expect(commit.status).toBe(422);
    expect((commit.body as { error: string }).error).toBe('verification_failed');
    expect(await world.blobs.listKeys(`artifacts/${SCOPE}/blobs/`)).toEqual([]);
  });

  it('compiles and runs the upload tools under a strict r2 profile (review finding 4)', async () => {
    const strict: ArtifactProviderProfile = {
      ...lot1Profile(),
      profileRevisionId: 'lot1-strict.v2',
      resultEnvelopeVersion: 2,
      requireExpectedCurrentReleaseId: true,
      contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions, outcome: 'artifacts-outcome/v2' },
    };
    const compiled = compileArtifactsProfile(strict);
    expect(compiled.selectedCapabilities).toContain('artifacts_create_upload');
    expect(compiled.selectedCapabilities).toContain('artifacts_commit_upload');
    expect(compiled.selectedCapabilities).toContain('artifacts_publish_bundle');
    const world = createTransportWorld(undefined, undefined, { profile: strict });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, '', 'strict');
    const bytes = pngBytes(21, 2048);
    const asset = await uploadFile(world, mcp, '', artifactId, 'shots/s.png', 'image/png', bytes, 0);
    const bundle = await mcp.invoke('artifacts_publish_bundle', {
      artifactId, idempotencyKey: 'strict-bundle', expectedCurrentReleaseId: null,
      assets: [{ path: asset.path, uploadId: asset.uploadId }],
    }, '');
    expect(bundle.status).toBe(201);
    expect(await world.state.getCurrentReleaseId(artifactId)).toBe((unwrap<{ releaseId: string }>(bundle.body)).releaseId);
  });

  it('refuses a PUT whose body exceeds the signed exact Content-Length', async () => {
    const world = createTransportWorld(undefined, undefined, { profile: lot1Profile() });
    const mcp = scannedMcp(world);
    const artifactId = await ensureArtifact(world, mcp, '', 'oversized-put');
    const created = await mcp.invoke('artifacts_create_upload',
      { artifactId, mimeType: 'image/png', maxSize: 64 }, '');
    const { requiredHeaders } = created.body as { requiredHeaders: Record<string, string> };
    const signed = world.uploadSigner.signed.at(-1)!;
    expect(signed.contentLength).toBe(64);
    expect(() => world.uploadSigner.put(signed, pngBytes(31, 65),
      { ...requiredHeaders, 'x-amz-checksum-sha256': checksumHeaderValue(sha256(pngBytes(31, 65))) }))
      .toThrow(/content-length mismatch/);
  });

  it('keeps the 17 pre-existing tool definitions byte-identical (sha256 pin)', () => {
    // Canonical form: recursively sorted keys, 2-space indent, no trailing newline.
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [key, sortKeys(entry)] as const)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
      }
      return value;
    };
    const { artifacts_publish_bundle: _bundle, artifacts_lookup_people: _lookup,
      artifacts_list_access: _access, artifacts_revoke_reader_consent: _revoke,
      artifacts_create_upload_page: _page, artifacts_list_assets: _list,
      artifacts_publish_bundle_v2: _v2, ...preexisting } = ARTIFACTS_TOOL_DEFINITIONS;
    const canonical = JSON.stringify(sortKeys(preexisting), null, 2);
    expect(createHash('sha256').update(canonical).digest('hex'))
      .toBe('6589d5930620ea12e5b185a8b72e2657e08a2c32e9b5943a7d0e4e89aa304b2c');
    expect(Object.keys(preexisting)).toHaveLength(17);
    // The union tools are appended in merge order and frozen at birth: the
    // four train tools, then the three LOT 2 tools.
    expect(ARTIFACTS_TOOL_NAMES).toHaveLength(24);
    expect(ARTIFACTS_TOOL_NAMES.slice(-7)).toEqual(['artifacts_lookup_people', 'artifacts_list_access',
      'artifacts_publish_bundle', 'artifacts_revoke_reader_consent',
      'artifacts_create_upload_page', 'artifacts_list_assets', 'artifacts_publish_bundle_v2']);
    expect(ARTIFACTS_TOOL_DEFINITIONS.artifacts_publish_bundle.description).toContain('publish bundle');
  });
});
