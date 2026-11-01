/**
 * Parity P0 — small edits on publish (edits:[{path,oldStr,newStr}] applied to
 * the current release's text files; oldStr must occur exactly once, else a
 * typed edit_mismatch changes nothing) and artifacts_get_source returning the
 * current content for editing.
 */
import { describe, expect, it } from 'vitest';
import { ensureSite, getSource, listVersions, parityWorld, publish, publishText,
  type Body } from './fixtures/parity-world.js';

describe('edits on publish', () => {
  it('should apply old/new edits to the current release text files as a new release', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'ed-ensure');
    await publishText(w, artifactId, '<h1>Hello</h1>', 'ed-p1');
    const res = await publish(w, artifactId, 'ed-p2', {
      edits: [{ path: 'index.html', oldStr: 'Hello', newStr: 'Goodbye' }] });
    expect(res.status).toBe(201);
    const source = await getSource(w, artifactId);
    const files = (source.body as Body).files as Record<string, unknown>[];
    expect(files[0].text).toBe('<h1>Goodbye</h1>');
    const versions = await listVersions(w, artifactId);
    expect((versions.body as Body).releases).toHaveLength(2);
    expect((versions.body as Body).total).toBe(2);
  });

  it('should return typed edit_mismatch and change nothing when oldStr does not occur exactly once', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'ed-mm');
    await publishText(w, artifactId, '<p>abc abc</p>', 'em-p1');
    for (const [oldStr, occurrences] of [['abc', 2], ['missing', 0]] as const) {
      const res = await publish(w, artifactId, `em-${occurrences}`, {
        edits: [{ path: 'index.html', oldStr, newStr: 'x' }] });
      expect(res.status).toBe(422);
      const body = res.body as Body;
      expect(body.error).toBe('edit_mismatch');
      expect((body.edit as Body).path).toBe('index.html');
      expect((body.edit as Body).occurrences).toBe(occurrences);
    }
    const unknownPath = await publish(w, artifactId, 'em-path', {
      edits: [{ path: 'other.css', oldStr: 'a', newStr: 'b' }] });
    expect(unknownPath.status).toBe(422);
    expect(((unknownPath.body as Body).edit as Body).path).toBe('other.css');
    const versions = await listVersions(w, artifactId);
    expect((versions.body as Body).releases).toHaveLength(1);
    const source = await getSource(w, artifactId);
    expect(((source.body as Body).files as Record<string, unknown>[])[0].text).toBe('<p>abc abc</p>');
  });

  it('should require exactly one of files or edits', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'ed-xor');
    await publishText(w, artifactId, 'base', 'ex-p1');
    const both = await publish(w, artifactId, 'ex-both', {
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'full' }],
      edits: [{ path: 'index.html', oldStr: 'base', newStr: 'x' }] });
    expect(both.status).toBe(400);
    const neither = await w.mcp.invoke({ tool: 'artifacts_publish', invocation: w.invocation(),
      args: { artifactId, idempotencyKey: 'ex-neither' } });
    expect(neither.status).toBe(400);
  });
});

describe('artifacts_get_source', () => {
  it('should return the current release files with decoded text for editing', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'gs-ensure');
    const pub = await w.mcp.invoke({ tool: 'artifacts_publish', invocation: w.invocation(), args: {
      artifactId, idempotencyKey: 'gs-p1',
      files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>Hi</h1>' },
        { path: 'data.json', mimeType: 'application/json', text: '{"a":1}' }] } });
    expect(pub.status).toBe(201);
    const res = await getSource(w, artifactId);
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body.artifactId).toBe(artifactId);
    expect(body.releaseId).toBe((pub.body as Body).releaseId);
    expect(body.digest).toBe((pub.body as Body).digest);
    const files = body.files as Record<string, unknown>[];
    expect(files).toHaveLength(2);
    // Manifest files are canonicalized (sorted), so assert by path, not position.
    expect(files.find((f) => f.path === 'index.html'))
      .toMatchObject({ mimeType: 'text/html', text: '<h1>Hi</h1>' });
    expect(files.find((f) => f.path === 'data.json'))
      .toMatchObject({ mimeType: 'application/json', text: '{"a":1}' });
  });

  it('should reflect the latest publish after edits', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'gs-edits');
    await publishText(w, artifactId, 'v1 body', 'ge-p1');
    await publish(w, artifactId, 'ge-p2', { edits: [{ path: 'index.html', oldStr: 'v1', newStr: 'v2' }] });
    const res = await getSource(w, artifactId);
    expect(((res.body as Body).files as Record<string, unknown>[])[0].text).toBe('v2 body');
  });

  it('should return not_found without a current release and for readers without the source right', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'gs-none');
    expect((await getSource(w, artifactId)).status).toBe(404);
    await publishText(w, artifactId, 'secret', 'gn-p1');
    expect((await getSource(w, artifactId, 'bob')).status).toBe(404);
    expect((await getSource(w, artifactId)).status).toBe(200);
  });
});
