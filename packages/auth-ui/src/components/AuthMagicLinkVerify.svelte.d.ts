import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiLabels,
  AuthUiSession,
  AuthUiTransport,
} from '../contracts.js';

export interface AuthMagicLinkVerifyProps {
  transport: AuthUiTransport;
  labels?: Partial<AuthUiLabels>;
  tokenSource: () => string | null | undefined;
  onVerified: (session: AuthUiSession) => void | Promise<void>;
  onRedirect?: () => void;
  onError?: (error: AuthUiError) => void;
  redirectDelayMs?: number;
}

declare const AuthMagicLinkVerify: Component<AuthMagicLinkVerifyProps>;
export default AuthMagicLinkVerify;
