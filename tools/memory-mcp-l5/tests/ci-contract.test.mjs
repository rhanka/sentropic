import { describe, it, expect } from 'vitest';
import { checkNodeFloor, checkSdkVersion } from '../receipt.mjs';

describe('L5 CI, SDK floor, and Node/SQLite runtime floor contract', () => {
  it('accepts unflagged Node >=22.13.0 on 22.x, >=23.4.0 on 23.x, and Node 24+', () => {
    expect(checkNodeFloor('22.13.0', [], '')).toBe(true);
    expect(checkNodeFloor('v22.14.1', [], '')).toBe(true);
    expect(checkNodeFloor('23.4.0', [], '')).toBe(true);
    expect(checkNodeFloor('24.2.0', [], '')).toBe(true);
  });

  it('rejects Node <22.13 on 22.x, Node 23.0-23.3, earlier majors, and malformed versions', () => {
    expect(checkNodeFloor('20.18.0', [], '')).toBe(false);
    expect(checkNodeFloor('22.12.0', [], '')).toBe(false);
    expect(checkNodeFloor('23.0.0', [], '')).toBe(false);
    expect(checkNodeFloor('23.3.9', [], '')).toBe(false);
    expect(checkNodeFloor('24.2.0-rc.1', [], '')).toBe(false);
    expect(checkNodeFloor('', [], '')).toBe(false);
  });

  it('rejects flag-dependent SQLite invocation in either execArgv or NODE_OPTIONS', () => {
    expect(checkNodeFloor('24.2.0', ['--experimental-sqlite'], '')).toBe(false);
    expect(checkNodeFloor('22.13.0', ['--no-experimental-sqlite'], '')).toBe(false);
    expect(checkNodeFloor('24.2.0', [], '--experimental-sqlite')).toBe(false);
  });

  it('enforces @modelcontextprotocol/sdk version floor >=1.31.0 <2.0.0 (^1.31.0)', () => {
    expect(checkSdkVersion('1.31.0')).toBe(true);
    expect(checkSdkVersion('1.32.4')).toBe(true);
    expect(checkSdkVersion('0.1.0')).toBe(false);
    expect(checkSdkVersion('1.30.9')).toBe(false);
    expect(checkSdkVersion('2.0.0')).toBe(false);
  });
});
