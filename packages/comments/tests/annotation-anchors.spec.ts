import { describe, expect, it } from 'vitest';

import {
  AnchorValidationError,
  isCanonicalScope,
  isResourceRef,
  isSourceVersionIndicator,
  resourceKey,
  scopeKey,
  validateAnchor,
  type Anchor,
} from '../src/anchors.js';

const scope = { tenantId: 'tnt_anchor', workspaceId: 'wsp_anchor' };
const resource = { scope, namespace: 'ns_anchor', kind: 'document', id: 'res_1' };
const observed = { variant: 'observed' as const, sourceVersion: 'src_v1', evidence: 'author-view' };

const dataAnchor: Anchor = { kind: 'data', resource, source: observed };
const fieldAnchor: Anchor = { kind: 'field', resource, source: observed, field: { format: 'json-pointer', value: '/body/2' } };
const textAnchor: Anchor = {
  kind: 'text',
  resource,
  source: observed,
  quote: 'hello',
  prefixContext: 'say ',
  suffixContext: ' now',
  startOffset: 4,
  endOffset: 9,
};
const uiAnchor: Anchor = { kind: 'ui', resource, source: observed, surfaceKey: 'doc-view', renderVersion: 'rv_1' };
const captureAnchor: Anchor = {
  kind: 'capture',
  blobId: 'blob_1',
  digest: 'capture-digest-1',
  mimeType: 'image/png',
  intrinsicWidth: 800,
  intrinsicHeight: 600,
  capturedAt: 1_717_000_000_000,
  source: observed,
};

describe('annotation anchors', () => {
  it('validates all five anchor kinds', () => {
    for (const anchor of [dataAnchor, fieldAnchor, textAnchor, uiAnchor, captureAnchor]) {
      expect(validateAnchor(anchor)).toBe(anchor);
    }
  });

  it('accepts the three source-indicator variants and closes the set', () => {
    const conversion = { variant: 'fixed-at-conversion' as const, sourceVersion: 'conv_v1', conversionRef: 'conv_1', historicalGap: true };
    const unknown = { variant: 'unknown' as const, classification: 'evidence-gap' };
    for (const source of [observed, conversion, unknown]) {
      expect(isSourceVersionIndicator(source)).toBe(true);
      expect(validateAnchor({ kind: 'data', resource, source })).toEqual({ kind: 'data', resource, source });
    }
    expect(isSourceVersionIndicator({ variant: 'inferred', sourceVersion: 'v' })).toBe(false);
    expect(isSourceVersionIndicator({ variant: 'observed', sourceVersion: 'v' })).toBe(false);
    expect(isSourceVersionIndicator({ variant: 'fixed-at-conversion', sourceVersion: 'v', conversionRef: 'c', historicalGap: false })).toBe(false);
  });

  it('rejects malformed anchors with closed reason codes', () => {
    const cases: Array<[Anchor, string]> = [
      [{ kind: 'data', resource: { ...resource, id: '' }, source: observed }, 'invalid-resource'],
      [{ kind: 'data', resource, source: { variant: 'observed', sourceVersion: 'src_v1' } as never }, 'invalid-indicator'],
      [{ kind: 'field', resource, source: observed, field: { format: 'xpath', value: '/a' } as never }, 'invalid-field'],
      [{ kind: 'text', resource, source: observed, quote: 'x', prefixContext: '', suffixContext: '', startOffset: 9, endOffset: 4 }, 'invalid-text-offsets'],
      [{ kind: 'ui', resource, source: observed, surfaceKey: '', renderVersion: 'rv' }, 'invalid-indicator'],
      [{ kind: 'capture', blobId: 'blob_1', digest: 'd', mimeType: 'image/png', intrinsicWidth: 0, intrinsicHeight: 600, capturedAt: 1, source: observed }, 'invalid-capture'],
      [{ kind: 'fragment', resource, source: observed } as never, 'unknown-kind'],
    ];
    for (const [anchor, code] of cases) {
      expect(() => validateAnchor(anchor)).toThrowError(AnchorValidationError);
      expect(() => validateAnchor(anchor)).toThrowError(expect.objectContaining({ code }));
    }
  });

  it('keys scopes and resources by their complete identity', () => {
    expect(isCanonicalScope({ tenantId: '', workspaceId: 'w' })).toBe(false);
    expect(isCanonicalScope(scope)).toBe(true);
    expect(isResourceRef({ ...resource, namespace: '' })).toBe(false);
    expect(scopeKey(scope)).not.toBe(scopeKey({ tenantId: 'tnt_other', workspaceId: 'wsp_anchor' }));
    expect(resourceKey(resource)).not.toBe(resourceKey({ ...resource, id: 'res_2' }));
    expect(resourceKey(resource)).not.toBe(resourceKey({ ...resource, kind: 'message' }));
  });

  it('requires capture anchors to carry positive intrinsic dimensions', () => {
    expect(() =>
      validateAnchor({ ...captureAnchor, intrinsicWidth: 800, intrinsicHeight: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-capture' }));
    expect(() =>
      validateAnchor({ ...captureAnchor, capturedAt: -1 }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-capture' }));
  });
});
