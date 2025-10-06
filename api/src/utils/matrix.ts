import type { MatrixConfig } from '../types/matrix';

export const parseMatrixConfig = (value: string | null): MatrixConfig | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as MatrixConfig;
  } catch (error) {
    return null;
  }
};
