import assert from 'node:assert/strict';
import { proposal, type Phase, type PublicationFactory, type PublicationFixture, type Route } from './publication-reference.js';
const fixture = (factory: PublicationFactory): PublicationFixture => {
  const f = factory();
  assert(f?.client && f.reopen && f.scan, 'missing publication fixture');
  for (const name of ['client', 'reopen', 'scan', 'activate', 'legacy', 'oldOpen', 'rollback', 'bind', 'change',
    'marker', 'unit', 'policy', 'legacyObject', 'protectedBytes', 'catalog', 'revoke', 'fence', 'effects'] as const)
    assert.equal(typeof f[name], 'function', 'missing publication fixture:' + name);
  for (const name of ['prepare', 'publish', 'read', 'inspect', 'receipt', 'reserved'] as const)
    assert.equal(typeof f.client('a')?.[name], 'function', 'missing publication fixture:' + name);
  for (const name of ['effects', 'scanned', 'delta', 'legacy'] as const)
    assert(Number.isFinite(f.counters?.[name]), 'missing publication instrumentation:' + name);
  return f;
};
const refused = async (call: () => unknown, pattern: RegExp, label?: string): Promise<void> => {
  let threw = false;
  try { await call(); } catch (error) { threw = true; assert.match(String(error), pattern); }
  assert(threw, label);
};
const validated = async (f: PublicationFixture): Promise<string> => {
  let page = await f.scan(1);
  while (!page.done) page = await f.scan(1);
  return page.checkpoint;
};
export const assertCT04 = async (factory: PublicationFactory): Promise<void> => {
  const routes: Route[] = ['ordinary', 'staged', 'projection'];
  for (const [i, route] of routes.entries()) {
    const f = fixture(factory), a = f.client('a'), b = f.reopen().client('a');
    const p = proposal('first', 'a', route), q = proposal('second', 'a', routes[(i + 1) % 3]);
    const ids = await Promise.all([a.prepare(p), b.prepare(q)]);
    for (const id of ids) {
      const pending = await a.inspect(id); assert.equal(pending.published, false);
      for (const token of pending.ids) for (const kind of ['historical', 'manifest'] as const)
        await refused(() => a.read(kind, token), /not committed/, 'CT-04: diagnostic IDs stay unpublished');
    }
    assert.equal(await a.read('current'), 'old');
    await assert.rejects(f.client('b').publish(ids[0]), /denied/);
    const results = await Promise.allSettled([a.publish(ids[0]), b.publish(ids[1])]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'CT-04: exactly one winner');
    for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason), /conflict/);
    const winner = results[0].status === 'fulfilled' ? p : q, loser = winner === p ? q : p;
    assert.equal(await a.read('current'), winner.value);
    for (const kind of ['historical', 'manifest'] as const) {
      assert.equal(await a.read(kind, winner.root), winner.value);
      await f.catalog(loser.root); await refused(() => a.read(kind, loser.root), /not committed/);
      await refused(() => f.client('b').read(kind, winner.root), /not committed/);
    }
    for (const patch of [{ scope: 'b' }, { incarnation: 'other-store' }, { epoch: 0 }])
      await assert.rejects(a.prepare({ ...proposal('invalid'), ...patch }), /conflict/);
    for (const root of ['initial', winner.root]) {
      await assert.rejects(a.prepare({ ...proposal('reuse'), expected: winner.root, root }), /conflict/);
      assert.equal(await a.read('historical', root), root === 'initial' ? 'old' : winner.value);
    }
    const stale = await a.prepare({ ...proposal('stale'), expected: winner.root });
    await f.fence(); await assert.rejects(a.publish(stale), /conflict/);
    assert.equal(await a.read('current'), winner.value);
  }
};
export const assertCT05 = async (factory: PublicationFactory): Promise<void> => {
  const phases: Phase[] = ['intent', 'payload', 'page', 'seal', 'before-commit', 'after-commit'];
  for (const phase of phases) {
    let f = fixture(factory), a = f.client('a'); const p = proposal();
    if (phase === 'before-commit' || phase === 'after-commit') {
      const id = await a.prepare(p); await assert.rejects(a.publish(id, phase), /crash:/);
    } else await assert.rejects(a.prepare(p, phase), /crash:/);
    f = f.reopen(); a = f.client('a');
    assert.equal(await a.read('current'), phase === 'after-commit' ? p.value : 'old', 'CT-05: complete old/new root');
    if (['intent', 'payload', 'page'].includes(phase)) {
      const reserved = await a.reserved(p.op); assert(reserved && !reserved.published);
      for (const token of (await a.inspect(reserved.id)).ids) for (const kind of ['historical', 'manifest'] as const) await refused(() => a.read(kind, token), /not committed/);
      await refused(() => a.publish(reserved.id), /conflict/, 'CT-05: unsealed intent cannot publish');
      assert.equal(f.counters.effects, 0);
    }
    if (phase !== 'after-commit') for (const kind of ['historical', 'manifest'] as const)
      await refused(() => a.read(kind, p.root), /not committed/);
    if (phase === 'after-commit')
      assert.deepEqual(await a.receipt(p.op), { op: p.op, root: p.root, serial: 1 }, 'CT-05: original receipt survives commit crash');
    const recovered = await a.publish(await a.prepare(p));
    assert.deepEqual(recovered, { op: p.op, root: p.root, serial: 1 });
    assert.equal(await a.read('current'), p.value); assert.equal(f.counters.effects, 1);
  }
};
export const assertCT06 = async (factory: PublicationFactory): Promise<void> => {
  for (const loseAck of [false, true]) {
    let f = fixture(factory), a = f.client('a'); const p = proposal();
    const [id, retry] = await Promise.all([a.prepare(p), f.reopen().client('a').prepare(p)]);
    if (loseAck) { await assert.rejects(a.publish(id, 'after-commit'), /crash:/); f = f.reopen(); a = f.client('a'); }
    const receipts = await Promise.all([a.publish(id), f.reopen().client('a').publish(retry)]);
    assert.equal((await f.effects()).length, 1, 'CT-06: concurrent retries produce one effect');
    assert.equal(f.counters.effects, 1, 'CT-06: concurrent retries produce one effect');
    assert.deepEqual(receipts[0], receipts[1]);
    assert.deepEqual(await a.publish(await a.prepare({ value: p.value, ...p })), receipts[0]);
    for (const patch of [{ value: 'changed' }, { root: 'changed' }, { expected: 'changed' }])
      await assert.rejects(a.prepare({ ...p, ...patch }), /conflict/);
    await f.fence(); assert.deepEqual(await f.reopen().client('a').publish(id), receipts[0]);
    assert.deepEqual(await a.publish(await a.prepare(p)), receipts[0]);
    await assert.rejects(a.prepare(proposal('stale')), /conflict/);
    const next = { ...proposal('later'), epoch: 2, expected: p.root };
    await a.publish(await a.prepare(next));
    assert.deepEqual(await f.reopen().client('a').publish(id), receipts[0], 'CT-06: recover original after later publication');
    assert.deepEqual(await a.publish(await a.prepare(p)), receipts[0]); assert.equal((await f.effects()).length, 2);
    assert.equal(f.counters.effects, 2);
    await f.revoke('a'); await assert.rejects(a.publish(id), /denied/);
    await refused(() => a.receipt(p.op), /denied/);
  }
  const f = fixture(factory), a = f.client('a'), id = await a.prepare(proposal());
  await assert.rejects(a.publish(id, undefined, () => f.revoke('a')), /denied/); assert.equal(f.counters.effects, 0);
};
export const assertCT14 = async (factory: PublicationFactory): Promise<void> => {
  const race = fixture(factory), cp = await validated(race);
  await refused(() => race.activate(cp, 0, undefined, () => race.legacy('b').write()), /limit/);
  assert.equal(await race.marker(), undefined);
  for (const crash of ['before', 'after'] as const) {
    let f = fixture(factory); const old = ['a', 'b'].map((scope) => f.legacy(scope));
    const a = f.client('a'), pending: string[] = [];
    for (const route of ['ordinary', 'staged', 'projection'] as const) pending.push(await a.prepare(proposal(route, 'a', route)));
    const checkpoint = await validated(f);
    await refused(() => f.activate(checkpoint, 0, crash), /crash:/);
    f = f.reopen();
    if (crash === 'before') {
      assert.equal(await f.marker(), undefined); for (const ports of old) await ports.write();
      await f.activate(checkpoint, 2);
    }
    const marker = await f.marker(); assert(marker);
    const count = f.counters.legacy;
    for (const ports of [...old, f.reopen().legacy('a'), f.reopen().legacy('b')])
      for (const mutate of Object.values(ports)) await refused(mutate, /legacy fenced/, 'CT-14: old mutation is refused');
    assert.equal(f.counters.legacy, count);
    for (const id of pending) await assert.rejects(a.publish(id), /conflict/);
    await refused(() => f.reopen().oldOpen(), /minimum contract/);
    await refused(() => f.rollback(false), /downgrade/);
    await refused(() => f.activate(checkpoint, 0), /checkpoint/);
    await f.rollback(true); assert.equal(await f.reopen().marker(), marker);
    assert.equal(await f.unit('a'), 'a'); assert.equal(await f.unit('b'), 'b');
    await refused(() => f.unit('excluded'), /unqualified/);
    for (const scope of ['a', 'b']) {
      const c = f.client(scope), p = { ...proposal('common', scope), epoch: 2 };
      const r = await c.publish(await c.prepare(p));
      assert.equal(await c.read('historical', r.root), p.value); assert.equal(await f.reopen().client(scope).read('current'), p.value);
    }
    assert.equal(f.counters.effects, 2);
  }
};
