import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiLabels,
  AuthUiTransport,
} from '../contracts.js';

export interface AuthDevicePairProps {
  transport: AuthUiTransport;
  labels?: Partial<AuthUiLabels>;
  userCodeSource?: () => string | null | undefined;
  onPaired?: (deviceName?: string) => void | Promise<void>;
  onError?: (error: AuthUiError) => void;
}

declare const AuthDevicePair: Component<AuthDevicePairProps>;
export default AuthDevicePair;
