import type { GatewayDispatchStreamEvent, GatewayWire } from '../ports/dispatch.js';
import type { GuardFinding, GuardPort, MaskedCapturePayload } from '../ports/guards.js';
import type { GatewayNativeStreamBytes } from '../flow.js';

export const SSE_GUARD_OVERLAP_BYTES = 16 * 1024;
export const SSE_CAPTURE_MAX_BYTES = 2 * 1024 * 1024;

export interface GuardedTurnCaptureRecord {
  readonly requestId: string;
  readonly ownerScopeRef: string;
  readonly wire: GatewayWire;
  readonly model: string;
  readonly requestCapture: MaskedCapturePayload;
  readonly responseCapture: MaskedCapturePayload;
  readonly truncated: boolean;
  readonly blocked: boolean;
  readonly createdAtMs: number;
}

export interface SseGuardTeeResult {
  readonly maskedCapture: MaskedCapturePayload;
  readonly findings: readonly GuardFinding[];
  readonly blocked: boolean;
  readonly truncated: boolean;
}

const extractDeltaText = (chunk: string): string => {
  const parts: string[] = [];
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const delta = obj.delta as Record<string, unknown> | string | undefined;
      if (typeof delta === 'string') parts.push(delta);
      else if (delta && typeof delta === 'object') {
        for (const k of ['text', 'partial_json', 'thinking']) {
          if (typeof delta[k] === 'string') parts.push(delta[k] as string);
        }
      }
      if (Array.isArray(obj.choices)) {
        for (const ch of obj.choices as { delta?: { content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] } }[]) {
          if (typeof ch?.delta?.content === 'string') parts.push(ch.delta.content);
          for (const tc of ch?.delta?.tool_calls ?? []) {
            if (typeof tc?.function?.arguments === 'string') parts.push(tc.function.arguments);
          }
        }
      }
    } catch { /* non-JSON SSE data line */ }
  }
  return parts.join('');
};

const mergeFindings = (target: Map<string, GuardFinding>, incoming: readonly GuardFinding[]): void => {
  for (const f of incoming) {
    const prev = target.get(f.detectorId);
    target.set(f.detectorId, prev ? { ...prev, count: prev.count + f.count } : f);
  }
};

export class SseGuardTee {
  private readonly guard: GuardPort;
  private readonly overlapBytes: number;
  private readonly maxCaptureBytes: number;
  private rawTail = '';
  private deltaTail = '';
  private captured = '';
  private capturedBytes = 0;
  private truncated = false;
  private blocked = false;
  private readonly findings = new Map<string, GuardFinding>();

  constructor(options: { readonly guard: GuardPort; readonly overlapBytes?: number; readonly maxCaptureBytes?: number }) {
    this.guard = options.guard;
    this.overlapBytes = options.overlapBytes ?? SSE_GUARD_OVERLAP_BYTES;
    this.maxCaptureBytes = options.maxCaptureBytes ?? SSE_CAPTURE_MAX_BYTES;
  }

  pushChunk(chunk: string): { readonly blocked: boolean; readonly findings: readonly GuardFinding[] } {
    const stepFindings = new Map<string, GuardFinding>();
    const rawWindow = this.rawTail + chunk;
    const rawRes = this.guard.scanText(rawWindow);
    mergeFindings(stepFindings, rawRes.findings);
    let stepBlocked = rawRes.blocked;
    this.rawTail = rawWindow.slice(-this.overlapBytes);
    const deltaText = extractDeltaText(chunk);
    if (deltaText) {
      const deltaWindow = this.deltaTail + deltaText;
      const deltaRes = this.guard.scanText(deltaWindow);
      mergeFindings(stepFindings, deltaRes.findings);
      if (deltaRes.blocked) stepBlocked = true;
      this.deltaTail = deltaWindow.slice(-this.overlapBytes);
    }
    if (stepBlocked) this.blocked = true;
    mergeFindings(this.findings, [...stepFindings.values()]);
    if (!this.truncated) {
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      if (this.capturedBytes + chunkBytes <= this.maxCaptureBytes) {
        this.captured += chunk;
        this.capturedBytes += chunkBytes;
      } else {
        const rem = Math.max(0, this.maxCaptureBytes - this.capturedBytes);
        if (rem > 0) {
          this.captured += Buffer.from(chunk, 'utf8').subarray(0, rem).toString('utf8');
          this.capturedBytes = this.maxCaptureBytes;
        }
        this.truncated = true;
      }
    }
    return { blocked: stepBlocked, findings: [...stepFindings.values()] };
  }

  finalize(): SseGuardTeeResult {
    const finalScan = this.guard.scanText(this.captured);
    mergeFindings(this.findings, finalScan.findings);
    if (finalScan.blocked) this.blocked = true;
    const allFindings = [...this.findings.values()];
    return {
      maskedCapture: { __maskedCapturePayload: true, payload: finalScan.maskedText, findings: allFindings, truncated: this.truncated },
      findings: allFindings, blocked: this.blocked, truncated: this.truncated,
    };
  }
}

export const teeGuardedStream = (
  source: AsyncGenerator<GatewayDispatchStreamEvent | GatewayNativeStreamBytes, void, unknown>,
  options: { readonly guard: GuardPort; readonly onComplete?: (result: SseGuardTeeResult) => Promise<void> | void },
): AsyncGenerator<GatewayDispatchStreamEvent | GatewayNativeStreamBytes, void, unknown> => {
  const tee = new SseGuardTee({ guard: options.guard });
  const decoder = new TextDecoder('utf-8');
  let completed = false;
  const finish = async () => { if (!completed) { completed = true; await options.onComplete?.(tee.finalize()); } };
  const wrapped = (async function* (): AsyncGenerator<GatewayDispatchStreamEvent | GatewayNativeStreamBytes, void, unknown> {
    try {
      for await (const frame of source) {
        const text = 'raw' in frame ? frame.raw : decoder.decode(frame.bytes, { stream: true });
        if (tee.pushChunk(text).blocked) { await source.return(undefined); return; }
        yield frame;
      }
    } finally { await finish(); }
  })();
  const originalReturn = wrapped.return.bind(wrapped);
  wrapped.return = async (value) => { await source.return(undefined); await finish(); return originalReturn(value); };
  return wrapped;
};
