export const getSmoothStepSize = (pendingLength: number): number => {
  if (pendingLength > 2400) return 48;
  if (pendingLength > 1200) return 32;
  if (pendingLength > 600) return 20;
  if (pendingLength > 240) return 12;
  return 6;
};

export const shouldAnimateSmoothDelta = (input: {
  delta: string;
  pendingText: string;
  hasTimer: boolean;
  threshold: number;
}): boolean =>
  input.delta.length >= input.threshold ||
  input.pendingText.length > 0 ||
  input.hasTimer;

export const takeSmoothChunk = (
  pendingText: string,
): { chunk: string; remaining: string } => {
  const size = getSmoothStepSize(pendingText.length);
  return {
    chunk: pendingText.slice(0, size),
    remaining: pendingText.slice(size),
  };
};
