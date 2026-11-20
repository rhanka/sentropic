import type {
  GuardActionPolicy, GuardDetectorCategory, GuardFinding, GuardPort, GuardScanResult,
  GuardTextScanResult, GuardVerdict, MaskedCapturePayload,
} from '../ports/guards.js';

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
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'secret.auth_header', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b(?:Authorization\s*:\s*(?:Bearer|DPoP)\s+\S+|DPoP\s*:\s*\S+|Cookie\s*:\s*[^\r\n;]+)/gi },
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
    pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[bp]-[A-Za-z0-9-]{16,})\b/g },
  { id: 'secret.jwt', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'secret.env_assignment', category: 'tech_secret', replacement: '[REDACTED:TECH_SECRET]',
    pattern: /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*[^\s"'`]+/g },
  { id: 'pii.email', category: 'pii', replacement: '[REDACTED:EMAIL]',
    pattern: /\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+\b/g },
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

export interface GuardEngineOptions {
  readonly defaultAction?: GuardActionPolicy;
  /** Owner-pending DM3 seam; defaults to `'audit_mask_copy'` (intact in flight). */
  readonly hopEgressHighConfidenceAction?: GuardActionPolicy;
  readonly detectorActions?: Readonly<Record<string, GuardActionPolicy>>;
}

export class GuardEngine implements GuardPort {
  private readonly defaultAction: GuardActionPolicy;
  private readonly detectorActions: Readonly<Record<string, GuardActionPolicy>>;
  readonly hopEgressHighConfidenceAction: GuardActionPolicy;

  constructor(options: GuardEngineOptions = {}) {
    this.defaultAction = options.defaultAction ?? 'audit_mask_copy';
    this.hopEgressHighConfidenceAction = options.hopEgressHighConfidenceAction ?? 'audit_mask_copy';
    this.detectorActions = options.detectorActions ?? {};
  }

  private actionFor(id: string): GuardActionPolicy {
    return this.detectorActions[id] ?? this.defaultAction;
  }

  scanText(text: string): GuardTextScanResult {
    const counts = new Map<string, { category: GuardDetectorCategory; count: number; action: GuardActionPolicy }>();
    let masked = text;
    let blocked = false;
    for (const detector of DETECTORS) {
      const action = this.actionFor(detector.id);
      detector.pattern.lastIndex = 0;
      masked = masked.replace(detector.pattern, (match) => {
        if (detector.validate && !detector.validate(match)) return match;
        const prev = counts.get(detector.id);
        counts.set(detector.id, { category: detector.category, count: (prev?.count ?? 0) + 1, action });
        if (action === 'block') blocked = true;
        return detector.replacement;
      });
    }
    const findings: GuardFinding[] = [...counts.entries()].map(([detectorId, info]) => ({
      detectorId, category: info.category, count: info.count, action: info.action,
    }));
    return { maskedText: masked, findings, blocked };
  }

  inspectRequest(payload: unknown): GuardScanResult {
    const totals = new Map<string, { category: GuardDetectorCategory; count: number; action: GuardActionPolicy }>();
    let blocked = false;
    let maskInFlight = false;
    const walk = (value: unknown, forInFlight: boolean): unknown => {
      if (typeof value === 'string') {
        const res = this.scanText(value);
        if (!forInFlight) {
          for (const f of res.findings) {
            const prev = totals.get(f.detectorId);
            totals.set(f.detectorId, { category: f.category, count: (prev?.count ?? 0) + f.count, action: f.action });
            if (f.action === 'block') blocked = true;
            if (f.action === 'mask_in_flight') maskInFlight = true;
          }
          return res.maskedText;
        }
        return res.findings.some((f) => f.action === 'mask_in_flight') ? res.maskedText : value;
      }
      if (Array.isArray(value)) return value.map((item) => walk(item, forInFlight));
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, forInFlight);
        return out;
      }
      return value;
    };
    const maskedPayload = walk(payload, false);
    const findings: GuardFinding[] = [...totals.entries()].map(([detectorId, info]) => ({
      detectorId, category: info.category, count: info.count, action: info.action,
    }));
    const inFlightPayload = maskInFlight ? walk(payload, true) : payload;
    const verdict: GuardVerdict = blocked ? 'blocked' : findings.length > 0 ? 'masked' : 'pass';
    return {
      verdict,
      findings,
      inFlightPayload,
      maskedCapture: { __maskedCapturePayload: true, payload: maskedPayload, findings },
    };
  }

  maskForCapture(payload: unknown): MaskedCapturePayload {
    return this.inspectRequest(payload).maskedCapture;
  }
}
