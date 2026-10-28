export type TodoToolTask = {
  id?: string;
  title: string;
  status?: string;
};

export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const normalizeTaskStatus = (value: unknown): string =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : 'todo';

export const asTaskList = (value: unknown): TodoToolTask[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): TodoToolTask | null => {
      const item = asRecord(entry);
      if (!item) return null;
      const title = String(item.title ?? '').trim();
      if (!title) return null;
      const id = String(item.id ?? '').trim();
      const status = normalizeTaskStatus(item.status ?? item.derivedStatus);
      return id ? { id, title, status } : { title, status };
    })
    .filter((entry): entry is TodoToolTask => entry !== null);
};

