import { readFileSync, statSync } from 'node:fs';
import yaml from 'js-yaml';
import type { CustomSecretPattern, SecretMatch } from '@sentropic/llm-gateway';

export const SECRETLINT_MAX_YAML_BYTES = 256 * 1024;
const SECRETLINT_MAX_CUSTOM_PATTERNS = 256;
const SECRETLINT_MAX_PATTERN_LENGTH = 512;

export const KUBECONFIG_PATTERNS: readonly CustomSecretPattern[] = [
  { id: 'kubeconfig-blob', pattern: 'YXBpVmVyc2lvbjogdjEKa2luZDogQ29uZmln[A-Za-z0-9+/=\\r\\n]{200,}' },
  { id: 'kubeconfig-client-key-data', pattern: '(?<=client-key-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}' },
  { id: 'kubeconfig-client-certificate-data', pattern: '(?<=client-certificate-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}' },
  { id: 'kubeconfig-certificate-authority-data', pattern: '(?<=certificate-authority-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}' },
  { id: 'kubeconfig-token', pattern: '(?<=token:\\s*["\']?)[A-Za-z0-9._\\-+/=]{20,}' },
  { id: 'kubeconfig-pem-material', pattern: 'LS0t[A-Za-z0-9+/=]{40,}' },
];

export type SecretPatternYamlErrorCode = 'yaml_too_large' | 'unsafe_or_invalid_yaml' | 'yaml_read_failed';

export class SecretPatternYamlError extends Error {
  constructor(readonly code: SecretPatternYamlErrorCode, message: string) {
    super(message);
    this.name = 'SecretPatternYamlError';
  }
}

const resolveMaxYamlBytes = (maxBytes?: number): number =>
  typeof maxBytes === 'number' && Number.isFinite(maxBytes)
    ? Math.max(1, Math.min(Math.floor(maxBytes), SECRETLINT_MAX_YAML_BYTES))
    : SECRETLINT_MAX_YAML_BYTES;

/** Parse custom secret patterns from YAML strictly via `yaml.safeLoad` + `JSON_SCHEMA`. */
export const parseSecretPatternsYaml = (raw: string, maxBytes = SECRETLINT_MAX_YAML_BYTES): CustomSecretPattern[] => {
  const limit = resolveMaxYamlBytes(maxBytes);
  if (Buffer.byteLength(raw, 'utf8') > limit) {
    throw new SecretPatternYamlError('yaml_too_large', 'secret patterns YAML exceeds size limit');
  }
  let parsed: unknown;
  try { parsed = yaml.safeLoad(raw, { schema: yaml.JSON_SCHEMA }); }
  catch { throw new SecretPatternYamlError('unsafe_or_invalid_yaml', 'secret patterns YAML rejected by safeLoad JSON_SCHEMA'); }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { patterns?: unknown }).patterns)
      ? (parsed as { patterns: unknown[] }).patterns
      : [];
  const out: CustomSecretPattern[] = [];
  for (const item of list) {
    if (out.length >= SECRETLINT_MAX_CUSTOM_PATTERNS) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { id, pattern, flags } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 64) continue;
    if (typeof pattern !== 'string' || !pattern || pattern.length > SECRETLINT_MAX_PATTERN_LENGTH) continue;
    if (flags !== undefined && (typeof flags !== 'string' || flags.length > 8)) continue;
    try { new RegExp(pattern, flags ?? ''); } catch { continue; }
    out.push({ id, pattern, ...(flags !== undefined ? { flags } : {}) });
  }
  return out;
};

/** Read and parse a YAML custom-pattern file with upfront size bound and `safeLoad` only. */
export const loadSecretPatterns = (filePath: string, maxBytes = SECRETLINT_MAX_YAML_BYTES): CustomSecretPattern[] => {
  const limit = resolveMaxYamlBytes(maxBytes);
  let size: number;
  let isRegularFile: boolean;
  try {
    const st = statSync(filePath);
    size = st.size;
    isRegularFile = st.isFile();
  } catch {
    throw new SecretPatternYamlError('yaml_read_failed', 'secret patterns YAML file cannot be read');
  }
  if (!isRegularFile) {
    throw new SecretPatternYamlError('yaml_read_failed', 'secret patterns YAML path is not a regular file');
  }
  if (size > limit) throw new SecretPatternYamlError('yaml_too_large', 'secret patterns YAML file exceeds size limit');
  try { return parseSecretPatternsYaml(readFileSync(filePath, 'utf8'), limit); }
  catch (err) {
    if (err instanceof SecretPatternYamlError) throw err;
    throw new SecretPatternYamlError('yaml_read_failed', 'secret patterns YAML file cannot be read');
  }
};

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

export const scanCustomPatterns = (text: string, patterns: readonly CustomSecretPattern[]): SecretMatch[] => {
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

export const dedupeSecretRanges = (matches: readonly SecretMatch[]): SecretMatch[] => {
  const valid = matches.filter((m) => Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end > m.start);
  const sorted = [...valid].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: SecretMatch[] = [];
  for (const m of sorted) {
    const prev = kept[kept.length - 1];
    if (!prev || m.start >= prev.end) kept.push({ ...m });
    else if (m.end > prev.end) kept[kept.length - 1] = { ...prev, end: m.end };
  }
  return kept;
};
