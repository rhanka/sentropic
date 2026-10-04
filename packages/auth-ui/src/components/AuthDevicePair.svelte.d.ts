import type { SvelteComponent } from 'svelte';
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

declare class AuthDevicePair extends SvelteComponent<
  AuthDevicePairProps,
  Record<string, never>,
  { 'back-to-devices': Record<string, never>; 'cancel': Record<string, never> }
> {}
export default AuthDevicePair;
