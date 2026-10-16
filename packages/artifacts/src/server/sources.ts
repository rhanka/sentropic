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
