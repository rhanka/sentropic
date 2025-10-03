export type LevelDescription = {
  level: number;
  description: string;
};

export type MatrixAxis = {
  id: string;
  name: string;
  weight: number;
  description?: string;
  levelDescriptions?: LevelDescription[];
};

export type MatrixThreshold = {
  level: number;
  points: number;
  cases?: number;
};

export type MatrixConfig = {
  valueAxes: MatrixAxis[];
  complexityAxes: MatrixAxis[];
  valueThresholds: MatrixThreshold[];
  complexityThresholds: MatrixThreshold[];
};
