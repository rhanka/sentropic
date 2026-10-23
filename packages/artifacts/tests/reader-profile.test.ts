/** L-5d — reader-profile contract (spec-v8 §9 5d). Pure evaluation of who may read what, where. */
import { describe, expect, it } from 'vitest';
import { evaluateReaderProfile, type ReaderProfile } from '../src/server/reader-profile.js';

const PROFILE: ReaderProfile = {
  ownerId: 'owner-1',
  subjects: ['reader-1'],
  allowApprovedAccounts: true,
  methods: ['GET'],
  routes: ['/content/a-1'],
  artifactId: 'a-1',
};

const APPROVED = (principalId: string): boolean => principalId === 'approved-1';

describe('reader profile', () => {
  it('lets the owner through on any bound route', () => {
    expect(
      evaluateReaderProfile(PROFILE, {
        subject: 'owner-1',
        method: 'GET',
        route: '/content/a-1',
        artifactId: 'a-1',
      }),
    ).toBe(true);
  });

  it('accepts listed subjects on allowed method and route', () => {
    expect(
      evaluateReaderProfile(
        PROFILE,
        { subject: 'reader-1', method: 'GET', route: '/content/a-1', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(true);
  });

  it('rejects disallowed methods and route prefixes', () => {
    expect(
      evaluateReaderProfile(
        PROFILE,
        { subject: 'reader-1', method: 'POST', route: '/content/a-1', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(false);
    expect(
      evaluateReaderProfile(
        PROFILE,
        { subject: 'reader-1', method: 'GET', route: '/content/a-1/extra', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(false);
  });

  it('enforces artifact and release bindings', () => {
    expect(
      evaluateReaderProfile(
        PROFILE,
        { subject: 'reader-1', method: 'GET', route: '/content/a-1', artifactId: 'a-2' },
        APPROVED,
      ),
    ).toBe(false);
    const bound: ReaderProfile = { ...PROFILE, releaseId: 'r-1' };
    expect(
      evaluateReaderProfile(
        bound,
        { subject: 'reader-1', method: 'GET', route: '/content/a-1', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(false);
    expect(
      evaluateReaderProfile(
        bound,
        {
          subject: 'reader-1',
          method: 'GET',
          route: '/content/a-1',
          artifactId: 'a-1',
          releaseId: 'r-1',
        },
        APPROVED,
      ),
    ).toBe(true);
  });

  it('restricts unlisted subjects to approved accounts only when allowed', () => {
    expect(
      evaluateReaderProfile(
        PROFILE,
        { subject: 'approved-1', method: 'GET', route: '/content/a-1', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(true);
    expect(
      evaluateReaderProfile(
        PROFILE,
        { subject: 'anon-1', method: 'GET', route: '/content/a-1', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(false);
    const strict: ReaderProfile = { ...PROFILE, allowApprovedAccounts: false };
    expect(
      evaluateReaderProfile(
        strict,
        { subject: 'approved-1', method: 'GET', route: '/content/a-1', artifactId: 'a-1' },
        APPROVED,
      ),
    ).toBe(false);
    expect(evaluateReaderProfile(PROFILE, { subject: '', method: 'GET', route: '/content/a-1' })).toBe(
      false,
    );
  });
});
