import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env';
import {
  assertDeploymentSecrets,
  DEVELOPMENT_EMAIL_TICKET_SEED,
  DEVELOPMENT_SECRET_SEED,
  isProvisionedDeploymentSecret,
  MissingDeploymentSecretError,
  resolveDeploymentSecret,
} from '../../src/config/deployment-secrets';
import { resolveSessionTokenSecret } from '../../src/routes/auth/oauth';
import { resolveEmailVerificationTokenSecret } from '../../src/services/identity/cm-token-secrets';

type Mutable = { NODE_ENV: string; DISABLE_RATE_LIMIT?: string; ADMIN_EMAIL?: string;
  JWT_SECRET?: string; SECRET_ENCRYPTION_KEY?: string };
const mutable = env as unknown as Mutable;
const saved = { ...mutable };
const PROVISIONED = 'a-provisioned-deployment-key-0123456789';

/** Pins all three inputs: the e2e production-image escape hatch must not hide the guard. */
const deployed = () => {
  mutable.NODE_ENV = 'production';
  mutable.DISABLE_RATE_LIMIT = 'false';
  mutable.ADMIN_EMAIL = 'not-the-e2e-admin@example.com';
};

afterEach(() => {
  for (const key of ['NODE_ENV', 'DISABLE_RATE_LIMIT', 'ADMIN_EMAIL', 'JWT_SECRET', 'SECRET_ENCRYPTION_KEY'] as const) {
    (mutable as Record<string, unknown>)[key] = saved[key];
  }
});

describe('deployment secrets — fail-closed in a deployed runtime', () => {
  it('keeps the development seed outside a deployed runtime, unset or EMPTY', () => {
    mutable.NODE_ENV = 'test';
    for (const value of [undefined, '']) {
      mutable.JWT_SECRET = value;
      expect(resolveDeploymentSecret('JWT_SECRET', DEVELOPMENT_SECRET_SEED)).toBe(DEVELOPMENT_SECRET_SEED);
      expect(resolveSessionTokenSecret()).toBe(DEVELOPMENT_SECRET_SEED);
      expect(resolveEmailVerificationTokenSecret()).toBe(DEVELOPMENT_EMAIL_TICKET_SEED);
    }
  });

  it('returns a delivered value byte-identical (never trimmed)', () => {
    deployed();
    mutable.JWT_SECRET = ` ${PROVISIONED} `;
    expect(resolveSessionTokenSecret()).toBe(` ${PROVISIONED} `);
    expect(resolveEmailVerificationTokenSecret()).toBe(` ${PROVISIONED} `);
  });

  it('should require 32 trimmed characters and reject public seeds', () => {
    for (const value of [undefined, '', 'x', 'x'.repeat(31), ` ${'x'.repeat(31)} `,
      ' '.repeat(32), DEVELOPMENT_SECRET_SEED, DEVELOPMENT_EMAIL_TICKET_SEED,
      'dev-idp-jwt-secret-change-in-production']) {
      expect(isProvisionedDeploymentSecret(value)).toBe(false);
    }
    expect(isProvisionedDeploymentSecret('x'.repeat(32))).toBe(true);
    expect(isProvisionedDeploymentSecret(` ${'x'.repeat(32)}\n`)).toBe(true);
  });

  it('refuses an unset, blank or public-seed value in a deployed runtime, naming only the variable', () => {
    deployed();
    for (const value of [undefined, '', '   ', 'x', 'x'.repeat(31), DEVELOPMENT_SECRET_SEED, DEVELOPMENT_EMAIL_TICKET_SEED,
      'dev-idp-jwt-secret-change-in-production', ` ${DEVELOPMENT_SECRET_SEED}\n`]) {
      mutable.JWT_SECRET = value;
      mutable.SECRET_ENCRYPTION_KEY = value;
      for (const name of ['JWT_SECRET', 'SECRET_ENCRYPTION_KEY'] as const) {
        let caught: unknown;
        try { resolveDeploymentSecret(name, DEVELOPMENT_SECRET_SEED); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(MissingDeploymentSecretError);
        expect((caught as MissingDeploymentSecretError).secret).toBe(name);
        expect((caught as Error).message).toContain(name);
        if (value?.trim()) expect((caught as Error).message).not.toContain(value.trim());
      }
      expect(() => resolveSessionTokenSecret()).toThrow(MissingDeploymentSecretError);
      expect(() => resolveEmailVerificationTokenSecret()).toThrow(MissingDeploymentSecretError);
    }
  });

  it('keeps the e2e production-image runtime on the CI seed', () => {
    mutable.NODE_ENV = 'production';
    mutable.DISABLE_RATE_LIMIT = 'true';
    mutable.ADMIN_EMAIL = 'e2e-admin@example.com';
    mutable.JWT_SECRET = DEVELOPMENT_SECRET_SEED;
    expect(resolveSessionTokenSecret()).toBe(DEVELOPMENT_SECRET_SEED);
  });

  it('boot gate: passes with both keys, refuses when either is missing', () => {
    deployed();
    mutable.JWT_SECRET = PROVISIONED;
    mutable.SECRET_ENCRYPTION_KEY = `${PROVISIONED}-at-rest`;
    expect(() => assertDeploymentSecrets()).not.toThrow();
    mutable.SECRET_ENCRYPTION_KEY = '';
    expect(() => assertDeploymentSecrets()).toThrow(/SECRET_ENCRYPTION_KEY/);
    mutable.SECRET_ENCRYPTION_KEY = `${PROVISIONED}-at-rest`;
    mutable.JWT_SECRET = undefined;
    expect(() => assertDeploymentSecrets()).toThrow(/JWT_SECRET/);
  });

  it('no source file outside the deployment-secrets module spells a development seed', () => {
    const root = join(__dirname, '../../src');
    const seeds = [DEVELOPMENT_SECRET_SEED, DEVELOPMENT_EMAIL_TICKET_SEED];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.(ts|js|mjs)$/.test(name) || path.endsWith(join('config', 'deployment-secrets.ts'))) continue;
        const text = readFileSync(path, 'utf8');
        if (seeds.some((seed) => text.includes(seed))) offenders.push(relative(root, path));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
