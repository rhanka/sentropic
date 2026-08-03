import { isNarrowCoworkKioskTarget } from './device-capabilities';
import { findActiveCoworkDevice } from './device-identity';
import { requireWorkspaceAccess } from '../workspace-access';

export type CoworkTargetSelection = {
  userId: string;
  workspaceId: string;
  sessionId: string;
  deviceId: string;
  selectedAt: number;
};

const SELECTION_TTL_MS = 30 * 60_000;
const selectionKey = (value: Pick<CoworkTargetSelection, 'userId' | 'workspaceId' | 'sessionId'>) =>
  `${value.userId}:${value.workspaceId}:${value.sessionId}`;

/**
 * C2's trusted human-selection boundary. The authenticated controller route
 * writes this session-bound selection; model arguments never do. A restart
 * clears it and fails closed rather than restoring an implicit target.
 */
export class CoworkTargetSelectionStore {
  private readonly selections = new Map<string, CoworkTargetSelection>();

  constructor(private readonly deps: {
    requireWorkspaceAccess?: typeof requireWorkspaceAccess;
    findDevice?: typeof findActiveCoworkDevice;
  } = {}) {}

  async select(input: CoworkTargetSelection): Promise<boolean> {
    await (this.deps.requireWorkspaceAccess ?? requireWorkspaceAccess)(input.userId, input.workspaceId);
    const device = await (this.deps.findDevice ?? findActiveCoworkDevice)(input.userId, input.deviceId);
    if (!device || !isNarrowCoworkKioskTarget(device.capabilities)) return false;
    this.selections.set(selectionKey(input), input);
    return true;
  }

  get(input: Pick<CoworkTargetSelection, 'userId' | 'workspaceId' | 'sessionId'>): CoworkTargetSelection | null {
    const selected = this.selections.get(selectionKey(input));
    if (!selected || Date.now() - selected.selectedAt > SELECTION_TTL_MS) {
      this.selections.delete(selectionKey(input));
      return null;
    }
    return selected;
  }
}

export const coworkTargetSelections = new CoworkTargetSelectionStore();
