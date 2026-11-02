import { IdentityCustodyErrorV1, type EmailRegistrationTicketV1 } from '@sentropic/cluster-mesh';
import { resolveOAuthSession } from '@sentropic/auth-hono';
import { FederationCompletionRefusal, type FederationBrokerDeps } from '../auth/federation/types';
import { withAppCmAuth } from './cm-auth-runtime';

const emailRefusal = () => new FederationCompletionRefusal(400, 'email_verification_required', 'Email ownership was not proven.');
const linkRefusal = () => new FederationCompletionRefusal(401, 'authentication_required', 'Sign in before linking a provider.');

/** Upstream network exchange is already complete; only CM and joined business writes run here. */
export const createCmFederationCompletion = (sessionToken: string | null): FederationBrokerDeps['complete'] =>
  async operation => {
    try {
      return await withAppCmAuth(async runner => {
        const result = await runner.complete('social', async (binding, tx) => {
          const ports = binding.ports;
          if (!ports.federation) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
          let ticket: EmailRegistrationTicketV1 | null = null;
          const value = await operation({
            get now() { return ports.clock.now(); }, audit: ports.auditLog, federation: ports.federation,
            resolveFederatedUser: input => binding.resolveFederatedUser(input),
            async authenticate(userId, deviceInfo) {
              const user = await ports.users.findById(userId);
              if (!user) throw new IdentityCustodyErrorV1('identity_material_missing');
              const eligibility = await ports.accountPolicy.canAuthenticate(user, ports.clock.now());
              if (!eligibility.allowed) throw new FederationCompletionRefusal(
                eligibility.status ?? 403, eligibility.code ?? 'account_unavailable',
                eligibility.message ?? 'Account cannot authenticate.');
              return binding.sessions.createSession({ user, deviceInfo, mfaVerified: false });
            },
            async requireLinkActor(expectedUserId) {
              if (!sessionToken) throw linkRefusal();
              await tx.lockSubject(expectedUserId);
              // Reuse the native consumer over bound ports; nesting a session_validate
              // completion refusal inside the social flow would violate the runner contract.
              const session = await resolveOAuthSession(new Request('http://identity.invalid', {
                headers: { cookie: `session=${sessionToken}` },
              }), ports);
              if (!session || session.user.id !== expectedUserId) throw linkRefusal();
            },
            async verifyEmailProof(email, token) {
              const normalized = ports.accountPolicy.normalizeEmail(email);
              if (!await ports.emailVerification.verifyToken(normalized, token, ports.clock.now())) throw emailRefusal();
              ticket = await tx.custody.emailTickets.findByTokenHash(await ports.tokens.hashSecret(token));
              if (!ticket || ticket.email !== normalized) throw emailRefusal();
            },
            async consumeEmailProof(userId) {
              if (!ticket) return;
              await tx.custody.emailTickets.consume({ tokenHash: ticket.tokenHash, email: ticket.email,
                expectedRevision: ticket.revision, bindUserId: userId, at: ports.clock.now().toISOString() });
              ticket = null;
            },
          });
          // No transaction handles, mutable identity snapshots or proof tokens escape.
          return structuredClone(value);
        });
        if (!result.committed) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
        return result.value;
      });
    } catch (error) {
      if (error instanceof IdentityCustodyErrorV1 &&
        (error.code === 'proof_state_conflict' || error.code === 'proof_binding_mismatch')) throw emailRefusal();
      throw error;
    }
  };
