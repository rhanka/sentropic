// r6 §4.3.3 / T6-P1: per-provider public-execution disposition required before the
// first seat admission for each provider and exact route. Relocating execution to the
// public rhanka/sentropic repository changes the facts underlying C1 D0.3, so admission
// accepts only (a) an explicit C1 D0.3 owner-disposition extension identifying execution
// in the public repository with its qualified isolation/encryption controls and
// provider-specific facts, or (b) current provider evidence explicitly permitting that
// public-repository usage path. A private-execution receipt, another provider's
// permission or a generic same-repo consent is insufficient. A9 linkage is recorded.
import { ensure } from './seat-admission.ts';

export const PUBLIC_REPOSITORY = 'rhanka/sentropic';
export const A9_RECORD = 'A9';
export const DISPOSITION_KINDS = ['c1-d0-3-public-extension', 'provider-proof'] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

export type PublicExecutionDispositionV1 = {
  schemaVersion: 1;
  kind: DispositionKind;
  provider: string; route: string; client: string; model: string;
  publicRepository: string;
  privateToPublicChange: string;
  evidenceDate: string; evidenceDigest: string; validUntil: string; reviewTrigger: string;
  dispositionSource: string; actor: string;
  a9Record: string; affectedQualificationIds: string[];
  isolationControls?: string[]; providerFacts?: string[];
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const nonEmptyList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(nonEmpty);

export function validateDisposition(d: unknown): PublicExecutionDispositionV1 {
  const r = d as PublicExecutionDispositionV1;
  ensure(r && typeof r === 'object', 'disposition-shape');
  ensure(r.schemaVersion === 1, 'disposition-schema');
  ensure((DISPOSITION_KINDS as readonly string[]).includes(r.kind), 'disposition-kind');
  for (const k of ['provider', 'route', 'client', 'model', 'privateToPublicChange',
    'reviewTrigger', 'dispositionSource', 'actor'] as const) {
    ensure(nonEmpty(r[k]), `disposition-${k}`);
  }
  ensure(r.publicRepository === PUBLIC_REPOSITORY, 'public-repository');
  ensure(ISO_UTC.test(r.evidenceDate) && ISO_UTC.test(r.validUntil), 'disposition-date');
  ensure(/^[0-9a-f]{64}$/.test(r.evidenceDigest), 'evidence-digest');
  ensure(r.a9Record === A9_RECORD, 'a9-linkage');
  ensure(nonEmptyList(r.affectedQualificationIds), 'affected-qualifications');
  if (r.kind === 'c1-d0-3-public-extension') {
    ensure(nonEmptyList(r.isolationControls), 'isolation-controls-missing');
    ensure(nonEmptyList(r.providerFacts), 'provider-facts-missing');
    ensure(r.privateToPublicChange.includes('public'), 'private-to-public-change');
  }
  return r;
}

export type DispositionVerdict =
  | { ok: true; disposition: PublicExecutionDispositionV1 }
  | { ok: false; code: string };

// Gate consulted before any inference on a route: exact provider/route/client/model
// match plus current validity. Refusal codes are typed; no online fallback exists.
export function admitPublicExecution(disposition: unknown, ctx: {
  provider: string; route: string; client: string; model: string; now: number;
}): DispositionVerdict {
  let d: PublicExecutionDispositionV1;
  try { d = validateDisposition(disposition); } catch (e) { return { ok: false, code: (e as Error).message }; }
  if (d.provider !== ctx.provider) return { ok: false, code: 'provider-mismatch' };
  if (d.route !== ctx.route) return { ok: false, code: 'route-mismatch' };
  if (d.client !== ctx.client) return { ok: false, code: 'client-mismatch' };
  if (d.model !== ctx.model) return { ok: false, code: 'model-mismatch' };
  if (ctx.now >= Date.parse(d.validUntil)) return { ok: false, code: 'evidence-expired' };
  return { ok: true, disposition: d };
}
