import type { SvelteComponent } from 'svelte';
import type { IdentityAuthScreenPorts } from './auth-flow.js';
declare class LoginScreen extends SvelteComponent<{ ports: IdentityAuthScreenPorts }> {}
export default LoginScreen;
