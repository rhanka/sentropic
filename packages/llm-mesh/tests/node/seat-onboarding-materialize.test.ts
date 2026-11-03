import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SEAT_PACKAGE_PROVIDER_ID,
  type SeatBundleV1,
  type SeatCli,
} from '../../src/enrollment/seat-bundle.js';
import {
  AGY_REQUIRED_COMPLETED_STEPS,
  SEAT_ENVELOPE_AUTH_FILES,
  type SeatCellSynthesis,
  type SeatOnboardingDestKey,
  type SeatOnboardingFile,
  type SeatOnboardingFormat,
  type SeatOnboardingV1,
} from '../../src/enrollment/seat-onboarding.js';
import {
  eraseSeatHome,
  materialiseCellHome,
  materialiseSeatEnvelopes,
} from '../../src/node/seat-onboarding-materialize.js';

const AGY_STEPS = AGY_REQUIRED_COMPLETED_STEPS['1.4.12'];
const AGY_CANONICAL = `post_onboarding {\n${AGY_STEPS.map((s) => `  completed_steps: ${s}\n`).join('')}}\n`;

const DEST: Record<string, [SeatOnboardingDestKey, SeatOnboardingFormat]> = {
  agy: ['agy-jetski', 'agy-jetski-pbtxt-v1'],
  claude: ['claude-json', 'claude-json-projection-v1'],
  muse: ['muse-trust', 'muse-trust-json-v1'],
  codex: ['codex-config', 'codex-config-projection-v1'],
};
const SYNTH: Record<string, SeatCellSynthesis> = {
  claude: 'claude-workspace-trust',
  muse: 'muse-workspace-trust',
  codex: 'codex-project-trust',
};
const CONTENT: Record<string, string> = {
  agy: AGY_CANONICAL,
  claude: JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.0' }),
  muse: JSON.stringify({ schema_version: 1 }),
  codex: JSON.stringify({ approvalPolicy: 'on-request', mcpServerNames: ['h2a'] }),
};

function bundle(cli: SeatCli, nativeCliVersion = '1.4.12'): SeatBundleV1 {
  return {
    identity: {
      schemaVersion: 1,
      seatRef: `seat-synth-${cli}-01`,
      refreshFamilyRef: `family-synth-${cli}-01`,
      ownerScope: 'owner-synth-01',
      cli,
      packageProviderId: SEAT_PACKAGE_PROVIDER_ID[cli],
      issuingClientRef: `client-synth-${cli}-01`,
      endpointFamily: `endpoint-synth-${cli}-01`,
      credentialFormatVersion: 'v1',
      nativeCliVersion,
      os: 'linux',
    },
    provenance: {
      enrollmentSource: 'cli',
      accountBinding: `binding-synth-${cli}-01`,
      entitlementClass: 'lab-seat',
    },
    authority: 'consumer',
    credentialClass: 'access-only',
    lifecycle: {
      epoch: 1,
      generation: 1,
      operationId: `op-synth-${cli}-01`,
      issuedAt: '2026-10-15T00:00:00Z',
      providerExpiry: '2026-10-16T00:00:00Z',
      localExpiryPolicy: 'synthetic-policy-01',
      refreshAuthority: 'none',
    },
    meshUse: { kind: 'access', accessRef: `access-synth-${cli}-01` },
  };
}

function onboardingFile(destKey: SeatOnboardingDestKey, format: SeatOnboardingFormat, content: string): SeatOnboardingFile {
  const buf = Buffer.from(content, 'utf8');
  return {
    destKey,
    format,
    contentBase64: buf.toString('base64'),
    sha256: createHash('sha256').update(buf).digest('hex'),
    byteLength: buf.length,
  };
}

function block(cli: SeatCli, overrides: Partial<SeatOnboardingV1> = {}): SeatOnboardingV1 {
  const [destKey, format] = DEST[cli];
  return {
    schemaVersion: 1,
    cli,
    seatRef: `seat-synth-${cli}-01`,
    accountBinding: `binding-synth-${cli}-01`,
    accountBindingBasis: 'custodian-stable-ref',
    lineage: { epoch: 1, generation: 1, operationId: `op-synth-${cli}-01` },
    nativeCliVersion: '1.4.12',
    os: 'linux',
    capturedAt: '2026-11-02T00:00:00Z',
    consent: { source: 'owner-interactive-cli', ownerScope: 'owner-synth-01' },
    cellSynthesis: cli === 'agy' ? [] : [SYNTH[cli]],
    files: [onboardingFile(destKey, format, CONTENT[cli])],
    ...overrides,
  };
}

function envelope(cli: SeatCli, onboarding?: unknown, mutate?: (env: Record<string, unknown>) => void): Record<string, unknown> {
  const env: Record<string, unknown> = { bundle: bundle(cli) };
  const files: Record<string, string> = {};
  for (const name of SEAT_ENVELOPE_AUTH_FILES[cli]) {
    files[name] = Buffer.from(`synthetic-${cli}-${name}`, 'utf8').toString('base64');
  }
  env.files = files;
  if (cli === 'agy') {
    env.agy = {
      packageProviderId: 'cloud-code',
      packageAccountTransport: 'cloud-code',
      issuingClientRef: 'agy-cli',
      endpointFamily: 'antigravity',
      requestedTargetProviderId: 'cloudcode-pa',
      requestedTransportProviderId: 'antigravity',
    };
  }
  if (onboarding !== undefined) env.onboarding = onboarding;
  if (mutate) mutate(env);
  return env;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mkRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'seat-mat-'));
  roots.push(root);
  return root;
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(dir, full));
    }
  }
  await walk(dir);
  return out.sort();
}

async function treeDigest(dir: string): Promise<string> {
  const files = await listFiles(dir);
  const hash = createHash('sha256');
  for (const rel of files) {
    hash.update(rel);
    hash.update(await readFile(join(dir, rel)));
  }
  return hash.digest('hex');
}

async function stageSeat(root: string, cli: SeatCli, onboarding?: unknown, mutate?: (env: Record<string, unknown>) => void): Promise<string> {
  const seatDir = join(root, 'seats', `${cli}-01`);
  const res = await materialiseSeatEnvelopes({
    seats: [{ envelope: envelope(cli, onboarding, mutate), seatDir }],
    ownerScope: 'owner-synth-01',
    expectedNativeCliVersions: { [cli]: '1.4.12' },
  });
  if (!res.ok) throw new Error(`stage failed: ${res.code} ${res.detail}`);
  return seatDir;
}

function cellInput(seatDir: string, root: string, overrides: Record<string, unknown> = {}) {
  const cellHome = join(root, 'cell');
  const workspaceDir = join(root, 'ws');
  return {
    seatDir,
    cellHome,
    workspaceDir,
    configDirs: {
      claudeConfigDir: join(cellHome, '.claude'),
      codexHome: join(cellHome, '.codex'),
      xdgConfigHome: join(cellHome, '.config'),
    },
    expectedNativeCliVersion: '1.4.12',
    ownerScope: 'owner-synth-01',
    ...overrides,
  };
}

async function mkWorkspace(input: { workspaceDir: string }): Promise<void> {
  await mkdir(input.workspaceDir, { recursive: true });
}

describe('materialiseSeatEnvelopes (stage 1)', () => {
  it('stages a synthetic agy seat with exact bytes, modes and a names-only receipt', async () => {
    const root = await mkRoot();
    const seatDir = join(root, 'seats', 'agy-01');
    const res = await materialiseSeatEnvelopes({
      seats: [{ envelope: envelope('agy', block('agy')), seatDir }],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: { agy: '1.4.12' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const tokenPath = join(seatDir, '.gemini/antigravity-cli/antigravity-oauth-token');
    expect(await readFile(tokenPath, 'utf8')).toBe('synthetic-agy-.gemini/antigravity-cli/antigravity-oauth-token');
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(seatDir, '.gemini/antigravity-cli'))).mode & 0o777).toBe(0o700);
    expect((await stat(seatDir)).mode & 0o777).toBe(0o700);
    const record = JSON.parse(await readFile(join(seatDir, '.sentropic-seat/seat-record.v1.json'), 'utf8'));
    expect(record.version).toBe(1);
    expect(record.onboarding).not.toBeNull();
    expect(record.launchGate).toEqual({ eligible: true });
    expect(record.authFiles).toEqual(['.gemini/antigravity-cli/antigravity-oauth-token']);
    const entry = res.receipt.seats[0];
    expect(entry.seatRef).toBe('seat-synth-agy-01');
    expect(entry.cli).toBe('agy');
    expect(entry.onboardingStatus).toBe('present');
    expect(entry.launchGate).toEqual({ eligible: true });
    expect(entry.authFiles).toEqual(['.gemini/antigravity-cli/antigravity-oauth-token']);
    expect(entry.seatRecordSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.onboarding?.files[0]).toMatchObject({ destKey: 'agy-jetski', format: 'agy-jetski-pbtxt-v1' });
    expect(entry.onboarding?.nativeCliVersion).toBe('1.4.12');
    expect(JSON.stringify(res.receipt)).not.toContain('synthetic-agy');
    expect(JSON.stringify(res.receipt)).not.toContain('POST_ONBOARDING_STEP_TYPE');
  });

  it('refuses the whole batch with zero bytes when the second seat is invalid', async () => {
    const root = await mkRoot();
    const good = join(root, 'seats', 'good');
    const bad = join(root, 'seats', 'bad');
    const badBlock = block('codex', { files: [{ ...block('codex').files[0], sha256: '0'.repeat(64) }] });
    const res = await materialiseSeatEnvelopes({
      seats: [
        { envelope: envelope('agy', block('agy')), seatDir: good },
        { envelope: envelope('codex', badBlock), seatDir: bad },
      ],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: {},
    });
    expect(res.ok).toBe(false);
    await expect(lstat(good)).rejects.toThrow();
    await expect(lstat(bad)).rejects.toThrow();
  });

  it('stages a mixed batch: present-block seat plus absent-block gated seat with a closed gate', async () => {
    const root = await mkRoot();
    const agyDir = join(root, 'seats', 'agy');
    const codexDir = join(root, 'seats', 'codex');
    const res = await materialiseSeatEnvelopes({
      seats: [
        { envelope: envelope('agy', block('agy')), seatDir: agyDir },
        { envelope: envelope('codex'), seatDir: codexDir },
      ],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: {},
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const record = JSON.parse(await readFile(join(codexDir, '.sentropic-seat/seat-record.v1.json'), 'utf8'));
    expect(record.onboarding).toBeNull();
    expect(record.launchGate).toEqual({ eligible: false, code: 'onboarding-required' });
    const codexEntry = res.receipt.seats.find((s) => s.cli === 'codex');
    expect(codexEntry?.onboardingStatus).toBe('absent');
    expect(codexEntry?.onboarding).toBeNull();
    expect(codexEntry?.launchGate).toEqual({ eligible: false, code: 'onboarding-required' });
    // the auth file of the gated seat is still staged in full
    expect(await readFile(join(codexDir, '.codex/auth.json'), 'utf8')).toBe('synthetic-codex-.codex/auth.json');
  });

  it('writes nothing at all when the absent seat pairs with a present-but-invalid block', async () => {
    const root = await mkRoot();
    const agyDir = join(root, 'seats', 'agy');
    const museDir = join(root, 'seats', 'muse');
    const badBlock = block('muse', { files: [{ ...block('muse').files[0], byteLength: 999 }] });
    const res = await materialiseSeatEnvelopes({
      seats: [
        { envelope: envelope('agy', block('agy')), seatDir: agyDir },
        { envelope: envelope('muse', badBlock), seatDir: museDir },
      ],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: {},
    });
    expect(res.ok).toBe(false);
    await expect(lstat(agyDir)).rejects.toThrow();
    await expect(lstat(museDir)).rejects.toThrow();
  });

  it('refuses a non-minimized claude auth .claude.json at stage 1', async () => {
    const root = await mkRoot();
    const seatDir = join(root, 'seats', 'claude');
    const res = await materialiseSeatEnvelopes({
      seats: [{
        envelope: envelope('claude', block('claude'), (env) => {
          const files = env.files as Record<string, string>;
          files['.claude.json'] = Buffer.from(JSON.stringify({
            oauthAccount: 'synthetic',
            hasCompletedOnboarding: true,
            lastOnboardingVersion: '2.1.0',
            projects: { '/foreign/path': { hasTrustDialogAccepted: true } },
          })).toString('base64');
        }),
        seatDir,
      }],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: {},
    });
    expect(res.ok).toBe(false);
    await expect(lstat(seatDir)).rejects.toThrow();
  });

  it('refuses a foreign ownerScope and an expected-version mismatch', async () => {
    const root = await mkRoot();
    const foreign = await materialiseSeatEnvelopes({
      seats: [{ envelope: envelope('agy', block('agy')), seatDir: join(root, 's1') }],
      ownerScope: 'owner-other-99',
      expectedNativeCliVersions: {},
    });
    expect(foreign.ok).toBe(false);
    const version = await materialiseSeatEnvelopes({
      seats: [{ envelope: envelope('agy', block('agy')), seatDir: join(root, 's2') }],
      ownerScope: 'owner-synth-01',
      expectedNativeCliVersions: { agy: '9.9.9' },
    });
    expect(version).toMatchObject({ ok: false, code: 'onboarding-version-mismatch' });
  });
});

describe('materialiseCellHome (stage 2)', () => {
  it('refuses onboarding-required with zero files for an absent-block gated seat', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'agy');
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res).toMatchObject({ ok: false, code: 'onboarding-required' });
    await expect(lstat(input.cellHome)).rejects.toThrow();
  });

  it('succeeds auth-only for a vibe seat with no block', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'vibe');
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await readFile(join(input.cellHome, '.vibe/MISTRAL_API_KEY'), 'utf8')).toBe('synthetic-vibe-.vibe/MISTRAL_API_KEY');
    expect(res.receipt.files).toHaveLength(1);
    expect(res.receipt.files[0]).toMatchObject({ cellRelPath: join('.vibe', 'MISTRAL_API_KEY'), class: 'auth' });
  });

  it('materialises an agy seat with exact bytes at the resolved destinations', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'agy', block('agy'));
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jetski = join(input.cellHome, '.gemini/antigravity-cli/jetski_state.pbtxt');
    expect(await readFile(jetski, 'utf8')).toBe(AGY_CANONICAL);
    expect((await stat(jetski)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(input.cellHome, '.gemini/antigravity-cli/antigravity-oauth-token'), 'utf8'))
      .toBe('synthetic-agy-.gemini/antigravity-cli/antigravity-oauth-token');
    const paths = res.receipt.files.map((f) => f.cellRelPath).sort();
    expect(paths).toEqual([
      join('.gemini/antigravity-cli', 'antigravity-oauth-token'),
      join('.gemini/antigravity-cli', 'jetski_state.pbtxt'),
    ]);
    expect(JSON.stringify(res.receipt)).not.toContain('POST_ONBOARDING_STEP_TYPE');
    expect(JSON.stringify(res.receipt)).not.toContain('synthetic-agy');
  });

  it('composes the claude .claude.json inside claudeConfigDir with the workspace trust entry', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'claude', block('claude'), (env) => {
      (env.files as Record<string, string>)['.claude.json'] = Buffer.from(JSON.stringify({
        oauthAccount: 'synthetic-oauth-account',
        hasCompletedOnboarding: true,
        lastOnboardingVersion: '2.1.0',
      })).toString('base64');
    });
    const input = cellInput(seatDir, root, { claudeMcpConfig: { mcpServers: { h2a: { command: '/bench/w.sh' } } } });
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const composedPath = join(input.configDirs.claudeConfigDir, '.claude.json');
    const composed = JSON.parse(await readFile(composedPath, 'utf8'));
    expect(composed).toEqual({
      oauthAccount: 'synthetic-oauth-account',
      hasCompletedOnboarding: true,
      lastOnboardingVersion: '2.1.0',
      projects: { [input.workspaceDir]: { hasTrustDialogAccepted: true } },
      mcpServers: { h2a: { command: '/bench/w.sh' } },
    });
    expect(await readFile(join(input.configDirs.claudeConfigDir, '.credentials.json'), 'utf8'))
      .toBe('synthetic-claude-.claude/.credentials.json');
    // nothing lands at the HOME-root .claude.json
    await expect(lstat(join(input.cellHome, '.claude.json'))).rejects.toThrow();
  });

  it('writes no trust entry for a present block with empty cellSynthesis', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'claude', block('claude', { cellSynthesis: [] }), (env) => {
      (env.files as Record<string, string>)['.claude.json'] = Buffer.from(JSON.stringify({
        oauthAccount: 'synthetic-oauth-account',
        hasCompletedOnboarding: true,
        lastOnboardingVersion: '2.1.0',
      })).toString('base64');
    });
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const composed = JSON.parse(await readFile(join(input.configDirs.claudeConfigDir, '.claude.json'), 'utf8'));
    expect(composed.projects).toBeUndefined();
    expect(composed.hasCompletedOnboarding).toBe(true);
  });

  it('synthesizes the muse trust file under xdgConfigHome with exactly one project', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'muse', block('muse'));
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const trust = JSON.parse(await readFile(join(input.configDirs.xdgConfigHome, 'muse/trust.json'), 'utf8'));
    expect(trust).toEqual({ schema_version: 1, projects: { [input.workspaceDir]: { decision: 'trusted' } } });
    expect(await readFile(join(input.configDirs.xdgConfigHome, 'muse/auth.json'), 'utf8'))
      .toBe('synthetic-muse-.config/muse/auth.json');
  });

  it('renders the codex config.toml with the wrapper command verbatim and the cell project', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'codex', block('codex'));
    const wrapper = '/bench/role wrapper --msg hi there';
    const input = cellInput(seatDir, root, {
      codexMcpServers: [{ name: 'h2a', command: wrapper, args: ['--serve', 'h2a'], defaultToolsApprovalMode: 'approve' }],
    });
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const toml = await readFile(join(input.configDirs.codexHome, 'config.toml'), 'utf8');
    expect(toml).toContain('approval_policy = "on-request"');
    expect(toml).toContain(`[projects."${input.workspaceDir}"]`);
    expect(toml).toContain('trust_level = "trusted"');
    expect(toml).toContain('[mcp_servers.h2a]');
    expect(toml).toContain(`command = "${wrapper}"`);
    expect(toml).toContain('args = ["--serve","h2a"]');
    expect(toml).toContain('default_tools_approval_mode = "approve"');
    expect(await readFile(join(input.configDirs.codexHome, 'auth.json'), 'utf8')).toBe('synthetic-codex-.codex/auth.json');
  });

  it('refuses a codex MCP server outside the intent set with zero files', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'codex', block('codex'));
    const input = cellInput(seatDir, root, {
      codexMcpServers: [{ name: 'outside-intent', command: '/bin/evil', args: [] }],
    });
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(false);
    await expect(lstat(input.cellHome)).rejects.toThrow();
  });

  it('refuses a claudeMcpConfig colliding with a single-writer key', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'claude', block('claude'), (env) => {
      (env.files as Record<string, string>)['.claude.json'] = Buffer.from(JSON.stringify({
        oauthAccount: 'synthetic-oauth-account',
        hasCompletedOnboarding: true,
        lastOnboardingVersion: '2.1.0',
      })).toString('base64');
    });
    const input = cellInput(seatDir, root, { claudeMcpConfig: { projects: { '/x': {} } } });
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(false);
    await expect(lstat(input.cellHome)).rejects.toThrow();
  });

  it('refuses a tampered seat record whose stored launchGate was edited', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'codex');
    const recordPath = join(seatDir, '.sentropic-seat/seat-record.v1.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    record.launchGate = { eligible: true };
    await writeFile(recordPath, JSON.stringify(record, null, 2));
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const res = await materialiseCellHome(input);
    expect(res).toMatchObject({ ok: false, code: 'onboarding-lineage-mismatch' });
    await expect(lstat(input.cellHome)).rejects.toThrow();
  });

  it.each([
    ['missing workspace', async (input: ReturnType<typeof cellInput>) => { /* no workspace */ }],
    ['version mismatch', async (input: ReturnType<typeof cellInput>) => { input.expectedNativeCliVersion = '9.9.9'; }],
    ['pre-existing cell home', async (input: ReturnType<typeof cellInput>) => { await mkdir(input.cellHome, { recursive: true }); }],
    ['symlinked parent', async (input: ReturnType<typeof cellInput>, root: string) => {
      const real = join(root, 'real');
      await mkdir(real, { recursive: true });
      await symlink(real, join(root, 'link'));
      input.cellHome = join(root, 'link', 'cell');
    }],
  ])('refuses with zero files on %s', async (_label, mutate) => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'agy', block('agy'));
    const input = cellInput(seatDir, root);
    await mutate(input, root);
    if (_label !== 'missing workspace' && _label !== 'symlinked parent') await mkWorkspace(input);
    if (_label === 'symlinked parent') await mkdir(input.workspaceDir, { recursive: true });
    const res = await materialiseCellHome(input);
    expect(res.ok).toBe(false);
    expect(await listFiles(input.cellHome)).toEqual([]);
  });

  it('seeds two role HOMEs from one staged seat without mutating the seat directory', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'agy', block('agy'));
    const before = await treeDigest(seatDir);
    for (const role of ['sender', 'receiver']) {
      const cellHome = join(root, role, 'home');
      const workspaceDir = join(root, role, 'ws');
      await mkdir(workspaceDir, { recursive: true });
      const res = await materialiseCellHome({
        seatDir,
        cellHome,
        workspaceDir,
        configDirs: {
          claudeConfigDir: join(cellHome, '.claude'),
          codexHome: join(cellHome, '.codex'),
          xdgConfigHome: join(cellHome, '.config'),
        },
        expectedNativeCliVersion: '1.4.12',
        ownerScope: 'owner-synth-01',
      });
      expect(res.ok).toBe(true);
      expect(await readFile(join(cellHome, '.gemini/antigravity-cli/jetski_state.pbtxt'), 'utf8')).toBe(AGY_CANONICAL);
    }
    expect(await treeDigest(seatDir)).toBe(before);
  });
});

describe('eraseSeatHome', () => {
  it('leaves no surviving path at either stage', async () => {
    const root = await mkRoot();
    const seatDir = await stageSeat(root, 'agy', block('agy'));
    const input = cellInput(seatDir, root);
    await mkWorkspace(input);
    const staged = await materialiseCellHome(input);
    expect(staged.ok).toBe(true);
    const erasedCell = await eraseSeatHome(input.cellHome);
    expect(erasedCell).toEqual({ ok: true, survivingPaths: [] });
    await expect(lstat(input.cellHome)).rejects.toThrow();
    const erasedSeat = await eraseSeatHome(seatDir);
    expect(erasedSeat).toEqual({ ok: true, survivingPaths: [] });
    await expect(lstat(seatDir)).rejects.toThrow();
    const erasedMissing = await eraseSeatHome(join(root, 'never-existed'));
    expect(erasedMissing).toEqual({ ok: true, survivingPaths: [] });
  });

  it('refuses to erase through a symlinked root', async () => {
    const root = await mkRoot();
    const real = join(root, 'real');
    await mkdir(real, { recursive: true });
    const link = join(root, 'link');
    await symlink(real, link);
    const res = await eraseSeatHome(link);
    expect(res.ok).toBe(false);
    expect((await lstat(real)).isDirectory()).toBe(true);
  });
});
