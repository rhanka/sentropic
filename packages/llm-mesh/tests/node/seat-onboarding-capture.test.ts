import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AGY_REQUIRED_COMPLETED_STEPS,
  canonicalAgyJetskiBytes,
  type SeatOnboardingV1,
} from '../../src/enrollment/seat-onboarding.js';
import { captureSeatOnboarding } from '../../src/node/seat-onboarding-capture.js';

const AGY_STEPS = AGY_REQUIRED_COMPLETED_STEPS['1.4.12'];
const AGY_SOURCE = '.gemini/antigravity-cli/jetski_state.pbtxt';

/** Synthetic fixture shaped like the measured owner file: steps + uuid + migrations. */
const MEASURED_SHAPE = `post_onboarding {
  completed_steps: ${AGY_STEPS[0]}
  completed_steps: ${AGY_STEPS[1]}
  completed_steps: ${AGY_STEPS[2]}
  completed_steps: ${AGY_STEPS[3]}
}
installation_uuid: "synthetic-installation-uuid-0001"
migrations {
  key: 1
  status: MIGRATION_STATUS_FAILED
}
migrations {
  key: 2
  status: MIGRATION_STATUS_SUCCEEDED
}
`;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sourceHome(content: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'seat-capture-'));
  roots.push(root);
  if (content !== null) {
    const dir = join(root, '.gemini', 'antigravity-cli');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'jetski_state.pbtxt'), content);
  }
  return root;
}

function input(home: string, overrides: Record<string, unknown> = {}) {
  return {
    cli: 'agy' as const,
    sourceHome: home,
    selector: { sourceRelPath: AGY_SOURCE },
    seatRef: 'seat-synth-agy-01',
    ownerScope: 'owner-synth-01',
    accountBinding: 'mesh-account-synth-01',
    nativeCliVersion: '1.4.12',
    os: 'linux' as const,
    capturedAt: '2026-11-02T00:00:00Z',
    lineage: { epoch: 1, generation: 1, operationId: 'op-synth-agy-01' },
    ...overrides,
  };
}

describe('captureSeatOnboarding (agy)', () => {
  it('captures the measured shape to canonical steps-only bytes', async () => {
    const home = await sourceHome(MEASURED_SHAPE);
    const result = await captureSeatOnboarding(input(home));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block: SeatOnboardingV1 = result.block;
    expect(block.cli).toBe('agy');
    expect(block.cellSynthesis).toEqual([]);
    expect(block.files).toHaveLength(1);
    const file = block.files[0];
    expect(file.destKey).toBe('agy-jetski');
    expect(file.format).toBe('agy-jetski-pbtxt-v1');
    const canonical = canonicalAgyJetskiBytes('1.4.12', AGY_STEPS);
    expect(Buffer.from(file.contentBase64, 'base64').toString('utf8')).toBe(canonical);
    expect(canonical).not.toContain('installation_uuid');
    expect(canonical).not.toContain('migrations');
    expect(block.accountBinding).toBe('mesh-account-synth-01');
    expect(block.accountBindingBasis).toBe('custodian-stable-ref');
    expect(block.capturedAt).toBe('2026-11-02T00:00:00Z');
  });

  it.each([1, 3])('refuses a %s-of-4 source step set as onboarding-incomplete', async (count) => {
    const partial = `post_onboarding {\n${AGY_STEPS.slice(0, count).map((s) => `  completed_steps: ${s}\n`).join('')}}\n`;
    const home = await sourceHome(partial);
    const result = await captureSeatOnboarding(input(home));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-incomplete' });
  });

  it('refuses a string scalar inside the post_onboarding block as identifier-present', async () => {
    const tainted = `post_onboarding {\n${AGY_STEPS.map((s) => `  completed_steps: ${s}\n`).join('')}  note: "synthetic"\n}\n`;
    const home = await sourceHome(tainted);
    const result = await captureSeatOnboarding(input(home));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-identifier-present' });
  });

  it('refuses a numeric scalar inside the post_onboarding block as identifier-present', async () => {
    const tainted = `post_onboarding {\n${AGY_STEPS.map((s) => `  completed_steps: ${s}\n`).join('')}  count: 4\n}\n`;
    const home = await sourceHome(tainted);
    const result = await captureSeatOnboarding(input(home));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-identifier-present' });
  });

  it('refuses an unknown step enum as shape-unverified', async () => {
    const unknown = `post_onboarding {\n${AGY_STEPS.map((s) => `  completed_steps: ${s}\n`).join('')}  completed_steps: POST_ONBOARDING_STEP_TYPE_UNKNOWN\n}\n`;
    const home = await sourceHome(unknown);
    const result = await captureSeatOnboarding(input(home));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses a version with no required-set entry', async () => {
    const home = await sourceHome(MEASURED_SHAPE);
    const result = await captureSeatOnboarding(input(home, { nativeCliVersion: '9.9.9' }));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses a missing or empty post_onboarding block', async () => {
    const missing = await sourceHome(`installation_uuid: "synthetic"\n`);
    expect(await captureSeatOnboarding(input(missing))).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
    const empty = await sourceHome('post_onboarding {\n}\n');
    expect(await captureSeatOnboarding(input(empty))).toMatchObject({ ok: false, code: 'onboarding-incomplete' });
  });

  it('refuses a duplicate post_onboarding block', async () => {
    const dup = `${MEASURED_SHAPE}post_onboarding {\n  completed_steps: ${AGY_STEPS[0]}\n}\n`;
    const home = await sourceHome(dup);
    const result = await captureSeatOnboarding(input(home));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-shape-unverified' });
  });

  it('refuses a symlinked source', async () => {
    const home = await sourceHome(null);
    const dir = join(home, '.gemini', 'antigravity-cli');
    await mkdir(dir, { recursive: true });
    await writeFile(join(home, 'real.pbtxt'), MEASURED_SHAPE);
    await symlink(join(home, 'real.pbtxt'), join(dir, 'jetski_state.pbtxt'));
    const result = await captureSeatOnboarding(input(home));
    expect(result.ok).toBe(false);
    const stat = await lstat(join(home, AGY_SOURCE));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('never reads a default home: the selector and source home are required', async () => {
    const missingSelector = await captureSeatOnboarding({ ...input('/nonexistent-home'), selector: undefined as never });
    expect(missingSelector.ok).toBe(false);
    const missingHome = await captureSeatOnboarding({ ...input(''), selector: { sourceRelPath: AGY_SOURCE } });
    expect(missingHome.ok).toBe(false);
  });

  it('refuses a wrong selector path for the CLI', async () => {
    const home = await sourceHome(MEASURED_SHAPE);
    const result = await captureSeatOnboarding(input(home, { selector: { sourceRelPath: '.gemini/settings.json' } }));
    expect(result.ok).toBe(false);
  });

  it('refuses an empty stable account reference as binding-unverifiable', async () => {
    const home = await sourceHome(MEASURED_SHAPE);
    const result = await captureSeatOnboarding(input(home, { accountBinding: '' }));
    expect(result).toMatchObject({ ok: false, code: 'onboarding-binding-unverifiable' });
  });
});
