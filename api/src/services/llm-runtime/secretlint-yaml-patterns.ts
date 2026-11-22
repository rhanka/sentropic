import { readFileSync, statSync } from 'node:fs';
import yaml from 'js-yaml';
import type { CustomSecretPattern } from '@sentropic/llm-gateway';

export const SECRETLINT_MAX_YAML_BYTES = 256 * 1024;
const SECRETLINT_MAX_CUSTOM_PATTERNS = 256;
const SECRETLINT_MAX_PATTERN_LENGTH = 512;

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
