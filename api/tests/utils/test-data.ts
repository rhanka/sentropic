export const testCompanies = {
  valid: {
    name: 'Test Company Inc',
    industry: 'Technologie',
    size: '50-200 employés',
  },
  forEnrichment: {
    name: 'RioTinto',
    expectedIndustry: 'Technologie',
  },
  forEnrichment2: {
    name: 'Airbus',
    expectedIndustry: 'Technologie',
  },
};

export const testUseCases = {
  valid: {
    input: 'Optimisation des opérations de production manufacturière',
    expectedCount: 6,
  },
  forGeneration: {
    input: '3 cas d\'usage pour Optimisation des plannings de production',
    expectedCount: 3,
  },
};

export const testFolders = {
  valid: {
    name: 'Test Folder',
    description: 'Dossier de test pour les cas d\'usage',
  },
};

export const testMatrix = {
  default: {
    valueAxes: [
      { id: 'business_value', name: 'Valeur d\'affaires', levels: ['Faible', 'Moyenne', 'Élevée'] },
      { id: 'risk_reduction', name: 'Réduction de risque', levels: ['Faible', 'Moyenne', 'Élevée'] },
      { id: 'urgency', name: 'Urgence dans le temps', levels: ['Faible', 'Moyenne', 'Élevée'] },
    ],
    complexityAxes: [
      { id: 'technical_complexity', name: 'Complexité technique', levels: ['Faible', 'Moyenne', 'Élevée'] },
      { id: 'implementation_effort', name: 'Effort d\'implémentation', levels: ['Faible', 'Moyenne', 'Élevée'] },
    ],
  },
};
