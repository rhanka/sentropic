import type {
  NativeUsageRaw, NativeUsageUncertainty, NativeCacheWriteSplitReason, NativeInputUsageSource,
  NativeUsageSnapshot, NativeUsageTermination,
} from '@sentropic/llm-mesh';
import type { NativeSseFrame } from './native-sse.js';

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
  readonly messageDeltaInputDecreased: boolean;
}

export class NativeCumulativeUsageAccumulator {
  private u = 0; private r = 0; private w = 0; private s5?: number; private s1?: number; private i1?: number;
  private o = 0; private p = 0; private plb = 0; private valid = false; private source?: NativeInputUsageSource;
  private reason?: NativeUsageUncertainty; private splitReason?: NativeCacheWriteSplitReason;
  private revoked = false; private est = false; private anchored = false; private startSeen = false;
  private raw: NativeUsageRaw = {};
  private decreased = false;

  private retainRaw(update: RawNativeUsageUpdate): void {
    const next = { ...this.raw };
    for (const key of ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'] as const) {
      const value = update[key];
      if (isSafeNonNegativeInteger(value)) next[key] = Math.max(next[key] ?? 0, value);
    }
    if (update.cache_creation && typeof update.cache_creation === 'object') {
      const split = { ...next.cache_creation };
      for (const key of ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'] as const) {
        const value = update.cache_creation[key];
        if (isSafeNonNegativeInteger(value)) split[key] = Math.max(split[key] ?? 0, value);
      }
      if (Object.keys(split).length) next.cache_creation = split;
    }
    this.raw = next;
  }

  constructor(initial?: RawNativeUsageUpdate, opts?: { isStart?: boolean; defaultTtlEligible?: boolean }) {
    if (initial) this.acceptStart(initial, opts);
  }

  acceptStart(raw: RawNativeUsageUpdate, opts?: { isStart?: boolean; defaultTtlEligible?: boolean }): boolean {
    if (this.startSeen) {
      this.revoke('input_breakdown_changed');
      return false;
    }
    if (this.revoked) {
      return false;
    }
    this.startSeen = true;
    const isStart = opts?.isStart !== false;
    const { input_tokens: u, cache_read_input_tokens: r, cache_creation_input_tokens: w, cache_creation: split, output_tokens: o } = raw;
    this.retainRaw(raw);
    if (o != null) {
      if (!isSafeNonNegativeInteger(o)) { this.est = true; this.reason = 'invalid_output'; }
      else this.o = o;
    }
    if (!isSafeNonNegativeInteger(u) || !isSafeNonNegativeInteger(r) || !isSafeNonNegativeInteger(w)) {
      this.revoke(u === undefined || r === undefined || w === undefined ? 'incomplete_input' : 'invalid_input');
      return false;
    }
    const sumP = BigInt(u) + BigInt(r) + BigInt(w);
    if (sumP > BigInt(Number.MAX_SAFE_INTEGER)) {
      this.revoke('invalid_input');
      return false;
    }
    let s5: number | undefined, s1: number | undefined;
    if (split != null) {
      if (typeof split !== 'object') { this.revoke('invalid_input'); return false; }
      s5 = split.ephemeral_5m_input_tokens ?? undefined; s1 = split.ephemeral_1h_input_tokens ?? undefined;
      if (!isSafeNonNegativeInteger(s5) || !isSafeNonNegativeInteger(s1)) {
        this.revoke('invalid_input'); return false;
      }
      const splitSum = BigInt(s5) + BigInt(s1);
      if (splitSum > BigInt(Number.MAX_SAFE_INTEGER) || splitSum !== BigInt(w)) {
        this.revoke('invalid_input'); return false;
      }
    } else if (w === 0) {
      // Split omitted; reported TTL remains undefined.
    } else if (opts?.defaultTtlEligible) {
      // Pricing allocation default TTL; reported TTL evidence remains undefined.
    } else {
      this.revoke('cache_write_split_unknown');
      this.u = u; this.r = r; this.w = w; this.p = Number(sumP); this.plb = this.p;
      this.anchored = isStart;
      return false;
    }
    this.u = u; this.r = r; this.w = w; this.s5 = s5; this.s1 = s1;
    this.p = Number(sumP); this.plb = this.p; this.valid = true;
    this.source = isStart ? 'message_start' : 'json'; this.anchored = isStart;
    return !this.est;
  }

  applyDelta(delta?: RawNativeUsageUpdate | null, opts?: { defaultTtlEligible?: boolean }): boolean {
    if (!delta) return true;
    const { input_tokens: u, cache_read_input_tokens: r, cache_creation_input_tokens: w, cache_creation: split, output_tokens: o } = delta;
    const supplied = [u, r, w, split?.ephemeral_5m_input_tokens, split?.ephemeral_1h_input_tokens];
    const accepted = [this.u, this.r, this.w, this.s5, this.s1];
    this.decreased ||= supplied.some((value, index) => typeof value === 'number' && Number.isFinite(value)
      && accepted[index] !== undefined && value < accepted[index]!);
    this.retainRaw(delta);
    let outputValid = true;
    if (o != null) {
      if (!isSafeNonNegativeInteger(o) || o < this.o) {
        this.est = true;
        this.reason = this.reason || 'invalid_output';
        outputValid = false;
      } else this.o = o;
    }
    if (u == null && r == null && w == null && split == null) {
      if (!outputValid) {
        this.reason = this.reason || 'invalid_output';
        return false;
      }
      return true;
    }

    const check = (val: unknown, accepted: number): { ok: boolean; n?: number } => {
      if (val == null) return { ok: true, n: accepted };
      if (typeof val === 'number' && Number.isFinite(val) && val < accepted) { this.revoke('input_breakdown_changed'); return { ok: false }; }
      if (!isSafeNonNegativeInteger(val)) { this.revoke('invalid_input'); return { ok: false }; }
      if (val < accepted) { this.revoke('input_breakdown_changed'); return { ok: false }; }
      return { ok: true, n: val };
    };

    const cu = check(u, this.u); if (!cu.ok) { if (!outputValid) this.reason = this.reason || 'invalid_output'; return false; }
    const cr = check(r, this.r); if (!cr.ok) { if (!outputValid) this.reason = this.reason || 'invalid_output'; return false; }
    let cw = this.w, c5 = this.s5, c1 = this.s1, ci1 = this.i1, csplit = this.splitReason;

    if (split != null) {
      if (typeof split !== 'object') { this.revoke('invalid_input'); return false; }
      const s5 = split.ephemeral_5m_input_tokens, s1 = split.ephemeral_1h_input_tokens;
      if (!isSafeNonNegativeInteger(s5) || !isSafeNonNegativeInteger(s1)) { this.revoke('invalid_input'); return false; }
      const splitSum = BigInt(s5) + BigInt(s1);
      if (splitSum > BigInt(Number.MAX_SAFE_INTEGER)) { this.revoke('invalid_input'); return false; }
      const sum = Number(splitSum);
      if (w != null && (!isSafeNonNegativeInteger(w) || w !== sum)) { this.revoke('invalid_input'); return false; }
      cw = sum;
      if ((this.s5 !== undefined && s5 < this.s5) || (this.s1 !== undefined && s1 < this.s1) || cw < this.w) {
        this.revoke('input_breakdown_changed'); return false;
      }
      c5 = s5; c1 = s1;
      csplit = undefined; ci1 = undefined;
    } else if (w != null) {
      const resW = check(w, this.w); if (!resW.ok) return false;
      cw = resW.n!;
      if (cw > this.w && !opts?.defaultTtlEligible) {
        const growth = BigInt(cw - this.w);
        const base = BigInt(this.i1 ?? (this.s1 ?? 0));
        const nextI1 = base + growth;
        if (nextI1 > BigInt(Number.MAX_SAFE_INTEGER)) { this.revoke('invalid_input'); return false; }
        ci1 = Number(nextI1);
        csplit = 'cache_write_split_inferred';
      }
    }

    const candPBig = BigInt(cu.n!) + BigInt(cr.n!) + BigInt(cw);
    if (candPBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      this.revoke('invalid_input');
      return false;
    }
    const candP = Number(candPBig);

    this.u = cu.n!; this.r = cr.n!; this.w = cw;
    if (c5 !== undefined) this.s5 = c5;
    if (c1 !== undefined) this.s1 = c1;
    this.i1 = ci1;
    this.splitReason = csplit;

    if (!this.anchored) {
      this.valid = false;
      this.p = 0;
      this.plb = 0;
      if (!outputValid) {
        this.reason = this.reason || 'invalid_output';
        return false;
      }
      return true;
    }

    this.plb = Math.max(this.plb, candP);
    if (this.revoked) {
      this.valid = false;
      this.p = this.plb;
    } else {
      this.valid = true;
      this.p = candP;
      this.source = 'message_delta';
    }
    return outputValid;
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
      messageDeltaInputDecreased: this.decreased,
    };
  }

  getRawUsage(): NativeUsageRaw {
    return {
      ...this.raw,
      ...(this.raw.cache_creation ? { cache_creation: { ...this.raw.cache_creation } } : {}),
    };
  }
}

const nativeRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

/** Sole native usage fold; terminal ownership and financial floors belong to the flow. */
export class NativeUsageObserver {
  readonly accumulator = new NativeCumulativeUsageAccumulator();
  private stopped = false;
  private finalCandidate = false;

  constructor(readonly selectedModelId: string, private readonly defaultTtlEligible = false) {}

  observeJson(body: Readonly<Record<string, unknown>>): void {
    const usage = nativeRecord(body.usage);
    if (!usage) { this.accumulator.revoke('missing_usage'); return; }
    this.accumulator.acceptStart(usage as RawNativeUsageUpdate,
      { isStart: false, defaultTtlEligible: this.defaultTtlEligible });
    this.finalCandidate = isSafeNonNegativeInteger(usage.output_tokens);
    this.stopped = true;
  }

  observeFrame(frame: NativeSseFrame): void {
    if (!frame.data) return;
    let event: Record<string, unknown> | undefined;
    try { event = nativeRecord(JSON.parse(frame.data)); } catch { return; }
    if (!event) return;
    const type = frame.event ?? event.type;
    if (type === 'message_start') {
      const usage = nativeRecord(nativeRecord(event.message)?.usage);
      if (!usage) { this.accumulator.revoke('missing_usage'); return; }
      this.accumulator.acceptStart(usage as RawNativeUsageUpdate, { defaultTtlEligible: this.defaultTtlEligible });
    } else if (type === 'message_delta') {
      const usage = nativeRecord(event.usage);
      const previousOutput = this.accumulator.getState().acceptedOutputTokens;
      this.accumulator.applyDelta(usage as RawNativeUsageUpdate | undefined,
        { defaultTtlEligible: this.defaultTtlEligible });
      if (isSafeNonNegativeInteger(usage?.output_tokens) && usage.output_tokens >= previousOutput) this.finalCandidate = true;
    } else if (type === 'message_stop') this.stopped = true;
  }

  snapshot(termination: NativeUsageTermination): NativeUsageSnapshot {
    const state = this.accumulator.getState();
    const raw = this.accumulator.getRawUsage();
    if (raw.cache_creation) Object.freeze(raw.cache_creation);
    Object.freeze(raw);
    const input = state.inputUsageValidated || state.physicalLowerBound > 0 ? state.physicalInput : undefined;
    const output = raw.output_tokens;
    const finalOutputObserved = termination === 'completed' && this.stopped && this.finalCandidate;
    const estimated = state.estimated || !state.inputUsageValidated || !finalOutputObserved
      || !input || !output;
    const total = input !== undefined && output !== undefined ? BigInt(input) + BigInt(output) : undefined;
    return Object.freeze({
      ...(input !== undefined ? { inputTokens: input } : {}),
      ...(output !== undefined ? { outputTokens: output } : {}),
      ...(total !== undefined && total <= BigInt(Number.MAX_SAFE_INTEGER) ? { totalTokens: Number(total) } : {}),
      rawUsage: raw, estimated, finalOutputObserved, termination,
      nativeSelectedModelId: this.selectedModelId, fallbackPresent: false, iterationsPresent: false,
      nativeInputUsageValidated: state.inputUsageValidated, nativeInputUsageSource: state.inputUsageSource,
      nativeUsageUncertainty: state.uncertaintyReason ?? (estimated ? 'incomplete_output' : undefined),
      nativeCacheWriteSplitReason: state.cacheWriteSplitReason,
    });
  }
}
