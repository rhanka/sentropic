import type { CanonicalIngressResult } from './canonical-ingress.js';
import type { GatewayWire } from './ports/dispatch.js';
import type { GatewayBudgetOptions } from './ports/budget.js';
import { GatewayError } from './router/errors.js';
import { buildNativeRequestHeaders } from './native-headers.js';

export type NativeFeatureSelection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'optional' | 'required';
      readonly anthropicVersion?: string;
      readonly anthropicBeta?: string;
      readonly forwarded: Readonly<Record<string, string>>;
      readonly maxOutputTokens: number;
    };

/** Selection only; the prepared capability supplies execute-time feasibility. */
export const classifyNativeFeatures = (
  wire: GatewayWire,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  canonical: CanonicalIngressResult,
  options: { readonly budget?: GatewayBudgetOptions; readonly nativeMessagesEnabled?: boolean },
): NativeFeatureSelection => {
  const required = body !== null && typeof body === 'object' && Object.hasOwn(body, 'safeguards');
  if (wire !== 'anthropic-messages') {
    if (required) throw new GatewayError('native-required', 'safeguards requires Messages ingress');
    return { kind: 'none' };
  }
  if (required && options.nativeMessagesEnabled === false) {
    throw new GatewayError('native-required', 'native Messages disabled');
  }
  const parsed = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const beta = parsed.get('anthropic-beta');
  if (!required && (beta === undefined || options.nativeMessagesEnabled === false)) return { kind: 'none' };
  const nominated = new Set((parsed.get('connection') ?? '').split(',').map((name) => name.trim().toLowerCase()));
  if (['anthropic-beta', 'anthropic-version'].some((name) => parsed.has(name) && nominated.has(name))) {
    if (required) throw new GatewayError('native-required', 'native feature header is hop-by-hop');
    return { kind: 'none' };
  }
  const ceiling = canonical.request.maxOutputTokens ?? options.budget?.defaultOutputTokens;
  if (!Number.isSafeInteger(ceiling) || ceiling! <= 0) {
    if (required) throw new GatewayError(
      options.budget ? 'bad-request' : 'native-max-tokens-required', 'invalid native output ceiling',
    );
    return { kind: 'none' };
  }
  const version = parsed.get('anthropic-version');
  return {
    kind: required ? 'required' : 'optional', maxOutputTokens: ceiling!,
    forwarded: buildNativeRequestHeaders(headers),
    ...(version !== undefined ? { anthropicVersion: version } : {}),
    ...(beta !== undefined ? { anthropicBeta: beta } : {}),
  };
};
