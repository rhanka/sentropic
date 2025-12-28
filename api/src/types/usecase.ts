/**
 * Types pour les cas d'usage
 */

export type ScoreEntry = {
  axisId: string;
  rating: number;
  description: string;
};

/**
 * Structure du champ data JSONB dans use_cases
 */
export type UseCaseData = {
  // === Champs principaux (obligatoires) ===
  name: string; // Nom du cas d'usage
  description?: string; // Description courte (30-60 mots)
  
  // === Nouveaux champs ===
  problem?: string; // 40-80 mots
  solution?: string; // 40-80 mots
  
  // === Détails métier ===
  process?: string;
  domain?: string;
  technologies?: string[];
  prerequisites?: string;
  deadline?: string;
  contact?: string;
  
  // === Listes ===
  benefits?: string[];
  metrics?: string[];
  risks?: string[];
  nextSteps?: string[];
  dataSources?: string[];
  dataObjects?: string[];
  
  // === Références ===
  references?: Array<{
    title: string;
    url: string;
    excerpt?: string;
  }>;
  
  // === Scores détaillés (pour recalcul dynamique) ===
  valueScores?: ScoreEntry[];
  complexityScores?: ScoreEntry[];
};

/**
 * Type helper pour JSONB compatible avec Drizzle ORM
 * Permet d'éviter l'utilisation de "as unknown as UseCaseData" en fournissant un type explicite
 * pour les colonnes JSONB qui acceptent n'importe quelle valeur JSON valide
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type UseCaseDataJson = JsonValue & UseCaseData;

/**
 * Cas d'usage complet avec données hydratées depuis la DB
 * Note: totalValueScore et totalComplexityScore sont calculés dynamiquement
 * Note: name et description sont maintenant dans data JSONB
 */
export type UseCase = {
  // === Gestion d'état (colonnes natives) ===
  id: string;
  folderId: string;
  // Preferred naming (DB column is organization_id)
  organizationId?: string | null;
  status: string;
  model?: string | null;
  createdAt: Date | string;
  
  // === Données métier (JSONB, inclut name et description) ===
  data: UseCaseData;
  
  // === Scores calculés dynamiquement (non stockés en DB) ===
  totalValueScore?: number | null;
  totalComplexityScore?: number | null;
};

