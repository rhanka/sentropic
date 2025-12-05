import { writable } from 'svelte/store';

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
  threshold: number;
  cases?: number;
};

export type MatrixConfig = {
  valueAxes: MatrixAxis[];
  complexityAxes: MatrixAxis[];
  valueThresholds: MatrixThreshold[];
  complexityThresholds: MatrixThreshold[];
  valueLevelDescriptions?: string[];
  complexityLevelDescriptions?: string[];
};

export const matrixStore = writable<MatrixConfig>({
  valueAxes: [],
  complexityAxes: [],
  valueThresholds: [],
  complexityThresholds: []
});
