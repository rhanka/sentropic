import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assertCT04, assertCT05, assertCT06, assertCT14, assertParity, assertInventory, assertNamespace } from './publication-assertions.js';
import { createPublicationReference, type PublicationFixture } from './publication-reference.js';
import { PUBLICATION_MUTANTS } from './publication-mutants.js';
const asyncPorts = <T extends object>(ports: T): T => new Proxy(ports, { get(target, key) {
  const value = Reflect.get(target, key);
  return typeof value === 'function' ? (...args: unknown[]) => Promise.resolve().then(() => value.apply(target, args)) : value;
} });
const asynchronous = (f = createPublicationReference()): PublicationFixture => ({ ...asyncPorts(f),
  client: (scope) => asyncPorts(f.client(scope)), reopen: () => asynchronous(f.reopen()),
  legacy: (scope) => asyncPorts(f.legacy(scope)) });
const cases = [['CT-04', assertCT04], ['CT-05', assertCT05], ['CT-06', assertCT06], ['CT-14', assertCT14],
  ['CT-14/parity', assertParity], ['CT-14/inventory', assertInventory], ['CT-14/namespace', assertNamespace]] as const;
describe('L01b2 publication and activation kit (reference only; no backend qualification)', () => {
  for (const [name, check] of cases) {
    it(`should pass ${name} on the independent positive reference`, async () => { await check(createPublicationReference); });
    for (const mutant of PUBLICATION_MUTANTS.filter((m) => m.target === name))
      it(`should kill ${mutant.id}@${mutant.revision} at its designated ${name} assertion`, async () => {
        await check(createPublicationReference); // A positive pass must precede each accepted kill.
        await assert.rejects(check(mutant.factory), mutant.kill);
      });
  }
  it('should run unchanged assertions against asynchronous I/O ports', async () => {
    for (const [, check] of cases) await check(() => asynchronous());
  });
  it('should refuse a missing fixture or required instrumentation', async () => {
    for (const [, check] of cases) {
      await assert.rejects(check(() => undefined as never), /missing publication fixture/);
      await assert.rejects(check(() => { const f = createPublicationReference(); f.counters.delta = undefined as never; return f; }),
        /missing publication instrumentation/);
    }
  });
});
