// Immutable AVL nodes: indexed updates copy only their search path. Captured
// roots share all untouched subtrees and require no historical enumeration.
export interface IndexedNode<V> {
  readonly key: string;
  readonly value: V;
  readonly left: IndexedNode<V> | null;
  readonly right: IndexedNode<V> | null;
  readonly height: number;
  readonly size: number;
}
type Tree<V> = IndexedNode<V> | null;
const height = <V>(tree: Tree<V>): number => tree?.height ?? 0;
const node = <V>(entry: { readonly key: string; readonly value: V }, left: Tree<V>, right: Tree<V>): IndexedNode<V> => Object.freeze({
  key: entry.key, value: entry.value, left, right,
  height: 1 + Math.max(height(left), height(right)),
  size: 1 + (left?.size ?? 0) + (right?.size ?? 0),
});

const balance = <V>(entry: IndexedNode<V>): IndexedNode<V> => {
  const delta = height(entry.left) - height(entry.right);
  if (delta > 1) {
    const left = entry.left!;
    if (height(left.left) < height(left.right)) {
      const pivot = left.right!;
      return node(pivot, node(left, left.left, pivot.left), node(entry, pivot.right, entry.right));
    }
    return node(left, left.left, node(entry, left.right, entry.right));
  }
  if (delta < -1) {
    const right = entry.right!;
    if (height(right.right) < height(right.left)) {
      const pivot = right.left!;
      return node(pivot, node(entry, entry.left, pivot.left), node(right, pivot.right, right.right));
    }
    return node(right, node(entry, entry.left, right.left), right.right);
  }
  return entry;
};

export const findIndexed = <V>(tree: Tree<V>, key: string): IndexedNode<V> | null => {
  let current = tree;
  while (current) {
    if (key === current.key) return current;
    current = key < current.key ? current.left : current.right;
  }
  return null;
};

export const putIndexed = <V>(tree: Tree<V>, key: string, value: V): IndexedNode<V> => {
  if (!tree) return node({ key, value }, null, null);
  if (key === tree.key) return node({ key, value }, tree.left, tree.right);
  return balance(key < tree.key
    ? node(tree, putIndexed(tree.left, key, value), tree.right)
    : node(tree, tree.left, putIndexed(tree.right, key, value)));
};

export const removeIndexed = <V>(tree: Tree<V>, key: string): Tree<V> => {
  if (!tree) return null;
  if (key < tree.key) return balance(node(tree, removeIndexed(tree.left, key), tree.right));
  if (key > tree.key) return balance(node(tree, tree.left, removeIndexed(tree.right, key)));
  if (!tree.left) return tree.right;
  if (!tree.right) return tree.left;
  let successor = tree.right;
  while (successor.left) successor = successor.left;
  return balance(node(successor, tree.left, removeIndexed(tree.right, successor.key)));
};

export function* indexedEntries<V>(tree: Tree<V>): IterableIterator<[string, V]> {
  if (!tree) return;
  yield* indexedEntries(tree.left);
  yield [tree.key, tree.value];
  yield* indexedEntries(tree.right);
}
