import type {
  NativeUsageRaw, NativeUsageUncertainty, NativeCacheWriteSplitReason, NativeInputUsageSource,
} from '@sentropic/llm-mesh';

export function isSafeNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

export interface RawNativeUsageUpdate {
  readonly input_tokens?: number | null; readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_creation?: { readonly ephemeral_5m_input_tokens?: number | null; readonly ephemeral_1h_input_tokens?: number | null } | null;
  readonly output_tokens?: number | null;
  readonly [key: string]: unknown;
}

export interface NativeCumulativeUsageState {
  readonly acceptedInputTokens: number; readonly acceptedCacheReadInputTokens: number;
  readonly acceptedCacheCreationInputTokens: number; readonly reportedCacheCreation5m?: number;
  readonly reportedCacheCreation1h?: number; readonly inferredCacheCreation1h?: number;
  readonly acceptedOutputTokens: number; readonly physicalInput: number; readonly physicalLowerBound: number;
  readonly inputUsageValidated: boolean; readonly inputUsageSource?: NativeInputUsageSource;
  readonly uncertaintyReason?: NativeUsageUncertainty; readonly cacheWriteSplitReason?: NativeCacheWriteSplitReason;
  readonly proofRevoked: boolean; readonly estimated: boolean;
}

export class NativeCumulativeUsageAccumulator {
  private u = 0; private r = 0; private w = 0; private s5?: number; private s1?: number; private i1?: number;
  private o = 0; private p = 0; private plb = 0; private valid = false; private source?: NativeInputUsageSource;
  private reason?: NativeUsageUncertainty; private splitReason?: NativeCacheWriteSplitReason;
  private revoked = false; private est = false; private anchored = false;

  constructor(initial?: RawNativeUsageUpdate, opts?: { isStart?: boolean; defaultTtlEligible?: boolean }) {
    if (initial) this.acceptStart(initial, opts);
  }

  acceptStart(raw: RawNativeUsageUpdate, opts?: { isStart?: boolean; defaultTtlEligible?: boolean }): boolean {
    const isStart = opts?.isStart !== false;
    const { input_tokens: u, cache_read_input_tokens: r, cache_creation_input_tokens: w, cache_creation: split, output_tokens: o } = raw;
    if (!isSafeNonNegativeInteger(u) || !isSafeNonNegativeInteger(r) || !isSafeNonNegativeInteger(w)) {
      this.revoke(u === undefined || r === undefined || w === undefined ? 'incomplete_input' : 'invalid_input');
      return false;
    }
    let s5: number | undefined, s1: number | undefined;
    if (split != null) {
      if (typeof split !== 'object') { this.revoke('invalid_input'); return false; }
      s5 = split.ephemeral_5m_input_tokens ?? undefined; s1 = split.ephemeral_1h_input_tokens ?? undefined;
      if (!isSafeNonNegativeInteger(s5) || !isSafeNonNegativeInteger(s1) || s5 + s1 !== w) {
        this.revoke('invalid_input'); return false;
      }
    } else if (w === 0) { s5 = 0; s1 = 0; } else if (opts?.defaultTtlEligible) { s5 = w; s1 = 0; } else {
      this.revoke('cache_write_split_unknown');
      this.u = u; this.r = r; this.w = w; this.p = u + r + w; this.plb = this.p;
      return false;
    }
    if (o != null) {
      if (!isSafeNonNegativeInteger(o)) { this.est = true; this.reason = 'invalid_output'; return false; }
      this.o = o;
    }
    this.u = u; this.r = r; this.w = w; this.s5 = s5; this.s1 = s1;
    this.p = u + r + w; this.plb = this.p; this.valid = true;
    this.source = isStart ? 'message_start' : 'json'; this.anchored = isStart;
    this.revoked = false; this.est = false;
    return true;
  }

  applyDelta(delta?: RawNativeUsageUpdate | null, opts?: { defaultTtlEligible?: boolean }): boolean {
    if (!delta) return true;
    const { input_tokens: u, cache_read_input_tokens: r, cache_creation_input_tokens: w, cache_creation: split, output_tokens: o } = delta;
    if (o != null) {
      if (!isSafeNonNegativeInteger(o) || o < this.o) { this.est = true; this.reason = this.reason || 'invalid_output'; return false; }
      this.o = o;
    }
    if (u == null && r == null && w == null && split == null) return true;

    const check = (val: unknown, accepted: number): { ok: boolean; n?: number } => {
      if (val == null) return { ok: true, n: accepted };
      if (typeof val === 'number' && Number.isFinite(val) && val < accepted) { this.revoke('input_breakdown_changed'); return { ok: false }; }
      if (!isSafeNonNegativeInteger(val)) { this.revoke('invalid_input'); return { ok: false }; }
      if (val < accepted) { this.revoke('input_breakdown_changed'); return { ok: false }; }
      return { ok: true, n: val };
    };

    const cu = check(u, this.u); if (!cu.ok) return false;
    const cr = check(r, this.r); if (!cr.ok) return false;
    let cw = this.w, c5 = this.s5, c1 = this.s1, ci1 = this.i1, csplit = this.splitReason;

    if (split != null) {
      if (typeof split !== 'object') { this.revoke('invalid_input'); return false; }
      const s5 = split.ephemeral_5m_input_tokens, s1 = split.ephemeral_1h_input_tokens;
      if (!isSafeNonNegativeInteger(s5) || !isSafeNonNegativeInteger(s1)) { this.revoke('invalid_input'); return false; }
      const sum = s5 + s1;
      if (w != null && (!isSafeNonNegativeInteger(w) || w !== sum)) { this.revoke('invalid_input'); return false; }
      cw = sum;
      if ((this.s5 !== undefined && s5 < this.s5) || (this.s1 !== undefined && s1 < this.s1) || cw < this.w) {
        this.revoke('input_breakdown_changed'); return false;
      }
      c5 = s5; c1 = s1;
    } else if (w != null) {
      const resW = check(w, this.w); if (!resW.ok) return false;
      cw = resW.n!;
      if (cw > this.w && !opts?.defaultTtlEligible) {
        ci1 = (this.i1 ?? (this.s1 ?? 0)) + (cw - this.w); csplit = 'cache_write_split_inferred';
      }
    }

    const candP = cu.n! + cr.n! + cw;
    this.u = cu.n!; this.r = cr.n!; this.w = cw; this.s5 = c5; this.s1 = c1;
    this.i1 = ci1; this.splitReason = csplit; this.plb = Math.max(this.plb, candP);
    if (this.revoked || !this.anchored) { this.valid = false; this.p = this.plb; return true; }
    this.p = candP; this.source = 'message_delta';
    return true;
  }

  revoke(reason?: NativeUsageUncertainty): void {
    this.revoked = true; this.valid = false;
    this.reason = reason ?? (this.reason || 'input_breakdown_changed'); this.est = true;
  }

  getState(): NativeCumulativeUsageState {
    return {
      acceptedInputTokens: this.u, acceptedCacheReadInputTokens: this.r, acceptedCacheCreationInputTokens: this.w,
      reportedCacheCreation5m: this.s5, reportedCacheCreation1h: this.s1, inferredCacheCreation1h: this.i1,
      acceptedOutputTokens: this.o, physicalInput: this.p, physicalLowerBound: this.plb,
      inputUsageValidated: this.valid, inputUsageSource: this.source, uncertaintyReason: this.reason,
      cacheWriteSplitReason: this.splitReason, proofRevoked: this.revoked, estimated: this.est,
    };
  }

  getRawUsage(): NativeUsageRaw {
    return {
      input_tokens: this.u, cache_read_input_tokens: this.r, cache_creation_input_tokens: this.w,
      ...(this.s5 !== undefined || this.s1 !== undefined ? { cache_creation: { ephemeral_5m_input_tokens: this.s5, ephemeral_1h_input_tokens: this.s1 } } : {}),
      output_tokens: this.o,
    };
  }
}
