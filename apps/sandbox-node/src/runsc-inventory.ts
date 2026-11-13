/** runsc release-20261102.0 prints null for an empty root. Reject every other shape. */
export function parseRunscList(text: string): Array<{ id: string }> {
  const value: unknown = JSON.parse(text);
  if (value === null) return [];
  if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string')) {
    throw new Error('invalid runsc inventory');
  }
  return value;
}
