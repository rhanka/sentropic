import { extname } from 'node:path';
import { creator as presetRecommend } from '@secretlint/secretlint-rule-preset-recommend';
import type {
  SecretLintCoreConfig, SecretLintRuleContext, SecretLintRuleCreator, SecretLintRulePresetContext,
  SecretLintSourceCode, SecretLintSourceNodeLocation, SecretLintSourceNodePosition, SecretLintSourceNodeRange,
} from '@secretlint/types';
import type {
  CustomSecretPattern, GuardEngineOptions, SecretMatch, SecretScanOptions, SecretScannerPort,
} from '@sentropic/llm-gateway';
import {
  KUBECONFIG_PATTERNS, SECRETLINT_MAX_YAML_BYTES, SecretPatternYamlError,
  dedupeSecretRanges, loadSecretPatterns, parseSecretPatternsYaml, scanCustomPatterns,
  type SecretPatternYamlErrorCode,
} from './secretlint-yaml-patterns';

export {
  SECRETLINT_MAX_YAML_BYTES, SecretPatternYamlError, loadSecretPatterns, parseSecretPatternsYaml,
  type SecretPatternYamlErrorCode,
};

const FILTER_COMMENTS_RULE_ID = '@secretlint/secretlint-rule-filter-comments';
export const SECRETLINT_SCAN_WINDOW_CHARS = 512 * 1024;
export const SECRETLINT_SCAN_OVERLAP_CHARS = 16 * 1024;
export const SECRETLINT_MAX_SCAN_CHARS = 32 * 1024 * 1024;
const SECRETLINT_HARD_MAX_SCAN_CHARS = 32 * 1024 * 1024;
export const SECRETLINT_SCAN_LIMIT_RULE_ID = '@sentropic/secretlint-scan-limit-exceeded';
export const SECRETLINT_PRESET_RULE_COUNT = presetRecommend.rules.length;

const dedupePerRule = (matches: readonly SecretMatch[]): SecretMatch[] => {
  if (matches.length <= 1) return [...matches];
  const byRule = new Map<string, SecretMatch[]>();
  for (const m of matches) {
    const bucket = byRule.get(m.ruleId);
    if (bucket) bucket.push(m);
    else byRule.set(m.ruleId, [m]);
  }
  const out: SecretMatch[] = [];
  for (const bucket of byRule.values()) out.push(...dedupeSecretRanges(bucket));
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
};

const windowSlices = (text: string, limit: number): { offset: number; chunk: string }[] => {
  const cap = Math.min(text.length, limit);
  if (cap <= SECRETLINT_SCAN_WINDOW_CHARS) return [{ offset: 0, chunk: text.slice(0, cap) }];
  const step = SECRETLINT_SCAN_WINDOW_CHARS - SECRETLINT_SCAN_OVERLAP_CHARS;
  const slices: { offset: number; chunk: string }[] = [];
  let offset = 0;
  while (offset < cap) {
    let end = Math.min(cap, offset + SECRETLINT_SCAN_WINDOW_CHARS);
    if (end < cap && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
    slices.push({ offset, chunk: text.slice(offset, end) });
    if (end >= cap) break;
    let next = offset + step;
    if (next > 0 && text.charCodeAt(next - 1) >= 0xd800 && text.charCodeAt(next - 1) <= 0xdbff) next -= 1;
    offset = next;
  }
  return slices;
};

const scanLimitMatch = (textLength: number, maxScanChars: number): SecretMatch => ({
  start: Math.max(0, maxScanChars - SECRETLINT_SCAN_OVERLAP_CHARS),
  end: textLength,
  ruleId: SECRETLINT_SCAN_LIMIT_RULE_ID,
  message: 'scan input exceeded maxScanChars; uninspected tail',
});

export interface SecretlintScannerOptions extends SecretScanOptions {
  readonly patternsFilePath?: string;
  readonly maxScanChars?: number;
  readonly maxYamlBytes?: number;
  readonly honorDisableComments?: boolean;
}
export type SecretlintGuardOptions = Omit<GuardEngineOptions, 'secretScanner'> & SecretlintScannerOptions;

const PRESET_RULES: SecretLintRuleCreator<Record<string, unknown>>[] = [];
const collector: SecretLintRulePresetContext = {
  sharedOptions: {},
  registerRule(rule) { PRESET_RULES.push(rule as SecretLintRuleCreator<Record<string, unknown>>); },
};
presetRecommend.create(collector, {});

const safeExt = (filePath: string): string => {
  const ext = extname(filePath).toLowerCase();
  return ext === '.p12' ? '' : ext;
};

const createSyncSourceCode = (raw: string, filePath: string): { source: SecretLintSourceCode; bomOffset: number } => {
  const hasBOM = raw.charCodeAt(0) === 0xfeff;
  const content = hasBOM ? raw.slice(1) : raw;
  const ext = safeExt(filePath);
  let lineStarts: number[] | undefined;
  const starts = (): number[] => {
    if (!lineStarts) {
      lineStarts = [0];
      for (let i = 0; i < content.length; i += 1) {
        const ch = content.charCodeAt(i);
        if (ch === 13) {
          if (content.charCodeAt(i + 1) === 10) i += 1;
          if (i + 1 < content.length) lineStarts.push(i + 1);
        } else if (ch === 10 || ch === 0x2028 || ch === 0x2029) {
          if (i + 1 < content.length) lineStarts.push(i + 1);
        }
      }
    }
    return lineStarts;
  };
  const indexToPosition = (index: number): SecretLintSourceNodePosition => {
    const s = starts(); let lo = 0; let hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid]! <= index) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: index - s[lo]! };
  };
  const positionToIndex = (pos: SecretLintSourceNodePosition): number => {
    const s = starts();
    if (pos.line - 1 >= s.length) return content.length + 1;
    const base = s[Math.max(0, pos.line - 1)] ?? 0;
    return Math.min(content.length, base + Math.max(0, pos.column));
  };
  return {
    bomOffset: hasBOM ? 1 : 0,
    source: {
      hasBOM, content, filePath, physicalFilePath: undefined, contentType: 'text', ext,
      getFilePath: () => filePath, getPhysicalFilePath: () => undefined, indexToPosition, positionToIndex,
      locationToRange: (loc: SecretLintSourceNodeLocation): SecretLintSourceNodeRange => [positionToIndex(loc.start), positionToIndex(loc.end)],
      rangeToLocation: (range: SecretLintSourceNodeRange): SecretLintSourceNodeLocation => ({ start: indexToPosition(range[0]), end: indexToPosition(range[1]) }),
    },
  };
};

const runPresetSync = (text: string, filePath: string, honorDisableComments: boolean): SecretMatch[] => {
  const { source, bomOffset } = createSyncSourceCode(text, filePath);
  const reported: SecretMatch[] = [];
  const ignored: { start: number; end: number; targetRuleId: string }[] = [];
  for (const rule of PRESET_RULES) {
    if (!honorDisableComments && rule.meta.id === FILTER_COMMENTS_RULE_ID) continue;
    if (!rule.meta.supportedContentTypes.includes('text') && !rule.meta.supportedContentTypes.includes('all')) continue;
    const ctx: SecretLintRuleContext = {
      sharedOptions: {},
      createTranslator: (() => (messageId: string, data?: unknown) => ({ message: messageId, messageId, data })) as unknown as SecretLintRuleContext['createTranslator'],
      report: (d) => { reported.push({ start: d.range[0] + bomOffset, end: d.range[1] + bomOffset, ruleId: rule.meta.id, message: `secret detected by ${rule.meta.id}` }); },
      ignore: (d) => { ignored.push({ start: d.range[0] + bomOffset, end: d.range[1] + bomOffset, targetRuleId: d.targetRuleId }); },
    };
    rule.create(ctx, {}).file?.(source);
  }
  return !honorDisableComments || ignored.length === 0 ? reported
    : reported.filter((m) => !ignored.some((ig) => (ig.targetRuleId === '*' || ig.targetRuleId === m.ruleId) && ig.start <= m.start && m.end <= ig.end));
};

export class SecretlintScannerAdapter implements SecretScannerPort {
  private readonly defaultFilePath: string;
  private readonly defaultIncludeKubeconfig: boolean;
  private readonly baseCustomPatterns: readonly CustomSecretPattern[];
  private readonly maxScanChars: number;
  private readonly honorDisableComments: boolean;
  private readonly lintConfig: SecretLintCoreConfig;

  constructor(options: SecretlintScannerOptions = {}) {
    this.defaultFilePath = options.filePath ?? 'inline.txt';
    this.defaultIncludeKubeconfig = options.includeDefaultPatterns ?? true;
    const loaded = options.patternsFilePath ? loadSecretPatterns(options.patternsFilePath, options.maxYamlBytes) : [];
    this.baseCustomPatterns = [...loaded, ...(options.customPatterns ?? [])];
    const rawMax = options.maxScanChars;
    this.maxScanChars = typeof rawMax === 'number' && Number.isFinite(rawMax)
      ? Math.max(1, Math.min(Math.floor(rawMax), SECRETLINT_HARD_MAX_SCAN_CHARS))
      : SECRETLINT_MAX_SCAN_CHARS;
    this.honorDisableComments = options.honorDisableComments === true;
    const activeRules = this.honorDisableComments ? PRESET_RULES : PRESET_RULES.filter((r) => r.meta.id !== FILTER_COMMENTS_RULE_ID);
    this.lintConfig = { rules: activeRules.map((rule) => ({ id: rule.meta.id, rule })) };
  }

  private resolvePatterns(options?: SecretScanOptions): readonly CustomSecretPattern[] {
    const defaults = (options?.includeDefaultPatterns ?? this.defaultIncludeKubeconfig) ? KUBECONFIG_PATTERNS : [];
    return [...this.baseCustomPatterns, ...(options?.customPatterns ?? []), ...defaults];
  }

  scanRaw(text: string, options?: SecretScanOptions): readonly SecretMatch[] {
    if (!text) return [];
    const filePath = options?.filePath ?? this.defaultFilePath;
    const patterns = this.resolvePatterns(options);
    const matches: SecretMatch[] = [];
    for (const { offset, chunk } of windowSlices(text, this.maxScanChars)) {
      for (const m of runPresetSync(chunk, filePath, this.honorDisableComments)) {
        matches.push({ ...m, start: m.start + offset, end: m.end + offset });
      }
      for (const m of scanCustomPatterns(chunk, patterns)) {
        matches.push({ ...m, start: m.start + offset, end: m.end + offset });
      }
    }
    const deduped = dedupePerRule(matches);
    if (text.length > this.maxScanChars) deduped.push(scanLimitMatch(text.length, this.maxScanChars));
    return deduped;
  }

  scan(text: string, options?: SecretScanOptions): readonly SecretMatch[] {
    const raw = this.scanRaw(text, options);
    return raw.length > 0 ? dedupeSecretRanges(raw) : [];
  }

  async scanAsync(text: string, options?: SecretScanOptions): Promise<readonly SecretMatch[]> {
    if (!text) return [];
    const filePath = options?.filePath ?? this.defaultFilePath;
    const ext = safeExt(filePath);
    const patterns = this.resolvePatterns(options);
    const { lintSource } = await import('@secretlint/core');
    const matches: SecretMatch[] = [];
    for (const { offset, chunk } of windowSlices(text, this.maxScanChars)) {
      const bomOffset = chunk.charCodeAt(0) === 0xfeff ? 1 : 0;
      const result = await lintSource({
        source: { filePath, ext, content: chunk, contentType: 'text' },
        options: { config: this.lintConfig, maskSecrets: true, noPhysicFilePath: true },
      });
      for (const m of result.messages) {
        matches.push({
          start: m.range[0] + bomOffset + offset,
          end: m.range[1] + bomOffset + offset,
          ruleId: m.ruleId,
          message: `secret detected by ${m.ruleId}`,
        });
      }
      for (const m of scanCustomPatterns(chunk, patterns)) {
        matches.push({ ...m, start: m.start + offset, end: m.end + offset });
      }
    }
    const deduped = dedupePerRule(matches);
    if (text.length > this.maxScanChars) deduped.push(scanLimitMatch(text.length, this.maxScanChars));
    return dedupeSecretRanges(deduped);
  }
}

export const createSecretlintScannerAdapter = (options?: SecretlintScannerOptions): SecretlintScannerAdapter =>
  new SecretlintScannerAdapter(options);
