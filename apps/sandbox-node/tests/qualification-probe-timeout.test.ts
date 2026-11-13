import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { request } from 'node:https';
import { probeDataPlane } from '../src/data-plane-qualification-probes.js';
import { qualificationCertificates } from '../src/qualification-certificates.js';
import { generateTicketKeyPair } from '../src/tickets.js';

vi.mock('node:https', () => ({ request: vi.fn() }));

describe('qualification probe deadlines', () => {
  it.each(['no-response', 'headers-without-body', 'empty-end', 'aborted', 'closed'])('should close each stalled %s probe and bound application readiness', async mode => {
    vi.useFakeTimers();
    const destroyed: number[] = [];
    let attempts = 0;
    vi.mocked(request).mockImplementation(() => {
      const created = Date.now();
      attempts++;
      const req = Object.assign(new EventEmitter(), { setTimeout() {},
        destroy(error: Error) { destroyed.push(Date.now() - created); req.emit('error', error); req.emit('close'); },
        end() {
          if (mode !== 'no-response') {
            const res = Object.assign(new EventEmitter(), { statusCode: 200 }); req.emit('response', res);
            if (mode === 'empty-end') res.emit('end');
            if (mode === 'aborted') res.emit('aborted');
            if (mode === 'closed') res.emit('close');
          }
        } });
      return req as never;
    });
    try {
      const work = probeDataPlane({ socketPath: '/private/test', certificates: qualificationCertificates(),
        uid: 'test', node: { keys: generateTicketKeyPair(), ownership: { custodyEpoch: 1 } as never, async revoke() {} },
        report() {}, checkTcp() {} });
      const result = expect(work).rejects.toThrow(['no-response', 'headers-without-body'].includes(mode) ? 'probe deadline' : 'response ended');
      await vi.advanceTimersByTimeAsync(6000); await result;
      expect(attempts).toBeGreaterThan(1);
      if (['no-response', 'headers-without-body'].includes(mode)) expect(destroyed.length).toBeGreaterThan(1);
      expect(destroyed.every(elapsed => elapsed === 1000)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
});
