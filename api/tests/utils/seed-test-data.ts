import { db } from '../../src/db/client.js';
import { 
  organizations, 
  folders, 
  useCases, 
  settings, 
  users, 
  workspaces,
  workspaceMemberships,
  objectLocks,
  contextDocuments,
  webauthnCredentials, 
  sessions,
  userSessions,
  webauthnChallenges,
  magicLinks,
  jobQueue,
  emailVerificationCodes,
  chatContexts,
  chatMessages,
  chatSessions,
  chatStreamEvents,
  contextModificationHistory,
  ADMIN_WORKSPACE_ID,
} from '../../src/db/schema.js';
import { testMatrix } from './test-data.js';

export async function seedTestData() {
  console.log('🌱 Seeding test data for E2E tests...\n');

  try {
    // Clean up all data before seeding to ensure a clean state for E2E tests
    // Order matters: delete tables with foreign keys first
    console.log('🗑️  Cleaning up existing data...');
    
    // 1. Delete tables with foreign keys (in dependency order)
    await db.delete(chatStreamEvents);
    await db.delete(chatContexts);
    await db.delete(chatMessages);
    await db.delete(chatSessions);
    await db.delete(contextModificationHistory);
    await db.delete(objectLocks);

    await db.delete(useCases); // Depends on folders and organizations
    await db.delete(folders); // Depends on organizations
    await db.delete(organizations); // Depends on workspaces
    
    // 2. Delete auth-related tables with foreign keys
    await db.delete(userSessions); // Depends on users
    await db.delete(webauthnCredentials); // Depends on users
    await db.delete(webauthnChallenges); // Depends on users
    await db.delete(magicLinks); // Depends on users
    await db.delete(emailVerificationCodes); // Depends on users/email
    await db.delete(sessions); // Old sessions table (if exists)
    await db.delete(users); // No dependencies
    
    // 3. Delete other tables
    await db.delete(jobQueue); // Clean job queue to avoid interference
    await db.delete(settings); // Clean settings to ensure clean state
    await db.delete(contextDocuments); // FK -> workspaces (documents are workspace-scoped)
    await db.delete(workspaceMemberships); // FK -> workspaces/users
    await db.delete(workspaces); // After all workspace-scoped tables are deleted
    
    // Note: businessConfig is kept as it contains business configuration
    // that might be needed. If you want to clean it too, uncomment:
    // await db.delete(businessConfig);
    
    console.log('✅ All data cleaned (organizations, folders, use cases, users, auth, jobs, settings)');
    // Deterministic IDs for stable E2E fixtures
    const E2E_ADMIN_ID = 'e2e-user-admin';
    const E2E_USER_A_ID = 'e2e-user-a';
    const E2E_USER_B_ID = 'e2e-user-b';
    const E2E_USER_VICTIM_ID = 'e2e-user-victim';
    const E2E_PENDING_ID = 'e2e-user-pending';

    const E2E_WS_ADMIN = ADMIN_WORKSPACE_ID;
    const E2E_WS_A = 'e2e-ws-a';
    const E2E_WS_B = 'e2e-ws-b';
    const E2E_WS_VICTIM = 'e2e-ws-victim';

    // 0. Workspaces & users (multi-tenant)
    // NOTE: we seed users with emailVerified=true because session validation requires it.
    const now = new Date();

    await db.insert(workspaces).values([
      {
        id: E2E_WS_ADMIN,
        ownerUserId: E2E_ADMIN_ID, // will be claimed by actual admin_app at boot; OK for E2E fixtures
        name: 'Admin Workspace',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_WS_A,
        ownerUserId: E2E_USER_A_ID,
        name: 'Workspace A (E2E)',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_WS_B,
        ownerUserId: E2E_USER_B_ID,
        name: 'Workspace B (E2E)',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_WS_VICTIM,
        ownerUserId: E2E_USER_VICTIM_ID,
        name: 'Workspace Victim (E2E)',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(users).values([
      {
        id: E2E_ADMIN_ID,
        email: 'e2e-admin@example.com',
        displayName: 'E2E Admin',
        role: 'admin_app',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_USER_A_ID,
        email: 'e2e-user-a@example.com',
        displayName: 'E2E User A',
        role: 'editor',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_USER_B_ID,
        email: 'e2e-user-b@example.com',
        displayName: 'E2E User B',
        role: 'editor',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_USER_VICTIM_ID,
        email: 'e2e-user-victim@example.com',
        displayName: 'E2E Victim',
        role: 'editor',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: E2E_PENDING_ID,
        email: 'e2e-user-pending@example.com',
        displayName: 'E2E Pending',
        role: 'editor',
        accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    console.log('✅ Workspaces + users seeded (admin + userA + userB + userVictim + pending)');

    await db.insert(workspaceMemberships).values([
      { workspaceId: E2E_WS_ADMIN, userId: E2E_ADMIN_ID, role: 'admin', createdAt: now },
      { workspaceId: E2E_WS_A, userId: E2E_USER_A_ID, role: 'admin', createdAt: now },
      { workspaceId: E2E_WS_B, userId: E2E_USER_B_ID, role: 'admin', createdAt: now },
      { workspaceId: E2E_WS_VICTIM, userId: E2E_USER_VICTIM_ID, role: 'admin', createdAt: now },
    ]);

    // 1. Organisations de test (profil dans organizations.data JSONB)
    const testOrganizationsData = [
      {
        id: 'e2e-organization-a-pomerleau',
        workspaceId: E2E_WS_A,
        name: 'Pomerleau',
        data: {
          industry: 'Construction',
          size: 'Plus de 5 000 employés',
          products: 'Construction bâtiments, infrastructures, génie civil',
          processes: 'Gestion de projets, BIM, planification, sécurité chantier',
          challenges: 'Délais, coordination, sécurité, conformité',
          objectives: 'Durabilité, performance projets, digitalisation',
          technologies: 'BIM, IoT, analytics, IA',
          kpis: [
            '## Indicateurs de performance',
            '- Respect des délais (OTD)',
            '- Écart budget vs réalisé',
            '- Taux d’incidents / sécurité (LTIFR)',
          ].join('\n'),
          references: [
            { title: 'Site officiel (exemple)', url: 'https://example.com/pomerleau', excerpt: 'Page entreprise (fixture de test).' },
          ],
        },
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e2e-organization-b-bmr',
        workspaceId: E2E_WS_B,
        name: 'Groupe BMR inc.',
        data: {
          industry: 'Retail',
          size: 'Réseau 200+ magasins',
          products: 'Quincaillerie, rénovation, matériaux',
          processes: 'Supply chain, omnicanal, pricing/promo, inventaire',
          challenges: 'Saisonnalité, supply constraints, omnicanal',
          objectives: 'Améliorer promesse livraison et conversion',
          technologies: 'ERP/POS/WMS, e-commerce, data',
          kpis: [
            '## Indicateurs de performance',
            '- Taux de rupture',
            '- OTIF / promesse de livraison',
            '- Marge brute',
          ].join('\n'),
          references: [
            { title: 'Site officiel (exemple)', url: 'https://example.com/bmr', excerpt: 'Page entreprise (fixture de test).' },
          ],
        },
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e2e-organization-admin-bombardier',
        workspaceId: E2E_WS_ADMIN,
        name: 'Bombardier Inc.',
        data: {
          industry: 'Aéronautique',
          size: '≈18k employés',
          products: 'Jets d’affaires + services MRO',
          processes: 'Ingénierie, supply chain, MRO',
          challenges: 'Supply chain, ramp-up, qualité',
          objectives: 'Croissance services, efficacité',
          technologies: 'PLM, data, maintenance prédictive',
          kpis: [
            '## Indicateurs de performance',
            '- Disponibilité flotte',
            '- MTBF / MTTR',
            '- On-time delivery',
          ].join('\n'),
          references: [
            { title: 'Site officiel (exemple)', url: 'https://example.com/bombardier', excerpt: 'Page entreprise (fixture de test).' },
          ],
        },
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      // Required by e2e/tests/ai-generation.spec.ts (expects an option containing "Delpharm")
      {
        id: 'e2e-organization-admin-delpharm',
        workspaceId: E2E_WS_ADMIN,
        name: 'Delpharm',
        data: {
          industry: 'Pharmaceutique',
          size: '1000-5000',
          products: 'CDMO, génériques',
          processes: 'Manufacturing, QC, supply',
          challenges: 'Compliance, coûts, qualité',
          objectives: 'Efficacité, capacité',
          technologies: 'Automation, data',
          kpis: [
            '## Indicateurs de performance',
            '- Lots libérés à temps',
            '- Taux de déviation',
            '- CAPA on-time',
          ].join('\n'),
          references: [
            { title: 'Site officiel (exemple)', url: 'https://example.com/delpharm', excerpt: 'Page entreprise (fixture de test).' },
          ],
        },
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e2e-organization-victim',
        workspaceId: E2E_WS_VICTIM,
        name: 'Victim Co',
        data: {
          industry: 'E2E',
          size: '1-10',
          products: 'N/A',
          processes: 'N/A',
          challenges: 'N/A',
          objectives: 'N/A',
          technologies: 'N/A',
          kpis: '',
          references: [],
        },
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
    ];

    // Insérer les organisations de test
    for (const org of testOrganizationsData) {
      await db.insert(organizations).values(org).onConflictDoNothing();
      console.log(`✅ Organization: ${org.name} (${org.status})`);
    }

    // 2. Dossiers de test (un par workspace)
    const matrixConfig = JSON.stringify({
      valueAxes: testMatrix.default.valueAxes,
      complexityAxes: testMatrix.default.complexityAxes,
      valueThresholds: [
        { level: 1, points: 0, cases: 0 },
        { level: 2, points: 2, cases: 0 },
        { level: 3, points: 8, cases: 0 },
        { level: 4, points: 34, cases: 0 },
        { level: 5, points: 100, cases: 0 },
      ],
      complexityThresholds: [
        { level: 1, points: 0, cases: 0 },
        { level: 2, points: 2, cases: 0 },
        { level: 3, points: 8, cases: 0 },
        { level: 4, points: 34, cases: 0 },
        { level: 5, points: 100, cases: 0 },
      ],
    });

    const testFolders = [
      {
        id: 'e2e-folder-a',
        workspaceId: E2E_WS_A,
        name: 'Pomerleau — Cas E2E (tenancy A)',
        description: "Dossier E2E réaliste (sans IA) pour valider le cloisonnement workspace.",
        organizationId: 'e2e-organization-a-pomerleau',
        matrixConfig,
        status: 'completed',
        executiveSummary: null,
        createdAt: now,
      },
      {
        id: 'e2e-folder-b',
        workspaceId: E2E_WS_B,
        name: 'BMR — Cas E2E (tenancy B)',
        description: "Dossier E2E réaliste (sans IA) pour valider le cloisonnement workspace.",
        organizationId: 'e2e-organization-b-bmr',
        matrixConfig,
        status: 'completed',
        executiveSummary: null,
        createdAt: now,
      },
      {
        id: 'e2e-folder-admin',
        workspaceId: E2E_WS_ADMIN,
        name: 'Bombardier — Cas E2E (admin)',
        description: "Dossier E2E admin.",
        organizationId: 'e2e-organization-admin-bombardier',
        matrixConfig,
        status: 'completed',
        executiveSummary: null,
        createdAt: now,
      },
      {
        id: 'e2e-folder-victim',
        workspaceId: E2E_WS_VICTIM,
        name: 'Victim — Dossier E2E',
        description: "Dossier E2E victim (pour disable/delete).",
        organizationId: 'e2e-organization-victim',
        matrixConfig,
        status: 'completed',
        executiveSummary: null,
        createdAt: now,
      },
    ] as const;

    for (const folder of testFolders) {
      await db.insert(folders).values(folder).onConflictDoNothing();
      console.log(`✅ Folder: ${folder.name}`);
    }

    // 3. Cas d'usage (schema v2: toutes les colonnes métier dans JSONB data)
    const mkUseCaseData = (name: string, description: string, extra: Record<string, unknown> = {}) => ({
      name,
      description,
      ...extra,
    });

    const testUseCasesData = [
      // Workspace A
      {
        id: 'e2e-uc-a-1',
        workspaceId: E2E_WS_A,
        folderId: 'e2e-folder-a',
        organizationId: 'e2e-organization-a-pomerleau',
        status: 'completed',
        model: null,
        createdAt: now,
        data: mkUseCaseData(
          'Optimisation planning chantier via IA',
          "Optimiser la planification et l'ordonnancement sur grands projets pour réduire retards et coûts.",
          { domain: 'Construction', process: 'Planification / scheduling' }
        ),
      },
      {
        id: 'e2e-uc-a-2',
        workspaceId: E2E_WS_A,
        folderId: 'e2e-folder-a',
        organizationId: 'e2e-organization-a-pomerleau',
        status: 'completed',
        model: null,
        createdAt: now,
        data: mkUseCaseData(
          'Détection défauts et contrôle qualité (vision)',
          "Inspection automatique (images/drones) pour détecter défauts et non-conformités plus tôt.",
          { domain: 'Construction', process: 'Contrôle qualité' }
        ),
      },

      // Workspace B
      {
        id: 'e2e-uc-b-1',
        workspaceId: E2E_WS_B,
        folderId: 'e2e-folder-b',
        organizationId: 'e2e-organization-b-bmr',
        status: 'completed',
        model: null,
        createdAt: now,
        data: mkUseCaseData(
          "Orchestration dernier km & promesse fiable",
          "Améliorer l’OTIF, réduire coûts/stop et fiabiliser la promesse e-commerce.",
          { domain: 'Retail', process: 'Logistique / last mile' }
        ),
      },
      {
        id: 'e2e-uc-b-2',
        workspaceId: E2E_WS_B,
        folderId: 'e2e-folder-b',
        organizationId: 'e2e-organization-b-bmr',
        status: 'completed',
        model: null,
        createdAt: now,
        data: mkUseCaseData(
          "Enrichissement PIM (contenu produit)",
          "Enrichir automatiquement les fiches produit (FR/EN) pour conversion + SEO, avec validation humaine.",
          { domain: 'Retail', process: 'PIM / contenu produit' }
        ),
      },

      // Admin workspace
      {
        id: 'e2e-uc-admin-1',
        workspaceId: E2E_WS_ADMIN,
        folderId: 'e2e-folder-admin',
        organizationId: 'e2e-organization-admin-bombardier',
        status: 'completed',
        model: 'gpt-4.1-nano',
        createdAt: now,
        data: mkUseCaseData(
          'Maintenance prédictive flotte',
          "Exploiter télémétrie et historiques MRO pour anticiper pannes et optimiser la disponibilité.",
          { domain: 'Aéronautique', process: 'MRO / maintenance' }
        ),
      },
    ] as const;

    // Insérer les cas d'usage de test
    for (const useCase of testUseCasesData) {
      await db.insert(useCases).values(useCase).onConflictDoNothing();
      console.log(`✅ Use Case: ${(useCase as any).data?.name ?? useCase.id} (${useCase.status})`);
    }

    // 4. Settings: matrice par défaut
    const defaultMatrix = {
      key: 'default-matrix',
      value: JSON.stringify({
        name: 'Matrice par défaut',
        description: 'Configuration de matrice pour les tests E2E',
        valueAxes: testMatrix.default.valueAxes,
        complexityAxes: testMatrix.default.complexityAxes,
        valueThresholds: JSON.parse(matrixConfig).valueThresholds,
        complexityThresholds: JSON.parse(matrixConfig).complexityThresholds,
      }),
      description: 'Configuration de matrice pour les tests E2E',
      updatedAt: now,
    };

    await db.insert(settings).values(defaultMatrix).onConflictDoNothing();
    console.log(`✅ Setting: ${defaultMatrix.key}`);

    console.log('\n🎉 Test data seeded successfully!');
    console.log('\n📊 Summary:');
    console.log(`- Organizations: ${testOrganizationsData.length}`);
    console.log(`- Folders: ${testFolders.length}`);
    console.log(`- Use Cases: ${testUseCasesData.length}`);
    console.log(`- Matrix: 1`);
    console.log(`- Workspaces: 4`);
    console.log(`- Users: 5`);

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
