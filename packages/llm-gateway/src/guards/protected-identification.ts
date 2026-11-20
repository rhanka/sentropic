import type { GenerateRequest } from '@sentropic/llm-mesh';
import type { GatewayWire } from '../ports/dispatch.js';
import { GatewayError } from '../router/errors.js';
import {
  bytesEqual, canonicalBytes, captureProtectedIdentityHeaders, extractBodyProtectedBytes,
  extractSequence, fieldEntry, isRecord, jcsStringify,
  type ProtectedIdentityHeadersSnapshot,
} from './protected-identification-core.js';

export { captureProtectedIdentityHeaders, type ProtectedIdentityHeadersSnapshot };

export interface ProtectedIdentificationSnapshot {
  readonly wire: GatewayWire;
  readonly bodyBytes: Uint8Array;
  readonly headers: ProtectedIdentityHeadersSnapshot;
}

export const captureProtectedIdentification = (
  wire: GatewayWire,
  rawIngressBody: unknown,
  rawIngressHeaders: Readonly<Record<string, string>>,
): ProtectedIdentificationSnapshot => ({
  wire,
  bodyBytes: extractBodyProtectedBytes(wire, rawIngressBody),
  headers: captureProtectedIdentityHeaders(rawIngressHeaders),
});

export interface CanonicalProtectedSnapshot {
  readonly wire: GatewayWire;
  readonly bytes: Uint8Array;
}

export const captureCanonicalProtectedProjection = (
  wire: GatewayWire,
  request: GenerateRequest,
): CanonicalProtectedSnapshot => {
  const po = isRecord(request.providerOptions) ? request.providerOptions : undefined;
  const cc = po && isRecord(po.cacheControl) ? po.cacheControl : undefined;
  const resp = po && isRecord(po.responses) ? po.responses : undefined;
  const ingressBodyProtected = po && Object.hasOwn(po, 'ingressBody') && po.ingressBody !== undefined
    ? jcsStringify(Array.from(extractBodyProtectedBytes(wire, po.ingressBody))) : null;
  return {
    wire,
    bytes: canonicalBytes({
      wire,
      messages: extractSequence(request.messages, false),
      tools: request.tools !== undefined ? { present: true, value: request.tools } : { present: false },
      ingressBodyProtected,
      prefixCacheControl: {
        topLevel: cc ? fieldEntry(cc, 'topLevel') : { present: false },
        system: cc ? fieldEntry(cc, 'system') : { present: false },
        tools: cc ? fieldEntry(cc, 'tools') : { present: false },
      },
      promptCacheKey: po ? fieldEntry(po, 'promptCacheKey') : { present: false },
      responses: resp
        ? {
          customTools: fieldEntry(resp, 'customTools'),
          functionToolRefs: fieldEntry(resp, 'functionToolRefs'),
          promptCacheKey: fieldEntry(resp, 'promptCacheKey'),
          safetyIdentifier: fieldEntry(resp, 'safetyIdentifier'),
          clientMetadata: fieldEntry(resp, 'clientMetadata'),
          requestMetadata: fieldEntry(resp, 'requestMetadata'),
        }
        : null,
    }),
  };
};

export type ProtectedEgressKind = 'provider-native' | 'provider-canonical' | 'legacy-flow' | 'relay-hop';

export interface VerifyProtectedIdentificationInput {
  readonly ingress: ProtectedIdentificationSnapshot | undefined;
  readonly canonicalIngress?: CanonicalProtectedSnapshot;
  readonly egressKind: ProtectedEgressKind;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly nativeForwardedHeaders?: Readonly<Record<string, string>>;
  readonly canonicalRequest?: GenerateRequest;
  readonly egressAdapterHeaders?: Readonly<Record<string, string>>;
}

const normalizeHeaderMap = (headers: Readonly<Record<string, string>>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
};

export const verifyProtectedIdentificationAtEgress = (
  input: VerifyProtectedIdentificationInput,
): void => {
  if (!input.ingress) {
    throw new GatewayError('protected-identification-mutated', 'missing ingress protected identification snapshot');
  }
  const egressBodyBytes = extractBodyProtectedBytes(input.ingress.wire, input.body);
  if (!bytesEqual(input.ingress.bodyBytes, egressBodyBytes)) {
    throw new GatewayError('protected-identification-mutated', 'protected identification body mutated before egress');
  }
  if (input.canonicalIngress || input.canonicalRequest) {
    if (!input.canonicalIngress || !input.canonicalRequest) {
      throw new GatewayError('protected-identification-mutated', 'missing canonical protected identification projection');
    }
    const egressCanonical = captureCanonicalProtectedProjection(input.ingress.wire, input.canonicalRequest);
    if (!bytesEqual(input.canonicalIngress.bytes, egressCanonical.bytes)) {
      throw new GatewayError('protected-identification-mutated', 'canonical protected identification mutated before egress');
    }
  }
  const egressHeaders = captureProtectedIdentityHeaders(input.headers);
  // Uniform across all egress kinds (r8-F2): reject Connection: nomination of any protected identity header.
  if (input.ingress.headers.connectionNominatedIdentityHeader || egressHeaders.connectionNominatedIdentityHeader) {
    throw new GatewayError('protected-identification-mutated', 'connection header nominated protected identity header');
  }
  if (input.egressKind === 'provider-native') {
    if (!input.nativeForwardedHeaders) {
      throw new GatewayError('protected-identification-mutated', 'missing native forwarded identity headers');
    }
    const nativeBytes = canonicalBytes(normalizeHeaderMap(input.nativeForwardedHeaders));
    if (!bytesEqual(input.ingress.headers.providerIdentityHeadersBytes, nativeBytes)
      || !bytesEqual(input.ingress.headers.providerIdentityHeadersBytes, egressHeaders.providerIdentityHeadersBytes)
      || !bytesEqual(input.ingress.headers.hopIdentityHeadersBytes, egressHeaders.hopIdentityHeadersBytes)) {
      throw new GatewayError('protected-identification-mutated', 'native identity headers mutated before egress');
    }
    return;
  }
  if (!bytesEqual(input.ingress.headers.hopIdentityHeadersBytes, egressHeaders.hopIdentityHeadersBytes)) {
    throw new GatewayError('protected-identification-mutated', 'identity headers mutated before egress');
  }
  if (input.egressAdapterHeaders) {
    const adapterSnap = captureProtectedIdentityHeaders(input.egressAdapterHeaders);
    if (adapterSnap.connectionNominatedIdentityHeader
      || !bytesEqual(input.ingress.headers.hopIdentityHeadersBytes, adapterSnap.hopIdentityHeadersBytes)) {
      throw new GatewayError('protected-identification-mutated', 'adapter identity headers mutated before egress');
    }
  }
};
