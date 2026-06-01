import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiLabels,
  AuthUiTransport,
} from '../contracts.js';

export interface AuthDevicesProps {
  transport: AuthUiTransport;
  labels?: Partial<AuthUiLabels>;
  formatDate?: (iso: string) => string;
  confirmRevoke?: (message: string) => boolean | Promise<boolean>;
  onUnauthorized?: () => void;
  onError?: (error: AuthUiError) => void;
}

declare const AuthDevices: Component<AuthDevicesProps>;
export default AuthDevices;
