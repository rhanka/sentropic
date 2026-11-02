import type { SvelteComponent } from 'svelte';
import type { IdentityManagementScreenPorts } from './management-ports.js';
declare class WorkspaceMembersScreen extends SvelteComponent<{ ports: IdentityManagementScreenPorts; workspaceId: string; refreshVersion?: number }> {}
export default WorkspaceMembersScreen;
