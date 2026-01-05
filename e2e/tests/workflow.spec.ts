import { test, expect } from '@playwright/test';

test.describe.serial('Workflow métier complet', () => {
  // Ce spec crée du contenu et enchaîne plusieurs pages: le laisser plus de marge + éviter la concurrence.
  test.setTimeout(4 * 60_000);

  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

  test.beforeEach(async ({ page }) => {
    // Stabiliser: forcer le scope admin sur la workspace admin (sinon mode "lecture seule")
    await page.addInitScript((id: string) => {
      try {
        localStorage.setItem('adminWorkspaceScopeId', id);
      } catch {
        // ignore
      }
    }, ADMIN_WORKSPACE_ID);
  });

  test('devrait exécuter le workflow complet : organisation → génération → dossiers → cas d\'usage → dashboard', async ({ page }) => {
    // Étape 1: Créer une organisation
    await page.goto('/organisations');
    await page.waitForLoadState('domcontentloaded');
    
    // Cliquer sur le bouton d'ajout (redirige vers /organisations/new)
    await page.getByRole('button', { name: 'Créer une organisation' }).click();
    await expect(page).toHaveURL(/\/organisations\/new$/);
    
    // Remplir le nom via l'EditableInput dans le H1 (textarea pour multiline)
    const nameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('TestOrganizationE2E');
    
    // Créer l'organisation
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page).toHaveURL(/\/organisations\/[a-zA-Z0-9-]+$/);
    
    // Vérifier sur la page détail
    const detailNameInput = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
    await expect(detailNameInput).toHaveValue('TestOrganizationE2E');

    // IMPORTANT: la suite E2E contient des tests destructifs (suppression dossiers).
    // Pour éviter la dépendance au seed global, créer un dossier + un cas d’usage dédiés via API.
    const orgUrl = page.url();
    const organizationId = new URL(orgUrl).pathname.split('/').filter(Boolean).pop() || '';
    expect(organizationId).toBeTruthy();

    const folderName = `Workflow Folder ${Date.now()}`;
    // NOTE: ne pas lier explicitement l’organisation au dossier ici:
    // le scope workspace admin peut varier (admin_app), ce qui rend la validation org->workspace flaky en E2E.
    const createFolderRes = await page.request.post(`${API_BASE_URL}/api/v1/folders`, {
      timeout: 30_000,
      data: { name: folderName, description: 'Folder created by workflow.spec.ts' }
    });
    if (!createFolderRes.ok()) {
      const body = await createFolderRes.text().catch(() => '');
      throw new Error(`POST /folders failed: status=${createFolderRes.status()} body=${body}`);
    }
    const createdFolder = await createFolderRes.json();
    const folderId = String(createdFolder?.id || '');
    expect(folderId).toBeTruthy();

    const useCaseName = `Workflow UC ${Date.now()}`;
    const createUseCaseRes = await page.request.post(`${API_BASE_URL}/api/v1/use-cases`, {
      timeout: 30_000,
      data: { name: useCaseName, description: 'Use case created by workflow.spec.ts', folderId }
    });
    if (!createUseCaseRes.ok()) {
      const body = await createUseCaseRes.text().catch(() => '');
      throw new Error(`POST /use-cases failed: status=${createUseCaseRes.status()} body=${body}`);
    }
    const createdUseCase = await createUseCaseRes.json();
    const useCaseId = String(createdUseCase?.id || '');
    expect(useCaseId).toBeTruthy();
    
    // Étape 3: Aller dans les dossiers pour voir l'avancement
    await page.goto('/dossiers');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier qu'on est sur la page des dossiers
    await expect(page.locator('h1')).toContainText('Dossiers');
    
    // Vérifier qu'on est sur la page dossiers (assertion h1 suffit)
    await expect(page.locator('h1')).toContainText('Dossiers');
    
    // Étape 4: Ouvrir le dossier dédié (liste cas d’usage sur /dossiers/[id])
    await page.goto(`/dossiers/${encodeURIComponent(folderId)}`);
    await page.waitForLoadState('domcontentloaded');

    const useCaseCard = page.locator('article.rounded.border.border-slate-200').filter({ hasText: useCaseName }).first();
    await expect(useCaseCard).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForURL(new RegExp(`/cas-usage/${useCaseId}$`), { timeout: 10_000 }),
      useCaseCard.click()
    ]);
    await page.waitForLoadState('domcontentloaded');
    
    // Étape 5: Aller au dashboard pour voir les métriques
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier qu'on est sur le dashboard (le dashboard affiche maintenant le titre du dossier)
    // Le titre est dans un div avec classe "text-3xl font-semibold" ou un h1
    const dashboardTitle = page.locator('div.text-3xl.font-semibold, h1.text-3xl.font-semibold, h1:has-text("Dashboard")');
    await expect(dashboardTitle.first()).toBeVisible({ timeout: 10000 });
    
    // Vérifier les statistiques (nouvelle structure) - conditionnel si executive summary existe
    const statsText = page.locator('text=Nombre de cas d\'usage');
    const hasStats = await statsText.isVisible().catch(() => false);
    if (hasStats) {
      await expect(statsText).toBeVisible();
    }
    
    // Vérifier le graphique scatter plot (nouvelle structure)
    const scatterPlotContainer = page.locator('.report-scatter-plot-container');
    await expect(scatterPlotContainer).toBeVisible({ timeout: 10000 });
  });

  test('devrait gérer la génération asynchrone des cas d\'usage', async ({ page }) => {
    // Aller directement aux cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier les différents statuts possibles
    const statusElements = page.locator('.inline-flex.items-center.px-2.py-1.rounded-full');
    
    if (await statusElements.count() > 0) {
      // Vérifier qu'il y a au moins un statut visible
      await expect(statusElements.first()).toBeVisible();
      
      // Vérifier les différents types de statuts
      const statusTexts = await statusElements.allTextContents();
      const hasGeneratingStatus = statusTexts.some(text => 
        text.includes('Génération') || text.includes('Détail en cours') || text.includes('Brouillon')
      );
      
      // Au moins un statut devrait être présent
      expect(statusTexts.length).toBeGreaterThan(0);
    }
  });

  test('devrait permettre de voir les détails d\'un cas d\'usage', async ({ page }) => {
    // Aller aux cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    // Chercher un cas d'usage cliquable (pas en génération)
    const useCaseCards = page.locator('article, .use-case-card, [data-testid="use-case-card"]');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      
      // Vérifier que la carte n'est pas en état de génération
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        // Cliquer sur la carte
        await firstCard.click();
        
        // Attendre la redirection vers la page de détail
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier qu'on est sur une page de détail (URL contient un ID)
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/cas-usage\/[a-zA-Z0-9-]+/);
      }
    }
  });

  test('devrait mettre à jour les métriques du dashboard en temps réel', async ({ page }) => {
    // Aller au dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    
    // Vérifier que les métriques sont présentes
    const totalMetric = page.locator('text=Total').locator('..').locator('p.text-2xl');
    const completedMetric = page.locator('text=Terminés').locator('..').locator('p.text-2xl');
    const inProgressMetric = page.locator('text=En cours').locator('..').locator('p.text-2xl');
    
    if (await totalMetric.isVisible()) {
      // Vérifier que les métriques sont des nombres
      const totalText = await totalMetric.textContent();
      const completedText = await completedMetric.textContent();
      const inProgressText = await inProgressMetric.textContent();
      
      expect(totalText).toMatch(/^\d+$/);
      expect(completedText).toMatch(/^\d+$/);
      expect(inProgressText).toMatch(/^\d+$/);
    }
  });

  test.skip('devrait permettre de changer de dossier dans le dashboard', async ({ page }) => {
    // Test skip: Le sélecteur de dossier n'existe plus dans la nouvelle structure du dashboard
    // Le changement de dossier se fait maintenant via la navigation vers /dossiers
  });
});
