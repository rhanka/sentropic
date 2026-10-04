import type { SvelteComponent } from 'svelte';
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

declare class AuthDevices extends SvelteComponent<
  AuthDevicesProps,
  Record<string, never>,
  { 'pair-cta': Record<string, never>; 'register-device': Record<string, never>; 'add-device': Record<string, never> }
> {}
export default AuthDevices;
