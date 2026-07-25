import { describe, it, expect, vi } from 'vitest';

import { createInMemoryAnnotationPort, annotationsForAI } from '../src/annotation-port';
import type { AnnotationPort } from '../src/types';

describe('createInMemoryAnnotationPort', () => {
  it('returns only open annotations', () => {
    const port = createInMemoryAnnotationPort();
    const kept = port.add({ anchorKey: 'node-a', body: 'still open' });
    const gone = port.add({ anchorKey: 'node-b', body: 'resolved' });
    gone.resolved = true;

    expect(port.listOpen().map((r) => r.id)).toEqual([kept.id]);
  });

  it('mints a threadId when the host does not supply one, and preserves it when it does', () => {
    const port = createInMemoryAnnotationPort();
    const minted = port.add({ anchorKey: 'node-a', body: 'first' });
    const supplied = port.add({ anchorKey: 'node-a', body: 'reply', threadId: minted.threadId });

    expect(minted.threadId).toBeTruthy();
    expect(supplied.threadId).toBe(minted.threadId);
  });

  it('notifies subscribers on write and stops after unsubscribe', () => {
    const port = createInMemoryAnnotationPort();
    const seen = vi.fn();
    const unsubscribe = port.subscribe(seen);

    port.add({ anchorKey: 'node-a', body: 'one' });
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    port.add({ anchorKey: 'node-b', body: 'two' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('carries the encoded anchor through verbatim — the host maps it to its own sub-target', () => {
    const port = createInMemoryAnnotationPort();
    // Anchor keys are opaque here; the overlay encodes group/arrow/freeform/geometric forms.
    const encoded = 'grp:node-a,node-b';
    expect(port.add({ anchorKey: encoded, body: 'region' }).anchorKey).toBe(encoded);
  });

  it('defaults origin to human but keeps a machine origin when declared', () => {
    const port = createInMemoryAnnotationPort();
    expect(port.add({ anchorKey: 'a', body: 'x' }).origin).toBe('human');
    expect(port.add({ anchorKey: 'b', body: 'y', origin: 'machine' }).origin).toBe('machine');
  });
});

describe('annotationsForAI', () => {
  it('projects anchor + body + provenance, and never leaks pixels', () => {
    const port = createInMemoryAnnotationPort();
    port.add({ anchorKey: 'node-a', body: 'human note' });
    port.add({ anchorKey: 'geo:1,2,3,4', body: 'machine note', origin: 'machine' });

    const projected = annotationsForAI(port);

    expect(projected).toHaveLength(2);
    for (const item of projected) {
      expect(Object.keys(item).sort()).toEqual(['anchorKey', 'body', 'origin', 'threadId']);
    }
  });

  it('does NOT launder machine-proposed content into looking human-authored', () => {
    const port = createInMemoryAnnotationPort();
    port.add({ anchorKey: 'node-a', body: 'proposed by a model', origin: 'machine' });

    expect(annotationsForAI(port)[0].origin).toBe('machine');
  });

  it('omits resolved annotations', () => {
    const port = createInMemoryAnnotationPort();
    const resolved = port.add({ anchorKey: 'node-a', body: 'done' });
    resolved.resolved = true;
    port.add({ anchorKey: 'node-b', body: 'open' });

    expect(annotationsForAI(port).map((a) => a.body)).toEqual(['open']);
  });

  it('works against any AnnotationPort implementation, not just the in-memory one', () => {
    // Proves the projection depends on the PORT, not on the default adapter —
    // this is what lets a host back it with @sentropic/comments.
    const stub: AnnotationPort = {
      listOpen: () => [{ id: '1', anchorKey: 'k', body: 'b', threadId: 't', origin: 'human' }],
      add: () => {
        throw new Error('not used');
      },
      subscribe: () => () => {},
    };

    expect(annotationsForAI(stub)).toEqual([
      { threadId: 't', anchorKey: 'k', body: 'b', origin: 'human' },
    ]);
  });
});
