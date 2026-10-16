/**
 * Responses carrier helpers (spec §16.3, R4-MAJ-3): the carrier reader and
 * the bare→qualified tool-name requalification. Providers echo the bare
 * canonical name; the client declared (and awaits) `namespace.name`.
 */
import { describe, expect, it } from 'vitest';

import {
  requalifyResponseToolName,
  responsesCarrierOf,
  type ResponsesNativeRequestCarrier,
} from '../src/responses-wire.js';

const carrier: ResponsesNativeRequestCarrier = {
  customTools: [],
  functionToolRefs: [
    { qualifiedName: 'muse.work_list', bareName: 'work_list', namespace: 'muse' },
    { qualifiedName: 'clock.sleep', bareName: 'sleep', namespace: 'clock' },
  ],
  reasoningArtifacts: [],
  itemIds: [],
};

describe('responses carrier helpers (spec §16.3)', () => {
  it('reads the validated carrier off providerOptions', () => {
    expect(responsesCarrierOf({ responses: carrier })).toBe(carrier);
    expect(responsesCarrierOf(undefined)).toBeUndefined();
    expect(responsesCarrierOf({})).toBeUndefined();
    expect(responsesCarrierOf({ responses: null })).toBeUndefined();
  });

  it('requalifies declared bare names to namespace.name', () => {
    expect(requalifyResponseToolName('work_list', carrier)).toBe('muse.work_list');
    expect(requalifyResponseToolName('sleep', carrier)).toBe('clock.sleep');
  });

  it('passes through unknown names and missing carriers untouched', () => {
    expect(requalifyResponseToolName('other', carrier)).toBe('other');
    expect(requalifyResponseToolName('work_list', undefined)).toBe('work_list');
  });
});
