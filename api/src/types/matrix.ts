export type MatrixAxis = {
  id: string;
  name: string;
  weight: number;
  description?: string;
};

export type MatrixThreshold = {
  level: number;
  points: number;
  threshold: number;
};

export type MatrixConfig = {
  valueAxes: MatrixAxis[];
  complexityAxes: MatrixAxis[];
  valueThresholds: MatrixThreshold[];
  complexityThresholds: MatrixThreshold[];
  valueLevelDescriptions?: string[];
  complexityLevelDescriptions?: string[];
};
