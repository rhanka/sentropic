/**
 * v0 GatewayDispatchPort — faithful provider-compat passthrough (spec §3/§3b).
 *
 * llm-mesh NORMALIZES to its own message/stream model; it does NOT emit native
 * provider SSE bytes. Faithful passthrough therefore relays the PROVIDER-NATIVE
 * JSON / SSE bytes unchanged. This adapter wraps an injectable `ProviderTransport`
 * (the thing that actually talks to the provider) and:
 *   - passes the provider-native request body through VERBATIM;
 *   - returns the provider-native response JSON + status VERBATIM (non-stream);
 *   - relays the provider-native SSE frames VERBATIM (stream).
 *
 * It adds NOTHING to the bytes and removes NOTHING — the pooled credential swap
 * happens via `material` (handed to the transport), invisible on the wire. In
 * tests the transport is a FIXTURE; in production it is a provider HTTP client
 * (or llm-mesh re-framed). The gateway is faithful regardless of the transport.
 *
 * Mid-stream provider failure (spec §2): the transport emits the provider-native
 * error frame, then throws — the flow settles with failure usage and does NOT
 * retry after bytes have streamed.
 */

import type {
  GatewayDispatchPort,
  GatewayDispatchRequest,
  GatewayDispatchResponse,
  GatewayDispatchStreamEvent,
} from '../ports/dispatch.js';
import type { SecretAuthMaterial } from '@sentropic/llm-mesh';

/** What the transport receives — the native body + the swapped credential. */
export interface ProviderTransportRequest {
  readonly providerId: string;
  readonly model: string;
  /** The pooled, resolved credential — used to auth the provider call, invisible on the wire. */
  readonly material: SecretAuthMaterial;
  /** Provider-native request JSON, passed through verbatim. */
  readonly body: unknown;
  readonly signal?: AbortSignal;
}

/**
 * The provider transport seam. `send` returns the native non-stream response
 * (status + body verbatim); `sendStream` yields native SSE frames (already
 * framed by the provider — `event:`/`data:` for Anthropic, `data:`/`[DONE]`
 * for OpenAI). The gateway relays both verbatim.
 */
export interface ProviderTransport {
  send(request: ProviderTransportRequest): Promise<GatewayDispatchResponse>;
  sendStream(
    request: ProviderTransportRequest,
  ): AsyncIterable<GatewayDispatchStreamEvent>;
}

export interface PassthroughDispatchOptions {
  readonly transport: ProviderTransport;
}

/**
 * Faithful passthrough dispatch. Holds NO provider logic of its own — it relays
 * native bytes between the gateway flow and the injected transport, swapping in
 * the pooled credential without touching the wire shape.
 */
export class PassthroughDispatch implements GatewayDispatchPort {
  private readonly transport: ProviderTransport;

  constructor(options: PassthroughDispatchOptions) {
    this.transport = options.transport;
  }

  async dispatch(
    request: GatewayDispatchRequest,
  ): Promise<GatewayDispatchResponse> {
    const response = await this.transport.send(this.toTransportRequest(request));
    // Faithful: provider status + body verbatim. No mutation.
    return { status: response.status, body: response.body };
  }

  async *dispatchStream(
    request: GatewayDispatchRequest,
  ): AsyncIterable<GatewayDispatchStreamEvent> {
    // Relay native SSE frames verbatim. A mid-stream transport throw propagates
    // to the flow (which settles failure; no retry post-stream, spec §2).
    for await (const event of this.transport.sendStream(this.toTransportRequest(request))) {
      yield { raw: event.raw };
    }
  }

  private toTransportRequest(
    request: GatewayDispatchRequest,
  ): ProviderTransportRequest {
    return {
      providerId: request.providerId,
      model: request.model,
      material: request.material,
      body: request.body,
      ...(request.signal ? { signal: request.signal } : {}),
    };
  }
}
