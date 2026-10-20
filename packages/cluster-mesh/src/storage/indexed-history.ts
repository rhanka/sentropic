import { IndexedMap } from './indexed-map.js';

// Append-only indexed sequences retain earlier roots in O(1). Appending to
// a successor copies one balanced search path, including on a long chain.
export class IndexedHistory<T> implements Iterable<T> {
  constructor(private readonly items = new IndexedMap<T>(), private count = 0) {}
  get length(): number { return this.count; }
  at(position: number): T | undefined {
    const index = position < 0 ? this.count + position : position;
    return index >= 0 && index < this.count ? this.items.get(String(index)) : undefined;
  }
  push(...values: T[]): number {
    for (const value of values) {
      this.items.set(String(this.count), value);
      this.count += 1;
    }
    return this.count;
  }
  fork(): IndexedHistory<T> { return new IndexedHistory(this.items.fork(), this.count); }
  lock(): void { this.items.lock(); }
  map<R>(callback: (value: T, index: number) => R): R[] {
    const result: R[] = [];
    for (let n = 0; n < this.count; n += 1) result.push(callback(this.at(n)!, n));
    return result;
  }
  *[Symbol.iterator](): IterableIterator<T> {
    for (let n = 0; n < this.count; n += 1) yield this.at(n)!;
  }
}

export const forkIndexedHistory = <T>(history: T[] | IndexedHistory<T>): T[] | IndexedHistory<T> =>
  history instanceof IndexedHistory ? history.fork() : [...history];
