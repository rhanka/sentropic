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

const sliceUtf8Safe = (text: string, maxBytes: number): string => {
  if (maxBytes <= 0 || !text) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  if ((buf[end]! & 0xc0) === 0x80) while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
};

const extractDeltaFromLines = (lines: readonly string[]): string => {
  const parts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const delta = obj.delta as Record<string, unknown> | string | undefined;
      if (typeof delta === 'string') parts.push(delta);
      else if (delta && typeof delta === 'object') {
        for (const k of ['text', 'partial_json', 'thinking']) if (typeof delta[k] === 'string') parts.push(delta[k] as string);
      }
      const block = obj.content_block as Record<string, unknown> | undefined;
      if (block && typeof block === 'object') {
        for (const k of ['text', 'thinking']) if (typeof block[k] === 'string' && block[k]) parts.push(block[k] as string);
      }
      if (Array.isArray(obj.choices)) {
        for (const ch of obj.choices as { delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] } }[]) {
          if (typeof ch?.delta?.content === 'string') parts.push(ch.delta.content);
          if (typeof ch?.delta?.reasoning_content === 'string') parts.push(ch.delta.reasoning_content);
          for (const tc of ch?.delta?.tool_calls ?? []) if (typeof tc?.function?.arguments === 'string') parts.push(tc.function.arguments);
        }
      }
    } catch { /* non-JSON SSE data line */ }
  }
  return parts.join('');
};

const stripUntouchedOverflowTail = (masked: string, overflow: string): string => {
  let m = masked.length - 1;
  let o = overflow.length - 1;
  while (m >= 0 && o >= 0 && masked.charCodeAt(m) === overflow.charCodeAt(o)) { m -= 1; o -= 1; }
  return masked.slice(0, m + 1);
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
  private isSse = false;
  private lineBuf = '';
  private rawTail = '';
  private deltaTail = '';
  private captured = '';
  private capturedBytes = 0;
  private overflowPreview = '';
  private overflowBytes = 0;
  private postCapTail = '';
  private postCapInit = false;
  private truncated = false;
  private blocked = false;
  private readonly postCapFindings = new Map<string, GuardFinding>();

  constructor(options: { readonly guard: GuardPort; readonly overlapBytes?: number; readonly maxCaptureBytes?: number }) {
    this.guard = options.guard;
    this.overlapBytes = options.overlapBytes ?? SSE_GUARD_OVERLAP_BYTES;
    this.maxCaptureBytes = options.maxCaptureBytes ?? SSE_CAPTURE_MAX_BYTES;
  }

  private trackPostCap(piece: string): void {
    if (!this.postCapInit) { this.postCapTail = (this.captured + this.overflowPreview).slice(-this.overlapBytes); this.postCapInit = true; }
    const prev = new Map(this.guard.scanText(this.postCapTail).findings.map((f) => [f.detectorId, f.count]));
    const combined = this.postCapTail + piece;
    const nextRes = this.guard.scanText(combined);
    if (nextRes.blocked) this.blocked = true;
    for (const f of nextRes.findings) {
      const delta = f.count - (prev.get(f.detectorId) ?? 0);
      if (delta > 0) mergeFindings(this.postCapFindings, [{ ...f, count: delta }]);
    }
    this.postCapTail = combined.slice(-this.overlapBytes);
  }

  private appendCapture(piece: string): void {
    if (!piece) return;
    if (!this.truncated) {
      const bytes = Buffer.byteLength(piece, 'utf8');
      if (this.capturedBytes + bytes <= this.maxCaptureBytes) { this.captured += piece; this.capturedBytes += bytes; return; }
      const head = sliceUtf8Safe(piece, Math.max(0, this.maxCaptureBytes - this.capturedBytes));
      this.captured += head;
      this.capturedBytes += Buffer.byteLength(head, 'utf8');
      this.truncated = true;
      piece = piece.slice(head.length);
    }
    if (piece && this.overflowBytes < this.overlapBytes) {
      const take = sliceUtf8Safe(piece, this.overlapBytes - this.overflowBytes);
      if (take) { this.overflowPreview += take; this.overflowBytes += Buffer.byteLength(take, 'utf8'); }
      piece = piece.slice(take.length);
    }
    if (piece) this.trackPostCap(piece);
  }

  pushChunk(chunk: string): { readonly blocked: boolean; readonly findings: readonly GuardFinding[] } {
    const stepFindings = new Map<string, GuardFinding>();
    const rawWindow = this.rawTail + chunk;
    const rawRes = this.guard.scanText(rawWindow);
    let stepBlocked = rawRes.blocked;
    this.rawTail = rawWindow.slice(-this.overlapBytes);
    if (!this.isSse && /^(?:event:|data:)/m.test(chunk)) this.isSse = true;
    if (this.isSse) {
      const combined = this.lineBuf + chunk;
      const lines = combined.split('\n');
      this.lineBuf = combined.endsWith('\n') ? '' : (lines.pop() ?? '');
      const deltaText = extractDeltaFromLines(lines);
      if (deltaText) {
        const deltaWindow = this.deltaTail + deltaText;
        const deltaRes = this.guard.scanText(deltaWindow);
        mergeFindings(stepFindings, deltaRes.findings);
        if (deltaRes.blocked) stepBlocked = true;
        this.deltaTail = deltaWindow.slice(-this.overlapBytes);
        this.appendCapture(deltaText);
      }
    } else {
      mergeFindings(stepFindings, rawRes.findings);
      this.appendCapture(chunk);
    }
    if (stepBlocked) this.blocked = true;
    return { blocked: stepBlocked, findings: [...stepFindings.values()] };
  }

  finalize(): SseGuardTeeResult {
    if (this.isSse && this.lineBuf) {
      const tailDelta = extractDeltaFromLines([this.lineBuf]);
      this.lineBuf = '';
      if (tailDelta) this.appendCapture(tailDelta);
    }
    const finalScan = this.guard.scanText(this.captured + this.overflowPreview);
    if (finalScan.blocked) this.blocked = true;
    const stripped = stripUntouchedOverflowTail(finalScan.maskedText, this.overflowPreview);
    const payload = this.truncated ? sliceUtf8Safe(stripped, this.maxCaptureBytes) : stripped;
    const totals = new Map<string, GuardFinding>();
    mergeFindings(totals, finalScan.findings);
    mergeFindings(totals, [...this.postCapFindings.values()]);
    const allFindings = [...totals.values()];
    return {
      maskedCapture: { __maskedCapturePayload: true, payload, findings: allFindings, truncated: this.truncated },
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
