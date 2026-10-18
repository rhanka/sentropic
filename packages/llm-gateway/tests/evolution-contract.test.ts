/**
 * Frozen L0 evolution contract (spec 8/GWRC-CI-V1).
 *
 * Pins the shared closed v1 schema identity, both program phase arms, the
 * mandatory profile map, and the three delivery rows (index/slot, ports,
 * ENVs). Any change here is a coordinated schema migration, never a silent
 * edit: the h2a companion and the registry arm freeze the same bytes.
 */
import { describe, expect, it } from 'vitest';

import {
  DELIVERIES,
  GATEWAY_PHASES,
  MANDATORY_GATEWAY_PROFILES,
  PROFILE_MAP,
  REGISTRY_PHASES,
  SCHEMA_VERSION,
  SHARED_BLOCK_SHA256,
  SPEC_SHA256,
} from '../src/evolution-contract.js';

describe('frozen evolution contract', () => {
  it('freezes schemaVersion 1 with the validated spec and shared-block identities', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(SPEC_SHA256).toBe(
      'a530321eb43171ee3b11605b90aa81699bb2758a0020e43f389a59156642eaf9',
    );
    expect(SHARED_BLOCK_SHA256).toBe(
      'b46d3c3c10873b8f5742fd8a4c6349f607d480b907dea899c38f0e8bb4e3b332',
    );
  });

  it('freezes the gateway phase arm including none and baseline-662', () => {
    expect([...GATEWAY_PHASES]).toEqual([
      'none',
      'baseline-662',
      'pr1-candidate',
      'pr2-candidate',
      'pr3-candidate',
      'pr1-published',
      'pr2-published',
      'pr3-published',
    ]);
  });

  it('freezes the registry phase arm including none', () => {
    expect([...REGISTRY_PHASES]).toEqual([
      'none',
      'r4-candidate',
      'r5-candidate',
      'r6-candidate',
      'r7b-candidate',
      'r4-published',
      'r5-published',
      'r6-published',
      'r7b-published',
    ]);
  });

  it('requires gateway-runtime and gateway-messaging on every gateway active phase', () => {
    expect([...MANDATORY_GATEWAY_PROFILES]).toEqual([
      'gateway-messaging',
      'gateway-runtime',
    ]);
    for (const profile of MANDATORY_GATEWAY_PROFILES) {
      expect(PROFILE_MAP[profile]).toBeDefined();
    }
  });

  it('freezes the PR1 delivery row on index 120 with its ports and ENVs', () => {
    expect(DELIVERIES.pr1).toEqual({
      branch: 'feat/gw-durable-vibe-muse',
      slug: 'feat-gw-durable-vibe-muse',
      candidateIndex: 120,
      slot: 0,
      apiPort: 9600,
      uiPort: 5800,
      maildevUiPort: 1700,
      gatewayPort: 19600,
      testEnv: 'test-gw-durable-vibe-muse',
      nativeEnv: 'e2e-gw-durable-vibe-muse',
    });
  });

  it('keeps the three delivery rows on distinct ports and ENVs', () => {
    const rows = [DELIVERIES.pr1, DELIVERIES.pr2, DELIVERIES.pr3];
    expect(new Set(rows.map((row) => row.apiPort)).size).toBe(3);
    expect(new Set(rows.map((row) => row.gatewayPort)).size).toBe(3);
    expect(new Set(rows.map((row) => row.testEnv)).size).toBe(3);
    expect(DELIVERIES.pr2.apiPort).toBe(9605);
    expect(DELIVERIES.pr3.apiPort).toBe(9610);
  });
});
