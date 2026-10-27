/** Minimal SemVer range check used for peer version evidence. */
type Version = readonly [number, number, number];

type Parsed = {
  readonly core: Version;
  /** Dot-separated prerelease identifiers, or null for a release. */
  readonly prerelease: readonly string[] | null;
};

/**
 * Release core with optional `-prerelease` and optional `+build` metadata
 * (build is ignored for precedence, as npm does).
 */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function parseVersion(value: unknown): Parsed | undefined {
  if (typeof value !== 'string') return undefined;
  const match = VERSION.exec(value);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? null : Object.freeze(match[4].split('.')),
  };
}

export function parseReleaseVersion(value: unknown): Version | undefined {
  const parsed = parseVersion(value);
  // Contract preserved: prereleases are not releases.
  if (!parsed || parsed.prerelease !== null) return undefined;
  return parsed.core;
}

function compareCore(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/u.test(a);
  const numericB = /^\d+$/u.test(b);
  if (numericA && numericB) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
    return 0;
  }
  if (numericA) return -1;
  if (numericB) return 1;
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}

function comparePrerelease(a: readonly string[] | null, b: readonly string[] | null): number {
  if (a === null && b === null) return 0;
  // A release outranks its own prereleases.
  if (a === null) return 1;
  if (b === null) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= a.length) return -1;
    if (index >= b.length) return 1;
    const order = compareIdentifiers(a[index]!, b[index]!);
    if (order !== 0) return order;
  }
  return 0;
}

function compareFull(a: Parsed, b: Parsed): number {
  return compareCore(a.core, b.core) || comparePrerelease(a.prerelease, b.prerelease);
}

type Comparator = {
  readonly test: (version: Parsed) => boolean;
  readonly core: Version;
  readonly hasPrerelease: boolean;
};

function comparators(range: string): Comparator[] | undefined {
  const parsed: Comparator[] = [];
  for (const token of range.trim().split(/\s+/u)) {
    if (token.startsWith('^')) {
      const floor = parseVersion(token.slice(1));
      if (!floor) return undefined;
      const ceiling: Version = floor.core[0] > 0 ? [floor.core[0] + 1, 0, 0]
        : floor.core[1] > 0 ? [0, floor.core[1] + 1, 0] : [0, 0, floor.core[2] + 1];
      parsed.push({
        test: (version) => compareFull(version, floor) >= 0 && compareCore(version.core, ceiling) < 0,
        core: floor.core,
        hasPrerelease: floor.prerelease !== null,
      });
      continue;
    }
    const match = /^(>=|<=|>|<|=)?(.+)$/u.exec(token);
    const bound = match ? parseVersion(match[2]) : undefined;
    if (!match || !bound) return undefined;
    const operator = match[1] ?? '=';
    parsed.push({
      test: (version) => {
        const order = compareFull(version, bound);
        switch (operator) {
          case '>=': return order >= 0;
          case '<=': return order <= 0;
          case '>': return order > 0;
          case '<': return order < 0;
          default: return order === 0;
        }
      },
      core: bound.core,
      hasPrerelease: bound.prerelease !== null,
    });
  }
  return parsed.length > 0 ? parsed : undefined;
}

function coresEqual(a: Version, b: Version): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * npm-style prerelease rule: a prerelease version satisfies an alternative
 * only when that alternative names a prerelease comparator on the same
 * `[major, minor, patch]` tuple. Ranges without any prerelease comparator
 * behave exactly as before (prereleases refused); build metadata is stripped.
 */
export function satisfiesRange(version: unknown, range: string): boolean {
  const parsed = parseVersion(version);
  const alternatives = range.split('||').map(comparators);
  if (!parsed || alternatives.some((tests) => !tests)) return false;
  return alternatives.some((tests) => {
    if (parsed.prerelease !== null) {
      const named = tests!.some((comparator) => comparator.hasPrerelease && coresEqual(comparator.core, parsed.core));
      if (!named) return false;
    }
    return tests!.every((comparator) => comparator.test(parsed));
  });
}
