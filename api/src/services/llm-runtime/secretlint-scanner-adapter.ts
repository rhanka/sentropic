import { extname } from 'node:path';
import { lintSource } from '@secretlint/core';
import { creator as presetRecommend } from '@secretlint/secretlint-rule-preset-recommend';
import type {
  SecretLintCoreConfig, SecretLintRuleContext, SecretLintRuleCreator, SecretLintRulePresetContext,
  SecretLintSourceCode, SecretLintSourceNodeLocation, SecretLintSourceNodePosition, SecretLintSourceNodeRange,
} from '@secretlint/types';
import {
  GuardEngine, KUBECONFIG_PATTERNS, dedupeRanges, scanCustom,
  type CustomSecretPattern, type GuardEngineOptions, type GuardPort,
  type SecretMatch, type SecretScanOptions, type SecretScannerPort,
} from '@sentropic/llm-gateway';
import {
  SECRETLINT_MAX_YAML_BYTES, SecretPatternYamlError, loadSecretPatterns, parseSecretPatternsYaml,
  type SecretPatternYamlErrorCode,
} from './secretlint-yaml-patterns';

export {
  SECRETLINT_MAX_YAML_BYTES, SecretPatternYamlError, loadSecretPatterns, parseSecretPatternsYaml,
  type SecretPatternYamlErrorCode,
};

const FILTER_COMMENTS_RULE_ID = '@secretlint/secretlint-rule-filter-comments';
export const SECRETLINT_MAX_SCAN_CHARS = 512 * 1024;
const SECRETLINT_HARD_MAX_SCAN_CHARS = 2 * 1024 * 1024;
export const SECRETLINT_PRESET_RULE_COUNT = presetRecommend.rules.length;

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

const createSyncSourceCode = (raw: string, filePath: string): { source: SecretLintSourceCode; bomOffset: number } => {
  const hasBOM = raw.charCodeAt(0) === 0xfeff;
  const content = hasBOM ? raw.slice(1) : raw;
  const rawExt = extname(filePath);
  const ext = rawExt === '.p12' ? '' : rawExt;
  let lineStarts: number[] | undefined;
  const starts = (): number[] => {
    if (!lineStarts) {
      lineStarts = [0];
      for (let i = 0; i < content.length; i += 1) if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);
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
    return Math.min(content.length, (s[Math.max(0, Math.min(pos.line - 1, s.length - 1))] ?? content.length) + Math.max(0, pos.column));
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
    this.maxScanChars = Math.max(1, Math.min(options.maxScanChars ?? SECRETLINT_MAX_SCAN_CHARS, SECRETLINT_HARD_MAX_SCAN_CHARS));
    this.honorDisableComments = options.honorDisableComments === true;
    const activeRules = this.honorDisableComments ? PRESET_RULES : PRESET_RULES.filter((r) => r.meta.id !== FILTER_COMMENTS_RULE_ID);
    this.lintConfig = { rules: activeRules.map((rule) => ({ id: rule.meta.id, rule })) };
  }

  private resolvePatterns(options?: SecretScanOptions): readonly CustomSecretPattern[] {
    const defaults = (options?.includeDefaultPatterns ?? this.defaultIncludeKubeconfig) ? KUBECONFIG_PATTERNS : [];
    return [...this.baseCustomPatterns, ...(options?.customPatterns ?? []), ...defaults];
  }

  private boundText(text: string): string { return text.length > this.maxScanChars ? text.slice(0, this.maxScanChars) : text; }

  scanRaw(text: string, options?: SecretScanOptions): readonly SecretMatch[] {
    if (!text) return [];
    const bounded = this.boundText(text);
    return [...runPresetSync(bounded, options?.filePath ?? this.defaultFilePath, this.honorDisableComments), ...scanCustom(bounded, this.resolvePatterns(options))];
  }

  scan(text: string, options?: SecretScanOptions): readonly SecretMatch[] {
    const raw = this.scanRaw(text, options);
    return raw.length > 0 ? dedupeRanges(raw) : [];
  }

  async scanAsync(text: string, options?: SecretScanOptions): Promise<readonly SecretMatch[]> {
    if (!text) return [];
    const bounded = this.boundText(text);
    const result = await lintSource({
      source: { filePath: options?.filePath ?? this.defaultFilePath, content: bounded, contentType: 'text' },
      options: { config: this.lintConfig, maskSecrets: true, noPhysicFilePath: true },
    });
    const preset: SecretMatch[] = result.messages.map((m) => ({
      start: m.range[0], end: m.range[1], ruleId: m.ruleId, message: `secret detected by ${m.ruleId}`,
    }));
    return dedupeRanges([...preset, ...scanCustom(bounded, this.resolvePatterns(options))]);
  }
}

export const createSecretlintScannerAdapter = (options?: SecretlintScannerOptions): SecretlintScannerAdapter =>
  new SecretlintScannerAdapter(options);

export const createSecretlintGuard = (options?: SecretlintGuardOptions): GuardPort =>
  new GuardEngine({ ...options, secretScanner: createSecretlintScannerAdapter(options) });
