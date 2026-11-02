import type { SvelteComponent } from 'svelte';
import type { IdentityManagementScreenPorts } from './management-ports.js';
declare class AdminUsersScreen extends SvelteComponent<{ ports: IdentityManagementScreenPorts; embeddedTitle?: string | null }> {}
export default AdminUsersScreen;
