import { db } from '../../src/db/client.js';
import { companies, folders, useCases, settings } from '../../src/db/schema.js';
import { testMatrix } from './test-data.js';

export async function seedTestData() {
  console.log('🌱 Seeding test data for E2E tests...\n');

  try {
    // 1. Entreprises de test
    const testCompaniesData = [
      {
        id: 'test-rio-tinto',
        name: 'Rio Tinto Test',
        industry: 'Mining & Metals',
        size: 'Large (10,000+ employees)',
        products: 'Aluminium, Iron Ore, Copper, Diamonds',
        processes: 'Mining, Smelting, Refining, Manufacturing',
        challenges: 'Decarbonization, ESG compliance, Operational efficiency',
        objectives: 'Carbon-neutral aluminum production, Digital transformation',
        technologies: 'AI/ML, IoT, Digital twins, Process optimization',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'test-delpharm',
        name: 'Delpharm Test',
        industry: 'Pharmaceutical Manufacturing',
        size: 'Medium (1,000-5,000 employees)',
        products: 'Generic pharmaceuticals, Contract manufacturing',
        processes: 'Drug development, Manufacturing, Quality control',
        challenges: 'Regulatory compliance, Cost optimization, Quality assurance',
        objectives: 'Expand manufacturing capacity, Improve efficiency',
        technologies: 'Process automation, Quality management systems',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    // Insérer les entreprises de test
    for (const company of testCompaniesData) {
      await db.insert(companies).values(company).onConflictDoNothing();
      console.log(`✅ Company: ${company.name} (${company.status})`);
    }

    // 2. Dossier de test
    const testFolderData = {
      id: 'test-folder-e2e',
      name: 'Dossier Test E2E',
      description: 'Dossier de test pour les tests E2E',
      status: 'in_progress',
      companyId: 'test-rio-tinto',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.insert(folders).values(testFolderData).onConflictDoNothing();
    console.log(`✅ Folder: ${testFolderData.name}`);

    // 3. Cas d'usage de test avec différents statuts
    const testUseCasesData = [
      {
        id: 'test-uc-1',
        folderId: 'test-folder-e2e',
        companyId: 'test-rio-tinto',
        name: 'Réponses clients automatiques',
        description: 'Système de réponse automatique aux questions clients',
        process: 'Customer service automation',
        domain: 'Customer Service',
        technologies: '["NLP", "Chatbot", "Machine Learning"]',
        prerequisites: 'Customer data, FAQ database, Integration APIs',
        deadline: '3 months',
        contact: 'Customer Service Manager',
        benefits: '["Reduced response time", "24/7 availability", "Cost savings"]',
        metrics: '["Response time", "Customer satisfaction", "Resolution rate"]',
        risks: '["Data privacy", "Accuracy concerns", "Integration complexity"]',
        nextSteps: '["Data collection", "Model training", "Pilot testing"]',
        sources: '["CRM", "FAQ database", "Customer feedback"]',
        relatedData: '["Customer queries", "Response templates", "Performance metrics"]',
        references: '[{"title": "AI in Customer Service", "url": "https://example.com"}]',
        valueScores: '[{"axisId": "business_value", "rating": 5, "description": "High business value"}]',
        complexityScores: '[{"axisId": "ai_maturity", "rating": 2, "description": "Low complexity"}]',
        totalValueScore: 5,
        totalComplexityScore: 2,
        status: 'active',
        createdAt: new Date()
      },
      {
        id: 'test-uc-2',
        folderId: 'test-folder-e2e',
        companyId: 'test-rio-tinto',
        name: 'Analyse sentiment',
        description: 'Analyse des sentiments dans les commentaires clients',
        process: 'Sentiment analysis',
        domain: 'Marketing',
        technologies: '["NLP", "Sentiment Analysis", "Text Mining"]',
        prerequisites: 'Customer feedback data, Text processing tools',
        deadline: '6 months',
        contact: 'Marketing Manager',
        benefits: '["Better customer insights", "Improved products", "Brand monitoring"]',
        metrics: '["Sentiment accuracy", "Processing speed", "Insight quality"]',
        risks: '["Data quality", "Model bias", "Privacy concerns"]',
        nextSteps: '["Data preparation", "Model development", "Validation"]',
        sources: '["Social media", "Reviews", "Surveys"]',
        relatedData: '["Customer comments", "Sentiment scores", "Trends"]',
        references: '[{"title": "Sentiment Analysis Guide", "url": "https://example.com"}]',
        valueScores: '[{"axisId": "business_value", "rating": 4, "description": "Medium-high value"}]',
        complexityScores: '[{"axisId": "ai_maturity", "rating": 3, "description": "Medium complexity"}]',
        totalValueScore: 4,
        totalComplexityScore: 3,
        status: 'active',
        createdAt: new Date()
      },
      {
        id: 'test-uc-3',
        folderId: 'test-folder-e2e',
        companyId: 'test-rio-tinto',
        name: 'Extraction documents',
        description: 'Extraction automatique de données depuis des documents',
        process: 'Document processing',
        domain: 'Operations',
        technologies: '["OCR", "Document AI", "Data extraction"]',
        prerequisites: 'Document repository, OCR tools, Data validation',
        deadline: '9 months',
        contact: 'Operations Manager',
        benefits: '["Reduced manual work", "Faster processing", "Better accuracy"]',
        metrics: '["Extraction accuracy", "Processing time", "Error rate"]',
        risks: '["Document quality", "Format variations", "Integration issues"]',
        nextSteps: '["Document analysis", "Tool selection", "Pilot testing"]',
        sources: '["Document management system", "File storage", "Scanned documents"]',
        relatedData: '["Document types", "Extracted data", "Validation results"]',
        references: '[{"title": "Document AI Solutions", "url": "https://example.com"}]',
        valueScores: '[{"axisId": "business_value", "rating": 3, "description": "Medium value"}]',
        complexityScores: '[{"axisId": "ai_maturity", "rating": 5, "description": "High complexity"}]',
        totalValueScore: 3,
        totalComplexityScore: 5,
        status: 'generating',
        createdAt: new Date()
      },
      {
        id: 'test-uc-4',
        folderId: 'test-folder-e2e',
        companyId: 'test-rio-tinto',
        name: 'Détection fraude',
        description: 'Système de détection de fraude en temps réel',
        process: 'Fraud detection',
        domain: 'Security',
        technologies: '["Machine Learning", "Anomaly Detection", "Real-time processing"]',
        prerequisites: 'Transaction data, ML models, Real-time infrastructure',
        deadline: '12 months',
        contact: 'Security Manager',
        benefits: '["Reduced fraud losses", "Real-time protection", "Better security"]',
        metrics: '["Detection rate", "False positive rate", "Response time"]',
        risks: '["Model accuracy", "False positives", "System performance"]',
        nextSteps: '["Data analysis", "Model training", "System integration"]',
        sources: '["Transaction logs", "User behavior", "External data"]',
        relatedData: '["Transaction patterns", "Risk scores", "Alerts"]',
        references: '[{"title": "Fraud Detection ML", "url": "https://example.com"}]',
        valueScores: '[{"axisId": "business_value", "rating": 2, "description": "Low-medium value"}]',
        complexityScores: '[{"axisId": "ai_maturity", "rating": 4, "description": "High complexity"}]',
        totalValueScore: 2,
        totalComplexityScore: 4,
        status: 'draft',
        createdAt: new Date()
      },
      {
        id: 'test-uc-5',
        folderId: 'test-folder-e2e',
        companyId: 'test-rio-tinto',
        name: 'Prévision vente',
        description: 'Prédiction des ventes futures basée sur l\'historique',
        process: 'Sales forecasting',
        domain: 'Sales',
        technologies: '["Time Series", "Machine Learning", "Statistical models"]',
        prerequisites: 'Historical sales data, Market data, Forecasting tools',
        deadline: '6 months',
        contact: 'Sales Manager',
        benefits: '["Better planning", "Reduced inventory", "Improved accuracy"]',
        metrics: '["Forecast accuracy", "Planning efficiency", "Inventory optimization"]',
        risks: '["Data quality", "Market volatility", "Model complexity"]',
        nextSteps: '["Data collection", "Model development", "Validation"]',
        sources: '["Sales database", "Market data", "External factors"]',
        relatedData: '["Sales history", "Forecast results", "Accuracy metrics"]',
        references: '[{"title": "Sales Forecasting ML", "url": "https://example.com"}]',
        valueScores: '[{"axisId": "business_value", "rating": 5, "description": "High value"}]',
        complexityScores: '[{"axisId": "ai_maturity", "rating": 5, "description": "High complexity"}]',
        totalValueScore: 5,
        totalComplexityScore: 5,
        status: 'generating_detail',
        createdAt: new Date()
      }
    ];

    // Insérer les cas d'usage de test
    for (const useCase of testUseCasesData) {
      await db.insert(useCases).values(useCase).onConflictDoNothing();
      console.log(`✅ Use Case: ${useCase.name} (${useCase.status})`);
    }

    // 4. Configuration de matrice par défaut (si pas déjà présente)
    const defaultMatrix = {
      key: 'default-matrix',
      value: JSON.stringify({
        name: 'Matrice par défaut',
        description: 'Configuration de matrice pour les tests E2E',
        valueAxes: testMatrix.default.valueAxes,
        complexityAxes: testMatrix.default.complexityAxes,
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
      }),
      description: 'Configuration de matrice pour les tests E2E',
      updatedAt: new Date()
    };

    await db.insert(settings).values(defaultMatrix).onConflictDoNothing();
    console.log(`✅ Matrix: ${defaultMatrix.key}`);

    console.log('\n🎉 Test data seeded successfully!');
    console.log('\n📊 Summary:');
    console.log(`- Companies: ${testCompaniesData.length}`);
    console.log(`- Folders: 1`);
    console.log(`- Use Cases: ${testUseCasesData.length}`);
    console.log(`- Matrix: 1`);

  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    throw error;
  }
}

// Execute when run directly
seedTestData()
  .then(() => {
    console.log('✅ Seed completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
