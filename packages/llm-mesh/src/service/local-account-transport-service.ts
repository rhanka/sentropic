import type {
  AccountTransportAcquireInput,
  AccountTransportAcquisition,
} from '../account-transports.js';
import type {
  AccountPublic,
  CompleteEnrollmentInput,
  CredentialEnvelope,
  EnrollmentProvider,
  EnrollmentSession,
  PreparedCredential,
  RefreshInput,
  StartEnrollmentInput,
} from '../enrollment/contracts.js';
import type { ConfigResolver, KeyringAdapter } from './facade.js';

export class LocalAccountTransportService {
  constructor(
    private readonly keyring: KeyringAdapter,
    private readonly providers: Map<string, EnrollmentProvider>,
    private readonly configResolver: ConfigResolver,
  ) {}

  // ── Enrollment (called via facade by h2a CLI) ──────────────────────────
  async enroll(providerId: string, input: StartEnrollmentInput): Promise<EnrollmentSession> {
    throw new Error(`Enrollment not implemented for provider ${providerId} with input ${JSON.stringify(input)}`);
  }

  async waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }> {
    throw new Error(`waitForCallback not implemented for enrollment ${enrollmentId}`);
  }

  async pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }> {
    throw new Error(`pollForCompletion not implemented for enrollment ${enrollmentId}`);
  }

  async cancel(enrollmentId: string): Promise<void> {
    throw new Error(`cancel not implemented for enrollment ${enrollmentId}`);
  }

  // ── Runtime (called via facade by h2a gateway) ─────────────────────────
  async acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition> {
    throw new Error(`acquire not implemented for target ${input.targetProviderId}`);
  }

  async release(acquisition: AccountTransportAcquisition): Promise<void> {
    throw new Error(`release not implemented for acquisition ${acquisition.lease.leaseId}`);
  }

  // ── Internal — never exposed to h2a ───────────────────────────────────────
  private async completeEnrollment(_input: CompleteEnrollmentInput): Promise<void> {
    throw new Error('completeEnrollment not implemented');
  }

  private async refreshToken(_input: RefreshInput): Promise<PreparedCredential> {
    throw new Error('refreshToken not implemented');
  }

  private async persistCredential(
    _pub: AccountPublic,
    _env: CredentialEnvelope,
  ): Promise<void> {
    throw new Error('persistCredential not implemented');
  }

  private async markReauthRequired(_accountId: string): Promise<void> {
    throw new Error('markReauthRequired not implemented');
  }
}
