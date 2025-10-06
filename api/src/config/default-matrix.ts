import type { MatrixConfig } from '../types/matrix';

// Descriptions par défaut pour les axes de valeur
const defaultValueDescriptions = {
  "business_value": [
    "Amélioration interne mineure, invisible pour les clients.",
    "Optimise un petit processus, utile à une seule équipe.",
    "Améliore l'efficacité ou l'expérience pour plusieurs équipes ou un segment de clients.",
    "Impact direct sur la satisfaction client ou la productivité globale.",
    "Augmente les revenus, renforce la position de marché ou différencie l'entreprise"
  ],
  "time_criticality": [
    "Peut être reporté sans aucun impact d'affaires.",
    "Retarde une opportunité mineure",
    "Retarde un lancement, une saison ou un jalon de projet",
    "Un retard expose l'entreprise à des pertes financières ou contractuelles.",
    "Un retard entraîne des pénalités légales, perte de clients ou réputation."
  ],
  "risk_reduction_opportunity": [
    "N'atténue aucun risque, n'ouvre aucune nouvelle voie.",
    "Réduit un petit irritant opérationnel ou ouvre une opportunité mineure.",
    "Diminue un risque identifié par la direction ou ouvre un marché de niche",
    "Réduit un risque stratégique (ex. sécurité, conformité) ou crée une nouvelle ligne d'affaires.",
    "Élimine un risque critique pouvant menacer l'entreprise ou ouvre une opportunité majeure (nouveau marché, partenariat stratégique)."
  ]
};

// Descriptions par défaut pour les axes de complexité
const defaultComplexityDescriptions = {
  "ai_maturity": [
    "Technologie éprouvée et stable pour l'usage (SVI basique).",
    "Technologie éprouvée mais requiert configuration standard (classification simple, chatbot FAQ).",
    "Technologie maîtrisée mais nécessite adaptation/paramétrage fin (chatbot transactionnel). Fiabilité à valider.",
    "Technologie récente ou appliquée de manière nouvelle, nécessite PoC/validation poussée. Fiabilité modérée attendue.",
    "Technologie émergente/expérimentale ou R&D importante. Fiabilité incertaine."
  ],
  "implementation_effort": [
    "Solution quasi \"sur étagère\", intégration minimale via API très simples.",
    "Intégration légère avec 1-2 systèmes via API standard. Configuration simple.",
    "Intégration avec systèmes clés (CRM, téléphonie) via API existantes. Dev/config modéré.",
    "Intégration plus complexe avec plusieurs systèmes (certains moins modernes), création d'API simples, orchestration basique.",
    "Intégration profonde avec multiples systèmes. Dev custom important, création/modif API complexes, orchestration avancée."
  ],
  "data_compliance": [
    "Pas ou peu de données personnelles et données non sensibles, risque biais faible, pas d'enjeux éthiques majeurs.",
    "Utilisation de données personnnelles non sensibles ou données peu sensibles, risque biais faible mais à vérifier, besoin de documentation conformité simple (Loi 25).",
    "Utilisation de données personnelles ou autres données à confidentialité limitée, nécessitant pseudonymisation/anonymisation, gestion consentement, tests biais standards, xAI simple.",
    "Utilisation de données personnelles sensibles ou autres données à confidentialité avérées, risque biais modéré nécessitant mitigation active, une traçabilité et une transparence accrue.",
    "Utilisation de données personnelles très sensibles ou autres très confidentielles et réglementées (e.g export control), risque biais élevé, enjeux éthiques importants (décisions importantes), conformité C-27/AI Act stricte ou autre réglementation (Export Control, ...), audits et traçabilité réglementés, xAI avancées."
  ],
  "data_availability": [
    "Données centralisées, propres, documentées.",
    "Données dans 1-2 systèmes, qualité bonne, accès simple, léger nettoyage.",
    "Données dans quelques systèmes (<5), nettoyage/rapprochement modéré, qualité acceptable, accès gérable.",
    "Données dans plusieurs systèmes, qualité hétérogène, effort ETL notable, complexité d'accès moyenne.",
    "Données dispersées (>5 systèmes, legacy), faible qualité, gros efforts ETL/qualité, complexité d'accès (sécurité, silos), besoin datamart/lac."
  ],
  "change_management": [
    "Impact minimal sur processus agents, formation rapide/intuitive.",
    "Léger ajustement processus, formation courte nécessaire.",
    "Modification notable processus/outils, formation structurée, communication nécessaire.",
    "Changement important processus, formation approfondie, accompagnement soutenu requis.",
    "Refonte majeure processus, fort impact rôle agent, formation + accompagnement intensifs, plan GOC robuste, implication syndicats (si applicable)."
  ]
};

export const defaultMatrixConfig: MatrixConfig = {
  valueAxes: [
    {
      id: 'business_value',
      name: 'Valeur d\'affaire',
      weight: 2.0,
      description: 'Impact sur la valeur d\'affaire de l\'entreprise',
      levelDescriptions: defaultValueDescriptions["business_value"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'time_criticality',
      name: 'Urgence dans le temps',
      weight: 1.5,
      description: 'Urgence temporelle du projet',
      levelDescriptions: defaultValueDescriptions["time_criticality"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'risk_reduction_opportunity',
      name: 'Réduction du risque / opportunité',
      weight: 1.5,
      description: 'Réduction des risques et création d\'opportunités',
      levelDescriptions: defaultValueDescriptions["risk_reduction_opportunity"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    }
  ],
  complexityAxes: [
    {
      id: 'ai_maturity',
      name: 'Maturité et fiabilité de l\'IA',
      weight: 1.0,
      description: 'Maturité de la solution IA',
      levelDescriptions: defaultComplexityDescriptions["ai_maturity"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'implementation_effort',
      name: 'Effort d\'Implémentation & Intégration',
      weight: 1.5,
      description: 'Effort d\'implémentation',
      levelDescriptions: defaultComplexityDescriptions["implementation_effort"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'data_compliance',
      name: 'IA Responsable & Conformité Données',
      weight: 1.0,
      description: 'Conformité des données',
      levelDescriptions: defaultComplexityDescriptions["data_compliance"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'data_availability',
      name: 'Disponibilité, Qualité & Accès Données',
      weight: 1.0,
      description: 'Disponibilité des données',
      levelDescriptions: defaultComplexityDescriptions["data_availability"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'change_management',
      name: 'Gestion du Changement & Impact Métier',
      weight: 1.0,
      description: 'Gestion du changement',
      levelDescriptions: defaultComplexityDescriptions["change_management"].map((desc, index) => ({
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