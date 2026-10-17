/**
 * L-5c — source references (spec-v8 §9 5c).
 *
 * A source is explicit provenance attached to an artifact: the original
 * inline bytes, a base commit, or a build recipe. Validation is strict at
 * attach time (known kind, non-empty commit/steps) — sources are declared,
 * never inferred from content.
 */
export type SourceRef =
  | { kind: 'inline-original' }
  | { kind: 'base-commit'; commit: string }
  | { kind: 'recipe'; steps: string[] };

/** Parse an untrusted source payload into a validated reference (no casts). */
export function parseSourceRef(value: unknown): SourceRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid source: must be an object');
  }
  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'inline-original':
      return attachSource({ kind: 'inline-original' });
    case 'base-commit': {
      const commit = record['commit'];
      if (typeof commit !== 'string') throw new Error('invalid source: missing commit');
      return attachSource({ kind: 'base-commit', commit });
    }
    case 'recipe': {
      const steps = record['steps'];
      if (!Array.isArray(steps) || steps.some((step) => typeof step !== 'string')) {
        throw new Error('invalid source: steps must be strings');
      }
      return attachSource({ kind: 'recipe', steps: steps as string[] });
    }
    default:
      throw new Error(`invalid source: unknown kind ${String(record['kind'])}`);
  }
}

/** Validate and attach a source reference (fail-closed on unknown kinds). */
export function attachSource(source: SourceRef): SourceRef {
  switch (source.kind) {
    case 'inline-original':
      return { kind: 'inline-original' };
    case 'base-commit':
      if (source.commit.length === 0) throw new Error('invalid source: empty commit');
      return { kind: 'base-commit', commit: source.commit };
    case 'recipe':
      if (source.steps.length === 0) throw new Error('invalid source: empty steps');
      return { kind: 'recipe', steps: [...source.steps] };
    default:
      throw new Error(`invalid source: unknown kind ${(source as { kind: string }).kind}`);
  }
}

export interface SourceStore {
  getSource(artifactId: string): Promise<SourceRef | undefined>;
  putSource(artifactId: string, source: SourceRef): Promise<void>;
}

/** In-memory SourceStore double for unit tests. */
export function createMemorySourceStore(): SourceStore {
  const sources = new Map<string, SourceRef>();
  return {
    getSource(artifactId: string): Promise<SourceRef | undefined> {
      return Promise.resolve(sources.get(artifactId));
    },
    putSource(artifactId: string, source: SourceRef): Promise<void> {
      sources.set(artifactId, source);
      return Promise.resolve();
    },
  };
}
