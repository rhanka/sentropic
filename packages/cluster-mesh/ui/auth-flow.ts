import type { AuthUiLabels, AuthUiSession, AuthUiTransport } from '@sentropic/auth-ui';

export interface IdentityAuthPresentation {
  readonly email?: string;
  readonly verificationToken?: string;
  readonly oauthContinuation?: string;
  readonly returnPath?: string;
}
export interface IdentityAuthScreenPorts {
  readonly transport: AuthUiTransport;
  readonly labels: AuthUiLabels;
  readonly presentation: IdentityAuthPresentation;
  readonly loginHref: string;
  readonly registerHref: string;
  commitSession(session: AuthUiSession): void | Promise<void>;
  navigate(path: string): void | Promise<void>;
  resumeOAuth(continuation: string): void | Promise<void>;
}

/** Presentation is never authority; the server verifies the sealed continuation. */
export const registrationScreenTransport = (ports: IdentityAuthScreenPorts): AuthUiTransport => {
  const present = <T>(input: T) => ({ ...input, oauthContinuation: ports.presentation.oauthContinuation });
  return { ...ports.transport,
    createPasskeyRegistrationOptions: input => ports.transport.createPasskeyRegistrationOptions(present(input)),
    verifyPasskeyRegistration: input => ports.transport.verifyPasskeyRegistration(present(input)),
  };
};

export async function completeIdentityAuth(ports: IdentityAuthScreenPorts, session: AuthUiSession): Promise<void> {
  await ports.commitSession(session);
  if (ports.presentation.oauthContinuation) {
    await ports.resumeOAuth(ports.presentation.oauthContinuation);
    return;
  }
  const path = ports.presentation.returnPath;
  let target = '/neutral';
  if (path?.startsWith('/')) {
    try {
      const url = new URL(path, 'https://identity.invalid');
      if (url.origin === 'https://identity.invalid') target = `${url.pathname}${url.search}${url.hash}`;
    } catch { /* Invalid presentation returns to the fixed internal page. */ }
  }
  await ports.navigate(target);
}
