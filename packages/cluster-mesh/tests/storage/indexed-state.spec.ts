import { describe, expect, it } from 'vitest';
import { IndexedMap } from '../../src/storage/indexed-map.js';
import { IndexedHistory } from '../../src/storage/indexed-history.js';

describe('indexed storage roots', () => {
  it('should append to a long captured history without copying its records', () => {
    const history = new IndexedHistory<number>();
    for (let n = 0; n < 10000; n += 1) history.push(n);
    const captured = history.fork();
    history[Symbol.iterator] = function* () { throw new Error('historical enumeration'); };
    const successor = history.fork();
    successor.push(10000);
    expect(captured.length).toBe(10000);
    expect(captured.at(-1)).toBe(9999);
    expect(successor.at(-1)).toBe(10000);
    expect(successor.at(0)).toBe(0);
    expect(successor.at(10001)).toBeUndefined();
  });

  it('should preserve captured versions while replacing and deleting keys in successors', () => {
    const original = new IndexedMap<number>();
    for (let n = 0; n < 2000; n += 1) original.set(`key-${n}`, n);
    const captured = original.fork();
    for (let n = 0; n < 2000; n += 1) {
      if (n % 3 === 0) original.delete(`key-${n}`);
      else original.set(`key-${n}`, -n);
    }
    expect(captured.size).toBe(2000);
    for (let n = 0; n < 2000; n += 1) {
      expect(captured.get(`key-${n}`)).toBe(n);
      expect(original.get(`key-${n}`)).toBe(n % 3 === 0 ? undefined : -n);
    }
    expect([...original].length).toBe(original.size);
  });

  it('should capture a successor without visiting historical keys', () => {
    const original = new IndexedMap<number>();
    for (let n = 0; n < 1000; n += 1) original.set(String(n), n);
    original.entries = () => { throw new Error('historical enumeration'); };
    original[Symbol.iterator] = original.entries;
    const successor = original.fork();
    successor.set('1000', 1000);
    expect(successor.size).toBe(1001);
    expect(original.get('1000')).toBeUndefined();
    expect(successor.get('999')).toBe(999);
  });
});
