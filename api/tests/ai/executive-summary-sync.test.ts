import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { createTestId, getTestModel } from '../utils/test-helpers';
import { db } from '../../src/db/client';
import { folders, useCases } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Executive Summary Generation - AI', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  // Helper function to create a test folder with use cases
  async function createTestFolderWithUseCases() {
    const folderId = createTestId();
    
    // Create folder
    await db.insert(folders).values({
      id: folderId,
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for executive summary',
      status: 'completed',
    });

    // Create use cases with scores
    const useCasesData = [
      { name: 'High Value Low Complexity', totalValueScore: 80, totalComplexityScore: 20 },
      { name: 'High Value High Complexity', totalValueScore: 75, totalComplexityScore: 70 },
      { name: 'Low Value Low Complexity', totalValueScore: 30, totalComplexityScore: 25 },
      { name: 'Low Value High Complexity', totalValueScore: 25, totalComplexityScore: 75 },
    ];

    for (const uc of useCasesData) {
      await db.insert(useCases).values({
        id: createTestId(),
        folderId,
        name: uc.name,
        description: `Description for ${uc.name}`,
        totalValueScore: uc.totalValueScore,
        totalComplexityScore: uc.totalComplexityScore,
        status: 'completed',
      });
    }

    return folderId;
  }

  describe('POST /analytics/executive-summary', () => {
    it('should generate executive summary with default medians', async () => {
      const folderId = await createTestFolderWithUseCases();

      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        {
          folder_id: folderId,
          model: getTestModel(), // Use test model (gpt-4.1-nano by default)
        }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.folder_id).toBe(folderId);
      expect(data.executive_summary).toBeDefined();
      expect(data.executive_summary).toHaveProperty('introduction');
      expect(data.executive_summary).toHaveProperty('analyse');
      expect(data.executive_summary).toHaveProperty('recommandation');
      expect(data.executive_summary).toHaveProperty('synthese_executive');
      expect(data.top_cases).toBeDefined();
      expect(Array.isArray(data.top_cases)).toBe(true);
      expect(data.thresholds).toBeDefined();
      expect(data.thresholds).toHaveProperty('value');
      expect(data.thresholds).toHaveProperty('complexity');
      expect(data.thresholds).toHaveProperty('median_value');
      expect(data.thresholds).toHaveProperty('median_complexity');

      // Verify stored in database
      const [folder] = await db.select({ executiveSummary: folders.executiveSummary })
        .from(folders)
        .where(eq(folders.id, folderId));
      
      expect(folder?.executiveSummary).toBeDefined();
      const stored = JSON.parse(folder!.executiveSummary);
      expect(stored).toHaveProperty('introduction');
      expect(stored).toHaveProperty('analyse');
      expect(stored).toHaveProperty('recommandation');
      expect(stored).toHaveProperty('synthese_executive');

      // Cleanup
      await db.delete(useCases).where(eq(useCases.folderId, folderId));
      await db.delete(folders).where(eq(folders.id, folderId));
    }, 45000); // 45 seconds timeout for AI generation

    it('should generate executive summary with custom thresholds', async () => {
      const folderId = await createTestFolderWithUseCases();

      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        {
          folder_id: folderId,
          value_threshold: 50,
          complexity_threshold: 40,
          model: getTestModel(), // Use test model (gpt-4.1-nano by default)
        }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.thresholds.value).toBe(50);
      expect(data.thresholds.complexity).toBe(40);
      expect(data.thresholds.median_value).toBeDefined();
      expect(data.thresholds.median_complexity).toBeDefined();

      // Cleanup
      await db.delete(useCases).where(eq(useCases.folderId, folderId));
      await db.delete(folders).where(eq(folders.id, folderId));
    }, 45000); // 45 seconds timeout for AI generation
  });
});

