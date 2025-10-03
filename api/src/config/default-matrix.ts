import type { MatrixConfig } from '../types/matrix';

export const defaultMatrixConfig: MatrixConfig = {
  valueAxes: [
    { name: 'Niveau de Sponsorship', weight: 2 },
    { name: 'Impact Satisfaction Client (CSAT/NPS)', weight: 1.5 },
    { name: 'Gains de Productivité (Agents & Opérations)', weight: 1.5 },
    { name: 'Amélioration Expérience Agent & Rétention', weight: 1 },
    { name: 'Conformité & Image Publique', weight: 1 }
  ],
  complexityAxes: [
    { name: 'Maturité & Fiabilité Solution IA', weight: 1 },
    { name: 'Effort d\'Implémentation & Intégration', weight: 1.5 },
    { name: 'IA Responsable & Conformité Données', weight: 1.5 },
    { name: 'Disponibilité, Qualité & Accès Données', weight: 1 },
    { name: 'Gestion du Changement & Impact Métier', weight: 1 }
  ],
  valueThresholds: [
    { level: 1, points: 0, threshold: 300 },
    { level: 2, points: 40, threshold: 700 },
    { level: 3, points: 100, threshold: 1000 },
    { level: 4, points: 400, threshold: 1500 },
    { level: 5, points: 2000, threshold: 4000 }
  ],
  complexityThresholds: [
    { level: 1, points: 0, threshold: 100 },
    { level: 2, points: 50, threshold: 250 },
    { level: 3, points: 100, threshold: 500 },
    { level: 4, points: 250, threshold: 1000 },
    { level: 5, points: 1000, threshold: 2000 }
  ]
};


