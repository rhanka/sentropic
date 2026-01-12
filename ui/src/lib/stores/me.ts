import { writable } from 'svelte/store';
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from '$lib/utils/api';

export type AccountStatus =
  | 'active'
  | 'pending_admin_approval'
  | 'approval_expired_readonly'
  | 'disabled_by_user'
  | 'disabled_by_admin';

export type Role = 'admin_app' | 'admin_org' | 'editor' | 'guest';

export interface MeResponse {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    role: Role;
    accountStatus: AccountStatus;
    approvalDueAt: string | null;
    approvedAt: string | null;
    approvedByUserId: string | null;
    disabledAt: string | null;
    disabledReason: string | null;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string | null;
  } | null;
  workspace: {
    id: string;
    name: string;
    ownerUserId: string | null;
    createdAt: string;
    updatedAt: string | null;
  } | null;
  effectiveRole: Role;
}

type MeState = {
  loading: boolean;
  data: MeResponse | null;
  error: string | null;
};

export const me = writable<MeState>({ loading: false, data: null, error: null });

export async function loadMe(): Promise<void> {
  me.set({ loading: true, data: null, error: null });
  try {
    const data = await apiGet<MeResponse>('/me');
    me.set({ loading: false, data, error: null });
  } catch (e: any) {
    const msg = e instanceof ApiError ? e.message : 'Erreur lors du chargement de votre profil';
    me.set({ loading: false, data: null, error: msg });
  }
}

export async function updateMe(input: { workspaceName?: string }): Promise<void> {
  await apiPatch('/me', input);
  await loadMe();
}

export async function deactivateAccount(): Promise<void> {
  await apiPost('/me/deactivate');
}

export async function deleteAccount(): Promise<void> {
  await apiDelete('/me');
}


