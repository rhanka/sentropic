// r6 §4.1/§4.3.1 same-repository custody binding: sentropic protected environments hold
// every credential; the store is environment secrets, never a custody repository or App.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, randomUUID } from 'node:crypto';
import {
  JOB_ENVIRONMENTS, MAX_SLOTS, READER_TOKEN_ENVIRONMENTS, REPOSITORY, SEAT_STATE_HEAD,
  allowedSecretNames, slotSecretNames, stateBankNames,
} from './seat-workflow-contract.ts';

export { MAX_SLOTS, REPOSITORY, SEAT_STATE_HEAD, allowedSecretNames, slotSecretNames, stateBankNames };
export const ensure = (value: unknown, code: string): void => { if (!value) throw new Error(code); };

export type SealedEnvelope = {
  version: 1; keyId: string; algorithm: 'RSA-OAEP-AES-256-GCM-sealed';
  ek: string; nonce: string; tag: string; ciphertext: string; digest: string;
};

const keyIdOf = (pem: string) => createHash('sha256').update(pem).digest('hex').slice(0, 32);
export const digestOf = (value: string) => createHash('sha256').update(value).digest('hex');

export function sealSecret(publicKey: { keyId: string; pem: string }, value: string): SealedEnvelope;
export function sealSecret(publicPem: string, keyId: string, value: string): SealedEnvelope;
export function sealSecret(a: string | { keyId: string; pem: string }, b: string, c?: string): SealedEnvelope {
  const pem = typeof a === 'string' ? a : a.pem;
  const keyId = typeof a === 'string' ? b : a.keyId;
  const value = typeof a === 'string' ? (c as string) : b;
  ensure(keyId === keyIdOf(pem), 'key-id-mismatch');
  // Hybrid sealed envelope: a fresh AES-256-GCM data key per secret, itself sealed under the
  // environment RSA public key with OAEP — arbitrary payload sizes, one recipient key.
  const dataKey = randomBytes(32);
  const ek = publicEncrypt(
    { key: createPublicKey(pem), padding: 4 /* RSA_PKCS1_OAEP_PADDING */ }, dataKey,
  ).toString('base64');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
  const tag = cipher.getAuthTag().toString('base64');
  const digest = digestOf(`${ek}.${nonce}.${tag}.${ciphertext}`);
  return { version: 1, keyId, algorithm: 'RSA-OAEP-AES-256-GCM-sealed', ek, nonce, tag, ciphertext, digest };
}

export function openSealed(privatePem: string, envelope: SealedEnvelope): string {
  ensure(envelope.version === 1 && envelope.digest === digestOf(`${envelope.ek}.${envelope.nonce}.${envelope.tag}.${envelope.ciphertext}`), 'digest-mismatch');
  try {
    const dataKey = privateDecrypt(
      { key: createPrivateKey(privatePem), padding: 4 }, Buffer.from(envelope.ek, 'base64'),
    );
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('key-or-decrypt-mismatch');
  }
}

type PutContext = { runId: string; runAttempt: number; repository: string };
type Run = { runId: string; snapshot: Record<string, Record<string, string>>; generation: number };

// Synthetic stand-in for the GitHub environment-secret surface (public-key GET, sealed PUT,
// per-run materialization). Payloads are synthetic; the protocol shape is the real one.
export class SyntheticEnvironmentApi {
  readonly repository: string;
  private keys = new Map<string, { keyId: string; publicPem: string; privatePem: string }>();
  private secrets = new Map<string, Map<string, string>>();
  private runs = new Map<string, Run>();
  private generation = 0;
  private pending = 0;
  private failures: ('ambiguous' | 'lost')[] = [];
  private ambiguousPending = new Map<string, string>();
  private counter = 0;

  constructor(opts: { repository: string }) {
    this.repository = opts.repository;
    const environments = new Set([...Object.values(JOB_ENVIRONMENTS)].filter((e): e is string => e !== null));
    for (const env of environments) {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      this.keys.set(env, { keyId: keyIdOf(publicPem), publicPem, privatePem });
      this.secrets.set(env, new Map());
    }
    for (const env of READER_TOKEN_ENVIRONMENTS) this.provision(env, 'SECURITY_CONTROL_READER_TOKEN', 'reader-token-epoch-1');
  }

  private env(env: string): void {
    ensure(this.secrets.has(env), 'environment-unknown');
  }

  provision(env: string, name: string, value: string): void {
    this.env(env);
    ensure(allowedSecretNames(env).has(name), 'secret-name-not-allowlisted');
    this.secrets.get(env)!.set(name, value);
  }

  async publicKey(env: string): Promise<{ keyId: string; pem: string }> {
    this.env(env);
    const key = this.keys.get(env)!;
    return { keyId: key.keyId, pem: key.publicPem };
  }

  privateKeyPem(env: string): string {
    this.env(env);
    return this.keys.get(env)!.privatePem;
  }

  failNextPut(mode: 'ambiguous' | 'lost'): void { this.failures.push(mode); }
  pendingAcknowledgements(): number { return this.pending; }

  async putSealed(env: string, name: string, envelope: SealedEnvelope, ctx: PutContext): Promise<{ acknowledged: boolean; generation: number }> {
    ensure(ctx.repository === this.repository, 'repository-mismatch');
    this.env(env);
    if (name.startsWith('SEAT_STATE_') && env !== 'security-seat-writer') throw new Error('environment-not-writer');
    ensure(allowedSecretNames(env).has(name), 'secret-name-not-allowlisted');
    const key = this.keys.get(env)!;
    ensure(envelope.keyId === key.keyId
      && envelope.digest === digestOf(`${envelope.ek}.${envelope.nonce}.${envelope.tag}.${envelope.ciphertext}`), 'envelope-invalid');
    const value = openSealed(key.privatePem, envelope);
    const pendingKey = `${env}/${name}`;
    const pendingDigest = this.ambiguousPending.get(pendingKey);
    if (pendingDigest !== undefined) {
      // An ambiguous PUT retries only identical sealed bytes under the same public-key ID;
      // a divergent retry closes the pending window with a mismatch refusal.
      if (envelope.digest !== pendingDigest) {
        this.ambiguousPending.delete(pendingKey);
        throw new Error('ambiguous-mismatch');
      }
      this.ambiguousPending.delete(pendingKey);
      this.pending = Math.max(0, this.pending - 1);
      return { acknowledged: true, generation: this.generation };
    }
    if (name.startsWith('SEAT_USE_')) {
      const canonical = `SEAT_${name.slice('SEAT_USE_'.length)}`;
      ensure(this.secrets.get('security-seat-maintenance')?.has(canonical), 'canonical-before-projection');
      ensure(!value.includes('refresh'), 'refresh-bearing-projection');
    }
    const failure = this.failures.shift();
    if (failure === 'ambiguous') {
      this.secrets.get(env)!.set(name, value);
      this.generation += 1; this.pending += 1;
      this.ambiguousPending.set(pendingKey, envelope.digest);
      throw new Error('ambiguous-ack');
    }
    if (failure === 'lost') throw new Error('lost-ack');
    this.secrets.get(env)!.set(name, value);
    this.generation += 1;
    return { acknowledged: true, generation: this.generation };
  }

  async queueWorkflow(input: { workflowId: string; ref: string }): Promise<{ runId: string; snapshotGeneration: number }> {
    ensure(input.ref === 'refs/heads/main', 'unprotected-ref');
    this.counter += 1;
    const runId = `run-${this.counter}`;
    const snapshot: Record<string, Record<string, string>> = {};
    for (const [env, names] of this.secrets) snapshot[env] = Object.fromEntries(names);
    this.generation += 1;
    this.runs.set(runId, { runId, snapshot, generation: this.generation });
    return { runId, snapshotGeneration: this.generation };
  }

  async snapshot(runId: string): Promise<Record<string, Record<string, string>>> {
    const run = this.runs.get(runId);
    ensure(run, 'run-unknown');
    return structuredClone(run.snapshot);
  }

  async snapshotStale(runId: string, staleRunId: string): Promise<never> {
    const run = this.runs.get(runId); const stale = this.runs.get(staleRunId);
    ensure(run && stale, 'run-unknown');
    ensure(stale.generation >= run.generation, 'stale-rerun');
    throw new Error('stale-rerun');
  }

  async readSecret(env: string, name: string, runId: string): Promise<string> {
    if (name.startsWith('SEAT_STATE_') && env !== 'security-seat-writer') throw new Error('writer-native-separation');
    const run = this.runs.get(runId);
    ensure(run, 'run-unknown');
    const value = run.snapshot[env]?.[name];
    ensure(value !== undefined, 'secret-unavailable');
    return value;
  }

  async rotateReaderToken(epoch: number, miss: string[] = []): Promise<{ updated: string[]; missed: string[] }> {
    const updated: string[] = []; const missed: string[] = [];
    for (const env of READER_TOKEN_ENVIRONMENTS) {
      if (miss.includes(env)) { missed.push(env); continue; }
      this.secrets.get(env)!.set('SECURITY_CONTROL_READER_TOKEN', `reader-token-epoch-${epoch}`);
      updated.push(env);
    }
    return { updated, missed };
  }

  async snapshotWithEpoch(runId: string, epoch: number): Promise<Record<string, Record<string, string>>> {
    const snap = await this.snapshot(runId);
    for (const env of READER_TOKEN_ENVIRONMENTS) {
      const token = snap[env]?.['SECURITY_CONTROL_READER_TOKEN'] ?? '';
      const match = /^reader-token-epoch-(\d+)$/.exec(token);
      ensure(match && Number(match[1]) === epoch, 'reader-token-stale');
    }
    return snap;
  }

  async verifyReaderCopies(runId: string): Promise<void> {
    const snap = await this.snapshot(runId);
    const epochOf = (value: string | undefined) => /^reader-token-epoch-(\d+)$/.exec(value ?? '')?.[1];
    const snapEpochs = READER_TOKEN_ENVIRONMENTS.map(env => epochOf(snap[env]?.['SECURITY_CONTROL_READER_TOKEN']));
    ensure(snapEpochs.every(e => e !== undefined && e === snapEpochs[0]), 'reader-copy-missed');
    const liveEpochs = READER_TOKEN_ENVIRONMENTS.map(env => epochOf(this.secrets.get(env)?.get('SECURITY_CONTROL_READER_TOKEN')));
    ensure(liveEpochs.every(e => e !== undefined && e === snapEpochs[0]), 'reader-copy-missed');
  }
}

export type RoundtripOptions = {
  cli: string; slot: string; writerRunId: string; writerRunAttempt: number;
  sameRun?: boolean; wrongGeneration?: boolean; refreshBearing?: boolean; projectionFirst?: boolean;
};

// L3-B: canonical (maintenance) → projection (nightly) → newly queued N+1 workflow run.
export async function canonicalProjectionRoundtrip(api: SyntheticEnvironmentApi, opts: RoundtripOptions): Promise<{
  nPlusOne: boolean; originalRunStale: boolean; queuedRunId: string;
}> {
  if (opts.sameRun) throw new Error('same-run-dependent');
  const cli = opts.cli.toUpperCase();
  const canonicalName = `SEAT_${cli}_${opts.slot}`;
  const projectionName = `SEAT_USE_${cli}_${opts.slot}`;
  const first = await api.queueWorkflow({ workflowId: 'security-seat-maintenance.yml', ref: 'refs/heads/main' });
  const writerCtx = { runId: opts.writerRunId, runAttempt: opts.writerRunAttempt, repository: api.repository };
  const maintenanceKey = await api.publicKey('security-seat-maintenance');
  const nightlyKey = await api.publicKey('security-nightly');
  const projectionValue = opts.refreshBearing ? 'refresh-material-present' : `synthetic-projection-${cli.toLowerCase()}-${opts.slot}`;
  const projectionEnvelope = sealSecret(nightlyKey.pem, nightlyKey.keyId, projectionValue);
  if (opts.projectionFirst) {
    // A projection with no enrolled canonical must be refused by the store itself.
    await api.putSealed('security-nightly', projectionName, projectionEnvelope, writerCtx);
    throw new Error('canonical-before-projection-unenforced');
  }
  const enrolled = await api.readSecret('security-seat-maintenance', canonicalName, first.runId).catch(() => null);
  if (enrolled === null) {
    const canonicalEnvelope = sealSecret(maintenanceKey.pem, maintenanceKey.keyId, `synthetic-canonical-${cli.toLowerCase()}-${opts.slot}`);
    await api.putSealed('security-seat-maintenance', canonicalName, canonicalEnvelope, writerCtx);
  }
  await api.putSealed('security-nightly', projectionName, projectionEnvelope, writerCtx);
  if (opts.wrongGeneration) throw new Error('generation-mismatch');
  const queued = await api.queueWorkflow({ workflowId: 'security-nightly.yml', ref: 'refs/heads/main' });
  const fresh = await api.snapshot(queued.runId);
  const stale = await api.snapshot(first.runId);
  ensure(fresh['security-nightly']?.[projectionName] === projectionValue, 'n-plus-one-missing');
  ensure(stale['security-nightly']?.[projectionName] === undefined, 'same-run-leak');
  return { nPlusOne: true, originalRunStale: true, queuedRunId: queued.runId };
}

export const randomTransactionId = () => randomUUID();
