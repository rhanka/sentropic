/**
 * Neutral default matrix for opportunity workspaces (§8.5).
 *
 * Differences from ai-ideas default matrix:
 * - NO ai_maturity axis (removed entirely)
 * - data_compliance → regulatory_compliance (general regulatory, not data/AI-specific)
 * - data_availability → resource_availability (team/budget/tools, not data pipeline)
 * - All descriptions neutralized: no AI/IA references
 */
import type { MatrixConfig } from '../types/matrix';

// Descriptions par défaut pour les axes de valeur (neutralisées)
const opportunityValueDescriptions = {
  "business_value": [
    "Amélioration interne mineure, invisible pour les clients.",
    "Optimise un petit processus, utile à une seule équipe.",
    "Améliore l'efficacité ou l'expérience pour plusieurs équipes ou un segment de clients.",
    "Impact direct sur la satisfaction client ou la productivité globale.",
    "Augmente les revenus, renforce la position de marché ou différencie l'entreprise."
  ],
  "time_criticality": [
    "Peut être reporté sans aucun impact d'affaires.",
    "Retarde une opportunité mineure.",
    "Retarde un lancement, une saison ou un jalon de projet.",
    "Un retard expose l'entreprise à des pertes financières ou contractuelles.",
    "Un retard entraîne des pénalités légales, perte de clients ou réputation."
  ],
  "risk_reduction_opportunity": [
    "N'atténue aucun risque, n'ouvre aucune nouvelle voie.",
    "Réduit un petit irritant opérationnel ou ouvre une opportunité mineure.",
    "Diminue un risque identifié par la direction ou ouvre un marché de niche.",
    "Réduit un risque stratégique (ex. sécurité, conformité) ou crée une nouvelle ligne d'affaires.",
    "Élimine un risque critique pouvant menacer l'entreprise ou ouvre une opportunité majeure (nouveau marché, partenariat stratégique)."
  ]
};

// Descriptions par défaut pour les axes de complexité (neutralisées, sans AI)
const opportunityComplexityDescriptions = {
  "implementation_effort": [
    "Solution clé en main, déploiement minimal.",
    "Mise en œuvre légère avec configuration standard et intégration simple.",
    "Mise en œuvre modérée nécessitant coordination entre équipes et adaptation de processus.",
    "Mise en œuvre complexe impliquant plusieurs équipes, développement sur mesure et orchestration.",
    "Programme de transformation majeur, développement lourd, intégration profonde avec de multiples systèmes."
  ],
  "regulatory_compliance": [
    "Pas d'enjeu réglementaire particulier, risque conformité négligeable.",
    "Conformité simple à la réglementation existante, documentation légère requise.",
    "Conformité nécessitant des mesures spécifiques (contrats, certifications, audits ponctuels).",
    "Conformité réglementaire avérée nécessitant accompagnement juridique, traçabilité accrue et audits réguliers.",
    "Environnement fortement réglementé (ex. export control, sanctions, réglementation sectorielle stricte), audits obligatoires, conformité complexe."
  ],
  "resource_availability": [
    "Ressources disponibles en interne (équipe, budget, outils).",
    "Ressources majoritairement disponibles, léger recrutement ou achat d'outils.",
    "Quelques ressources à mobiliser (recrutement ciblé, budget à débloquer, outillage à acquérir).",
    "Mobilisation de ressources significatives (équipes dédiées, budget conséquent, partenaires externes).",
    "Ressources majeures à constituer (recrutement massif, budget transformationnel, écosystème de partenaires à construire)."
  ],
  "change_management": [
    "Impact minimal sur les processus existants, adoption intuitive.",
    "Léger ajustement des processus, formation courte nécessaire.",
    "Modification notable des processus et outils, formation structurée et communication nécessaires.",
    "Changement important des processus, formation approfondie et accompagnement soutenu requis.",
    "Refonte majeure des processus, fort impact organisationnel, plan de conduite du changement robuste et accompagnement intensif."
  ]
};

export const opportunityMatrixConfig: MatrixConfig = {
  valueAxes: [
    {
      id: 'business_value',
      name: 'Valeur d\'affaire',
      weight: 2.0,
      description: 'Impact sur la valeur d\'affaire de l\'entreprise',
      levelDescriptions: opportunityValueDescriptions["business_value"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'time_criticality',
      name: 'Urgence dans le temps',
      weight: 1.5,
      description: 'Urgence temporelle du projet',
      levelDescriptions: opportunityValueDescriptions["time_criticality"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'risk_reduction_opportunity',
      name: 'Réduction du risque / opportunité',
      weight: 1.5,
      description: 'Réduction des risques et création d\'opportunités',
      levelDescriptions: opportunityValueDescriptions["risk_reduction_opportunity"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    }
  ],
  complexityAxes: [
    {
      id: 'implementation_effort',
      name: 'Effort de mise en œuvre',
      weight: 1.5,
      description: 'Effort de mise en œuvre et d\'intégration',
      levelDescriptions: opportunityComplexityDescriptions["implementation_effort"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'regulatory_compliance',
      name: 'Conformité réglementaire',
      weight: 1.0,
      description: 'Exigences de conformité réglementaire',
      levelDescriptions: opportunityComplexityDescriptions["regulatory_compliance"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'resource_availability',
      name: 'Disponibilité des ressources',
      weight: 1.0,
      description: 'Disponibilité des ressources (équipe, budget, outils)',
      levelDescriptions: opportunityComplexityDescriptions["resource_availability"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'change_management',
      name: 'Gestion du changement',
      weight: 1.0,
      description: 'Impact organisationnel et gestion du changement',
      levelDescriptions: opportunityComplexityDescriptions["change_management"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    }
  ],
  valueThresholds: [
    { level: 1, points: 0, cases: 0 },
    { level: 2, points: 2, cases: 0 },
    { level: 3, points: 8, cases: 0 },
    { level: 4, points: 34, cases: 0 },
    { level: 5, points: 100, cases: 0 }
  ],
  complexityThresholds: [
    { level: 1, points: 0, cases: 0 },
    { level: 2, points: 2, cases: 0 },
    { level: 3, points: 8, cases: 0 },
    { level: 4, points: 34, cases: 0 },
    { level: 5, points: 100, cases: 0 }
  ]
};
