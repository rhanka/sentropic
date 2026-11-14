import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startHmrServer, moduleFor } from './hmr-server';

for (const size of ['S', 'M']) for (const vaporParent of [true, false]) for (const kind of ['rerender', 'reload']) {
  test(`should ${kind} F-LIVE-${size} under ${vaporParent ? 'Vapor' : 'classic'} parent without reload`, async ({ page }, info) => {
    const { source } = JSON.parse(await readFile(`/repo/packages/cluster-mesh/tests/compile-spike/fixtures/F-LIVE-${size}.json`, 'utf8'));
    const { server, modules, origin } = await startHmrServer(source, vaporParent);
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('HMR page error:', error.message); });
    page.on('response', response => { if (response.status() >= 400) console.log('HMR refused resource:', response.status(), response.url()); });
    try {
      await page.goto(origin);
      await page.waitForFunction(() => (window as any).ready);
      await page.locator('#sibling').click();
      await expect(page.locator('#sibling')).toHaveText('1');
      const rows: { duration: number; marks: [string, number][]; sibling: string | null }[] = [];
      for (let revision = 0; revision < 20; revision++) {
        const next = source.replace('class="item-0"', `class="revision-${revision}"`)
          .replace('const count = ref(0)', `const count = ref(${revision + 1})`);
        const path = `/patch-${revision}.mjs`;
        modules.set(path, moduleFor(next, 'edited'));
        const marks = await page.evaluate(({ kind, path }) => (window as any).replace(kind, path), { kind, path }) as [string, number][];
        await expect(page.locator(`.revision-${revision}`)).toHaveCount(1);
        const p0 = marks.find(([name]) => name === 'p0')![1];
        const p2 = marks.find(([name]) => name === 'p2')![1];
        rows.push({ duration: p2 - p0, marks, sibling: await page.locator('#sibling').textContent() });
      }
      expect(errors).toEqual([]);
      const sorted = rows.map(row => row.duration).sort((a, b) => a - b);
      const siblingKept = rows.every(row => row.sibling === '1');
      // A Vapor-parent reload is documented to re-create siblings; record the loss.
      expect(siblingKept).toBe(kind === 'rerender' || !vaporParent);
      expect(rows.some(row => row.marks.some(([name]) => name === 'f0'))).toBe(true);
      await info.attach('hmr-evidence', { body: JSON.stringify({ size, vaporParent, kind,
        N: rows.length, p50: sorted[9], p95: sorted[18], max: sorted[19],
        clock: 'page monotonic clock; p0 same-origin ResourceTiming.responseEnd, p2 after nextTick and DOM mutation',
        criterionMs: { p50: 2, p95: 5 }, resolutionAdded: false,
        verdict: 'diagnostic only; N=200 and clock correction still required', siblingKept, rows }), contentType: 'application/json' });
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
