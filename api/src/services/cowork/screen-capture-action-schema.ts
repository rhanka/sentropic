/**
 * The MVP captures the primary display in full only.  Do not accept a region
 * or another display until the device crops/selects it before signing a result.
 */
export type CoworkScreenCaptureAction = { screen?: 0 };

export function isCoworkScreenCaptureAction(value: unknown): value is CoworkScreenCaptureAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (Object.keys(action).some((key) => key !== 'screen')) return false;
  return action.screen === undefined || action.screen === 0;
}
