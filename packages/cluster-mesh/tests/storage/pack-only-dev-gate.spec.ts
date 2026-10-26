import { describe, expect, it } from 'vitest';
import {
  acceptsCommentsRefusal,
  isPackOnlyDevBump,
  RESERVED_NEXT,
} from './pack-only-dev-gate.mjs';

describe('isPackOnlyDevBump', () => {
  it.each([
    ['0.23.0-dev.1', '0.22.4', '0.23.0', true],
    ['0.23.0-dev.99', '0.22.4', '0.23.0', true],
    ['0.22.1', '0.22.4', '0.23.0', false],
    ['0.22.4', '0.22.4', '0.23.0', false],
    ['0.24.0-dev.1', '0.22.4', '0.23.0', false],
    ['0.23.0-dev.1', '0.22.4', '0.24.0', false],
    ['0.23.0-dev.1', '0.22.1', '0.23.0', false],
    ['0.23.0-dev.1', '0.23.0', '0.23.0', false],
    ['0.23.0-rc.1', '0.22.4', '0.23.0', false],
  ])('isPackOnlyDevBump(%s, %s, %s) === %s', (workspaceVersion, publishedPin, reservedNext, expected) => {
    expect(isPackOnlyDevBump(workspaceVersion, publishedPin, reservedNext)).toBe(expected);
  });
});

describe('acceptsCommentsRefusal', () => {
  it('should accept the missing-peer refusal for any candidate', () => {
    for (const installedVersion of ['0.22.4', '0.23.0-dev.1', '0.22.1']) {
      expect(acceptsCommentsRefusal({
        installedVersion, publishedPin: '0.22.4', reservedNext: RESERVED_NEXT,
        reason: 'not_installed', code: 'not_installed',
      })).toBe(true);
    }
  });

  it('should accept the out-of-range refusal for a reserved-next dev candidate', () => {
    expect(acceptsCommentsRefusal({
      installedVersion: `${RESERVED_NEXT}-dev.5`, publishedPin: '0.22.4', reservedNext: RESERVED_NEXT,
      reason: 'incompatible_version', code: 'incompatible_version',
    })).toBe(true);
  });

  it('should keep refusing the out-of-range refusal for other candidates', () => {
    const cases = [
      { installedVersion: '0.22.1', publishedPin: '0.22.4' },
      { installedVersion: '0.22.4', publishedPin: '0.22.4' },
      { installedVersion: '0.24.0-dev.1', publishedPin: '0.22.4' },
      { installedVersion: '0.23.0-dev.1', publishedPin: '0.22.1' },
      { installedVersion: '0.23.0-rc.1', publishedPin: '0.22.4' },
    ];
    for (const { installedVersion, publishedPin } of cases) {
      expect(acceptsCommentsRefusal({
        installedVersion, publishedPin, reservedNext: RESERVED_NEXT,
        reason: 'incompatible_version', code: 'incompatible_version',
      })).toBe(false);
    }
  });
});
