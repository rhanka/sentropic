export interface MatrixConfig {
  valueAxes: Array<{
    id: string;
    name: string;
    weight: number;
    description: string;
    levelDescriptions: Array<{
      level: number;
      description: string;
    }>;
  }>;
  complexityAxes: Array<{
    id: string;
    name: string;
    weight: number;
    description: string;
    levelDescriptions: Array<{
      level: number;
      description: string;
    }>;
  }>;
  valueThresholds: Array<{
    level: number;
    points: number;
    cases?: number;
  }>;
  complexityThresholds: Array<{
    level: number;
    points: number;
    cases?: number;
  }>;
}
