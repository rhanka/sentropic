import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { qualifyDisabledInstall } from '../disabled-install.mjs';
it('P08.packed.disabled-install: ordinary install and unselected root/metadata imports activate no memory', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = qualifyDisabledInstall(root, process.env.ARTIFACT_MANIFEST,
    'spec/evidence/memory-mcp-l5/r5-run/packed-disabled');
  expect(result.passed).toBe(true);
  expect(result.positiveControlBuilds).toBeGreaterThan(0);
  expect(result.nativeBuilds).toEqual([]);
  expect(result.runtimeCounts).toEqual({ 'provider-load': 0, 'store-open': 0, 'identity-bootstrap': 0, 'native-build': 0 });
});
