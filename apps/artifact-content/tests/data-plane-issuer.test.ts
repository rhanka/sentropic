import { afterEach, expect, it, vi } from 'vitest';
import { createRpcCustodyIssuer } from '../src/custody-issuer';
import type { CustodyRpc } from '../src/custody-rpc';
import { subject } from './data-plane-fixture';

afterEach(() => vi.useRealTimers());

it('should cut established watches on both replicas before the delayed-OK 1240 ms counterexample', async () => {
  vi.useFakeTimers(); const cut: number[] = []; const sent: number[][] = [[], []];
  const stops = sent.map((requests, replica) => createRpcCustodyIssuer(async () => {
    requests.push(performance.now());
    const requestNumber = requests.length;
    if (requestNumber === 1) return { version: 'a'.repeat(64) };
    // The t=250 check precedes revocation at t=260; its stale OK arrives at t=750.
    await new Promise(resolve => setTimeout(resolve, 500));
    if (requestNumber > 2) throw new Error('RPC timeout');
    return { version: 'a'.repeat(64) };
  }).watch(subject, () => { cut[replica] = performance.now(); }));
  try {
    await vi.advanceTimersByTimeAsync(260); expect(cut).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(cut).toHaveLength(2); expect(cut.every(time => time - 260 < 1000)).toBe(true);
    expect(sent.every(requests => requests[1] === 250 && requests[2] === 500)).toBe(true);
  } finally { stops.forEach(stop => stop()); }
});

it('should cut both replicas within one second despite delayed stale OKs and hanging subsequent polls', async () => {
  vi.useFakeTimers();
  const sent: number[][] = [[], []]; const cut: number[] = [];
  const stops = sent.map((requests, replica) => {
    const rpc: CustodyRpc = async () => {
      requests.push(performance.now());
      if (requests.length > 1) return new Promise(() => {});
      // Authority is checked now, revoked at t=10, but this old OK arrives at t=500.
      await new Promise(resolve => setTimeout(resolve, 500));
      return { version: 'a'.repeat(64) };
    };
    return createRpcCustodyIssuer(rpc).watch(subject, () => { cut[replica] = performance.now(); });
  });
  try {
    await vi.advanceTimersByTimeAsync(999);
    expect(cut).toHaveLength(2);
    expect(cut.every(time => time > 500 && time < 1000)).toBe(true);
    expect(sent.every(requests => requests[1] === 250 && requests[2] === 500)).toBe(true);
    await vi.advanceTimersByTimeAsync(501);
    expect(cut).toHaveLength(2);
  } finally { stops.forEach(stop => stop()); }
});

it('should never resurrect a revoked watch when its old OK arrives after the freshness limit', async () => {
  vi.useFakeTimers(); let cuts = 0; let calls = 0;
  const stop = createRpcCustodyIssuer(async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 1100));
    return { version: 'a'.repeat(64) };
  }).watch(subject, () => { cuts++; });
  try {
    await vi.advanceTimersByTimeAsync(1000); expect(cuts).toBe(1);
    const before = calls;
    await vi.advanceTimersByTimeAsync(1500); expect(cuts).toBe(1); expect(calls).toBe(before);
  } finally { stop(); }
});
