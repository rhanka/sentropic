import { describe, expect, it } from 'vitest';
import {
  acceptsCommentsRefusal,
  isPackOnlyDevBump,
  PACK_ONLY_PACKAGE,
  RESERVED_NEXT,
} from './pack-only-dev-gate.mjs';

describe('isPackOnlyDevBump', () => {
  it.each([
    ['@sentropic/cluster-mesh', '0.23.0-dev.1', '0.22.4', '0.23.0', true],
    ['@sentropic/cluster-mesh', '0.23.0-dev.99', '0.22.4', '0.23.0', true],
    ['@sentropic/cluster-mesh', '0.22.1', '0.22.4', '0.23.0', false],
    ['@sentropic/cluster-mesh', '0.22.4', '0.22.4', '0.23.0', false],
    ['@sentropic/cluster-mesh', '0.24.0-dev.1', '0.22.4', '0.23.0', false],
    ['@sentropic/cluster-mesh', '0.23.0-dev.1', '0.22.4', '0.24.0', false],
    ['@sentropic/cluster-mesh', '0.23.0-dev.1', '0.22.1', '0.23.0', false],
    ['@sentropic/cluster-mesh', '0.23.0-dev.1', '0.23.0', '0.23.0', false],
    ['@sentropic/cluster-mesh', '0.23.0-rc.1', '0.22.4', '0.23.0', false],
    ['@sentropic/other', '0.23.0-dev.1', '0.22.4', '0.23.0', false],
  ])('isPackOnlyDevBump(%s, %s, %s, %s) === %s', (packageName, workspaceVersion, publishedPin, reservedNext, expected) => {
    expect(isPackOnlyDevBump(packageName, workspaceVersion, publishedPin, reservedNext)).toBe(expected);
  });
});

describe('acceptsCommentsRefusal', () => {
  it('should accept the missing-peer refusal for any candidate', () => {
    for (const installedVersion of ['0.22.4', '0.23.0-dev.1', '0.22.1']) {
      expect(acceptsCommentsRefusal({
        packageName: PACK_ONLY_PACKAGE, installedVersion, publishedPin: '0.22.4', reservedNext: RESERVED_NEXT,
        reason: 'not_installed', code: 'not_installed',
      })).toBe(true);
    }
  });

  it('should accept the out-of-range refusal for a reserved-next dev candidate', () => {
    expect(acceptsCommentsRefusal({
      packageName: PACK_ONLY_PACKAGE, installedVersion: `${RESERVED_NEXT}-dev.5`,
      publishedPin: '0.22.4', reservedNext: RESERVED_NEXT,
      reason: 'incompatible_version', code: 'incompatible_version',
    })).toBe(true);
  });

  it('should keep refusing the out-of-range refusal for other candidates', () => {
    const cases = [
      { packageName: PACK_ONLY_PACKAGE, installedVersion: '0.22.1', publishedPin: '0.22.4' },
      { packageName: PACK_ONLY_PACKAGE, installedVersion: '0.22.4', publishedPin: '0.22.4' },
      { packageName: PACK_ONLY_PACKAGE, installedVersion: '0.24.0-dev.1', publishedPin: '0.22.4' },
      { packageName: PACK_ONLY_PACKAGE, installedVersion: '0.23.0-dev.1', publishedPin: '0.22.1' },
      { packageName: PACK_ONLY_PACKAGE, installedVersion: '0.23.0-rc.1', publishedPin: '0.22.4' },
      { packageName: '@sentropic/other', installedVersion: '0.23.0-dev.1', publishedPin: '0.22.4' },
    ];
    for (const { packageName, installedVersion, publishedPin } of cases) {
      expect(acceptsCommentsRefusal({
        packageName, installedVersion, publishedPin, reservedNext: RESERVED_NEXT,
        reason: 'incompatible_version', code: 'incompatible_version',
      })).toBe(false);
    }
  });
});
