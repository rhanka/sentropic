// Minimal, tolerant BRANCH.md parser. Extracts the structure C1/C2 need:
// title, scope buckets (Allowed/Forbidden/Conditional path globs), exception ids, and lots.
// Malformed/partial input yields empty fields — never throws.

export interface ParsedLotItem {
  text: string;
  checked: boolean;
}

export interface ParsedLot {
  title: string;
  checked: boolean;
  items: ParsedLotItem[];
}

export interface ParsedBranchMd {
  title: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  conditionalPaths: string[];
  exceptions: string[];
  lots: ParsedLot[];
}

const BACKTICK = /`([^`]+)`/g;
const EXCEPTION = /\bBR\d+[a-z]?-EX\d+\b/g;

function backtickGlobs(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(BACKTICK)) out.push(m[1]);
  return out;
}

export function parseBranchMd(text: string): ParsedBranchMd {
  const lines = text.split(/\r?\n/);
  const result: ParsedBranchMd = {
    title: '',
    allowedPaths: [],
    forbiddenPaths: [],
    conditionalPaths: [],
    exceptions: [],
    lots: [],
  };

  // Title: first `# ` heading (single hash), stripped of a leading "Feature:".
  for (const line of lines) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) {
      result.title = m[1].replace(/^Feature:\s*/i, '').trim();
      break;
    }
  }

  let bucket: 'allowed' | 'forbidden' | 'conditional' | null = null;
  let inPlan = false;
  let currentLot: ParsedLot | null = null;

  const pushBucket = (globs: string[]): void => {
    if (bucket === 'allowed') result.allowedPaths.push(...globs);
    else if (bucket === 'forbidden') result.forbiddenPaths.push(...globs);
    else if (bucket === 'conditional') result.conditionalPaths.push(...globs);
  };

  for (const line of lines) {
    for (const m of line.matchAll(EXCEPTION)) result.exceptions.push(m[0]);

    if (/^##\s+/.test(line)) {
      bucket = null;
      inPlan = /plan\s*\/\s*todo/i.test(line);
      currentLot = null;
      continue;
    }

    // Prefix-match the bucket headings: the canonical BRANCH_TEMPLATE.md carries a
    // parenthetical suffix (e.g. `**Allowed Paths (implementation scope)**`), so the
    // closing `**` is NOT adjacent to "Paths". Match the prefix only (as Conditional
    // already did) — otherwise Allowed/Forbidden silently parse to empty on every
    // real BRANCH.md and in-scope files wrongly classify as `unknown`.
    if (/\*\*Allowed Paths/i.test(line)) {
      bucket = 'allowed';
      pushBucket(backtickGlobs(line));
      continue;
    }
    if (/\*\*Forbidden Paths/i.test(line)) {
      bucket = 'forbidden';
      pushBucket(backtickGlobs(line));
      continue;
    }
    if (/\*\*Conditional Paths/i.test(line)) {
      bucket = 'conditional';
      pushBucket(backtickGlobs(line));
      continue;
    }

    if (bucket && /^\s+-\s/.test(line)) {
      pushBucket(backtickGlobs(line));
      continue;
    }
    if (bucket && /^-\s/.test(line)) {
      bucket = null;
    }

    if (inPlan) {
      const lotMatch = /^-\s*\[( |x)\]\s*\*\*(Lot[^*]+)\*\*/i.exec(line);
      if (lotMatch) {
        currentLot = {
          title: lotMatch[2].trim(),
          checked: lotMatch[1].toLowerCase() === 'x',
          items: [],
        };
        result.lots.push(currentLot);
        continue;
      }
      const itemMatch = /^\s+-\s*\[( |x)\]\s*(.+)$/.exec(line);
      if (itemMatch && currentLot) {
        currentLot.items.push({
          text: itemMatch[2].trim(),
          checked: itemMatch[1].toLowerCase() === 'x',
        });
      }
    }
  }

  result.exceptions = [...new Set(result.exceptions)];
  return result;
}
