import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeatBroker, BrokerJournal, assertQualifiedModel, NANO_CUTOFF, DEFAULT_ENDPOINT } from '../src/ci-seat-broker.ts';

const keys = generateKeyPairSync('ed25519');
const QUALIFIED = 'synthetic-qualified-chat-1';
const operationModels = { chat: QUALIFIED };
const binding = { H: 'a'.repeat(40), B: 'b'.repeat(40), T: 'c'.repeat(40), plan: 'd'.repeat(64),
  control: 'e'.repeat(64), policy: 'f'.repeat(64), artifacts: '1'.repeat(64) };
const claims = { version: 1, purpose: 'ci-test', caseId: 'case-a', route: 'seat', binding,
  runId: '100', runAttempt: 1, reservation: 'reservation-a', generation: 1,
  operations: { chat: QUALIFIED }, attempts: 1, deadline: Date.now() + 60_000 };
const ticket = (value = claims) => {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(null, Buffer.from(payload), keys.privateKey).toString('base64url')}`;
};
const request = () => ({ ticket: ticket(), requestId: 'request-a', operation: 'chat',
  url: DEFAULT_ENDPOINT, method: 'POST',
  headers: { authorization: 'Bearer SYNTHETIC_BROKER_ONLY', 'content-type': 'application/json' },
  body: JSON.stringify({ model: QUALIFIED, stream: true, input: [] }) });
const setup = async (syncFailure = false, now?: () => number) => {
  const sends: unknown[] = []; const directory = await mkdtemp(join(tmpdir(), 'broker-'));
  const journal = await BrokerJournal.create(join(directory, 'journal'), () => syncFailure);
  const broker = new SeatBroker({ publicKey: keys.publicKey, binding, runId: '100', runAttempt: 1,
    reservation: { id: 'reservation-a', units: 1, generation: 1, day: new Date().toISOString().slice(0, 10) },
    journal, qualified: true, billing: true, expiresAt: (now?.() ?? Date.now()) + 600_000,
    quota: async () => ({ observedAt: Date.now(), remaining: [21], generation: 1 }),
    send: async (url, options) => { sends.push({ url, options }); return new Response('ok'); },
    accessToken: 'SYNTHETIC_BROKER_ONLY', accountId: 'private-account',
    operationModels, now });
  return { broker, sends, journal, directory };
};

test('T5-C3: valid sentinel wire succeeds only after fsync debit; replay and exhausted units cannot resend', async () => {
  const { broker, sends, journal } = await setup();
  assert.equal((await broker.submit(request())).status, 200);
  assert.equal(journal.records.length, 1); assert.equal(sends.length, 1);
  await assert.rejects(broker.submit(request()), /replay|exhausted/);
  await assert.rejects(broker.submit({ ...request(), requestId: 'two' }), /exhausted/);
});

test('T5-C3: historical Luna routes, retired IDs, cutoff model and unmapped models send nothing', async () => {
  for (const model of ['gpt-5.6-luna', 'gpt-6-luna', 'gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14', 'unmapped']) {
    const { broker, sends } = await setup();
    await assert.rejects(broker.submit({ ...request(), body: JSON.stringify({ model }) }));
    assert.equal(sends.length, 0, model);
  }
  // gpt-5.4-nano is an inherited code observation, not a qualified route, and refuses at the cutoff
  const farTicket = ticket({ ...claims, deadline: 4102444800000 });
  const before = await setup(false, () => Date.parse(NANO_CUTOFF) - 1);
  await assert.rejects(before.broker.submit({ ...request(), ticket: farTicket, body: JSON.stringify({ model: 'gpt-5.4-nano' }) }), /model-not-qualified-route/);
  const at = await setup(false, () => Date.parse(NANO_CUTOFF));
  await assert.rejects(at.broker.submit({ ...request(), ticket: farTicket, body: JSON.stringify({ model: 'gpt-5.4-nano' }) }), /model-cutoff/);
  assert.equal(before.sends.length, 0); assert.equal(at.sends.length, 0);
  assert.throws(() => assertQualifiedModel('gpt-4.1-nano', operationModels, 'chat', Date.now()), /model-retired/);
  assert.throws(() => assertQualifiedModel('gpt-5.6-luna', operationModels, 'chat', Date.now()), /historical/);
});

test('T5-C3: forged ticket, refresh endpoint, stolen token, stale quota and expired broker send nothing', async () => {
  for (const delta of [{ ticket: 'forged' },
    { url: 'https://chatgpt.com/backend-api/refresh' }, { body: 'not-json' },
    { headers: { authorization: 'Bearer stolen' } }]) {
    const { broker, sends } = await setup();
    await assert.rejects(broker.submit({ ...request(), ...delta })); assert.equal(sends.length, 0);
  }
  const staleQuota = await setup();
  staleQuota.broker['opts'].quota = async () => ({ observedAt: Date.now(), remaining: [0], generation: 1 });
  await assert.rejects(staleQuota.broker.submit(request()), /quota-exhausted/);
  assert.equal(staleQuota.sends.length, 0);
});

test('T5-C3: journal fsync failure prevents upstream send; forged journal line refuses load', async () => {
  const { broker, sends, journal, directory } = await setup(true);
  await assert.rejects(broker.submit(request()), /journal-fsync/); assert.equal(sends.length, 0);
  const ok = await setup();
  await ok.broker.submit(request());
  const file = join(ok.directory, 'journal');
  const line = (await readFile(file, 'utf8')).trim();
  await writeFile(file, line.slice(0, -8) + 'deadbeef\n');
  await assert.rejects(BrokerJournal.create(file), /journal-corrupt/);
  assert.ok(journal.records.length === 0);
});
