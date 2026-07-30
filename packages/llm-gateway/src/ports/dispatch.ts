/**
 * GatewayDispatchPort (spec §1/§6). The opaque model-invocation seam the
 * gateway dispatches through — llm-mesh fills it server-side once an account
 * is selected + resolved. Mirrors the `MeshDispatchPort` contract published by
 * `@sentropic/chat-core` (`chat-core/mesh-port.ts`): chat-core never imports
 * provider creds, it sees only this opaque port. Here the gateway OWNS the
 * concrete dispatch (selected `SecretAuthMaterial` + llm-mesh adapter), so it
 * keeps its own local port name rather than depending on chat-core.
 *
 * v0 stub: interface only. Lot 2 wires the concrete llm-mesh-backed adapter
 * (faithful provider-compat SSE passthrough — Anthropic SSE vs OpenAI [DONE]).
 */

import type { SecretAuthMaterial } from '@sentropic/llm-mesh';

export type GatewayWire = 'anthropic-messages' | 'openai-chat-completions';

/**
 * One dispatch unit: the provider-native body passed through verbatim (spec
 * §3b), plus the resolved executable material and the wire to frame the
 * response on. `body` stays opaque — the gateway round-trips the vendor shape.
 */
export interface GatewayDispatchRequest {
  readonly wire: GatewayWire;
  readonly providerId: string;
  readonly model: string;
  readonly material: SecretAuthMaterial;
  /** Provider-native request JSON, passed through verbatim. */
  readonly body: unknown;
  readonly stream: boolean;
  /**
   * Reasoning effort implied by the resolved target/alias (e.g. a `*-xhigh`
   * launch alias). Optional; the dispatch impl applies it to the provider
   * request. Absent = honor whatever the verbatim body already carries.
   */
  readonly effort?: string;
  readonly signal?: AbortSignal;
}

/**
 * Provider response headers carried through the dispatch contract (#4). The
 * gateway forwards an ALLOWLIST of these so request-ids/rate-limit/version/beta/
 * retry headers survive — faithful passthrough. Keys are lowercased.
 */
export type ProviderResponseHeaders = Readonly<Record<string, string>>;

/** Non-stream provider-native response, passed through verbatim. */
export interface GatewayDispatchResponse {
  readonly status: number;
  readonly body: unknown;
  /** Provider response headers (lowercased). The router forwards the allowlist (#4). */
  readonly headers?: ProviderResponseHeaders;
}

/** Provider-native SSE event, framed by wire (Anthropic event/data; OpenAI data + [DONE]). */
export interface GatewayDispatchStreamEvent {
  readonly raw: string;
}

/**
 * A streaming dispatch result: the provider response headers (known BEFORE the
 * first byte) + the async frame iterator. Carrying headers here lets the router
 * forward the allowlisted provider stream headers (#4) faithfully.
 */
export interface GatewayDispatchStream {
  /** Provider response headers (lowercased) for the stream. */
  readonly headers?: ProviderResponseHeaders;
  /** The provider-native SSE frames, relayed verbatim. */
  readonly frames: AsyncIterable<GatewayDispatchStreamEvent>;
}

export interface GatewayDispatchPort {
  dispatch(request: GatewayDispatchRequest): Promise<GatewayDispatchResponse>;
  dispatchStream(request: GatewayDispatchRequest): GatewayDispatchStream;
}
