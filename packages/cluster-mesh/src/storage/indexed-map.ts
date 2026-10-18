import { StorageInvalidCommandError } from './errors.js';
import { findIndexed, indexedAt, indexedEntries, putIndexed, removeIndexed, type IndexedNode } from './indexed-tree.js';

// Internal indexed maps enumerate keys lexically. Forking copies one root
// pointer; updates copy balanced search paths, never the scope's entries.
export class IndexedMap<V> extends Map<string, V> {
  #root: IndexedNode<V> | null = null;
  #locked = false;

  fork(): IndexedMap<V> {
    const successor = new IndexedMap<V>();
    successor.#root = this.#root;
    return successor;
  }

  lock(): this { this.#locked = true; return this; }
  private writable(): void {
    if (this.#locked) throw new StorageInvalidCommandError('captured indexed state is immutable');
  }
  override get size(): number { return this.#root?.size ?? 0; }
  override get(key: string): V | undefined { return findIndexed(this.#root, key)?.value; }
  entryAt(ordinal: number): [string, V] | undefined {
    const entry = indexedAt(this.#root, ordinal);
    return entry ? [entry.key, entry.value] : undefined;
  }
  override has(key: string): boolean { return findIndexed(this.#root, key) !== null; }
  override set(key: string, value: V): this {
    this.writable();
    this.#root = putIndexed(this.#root, key, value);
    return this;
  }
  override delete(key: string): boolean {
    this.writable();
    if (!this.has(key)) return false;
    this.#root = removeIndexed(this.#root, key);
    return true;
  }
  override clear(): void { this.writable(); this.#root = null; }
  override entries(): IterableIterator<[string, V]> { return indexedEntries(this.#root); }
  override [Symbol.iterator](): IterableIterator<[string, V]> { return this.entries(); }
  override *keys(): IterableIterator<string> { for (const [key] of this.entries()) yield key; }
  override *values(): IterableIterator<V> { for (const [, value] of this.entries()) yield value; }
  override forEach(callback: (value: V, key: string, map: Map<string, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
  }
}

export const forkIndexedMap = <V>(map: Map<string, V>): Map<string, V> =>
  map instanceof IndexedMap ? map.fork() : new Map(map);
