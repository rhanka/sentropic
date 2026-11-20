import { createHash } from 'node:crypto';
import type {
  CustomSecretPattern, SecretMatch, SecretScanOptions, SecretScannerPort,
} from '../ports/guards.js';

/** Vendored pure-TS kubeconfig secret patterns from `@sentropic/agent-stats-core` (zero external deps). */
export const KUBECONFIG_PATTERNS: readonly CustomSecretPattern[] = [
  { id: 'kubeconfig-blob', pattern: 'YXBpVmVyc2lvbjogdjEKa2luZDogQ29uZmln[A-Za-z0-9+/=\\r\\n]{200,}' },
  { id: 'kubeconfig-client-key-data', pattern: '(?<=client-key-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}' },
  { id: 'kubeconfig-client-certificate-data', pattern: '(?<=client-certificate-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}' },
  { id: 'kubeconfig-certificate-authority-data', pattern: '(?<=certificate-authority-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}' },
  { id: 'kubeconfig-token', pattern: '(?<=token:\\s*["\']?)[A-Za-z0-9._\\-+/=]{20,}' },
  { id: 'kubeconfig-pem-material', pattern: 'LS0t[A-Za-z0-9+/=]{40,}' },
];

const sha256Short = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex').slice(0, 16);

export const formatSecretRedactionTag = (ruleId: string, secret: string): string =>
  `<<SECRET:${ruleId.replace(/[^a-zA-Z0-9_-]/g, '_')}:${sha256Short(secret)}>>`;

const COMPILED_REGEX_CACHE = new Map<string, RegExp | null>();
const MAX_REGEX_CACHE = 256;

const compileCustomRegex = (pattern: string, rawFlags?: string): RegExp | null => {
  const flags = new Set((rawFlags ?? '').split(''));
  flags.delete('y');
  flags.add('g');
  const normalized = [...flags].sort().join('');
  const key = `${pattern}\0${normalized}`;
  if (COMPILED_REGEX_CACHE.has(key)) return COMPILED_REGEX_CACHE.get(key) ?? null;
  let compiled: RegExp | null;
  try { compiled = new RegExp(pattern, normalized); } catch { compiled = null; }
  if (COMPILED_REGEX_CACHE.size >= MAX_REGEX_CACHE) {
    const oldest = COMPILED_REGEX_CACHE.keys().next().value;
    if (oldest !== undefined) COMPILED_REGEX_CACHE.delete(oldest);
  }
  COMPILED_REGEX_CACHE.set(key, compiled);
  return compiled;
};

/** Scan text against structured custom regex patterns; enforces global (`g`) flag and strips sticky (`y`). */
export const scanCustom = (text: string, patterns: readonly CustomSecretPattern[]): SecretMatch[] => {
  if (!text || patterns.length === 0) return [];
  const matches: SecretMatch[] = [];
  for (const p of patterns) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.pattern !== 'string' || !p.pattern) continue;
    const re = compileCustomRegex(p.pattern, p.flags);
    if (!re) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || m[0].length === 0) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, ruleId: `custom:${p.id}`, message: `custom pattern ${p.id}` });
    }
  }
  return matches;
};

/**
 * Normalize matches into strictly disjoint ranges (`kept[i].end <= kept[i + 1].start`).
 * Merges any partial overlap (`m.start < prev.end`) into `[prev.start, Math.max(prev.end, m.end)]`
 * while keeping the earlier/higher-priority `ruleId` so reverse-offset slicing never corrupts output.
 */
export const dedupeRanges = (matches: readonly SecretMatch[]): SecretMatch[] => {
  const valid = matches.filter(
    (m) => Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end > m.start,
  );
  const sorted = [...valid].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: SecretMatch[] = [];
  for (const m of sorted) {
    const prev = kept[kept.length - 1];
    if (!prev || m.start >= prev.end) kept.push({ ...m });
    else if (m.end > prev.end) kept[kept.length - 1] = { ...prev, end: m.end };
  }
  return kept;
};

/** Normalize & clamp match ranges to `[0, text.length]` as strictly disjoint intervals. */
export const normalizeSecretMatches = (text: string, matches: readonly SecretMatch[]): SecretMatch[] =>
  !text || matches.length === 0
    ? []
    : dedupeRanges(
      matches
        .map((m) => ({
          ...m,
          start: Math.max(0, Math.min(m.start, text.length)),
          end: Math.max(0, Math.min(m.end, text.length)),
        }))
        .filter((m) => m.end > m.start),
    );

export const redactSecretMatches = (text: string, matches: readonly SecretMatch[]): string => {
  const disjoint = normalizeSecretMatches(text, matches);
  if (disjoint.length === 0) return text;
  let out = text;
  for (let i = disjoint.length - 1; i >= 0; i -= 1) {
    const m = disjoint[i]!;
    out = out.slice(0, m.start) + formatSecretRedactionTag(m.ruleId, out.slice(m.start, m.end)) + out.slice(m.end);
  }
  return out;
};

const resolveSecretPatterns = (options: SecretScanOptions = {}): readonly CustomSecretPattern[] => {
  const defaults = options.includeDefaultPatterns === false ? [] : KUBECONFIG_PATTERNS;
  return options.customPatterns?.length ? [...options.customPatterns, ...defaults] : defaults;
};

export const scanSecrets = (text: string, options: SecretScanOptions = {}): SecretMatch[] => {
  if (!text) return [];
  const patterns = resolveSecretPatterns(options);
  return patterns.length > 0 ? dedupeRanges(scanCustom(text, patterns)) : [];
};

export class PureSecretScanner implements SecretScannerPort {
  private readonly defaultOptions: SecretScanOptions;

  constructor(options: SecretScanOptions = {}) {
    this.defaultOptions = options;
  }

  private mergeOptions(options?: SecretScanOptions): SecretScanOptions {
    const includeDefaultPatterns = options?.includeDefaultPatterns ?? this.defaultOptions.includeDefaultPatterns;
    const customPatterns = [...(this.defaultOptions.customPatterns ?? []), ...(options?.customPatterns ?? [])];
    const filePath = options?.filePath ?? this.defaultOptions.filePath;
    return {
      ...(filePath !== undefined ? { filePath } : {}),
      ...(includeDefaultPatterns !== undefined ? { includeDefaultPatterns } : {}),
      ...(customPatterns.length > 0 ? { customPatterns } : {}),
    };
  }

  scanRaw(text: string, options?: SecretScanOptions): readonly SecretMatch[] {
    if (!text) return [];
    const patterns = resolveSecretPatterns(this.mergeOptions(options));
    return patterns.length > 0 ? scanCustom(text, patterns) : [];
  }

  scan(text: string, options?: SecretScanOptions): readonly SecretMatch[] {
    const raw = this.scanRaw(text, options);
    return raw.length > 0 ? dedupeRanges(raw) : [];
  }
}
