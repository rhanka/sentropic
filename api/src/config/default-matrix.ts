import type { MatrixConfig } from '../types/matrix';

// Descriptions par défaut pour les axes de valeur
const defaultValueDescriptions = {
  "Niveau de Sponsorship": [
    "Équipe locale / Aucun sponsor clair",
    "Opérationnel / Gestionnaire 1er niveau",
    "Direction Service Client / TI",
    "Direction Principale / VP Service Client",
    "Vice-Présidence Exécutive / Comité Exécutif"
  ],
  "Impact Satisfaction Client (CSAT/NPS)": [
    "Impact négligeable ou très localisé sur la satisfaction client.",
    "Amélioration mineure d'un point de contact peu fréquent ou irritant mineur.",
    "Réduction notable des irritants sur motifs courants (ex: facturation simple). Impact mesurable sur le CSAT.",
    "Amélioration sensible de l'expérience sur motifs importants (déménagement) OU réduction significative de l'effort client.",
    "Amélioration majeure sur motifs critiques (pannes) OU refonte positive d'un parcours client clé. Fort impact potentiel sur CSAT/NPS."
  ],
  "Gains de Productivité (Agents & Opérations)": [
    "Impact quasi nul sur le TMT (<2%) ou les ETP (<0.5).",
    "Réduction mineure du TMT (2-5%) ou RPC, économie 0.5-1 ETP.",
    "Réduction significative du TMT (5-10%), amélioration du RPC, économie 1-3 ETP.",
    "Réduction importante du TMT (10-15%), automatisation partielle d'une tâche, économie 3-5 ETP.",
    "Réduction majeure du TMT (>15%) ou RPC, forte automatisation/déviation vers self-service, économie > 5 ETP."
  ],
  "Amélioration Expérience Agent & Rétention": [
    "Pas d'impact notable sur le travail de l'agent.",
    "Simplifie une tâche très spécifique ou rarement frustrante.",
    "Simplifie des tâches modérément complexes, réduit le stress sur certains types d'appels, aide à la formation initiale.",
    "Automatise une partie des tâches répétitives, fournit une assistance contextuelle utile.",
    "Automatise tâches frustrantes, assistance temps réel précieuse, réduit la charge cognitive, améliore satisfaction agent."
  ],
  "Conformité & Image Publique": [
    "N/A ou impact neutre.",
    "Aide marginale à la conformité (ex: logging simple).",
    "Aide à maintenir la conformité OU améliore l'image sur un aspect spécifique (ex: transparence facturation).",
    "Renforce la conformité sur un point précis OU améliore l'image sur un sujet sensible.",
    "Renforce significativement la conformité (traçabilité, données) OU améliore l'image publique sur des enjeux clés (pannes)."
  ]
};

// Descriptions par défaut pour les axes de complexité
const defaultComplexityDescriptions = {
  "Maturité & Fiabilité Solution IA": [
    "Technologie éprouvée et stable pour l'usage (SVI basique).",
    "Technologie éprouvée mais requiert configuration standard (classification simple, chatbot FAQ).",
    "Technologie maîtrisée mais nécessite adaptation/paramétrage fin (chatbot transactionnel). Fiabilité à valider.",
    "Technologie récente ou appliquée de manière nouvelle, nécessite PoC/validation poussée. Fiabilité modérée attendue.",
    "Technologie émergente/expérimentale ou R&D importante. Fiabilité incertaine."
  ],
  "Effort d'Implémentation & Intégration": [
    "Solution quasi \"sur étagère\", intégration minimale via API très simples.",
    "Intégration légère avec 1-2 systèmes via API standard. Configuration simple.",
    "Intégration avec systèmes clés (CRM, téléphonie) via API existantes. Dev/config modéré.",
    "Intégration plus complexe avec plusieurs systèmes (certains moins modernes), création d'API simples, orchestration basique.",
    "Intégration profonde avec multiples systèmes. Dev custom important, création/modif API complexes, orchestration avancée."
  ],
  "IA Responsable & Conformité Données": [
    "Pas ou peu de DP, risque biais faible, pas d'enjeux éthiques majeurs.",
    "Utilisation de DP non sensibles, risque biais faible mais à vérifier, besoin de documentation conformité simple (Loi 25).",
    "Utilisation de DP (Loi 25), pseudonymisation/anonymisation, gestion consentement, tests biais standards, xAI simple.",
    "Utilisation de DP potentiellement sensibles, risque biais modéré nécessitant mitigation active, enjeu C-27/AI Act naissant, transparence accrue.",
    "Utilisation DP sensibles, risque biais élevé, enjeux éthiques importants (décisions importantes), conformité C-27/AI Act stricte, audits complexes, xAI avancées."
  ],
  "Disponibilité, Qualité & Accès Données": [
    "Données centralisées, propres, documentées.",
    "Données dans 1-2 systèmes, qualité bonne, accès simple, léger nettoyage.",
    "Données dans quelques systèmes (<5), nettoyage/rapprochement modéré, qualité acceptable, accès gérable.",
    "Données dans plusieurs systèmes, qualité hétérogène, effort ETL notable, complexité d'accès moyenne.",
    "Données dispersées (>5 systèmes, legacy), faible qualité, gros efforts ETL/qualité, complexité d'accès (sécurité, silos), besoin datamart/lac."
  ],
  "Gestion du Changement & Impact Métier": [
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
      id: 'sponsorship',
      name: 'Niveau de Sponsorship',
      weight: 2.0,
      description: 'Niveau de support hiérarchique pour le projet',
      levelDescriptions: defaultValueDescriptions["Niveau de Sponsorship"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'customer_satisfaction',
      name: 'Impact Satisfaction Client (CSAT/NPS)',
      weight: 1.5,
      description: 'Impact sur la satisfaction client',
      levelDescriptions: defaultValueDescriptions["Impact Satisfaction Client (CSAT/NPS)"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'productivity',
      name: 'Gains de Productivité (Agents & Opérations)',
      weight: 1.5,
      description: 'Amélioration de la productivité',
      levelDescriptions: defaultValueDescriptions["Gains de Productivité (Agents & Opérations)"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'agent_experience',
      name: 'Amélioration Expérience Agent & Rétention',
      weight: 1.0,
      description: 'Impact sur l\'expérience des agents',
      levelDescriptions: defaultValueDescriptions["Amélioration Expérience Agent & Rétention"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'compliance',
      name: 'Conformité & Image Publique',
      weight: 1.0,
      description: 'Impact sur la conformité et l\'image',
      levelDescriptions: defaultValueDescriptions["Conformité & Image Publique"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    }
  ],
  complexityAxes: [
    {
      id: 'ai_maturity',
      name: 'Maturité & Fiabilité Solution IA',
      weight: 1.0,
      description: 'Maturité de la solution IA',
      levelDescriptions: defaultComplexityDescriptions["Maturité & Fiabilité Solution IA"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'implementation_effort',
      name: 'Effort d\'Implémentation & Intégration',
      weight: 1.5,
      description: 'Effort d\'implémentation',
      levelDescriptions: defaultComplexityDescriptions["Effort d'Implémentation & Intégration"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'data_compliance',
      name: 'IA Responsable & Conformité Données',
      weight: 1.0,
      description: 'Conformité des données',
      levelDescriptions: defaultComplexityDescriptions["IA Responsable & Conformité Données"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'data_availability',
      name: 'Disponibilité, Qualité & Accès Données',
      weight: 1.0,
      description: 'Disponibilité des données',
      levelDescriptions: defaultComplexityDescriptions["Disponibilité, Qualité & Accès Données"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    },
    {
      id: 'change_management',
      name: 'Gestion du Changement & Impact Métier',
      weight: 1.0,
      description: 'Gestion du changement',
      levelDescriptions: defaultComplexityDescriptions["Gestion du Changement & Impact Métier"].map((desc, index) => ({
        level: index + 1,
        description: desc
      }))
    }
  ],
  valueThresholds: [
    { level: 1, points: 0, threshold: 300, cases: 0 },
    { level: 2, points: 40, threshold: 700, cases: 0 },
    { level: 3, points: 100, threshold: 1000, cases: 0 },
    { level: 4, points: 400, threshold: 1500, cases: 0 },
    { level: 5, points: 2000, threshold: 4000, cases: 0 }
  ],
  complexityThresholds: [
    { level: 1, points: 0, threshold: 100, cases: 0 },
    { level: 2, points: 50, threshold: 250, cases: 0 },
    { level: 3, points: 100, threshold: 500, cases: 0 },
    { level: 4, points: 250, threshold: 1000, cases: 0 },
    { level: 5, points: 1000, threshold: 2000, cases: 0 }
  ]
};