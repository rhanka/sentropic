import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  CompleteEnrollmentInput,
  EnrollmentProvider,
  EnrollmentSession,
  EnrollmentState,
  PreparedCredential,
  RefreshInput,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';

export const MUSE_AUTH_FILE_SOURCE = 'muse-cli-auth-file';

const defaultAuthFilePath = (): string =>
  join(homedir(), '.config', 'muse', 'auth.json');

interface MuseProviderEntry {
  access_token?: unknown;
  api_key?: unknown;
  api_base_url?: unknown;
  mechanism?: unknown;
  obtained_via?: unknown;
  user_email?: unknown;
  user_full_name?: unknown;
}

interface MuseAuthFile {
  schema_version?: unknown;
  providers?: unknown;
}

export interface MuseEnrollmentOptions {
  readAuthFile?: (path: string) => Promise<string>;
  authFilePath?: string;
}

interface MuseSession {
  state: EnrollmentState;
  ownerScope: string;
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

/** The CLI owns token lifecycle; mesh treats an import as fresh for one hour. */
const IMPORT_TTL_MS = 3600 * 1000;

export class MuseEnrollmentProvider implements EnrollmentProvider {
  private readonly readAuthFile: (path: string) => Promise<string>;
  private readonly authFilePath: string;
  private readonly sessions = new Map<string, MuseSession>();
  private sequence = 0;

  constructor(options: MuseEnrollmentOptions = {}) {
    this.readAuthFile = options.readAuthFile
      ?? ((path) => readFile(path, 'utf8'));
    this.authFilePath = options.authFilePath ?? defaultAuthFilePath();
  }

  async start(input: StartEnrollmentInput): Promise<EnrollmentSession> {
    this.sequence += 1;
    const enrollmentId = `enr_muse_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
    const now = new Date().toISOString();
    this.sessions.set(enrollmentId, {
      state: {
        enrollmentId,
        providerId: 'muse',
        ownerScope: input.ownerScope,
        pkceVerifier: '',
        pkceState: '',
        redirectUri: input.redirectUri,
        configVersion: '1',
        createdAt: now,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      ownerScope: input.ownerScope,
    });
    return {
      kind: 'local-import',
      enrollmentId,
      source: MUSE_AUTH_FILE_SOURCE,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  private async readEntry(): Promise<{ entry: MuseProviderEntry; schemaVersion: string }> {
    let raw: string;
    try {
      raw = await this.readAuthFile(this.authFilePath);
    } catch {
      throw new Error(`Muse CLI auth file is not readable at ${this.authFilePath}`);
    }
    let parsed: MuseAuthFile;
    try {
      parsed = JSON.parse(raw) as MuseAuthFile;
    } catch {
      throw new Error('Muse CLI auth file is not valid JSON');
    }
    const providers =
      parsed && typeof parsed === 'object' && parsed.providers
      && typeof parsed.providers === 'object'
        ? (parsed.providers as Record<string, unknown>).meta
        : undefined;
    if (!providers || typeof providers !== 'object') {
      throw new Error('Muse CLI auth file has no meta provider entry');
    }
    const entry = providers as MuseProviderEntry;
    const token = textOf(entry.access_token) ?? textOf(entry.api_key);
    if (!token) {
      throw new Error('Muse CLI auth file has no usable token for the meta provider');
    }
    const schemaVersion =
      typeof parsed.schema_version === 'number' ? String(parsed.schema_version) : '1';
    return { entry, schemaVersion };
  }

  private buildCredential(entry: MuseProviderEntry, schemaVersion: string): PreparedCredential {
    const token = textOf(entry.access_token) ?? textOf(entry.api_key);
    if (!token) {
      throw new Error('Muse CLI auth file has no usable token for the meta provider');
    }
    // Stable per login so re-imports converge on one account, never a dupe.
    const email = textOf(entry.user_email);
    const stableId = email ?? token;
    const accountId = `acct_muse_${createHash('sha256').update(stableId).digest('hex').slice(0, 12)}`;
    return {
      accountId,
      accessToken: token,
      expiresAt: new Date(Date.now() + IMPORT_TTL_MS).toISOString(),
      authClientConfigVersion: schemaVersion,
      ...(email ? { accountEmail: email } : {}),
    };
  }

  async complete(input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    const entry = this.sessions.get(input.enrollmentId);
    if (!entry) {
      throw new Error(`Enrollment session ${input.enrollmentId} not found`);
    }
    if (entry.state.cancelledAt) {
      throw new Error(`Enrollment session ${input.enrollmentId} was cancelled`);
    }
    const { entry: providerEntry, schemaVersion } = await this.readEntry();
    return this.buildCredential(providerEntry, schemaVersion);
  }

  async resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    return {
      provider: 'muse',
      accountId: credential.accountId,
    };
  }

  async refresh(input: RefreshInput): Promise<PreparedCredential> {
    // The CLI owns token lifecycle (login/refresh happens in muse itself);
    // mesh refresh re-imports the current CLI store for the same account.
    const { entry, schemaVersion } = await this.readEntry();
    const credential = this.buildCredential(entry, schemaVersion);
    if (credential.accountId !== input.accountId) {
      throw new Error('Muse CLI store now holds a different login than the enrolled account');
    }
    return credential;
  }

  async cancel(enrollmentId: string): Promise<void> {
    const entry = this.sessions.get(enrollmentId);
    if (entry) {
      entry.state.cancelledAt = new Date().toISOString();
    }
  }
}
