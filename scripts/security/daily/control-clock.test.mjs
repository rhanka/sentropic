import { describe, it, test } from 'node:test';
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
  CLOCK_SOURCE,
  DETECTION_LIMIT_S,
  DIRECT_READ_GET_TIMEOUT_S,
  DIRECT_READ_VALIDITY_S,
  MAX_CLOCK_OFFSET_MS,
  TOTAL_LIMIT_S,
  assertClockHealth,
  assertDirectRead,
  assertTerminationTimeline,
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

// T5-C6 / T6-C3 (r6 §6.4 D/ destination): chronyd/NTS clock health with ≤60 s detection
// / ≤75 s total termination bounds, and direct reads bounded by 2 s GET / 5 s validity.
const t0 = 1_800_000_000_000;

test('T5-C6/T6-C3: pinned chronyd/NTS source with bounded offset validates', () => {
  assert.equal(assertClockHealth({ source: CLOCK_SOURCE, offsetMs: 120, epoch: 7 }), true);
  assert.equal(CLOCK_SOURCE, 'chronyd-nts');
  assert.equal(MAX_CLOCK_OFFSET_MS, 1000);
});

test('T5-C6/T6-C3: wrong clock source, large offset or missing epoch refuses', () => {
  assert.throws(() => assertClockHealth({ source: 'ntp-pool', offsetMs: 0, epoch: 1 }), /clock-source/);
  assert.throws(() => assertClockHealth({ source: CLOCK_SOURCE, offsetMs: 5000, epoch: 1 }), /clock-offset/);
  assert.throws(() => assertClockHealth({ source: CLOCK_SOURCE, offsetMs: 0 }), /clock-epoch/);
});

test('T5-C6/T6-C3: termination within 60 s detection / 75 s total passes; over-bound refuses', () => {
  const ok = assertTerminationTimeline([
    { atMs: t0, kind: 'drift-start' },
    { atMs: t0 + 45_000, kind: 'detected' },
    { atMs: t0 + 70_000, kind: 'terminated' },
  ]);
  assert.equal(ok.detectionSeconds, 45);
  assert.equal(ok.totalSeconds, 70);
  assert.throws(() => assertTerminationTimeline([
    { atMs: t0, kind: 'drift-start' },
    { atMs: t0 + 61_000, kind: 'detected' },
    { atMs: t0 + 70_000, kind: 'terminated' },
  ]), /detection-over-60s/);
  assert.throws(() => assertTerminationTimeline([
    { atMs: t0, kind: 'drift-start' },
    { atMs: t0 + 30_000, kind: 'detected' },
    { atMs: t0 + 76_000, kind: 'terminated' },
  ]), /termination-over-75s/);
  assert.throws(() => assertTerminationTimeline([
    { atMs: t0, kind: 'drift-start' },
    { atMs: t0 - 5_000, kind: 'detected' },
    { atMs: t0 + 10_000, kind: 'terminated' },
  ]), /timeline-order/);
  assert.throws(() => assertTerminationTimeline([
    { atMs: t0, kind: 'drift-start' },
    { atMs: t0 + 5_000, kind: 'detected' },
    { atMs: t0 + 6_000, kind: 'other' },
  ]), /timeline-markers-missing/);
  assert.equal(DETECTION_LIMIT_S, 60);
  assert.equal(TOTAL_LIMIT_S, 75);
});

test('T5-C6/T6-C3: direct reads respect the 2 s GET timeout / 5 s validity bounds', () => {
  assert.equal(assertDirectRead({ getTimeoutSeconds: 2, validitySeconds: 5 }), true);
  assert.throws(() => assertDirectRead({ getTimeoutSeconds: 3, validitySeconds: 5 }), /direct-read-get-timeout/);
  assert.throws(() => assertDirectRead({ getTimeoutSeconds: 2, validitySeconds: 6 }), /direct-read-validity/);
  assert.throws(() => assertDirectRead({ getTimeoutSeconds: 0, validitySeconds: 5 }), /direct-read-nonpositive/);
  assert.equal(DIRECT_READ_GET_TIMEOUT_S, 2);
  assert.equal(DIRECT_READ_VALIDITY_S, 5);
});
