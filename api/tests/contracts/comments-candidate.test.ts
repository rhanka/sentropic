// Consumer-owned contract: comments candidate through the API.
// The API consumes @sentropic/comments over the ./hono export (wire shape:
// Hono router with comment collection/item routes, auth fail-closed). The
// contract verifies the public export surface and the wire shape on qualified
// candidate bytes, not semver declarations. When COMMENTS_CANDIDATE_TARBALL
// points at the BR-80 qualified archive, the packed manifest must expose the
// same surface the consumer imports.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { createCommentsRouter } from '@sentropic/comments/hono';
import { InMemoryCommentStore } from '@sentropic/comments';
import { readPackedManifest } from '../../../scripts/ci/publishable-manifests.mjs';

const stubOptions = () => ({
  store: new InMemoryCommentStore(),
  events: { emit: () => {} },
  tenant: { contextExists: async () => false, resolve: async (principal: unknown) => principal },
  authz: { resolvePrincipal: async () => undefined, authorize: async () => false },
});

const packedManifest = async () => {
  const tarball = process.env.COMMENTS_CANDIDATE_TARBALL;
  if (!tarball) return null;
  return readPackedManifest(await readFile(tarball));
};

describe('comments candidate through the API', () => {
  it('should expose the comments router factory the API wires', () => {
    expect(typeof createCommentsRouter).toBe('function');
  });

  it('should serve the comment collection wire with auth fail-closed', async () => {
    const router = createCommentsRouter(stubOptions());
    const paths = router.routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('GET /comments');
    expect(paths).toContain('POST /comments');
    const denied = await router.request('/comments?context_type=organization&context_id=x');
    expect(denied.status).toBe(401);
  });

  it('should keep the API namespace module wired to the same export', () => {
    const consumer = readFileSync(new URL('../../src/routes/namespaces/comments.ts', import.meta.url), 'utf8');
    expect(consumer).toContain("from '@sentropic/comments/hono'");
    expect(consumer).toContain('createCommentsRouter');
  });

  it('should match the qualified candidate archive when one is supplied', async () => {
    const packed = await packedManifest();
    if (!packed) return;
    expect(packed.name).toBe('@sentropic/comments');
    expect(typeof packed.version).toBe('string');
    expect(packed.exports?.['./hono']).toBeDefined();
  });
});
