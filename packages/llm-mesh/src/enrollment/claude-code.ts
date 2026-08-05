import type {
  CompleteEnrollmentInput,
  EnrollmentProvider,
  EnrollmentSession,
  PreparedCredential,
  RefreshInput,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';

export class ClaudeCodeEnrollmentProvider implements EnrollmentProvider {
  async start(_input: StartEnrollmentInput): Promise<EnrollmentSession> {
    throw new Error(
      'UNSUPPORTED: claude-code account transport enrollment is portal-only and unsupported locally in h2a-runtime.',
    );
  }

  async complete(_input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    throw new Error(
      'UNSUPPORTED: claude-code account transport enrollment is portal-only and unsupported locally in h2a-runtime.',
    );
  }

  async resolve(_credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    throw new Error(
      'UNSUPPORTED: claude-code account transport enrollment is portal-only and unsupported locally in h2a-runtime.',
    );
  }

  async refresh(_input: RefreshInput): Promise<PreparedCredential> {
    throw new Error(
      'UNSUPPORTED: claude-code account transport refresh is portal-only and unsupported locally in h2a-runtime.',
    );
  }

  async cancel(_enrollmentId: string): Promise<void> {
    // no-op stub
  }
}
