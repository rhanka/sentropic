export type LockScopeReadiness = {
  hydrated: boolean;
  userId: string | null | undefined;
  workspaceId: string | null | undefined;
  targetId: string | null | undefined;
};

export function buildLockScopeKey(scope: LockScopeReadiness): string | null {
  const userId = scope.userId?.trim();
  const workspaceId = scope.workspaceId?.trim();
  const targetId = scope.targetId?.trim();
  if (!scope.hydrated || !userId || !workspaceId || !targetId) return null;
  return JSON.stringify([workspaceId, userId, targetId]);
}
