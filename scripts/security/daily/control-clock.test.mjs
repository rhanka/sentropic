import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFSET_BOUND_MS,
  DIFF_BOUND_MS,
  HEALTH_MAX_AGE_MS,
  TERMINATE_DETECT_MS,
  TERMINATE_TOTAL_MS,
  NTS_SERVER,
  validateClockHealth,
  terminationVerdict,
} from './control-clock.mjs';

function health() {
  return {
    ntsAuthenticated: true,
    server: 'time.cloudflare.com',
    daemon: 'chronyd',
    leapState: 'normal',
    syncState: 'synchronized',
    stratum: 3,
    referenceAgeSeconds: 12,
    systemOffsetMs: 40,
    rootDispersionMs: 20,
    rootDelayMs: 60,
    sampledAt: 200000,
    now: 200500,
    bootId: 'boot-1',
    baselineBootId: 'boot-1',
    realtimeMinusBoottimeDriftMs: 10,
    peerDifferenceMs: 200,
  };
}

describe('L8-G/J: named clock-health contract', () => {
  it('positive health validates within the 250 ms bound', () => {
    assert.deepEqual(validateClockHealth(health()), []);
    assert.equal(OFFSET_BOUND_MS, 250);
    assert.equal(NTS_SERVER, 'time.cloudflare.com');
  });

  it('unauthenticated source, bad stratum and stale reference fail', () => {
    assert.ok(validateClockHealth({ ...health(), ntsAuthenticated: false }).length > 0);
    assert.ok(validateClockHealth({ ...health(), server: 'ntp.evil.example' }).length > 0);
    assert.ok(validateClockHealth({ ...health(), stratum: 16 }).length > 0);
    assert.ok(validateClockHealth({ ...health(), referenceAgeSeconds: 31 }).length > 0);
  });

  it('offset over the bound and one-second peer difference fail', () => {
    assert.ok(validateClockHealth({ ...health(), systemOffsetMs: 300 }).length > 0);
    assert.ok(validateClockHealth({ ...health(), peerDifferenceMs: 1000 }).length === 0);
    assert.ok(validateClockHealth({ ...health(), peerDifferenceMs: 1001 }).length > 0);
    assert.ok(validateClockHealth({ ...health(), baselineBootId: 'boot-2' }).length > 0);
    assert.ok(validateClockHealth({ ...health(), now: 200000 + HEALTH_MAX_AGE_MS + 1 }).length > 0);
  });
});

describe('L8-G: termination within 60 seconds of detection, 75 total', () => {
  it('timely termination passes, late termination fences', () => {
    assert.equal(terminationVerdict({ detectedAt: 0, terminatedAt: 59000 }), 'ok');
    assert.equal(terminationVerdict({ detectedAt: 0, terminatedAt: 61000 }), 'exceeded-detect');
    assert.equal(terminationVerdict({ detectedAt: 0, terminatedAt: 76000 }), 'exceeded-total');
    assert.equal(TERMINATE_DETECT_MS, 60000);
    assert.equal(TERMINATE_TOTAL_MS, 75000);
  });
});
