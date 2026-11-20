import type {
  CustomSecretPattern, GuardActionPolicy, GuardDetectorCategory, GuardFinding, GuardPort,
  GuardScanResult, GuardTextScanResult, GuardVerdict, MaskedCapturePayload,
  SecretScanOptions, SecretScannerPort,
} from '../ports/guards.js';
import {
  PureSecretScanner, dedupeRanges, formatSecretRedactionTag,
} from './secret-scanner.js';

interface DetectorSpec {
  readonly id: string;
  readonly category: GuardDetectorCategory;
  readonly replacement: string;
  readonly pattern: RegExp;
  readonly validate?: (match: string) => boolean;
}

const luhnValid = (raw: string): boolean => {
  const digits = raw.replace(/\D/g, '');
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return digits.length > 0 && sum % 10 === 0;
};

const DETECTORS: readonly DetectorSpec[] = [
  { id: 'secret.pem_private_key', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { id: 'secret.auth_header', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b(?:(?:Proxy-)?Authorization\s*:\s*(?:Bearer|DPoP|Basic|Token|ApiKey)\s+\S+|DPoP\s*:\s*\S+|X-Api-Key\s*:\s*\S+|(?:Set-)?Cookie\s*:\s*[^\r\n"]+)/gi },
  { id: 'secret.sentropic_session', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\bgw-v[12]-[A-Za-z0-9_-]{16,}\b/g },
  { id: 'secret.anthropic_key', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\bsk-ant-(?:oat01-|ort01-)?[A-Za-z0-9_-]{16,}\b/g },
  { id: 'secret.openai_key', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'secret.google_key', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b(?:AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z._-]{16,})\b/g },
  { id: 'secret.aws_access_key', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'secret.vcs_saas_token', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g },
  { id: 'secret.jwt', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'secret.credential_uri', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:@/]+:[^\s@/]+@[^\s"'`]+/gi },
  { id: 'secret.env_assignment', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY)\s*=\s*(?:"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s"'`]+)/g },
  { id: 'pii.email', category: 'pii', replacement: '[REDACTED:EMAIL]',
    pattern: /(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+\b/g },
  { id: 'pii.card_pan', category: 'pii', replacement: '[REDACTED:CARD_PAN]',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhnValid(d); } },
  { id: 'pii.us_ssn', category: 'pii', replacement: '[REDACTED:US_SSN]',
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { id: 'pii.phone', category: 'pii', replacement: '[REDACTED:PHONE]',
    pattern: /(?<!\w)(?:\+\d{1,3}[-.\s])?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g },
  { id: 'pii.ca_sin', category: 'pii', replacement: '[REDACTED:CA_SIN]',
    pattern: /\b\d{3}[- ]\d{3}[- ]\d{3}\b/g,
    validate: (m) => { const d = m.replace(/\D/g, ''); return d.length === 9 && luhnValid(d); } },
];

const PROTECTED_ROOT_KEYS: ReadonlySet<string> = new Set([
  'system', 'instructions', 'metadata', 'client_metadata', 'safety_identifier',
  'user', 'prompt_cache_key', 'tools', 'additional_tools', 'safeguards', 'cache_control',
]);
const NON_MASKABLE_LINKAGE_KEYS: ReadonlySet<string> = new Set([
  'model', 'role', 'type', 'tool_use_id', 'tool_call_id', 'call_id',
]);
const isProtectedItem = (item: unknown, isResponsesInput: boolean): boolean => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const rec = item as Record<string, unknown>;
  if (isResponsesInput && rec.type === 'additional_tools') return true;
  const role = typeof rec.role === 'string' ? rec.role.trim().toLowerCase() : undefined;
  const kindOk = !isResponsesInput || rec.type === undefined || rec.type === 'message';
  return kindOk && (role === 'system' || role === 'developer');
};

const isExactEnvValueOverlap = (
  text: string,
  builtInStart: number,
  builtInEnd: number,
  editStart: number,
  editEnd: number,
): boolean => {
  const prefix = text.slice(builtInStart, editStart);
  const suffix = text.slice(editEnd, builtInEnd);
  const m = /^[A-Z0-9_]+\s*=\s*(["'`]?)$/.exec(prefix);
  return m !== null && suffix === m[1];
};

export interface GuardEngineOptions {
  readonly defaultAction?: GuardActionPolicy;
  /** Owner-pending DM3 seam; defaults to `'audit_mask_copy'` (intact in flight). */
  readonly hopEgressHighConfidenceAction?: GuardActionPolicy;
  readonly detectorActions?: Readonly<Record<string, GuardActionPolicy>>;
  /** Injectable secret range scanner (defaults to PureSecretScanner with KUBECONFIG_PATTERNS). */
  readonly secretScanner?: SecretScannerPort;
  /** Structured custom secret patterns forwarded to the secret scanner. */
  readonly customPatterns?: readonly CustomSecretPattern[];
  /** Include built-in KUBECONFIG_PATTERNS when scanning (default true). */
  readonly includeDefaultPatterns?: boolean;
}

export class GuardEngine implements GuardPort {
  private readonly defaultAction: GuardActionPolicy;
  private readonly detectorActions: Readonly<Record<string, GuardActionPolicy>>;
  private readonly secretScanner: SecretScannerPort;
  private readonly scanOptions?: SecretScanOptions;
  readonly hopEgressHighConfidenceAction: GuardActionPolicy;

  constructor(options: GuardEngineOptions = {}) {
    this.defaultAction = options.defaultAction ?? 'audit_mask_copy';
    this.hopEgressHighConfidenceAction = options.hopEgressHighConfidenceAction ?? 'audit_mask_copy';
    this.detectorActions = options.detectorActions ?? {};
    this.secretScanner = options.secretScanner ?? new PureSecretScanner();
    if (options.customPatterns !== undefined || options.includeDefaultPatterns !== undefined) {
      this.scanOptions = {
        ...(options.customPatterns !== undefined ? { customPatterns: options.customPatterns } : {}),
        ...(options.includeDefaultPatterns !== undefined ? { includeDefaultPatterns: options.includeDefaultPatterns } : {}),
      };
    }
  }

  private actionFor(id: string): GuardActionPolicy {
    return this.detectorActions[id] ?? this.defaultAction;
  }

  private scanTextMode(text: string, inFlightOnly: boolean): GuardTextScanResult {
    if (!text) return { maskedText: text, findings: [], blocked: false };
    const counts = new Map<string, { category: GuardDetectorCategory; count: number; action: GuardActionPolicy }>();
    let blocked = false;
    const recordFinding = (id: string, category: GuardDetectorCategory): GuardActionPolicy => {
      const action = this.actionFor(id);
      const prev = counts.get(id);
      counts.set(id, { category, count: (prev?.count ?? 0) + 1, action });
      if (action === 'block') blocked = true;
      return action;
    };

    const rawScanner = (this.secretScanner.scanRaw?.(text, this.scanOptions) ?? this.secretScanner.scan(text, this.scanOptions))
      .map((m) => ({
        ...m,
        start: Math.max(0, Math.min(m.start, text.length)),
        end: Math.max(0, Math.min(m.end, text.length)),
      }))
      .filter((m) => Number.isInteger(m.start) && Number.isInteger(m.end) && m.end > m.start);
    for (const m of rawScanner) recordFinding(m.ruleId, 'tech_secret');
    const scannerMatches = dedupeRanges(
      inFlightOnly ? rawScanner.filter((m) => this.actionFor(m.ruleId) === 'mask_in_flight') : rawScanner,
    );

    const builtInSpans: { start: number; end: number; id: string; replacement: string; action: GuardActionPolicy }[] = [];
    for (const detector of DETECTORS) {
      if (detector.id === 'pii.email' && !text.includes('@')) continue;
      detector.pattern.lastIndex = 0;
      for (const m of text.matchAll(detector.pattern)) {
        if (m.index === undefined || m[0].length === 0) continue;
        if (detector.validate && !detector.validate(m[0])) continue;
        const start = m.index;
        const end = start + m[0].length;
        if (builtInSpans.some((b) => b.start <= start && b.end >= end)) continue;
        const action = recordFinding(detector.id, detector.category);
        builtInSpans.push({ start, end, id: detector.id, replacement: detector.replacement, action });
      }
    }

    const activeBuiltIns = inFlightOnly ? builtInSpans.filter((b) => b.action === 'mask_in_flight') : builtInSpans;
    type Edit = { start: number; end: number; text: string; isScanner: boolean };
    const edits: Edit[] = scannerMatches.map((s) => ({
      start: s.start,
      end: s.end,
      text: formatSecretRedactionTag(s.ruleId, text.slice(s.start, s.end)),
      isScanner: true,
    }));
    for (const b of activeBuiltIns) {
      const overlapping = edits.filter((e) => b.start < e.end && b.end > e.start);
      if (overlapping.length === 0) {
        edits.push({ start: b.start, end: b.end, text: b.replacement, isScanner: false });
        continue;
      }
      const single = overlapping.length === 1 ? overlapping[0]! : undefined;
      const coveredBySingle = single !== undefined && (
        (single.start <= b.start && single.end >= b.end)
        || (single.isScanner && b.id === 'secret.env_assignment'
          && isExactEnvValueOverlap(text, b.start, b.end, single.start, single.end))
      );
      if (!coveredBySingle) {
        const minStart = Math.min(b.start, ...overlapping.map((e) => e.start));
        const maxEnd = Math.max(b.end, ...overlapping.map((e) => e.end));
        for (let i = edits.length - 1; i >= 0; i -= 1) {
          if (b.start < edits[i]!.end && b.end > edits[i]!.start) edits.splice(i, 1);
        }
        edits.push({ start: minStart, end: maxEnd, text: b.replacement, isScanner: false });
      }
    }

    edits.sort((a, b) => b.start - a.start);
    let masked = text;
    for (const e of edits) masked = masked.slice(0, e.start) + e.text + masked.slice(e.end);

    const findings: GuardFinding[] = [...counts.entries()].map(([detectorId, info]) => ({
      detectorId, category: info.category, count: info.count, action: info.action,
    }));
    return { maskedText: masked, findings, blocked };
  }

  scanText(text: string): GuardTextScanResult {
    return this.scanTextMode(text, false);
  }

  inspectRequest(payload: unknown): GuardScanResult {
    const totals = new Map<string, { category: GuardDetectorCategory; count: number; action: GuardActionPolicy }>();
    let blocked = false;
    let protectedViolation = false;
    let maskInFlight = false;
    const walk = (value: unknown, forInFlight: boolean, inProtected: boolean, depth: number): unknown => {
      if (typeof value === 'string') {
        if (forInFlight) return !inProtected ? this.scanTextMode(value, true).maskedText : value;
        const res = this.scanTextMode(value, false);
        for (const f of res.findings) {
          const prev = totals.get(f.detectorId);
          totals.set(f.detectorId, { category: f.category, count: (prev?.count ?? 0) + f.count, action: f.action });
          if (f.action === 'block') blocked = true;
          if (f.action === 'mask_in_flight') {
            if (inProtected) { blocked = true; protectedViolation = true; }
            else maskInFlight = true;
          }
        }
        return res.maskedText;
      }
      if (Array.isArray(value)) return value.map((item) => walk(item, forInFlight, inProtected, depth + 1));
      if (value && typeof value === 'object') {
        const rec = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rec)) {
          if (depth === 0 && (k === 'messages' || k === 'input') && Array.isArray(v)) {
            out[k] = v.map((item) => {
              const itemProtected = inProtected || isProtectedItem(item, k === 'input');
              return forInFlight && itemProtected ? item : walk(item, forInFlight, itemProtected, depth + 2);
            });
            continue;
          }
          const keyProtected = inProtected || (depth === 0 && PROTECTED_ROOT_KEYS.has(k));
          const skipInFlight = forInFlight && (keyProtected || NON_MASKABLE_LINKAGE_KEYS.has(k));
          out[k] = skipInFlight ? v : walk(v, forInFlight, keyProtected, depth + 1);
        }
        return out;
      }
      return value;
    };
    const maskedPayload = walk(payload, false, false, 0);
    const findings: GuardFinding[] = [...totals.entries()].map(([detectorId, info]) => ({
      detectorId, category: info.category, count: info.count, action: info.action,
    }));
    const inFlightPayload = !blocked && maskInFlight ? walk(payload, true, false, 0) : payload;
    const verdict: GuardVerdict = blocked ? 'blocked' : findings.length > 0 ? 'masked' : 'pass';
    return {
      verdict,
      findings,
      inFlightPayload,
      maskedCapture: { __maskedCapturePayload: true, payload: maskedPayload, findings },
      ...(protectedViolation ? { protectedViolation: true } : {}),
    };
  }

  maskForCapture(payload: unknown): MaskedCapturePayload {
    return this.inspectRequest(payload).maskedCapture;
  }
}
