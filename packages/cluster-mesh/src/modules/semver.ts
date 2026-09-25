/** Minimal release-only SemVer range check used for peer version evidence. */
type Version = readonly [number, number, number];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseReleaseVersion(value: unknown): Version | undefined {
  if (typeof value !== 'string') return undefined;
  const match = VERSION.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

function comparators(range: string): ((version: Version) => boolean)[] | undefined {
  const tests: ((version: Version) => boolean)[] = [];
  for (const token of range.trim().split(/\s+/u)) {
    if (token.startsWith('^')) {
      const floor = parseReleaseVersion(token.slice(1));
      if (!floor) return undefined;
      const ceiling: Version = floor[0] > 0 ? [floor[0] + 1, 0, 0]
        : floor[1] > 0 ? [0, floor[1] + 1, 0] : [0, 0, floor[2] + 1];
      tests.push((version) => compare(version, floor) >= 0 && compare(version, ceiling) < 0);
      continue;
    }
    const match = /^(>=|<=|>|<|=)?(.+)$/u.exec(token);
    const bound = match ? parseReleaseVersion(match[2]) : undefined;
    if (!match || !bound) return undefined;
    const operator = match[1] ?? '=';
    tests.push((version) => {
      const order = compare(version, bound);
      switch (operator) {
        case '>=': return order >= 0;
        case '<=': return order <= 0;
        case '>': return order > 0;
        case '<': return order < 0;
        default: return order === 0;
      }
    });
  }
  return tests.length > 0 ? tests : undefined;
}

/** Prerelease, build metadata and malformed versions or ranges never satisfy. */
export function satisfiesRange(version: unknown, range: string): boolean {
  const parsed = parseReleaseVersion(version);
  const tests = comparators(range);
  if (!parsed || !tests) return false;
  return tests.every((test) => test(parsed));
}
