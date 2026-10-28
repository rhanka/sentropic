import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import { jevDescriptor } from './descriptor.js';
import { freezeDecisionData, parseDecisionEvaluatorDescriptor } from './descriptor-validation.js';
import { digestStructuredArtifact } from './validation.js';

/** Exact owner-selected tuple. A host verifier must inspect local bytes and the running process. */
export const KEV_INVENTORY = freezeDecisionData({
  model: { repository: 'ggml-org/Kev-4B-GGUF', revision: 'f4624b6bb7072f1bab726a622c1cad3f96030b9e',
    file: 'Kev-4B-Q8_0.gguf', bytes: 4483801504,
    sha256: '7c2ebed90560522c2801389db482ac1dc4c36d828f201f6074c1d60e433948da', quantization: 'Q8_0' },
  runtime: { repository: 'ggml-org/llama.cpp', revision: 'f1a7dea99aae1623bad10c4ce31fe220033ab7f6',
    release: 'b11954', archiveSha256: '9e43757438fe70dee5ca759c718bf0b17df7760916c3714092a3a63e22e11fbc',
    backend: 'CPU', platform: 'linux-x64', contextTokens: 2048, parallel: 1, threads: 4,
    threadsBatch: 4, batchTokens: 512, microBatchTokens: 512, gpuLayers: 0, contextShift: false, cacheRamMiB: 0,
    serverSha256: 'd198b4a5156c34279cf75346451d2e17acafa8188edee4d00e3042a727f01259',
    serverLibrarySha256: 'e9617b6f102a7301dd9b417726e6972234b6fa68e02b14b9874f689abfd8ba7a' },
  readout: 'llama.cpp-systemone-b11954',
});
export const KEV_SERVED_MODEL_ID = 'kev-q8-7c2ebed90560522c-b11954';
export const kevInventoryMatches = (value: unknown): boolean => {
  try { return digestStructuredArtifact(value) === digestStructuredArtifact(KEV_INVENTORY); }
  catch { return false; }
};
const contract = { inventory: KEV_INVENTORY, state: 'json-data', question: 'verdict', attempts: 1,
  // Library response cache only; the pinned native runtime retains slot prefix KV reuse.
  endpoint: 'http://127.0.0.1:8797/v1/systemone', cache: 'disabled', outputTokens: 0 };
const digest = digestStructuredArtifact;
/** Catalogue candidate only; no I/O, automatic registration, or production qualification. */
export const kevDescriptor: DecisionEvaluatorDescriptor = freezeDecisionData({
  ...jevDescriptor,
  evaluator: { providerId: 'local', evaluatorId: 'kev-4b-q8-0', revision: 'kev-q8-b11954-' + digest(contract).slice(0, 32) },
  protocol: 'systemone-local', wireModel: KEV_SERVED_MODEL_ID,
  acceptedServedModelIds: [],
  qualification: { servedIdentity: 'unqualified', billingBound: 'unqualified', evidenceRefs: [] },
  maxBillableInputTokens: 2048, maxBillableOutputTokens: 0,
  maxStateQuestionBytes: 8192,
  compilation: { templateDigest: digest(contract), schemaDigest: digest({ contract, types: ['noul', 'choice', 'score'] }),
    readout: KEV_INVENTORY.readout },
  definition: { validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
    kinds: ['binary', 'choice', 'graded'].map((kind) => ({ kind, schemaDigest: digest({ contract, kind }) })),
    evidenceRequirements: ['host-verified-artifact-runtime', 'single-native-inventory', 'reported-usage'],
    executionDigest: digest(contract), bundleDigest: digest({ contract, qualification: 'unqualified' }) },
  confidence: { meaning: 'provider-confidence',
    meaningRef: 'https://github.com/ggml-org/llama.cpp/blob/f1a7dea99aae1623bad10c4ce31fe220033ab7f6/tools/server/README.md', min: 0, max: 1 },
  priceProtocol: { authority: 'host.local-compute', revision: 'kev-cpu-b11954-v1' },
  retention: { status: 'not-evaluated', basis: 'none', retentionDays: null, evidenceRefs: [] },
});

/** Host attestation of the exact local tuple enables experimental calls, never calibration. */
export function createKevQualificationDescriptor(inventory: unknown): DecisionEvaluatorDescriptor {
  if (!kevInventoryMatches(inventory)) throw new Error('Kev artifact/runtime inventory mismatch.');
  return freezeDecisionData({ ...kevDescriptor, executionProfile: 'qualification',
    acceptedServedModelIds: [KEV_SERVED_MODEL_ID],
    qualification: { servedIdentity: 'qualified', billingBound: 'qualified',
      evidenceRefs: ['host:verified-kev-artifact-runtime-b11954'] } });
}

/** Only publication evidence/profile and registered rubrics may vary from implemented execution. */
export function parseKevDescriptor(candidate: unknown): DecisionEvaluatorDescriptor | null {
  const parsed = parseDecisionEvaluatorDescriptor(candidate);
  if (!parsed || parsed.acceptedServedModelIds.some((id) => id !== KEV_SERVED_MODEL_ID)) return null;
  const execution = (d: DecisionEvaluatorDescriptor) => {
    const { qualification, executionProfile, acceptedServedModelIds, registeredCriteria, ...rest } = d;
    const { bundleDigest, ...definition } = rest.definition;
    return { ...rest, definition };
  };
  return digest(execution(parsed)) === digest(execution(kevDescriptor)) ? parsed : null;
}
