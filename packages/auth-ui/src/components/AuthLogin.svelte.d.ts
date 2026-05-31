import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiLabels,
  AuthUiSession,
  AuthUiTransport,
} from '../contracts.js';

export interface AuthLoginProps {
  transport: AuthUiTransport;
  labels?: Partial<AuthUiLabels>;
  onLoggedIn: (session: AuthUiSession) => void | Promise<void>;
  onLostDevice?: () => void;
  onError?: (error: AuthUiError) => void;
}

declare const AuthLogin: Component<AuthLoginProps>;
export default AuthLogin;
