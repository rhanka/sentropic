import { describe, expect, it, vi } from 'vitest';
import { ClusterMeshConfigError, resolveClusterMeshConfig } from '../src/config.js';
import { createCapacityAdmission } from '../src/runtime/admission.js';

describe('cluster mesh capacity admission', () => {
  it('should reject the thirteenth reservation before spawn at the default cap', () => {
    const config = resolveClusterMeshConfig({ capacity: { poolSize: 4 } });
    const admission = createCapacityAdmission({
      generationId: 'generation-1',
      config: config.capacity,
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    });
    const spawn = vi.fn();

    for (let index = 1; index <= 12; index += 1) {
      const result = admission.reserveBeforeSpawn({
        reservationId: `reservation-${index}`,
        subjectRef: `subject-${index}`,
      });
      if (result.ok) spawn(result.reservation);
    }
    const refused = admission.reserveBeforeSpawn({
      reservationId: 'reservation-13',
      subjectRef: 'subject-13',
    });
    if (refused.ok) spawn(refused.reservation);

    expect(config.capacity).toEqual({ maxConcurrent: 12, poolSize: 4 });
    expect(refused).toEqual({ ok: false, reason: 'capacity_exhausted' });
    expect(spawn).toHaveBeenCalledTimes(12);
  });

  it('should enforce a configured non-default cap', () => {
    const config = resolveClusterMeshConfig({
      capacity: { maxConcurrent: 2, poolSize: 1 },
    });
    const admission = createCapacityAdmission({ generationId: 'generation-2', config: config.capacity });

    expect(admission.reserveBeforeSpawn({ reservationId: 'one', subjectRef: 'one' }).ok).toBe(true);
    expect(admission.reserveBeforeSpawn({ reservationId: 'two', subjectRef: 'two' }).ok).toBe(true);
    expect(admission.reserveBeforeSpawn({ reservationId: 'three', subjectRef: 'three' })).toEqual({
      ok: false,
      reason: 'capacity_exhausted',
    });
  });

  it('should accept an idempotent reservation retry without consuming capacity', () => {
    const admission = createCapacityAdmission({
      generationId: 'generation-retry',
      config: { maxConcurrent: 1, poolSize: 1 },
    });
    const request = { reservationId: 'same', subjectRef: 'subject' };

    expect(admission.reserveBeforeSpawn(request)).toMatchObject({ ok: true, outcome: 'reserved' });
    expect(admission.reserveBeforeSpawn(request)).toMatchObject({
      ok: true,
      outcome: 'idempotent_retry',
    });
    expect(admission.reserved).toBe(1);
  });

  it.each([
    [{ capacity: { maxConcurrent: 0, poolSize: 1 } }, 'maxConcurrent'],
    [{ capacity: { maxConcurrent: 1.5, poolSize: 1 } }, 'maxConcurrent'],
    [{ capacity: { maxConcurrent: 2, poolSize: 0 } }, 'poolSize'],
    [{ capacity: { maxConcurrent: 2, poolSize: 1.5 } }, 'poolSize'],
    [{ capacity: { maxConcurrent: 2, poolSize: 3 } }, 'poolSize'],
  ])('should reject invalid capacity config %#', (input, field) => {
    expect(() => resolveClusterMeshConfig(input)).toThrowError(ClusterMeshConfigError);
    expect(() => resolveClusterMeshConfig(input)).toThrowError(
      expect.objectContaining({ message: expect.stringContaining(field) }),
    );
  });
});
