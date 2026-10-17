import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeatBroker, BrokerJournal } from '../src/ci-seat-broker.ts';
const keys = generateKeyPairSync('ed25519');
const binding = { H: 'a'.repeat(40), B: 'b'.repeat(40), T: 'c'.repeat(40), plan: 'd'.repeat(64),
  control: 'e'.repeat(64), policy: 'f'.repeat(64), artifacts: '1'.repeat(64) };
const claims = { version: 1, purpose: 'ci-test', caseId: 'case-a', route: 'seat', binding,
  runId: '100', runAttempt: 1, reservation: 'reservation-a', generation: 1,
  operations: { chat: 'gpt-5.6-luna' }, attempts: 1, deadline: Date.now() + 60_000 };
const ticket = (value = claims) => {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(null, Buffer.from(payload), keys.privateKey).toString('base64url')}`;
};
const request = () => ({ ticket: ticket(), requestId: 'request-a', operation: 'chat',
  url: 'https://chatgpt.com/backend-api/codex/responses', method: 'POST',
  headers: { authorization: 'Bearer CI_SENTINEL', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-5.6-luna', stream: true, input: [] }) });
const setup = async (syncFailure = false) => {
  const sends: unknown[] = []; const directory = await mkdtemp(join(tmpdir(), 'broker-'));
  const journal = await BrokerJournal.create(join(directory, 'journal'), () => syncFailure);
  const broker = new SeatBroker({ publicKey: keys.publicKey, binding, runId: '100', runAttempt: 1,
    reservation: { id: 'reservation-a', units: 1, generation: 1, day: new Date().toISOString().slice(0, 10) },
    journal, qualified: true, billing: true, expiresAt: Date.now() + 600_000,
    quota: async () => ({ observedAt: Date.now(), remaining: [21], generation: 1 }),
    send: async (url, options) => { sends.push({ url, options }); return new Response('ok'); },
    accessToken: 'SYNTHETIC_BROKER_ONLY', accountId: 'private-account' });
  return { broker, sends, journal };
};
test('valid sentinel wire succeeds only after fsync debit; replay and exhausted units cannot resend', async () => {
  const { broker, sends, journal } = await setup();
  assert.equal((await broker.submit(request())).status, 200);
  assert.equal(journal.records.length, 1); assert.equal(sends.length, 1);
  await assert.rejects(broker.submit(request()), /replay|exhausted/);
  await assert.rejects(broker.submit({ ...request(), requestId: 'two' }), /exhausted/);
});
test('unmapped/retired model, forged case, endpoint and refresh overrides send nothing', async () => {
  for (const delta of [{ body: '{"model":"gpt-4.1-nano"}' }, { ticket: 'forged' },
    { url: 'https://chatgpt.com/backend-api/refresh' }, { body: '{"model":"unmapped"}' },
    { headers: { authorization: 'Bearer stolen' } }]) {
    const { broker, sends } = await setup();
    await assert.rejects(broker.submit({ ...request(), ...delta })); assert.equal(sends.length, 0);
  }
});
test('journal fsync failure prevents upstream send', async () => {
  const { broker, sends } = await setup(true);
  await assert.rejects(broker.submit(request()), /journal-fsync/); assert.equal(sends.length, 0);
});
