import { describe, expect, it } from 'vitest';
import { ProjectionRuntime } from '../../src/storage/projection-runtime.js';
import { StorageInvalidCommandError } from '../../src/storage/errors.js';

describe('prepared projection roots', () => {
  it('should validate successive relationship removals without changing the committed root', () => {
    const current = new ProjectionRuntime();
    current.applyRelationships([{ kind: 'add', relation: 'r', from: 'a', to: 'b' }]);
    const prepared = current.fork();
    expect(() => prepared.applyRelationships([
      { kind: 'remove', relation: 'r', from: 'a', to: 'b' },
      { kind: 'remove', relation: 'r', from: 'a', to: 'b' },
    ])).toThrow(StorageInvalidCommandError);
    expect(current.queryRelationships('r', 'a')).toEqual(['b']);
  });

  it('should own nested deltas and preserve their captured membership', () => {
    const current = new ProjectionRuntime();
    const records = ['accepted'];
    current.emitDelta({ cause: 'atomic', records, aggregates: [], relationships: [], barriers: [] });
    const prepared = current.fork();
    records[0] = 'changed';
    prepared.emitDelta({ cause: 'atomic', records: ['next'], aggregates: [], relationships: [], barriers: [] });
    const delivered = current.deltas();
    expect(delivered[0].records).toEqual(['accepted']);
    expect(current.deltas()).toHaveLength(1);
    expect(prepared.deltas()).toHaveLength(2);
  });
});
