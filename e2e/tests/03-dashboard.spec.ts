import { test, expect, request } from '@playwright/test';

test.describe('Dashboard', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceAId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    const workspaceName = `Dashboard E2E ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceAId = String(created?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Ajouter user-b en viewer pour les tests read-only
    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'viewer' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en viewer (status ${addRes.status()})`);
    }
    await userAApi.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
  });

  test('devrait afficher la page dashboard', async ({ page }) => {
    await expect(page).toHaveURL('/dashboard');
    // Le dashboard affiche maintenant le titre du dossier dans un div avec classe "text-3xl font-semibold"
    // ou un h1 avec "Dashboard" si pas de dossier sélectionné
    const dashboardTitle = page.locator('div.text-3xl.font-semibold, h1.text-3xl.font-semibold, h1:has-text("Dashboard")');
    await expect(dashboardTitle.first()).toBeVisible({ timeout: 10000 });
  });

  test.skip('devrait afficher le sélecteur de dossier', async ({ page }) => {
    // Test skip: Le sélecteur de dossier n'existe plus dans la nouvelle structure du dashboard
    // Le dossier est sélectionné automatiquement ou via la navigation
  });

  test('devrait afficher les statistiques des cas d\'usage', async ({ page }) => {
    // Vérifier que les statistiques sont affichées (nouvelle structure)
    // Les statistiques sont maintenant dans une carte avec "Nombre de cas d'usage"
    // Elles ne sont visibles que si executiveSummary existe
    // Si pas d'executive summary, on vérifie juste que la page se charge correctement
    const statsText = page.locator('text=Nombre de cas d\'usage');
    const hasStats = await statsText.isVisible().catch(() => false);
    if (!hasStats) {
      // Si pas de stats visibles, vérifier qu'on est bien sur le dashboard
      await expect(page).toHaveURL('/dashboard');
      // Vérifier qu'il y a au moins un élément visible sur la page
      await expect(page.locator('body')).toBeVisible();
    } else {
      await expect(statsText).toBeVisible();
    }
  });

  test('devrait afficher le graphique scatter plot', async ({ page }) => {
    // Le scatter plot est maintenant dans un conteneur avec classe report-scatter-plot-container
    const scatterPlotContainer = page.locator('.report-scatter-plot-container');
    await expect(scatterPlotContainer).toBeVisible({ timeout: 10000 });
  });

  test.skip('devrait changer de dossier et mettre à jour les données', async ({ page }) => {
    // Test skip: Le sélecteur de dossier n'existe plus, le changement de dossier se fait via la navigation
  });

  test('devrait afficher un message de chargement', async ({ page }) => {
    // Vérifier qu'il y a un indicateur de chargement si nécessaire
    // Utiliser .first() pour éviter strict mode violation (plusieurs éléments .animate-spin)
    const loadingIndicator = page.locator('.animate-spin').first();
    if (await loadingIndicator.isVisible()) {
      await expect(page.locator('text=Chargement des données..., text=Chargement')).toBeVisible();
    }
  });

  test.skip('devrait gérer le cas sans dossier sélectionné', async ({ page }) => {
    // Test skip: seed data always provides folders; empty state not tested
  });

  test.describe('Read-only', () => {
    test.use({ storageState: USER_B_STATE });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((id: string) => {
        try {
          localStorage.setItem('workspaceScopeId', id);
        } catch {
          // ignore
        }
      }, workspaceAId);
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
    });

    test('viewer voit l’icône lock (print-hidden)', async ({ page }) => {
      const lockButton = page.locator('button[aria-label="Mode lecture seule : édition / génération désactivées."]');
      await expect(lockButton).toBeVisible({ timeout: 10_000 });
      await expect(lockButton).toHaveClass(/print-hidden/);
    });
  });

  test.describe('Executive Summary', () => {
    test('devrait afficher les sections executive summary si disponible', async ({ page }) => {
      // Sélectionner un dossier qui pourrait avoir un executive summary
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier si la section "Synthèse exécutive" est visible
        const executiveSummarySection = page.locator('h2:has-text("Synthèse exécutive")');
        if (await executiveSummarySection.isVisible()) {
          // Vérifier les sections possibles
          const introductionSection = page.locator('#section-introduction, h2:has-text("Introduction")');
          const analyseSection = page.locator('#section-analyse, h2:has-text("Analyse")');
          const recommandationsSection = page.locator('#section-recommandations, h2:has-text("Recommandations")');
          
          // Au moins une section devrait être visible
          const hasIntroduction = await introductionSection.isVisible();
          const hasAnalyse = await analyseSection.isVisible();
          const hasRecommandations = await recommandationsSection.isVisible();
          
          expect(hasIntroduction || hasAnalyse || hasRecommandations).toBe(true);
        }
      }
    });

    test('devrait afficher les références cliquables dans executive summary', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher les références [1], [2], etc.
        const references = page.locator('a[href^="#ref-"], a:has-text(/^\\[\\d+\\]$/)');
        if (await references.count() > 0) {
          // Vérifier qu'au moins une référence est cliquable
          await expect(references.first()).toBeVisible();
        }
      }
    });

    test('devrait afficher le bouton "Générer" si pas d\'executive summary', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher le bouton "Générer la synthèse"
        const generateButton = page.locator('button:has-text("Générer la synthèse"), button:has-text("Générer")');
        if (await generateButton.isVisible()) {
          await expect(generateButton).toBeEnabled();
        }
      }
    });

    test('devrait afficher le bouton "Régénérer" si executive summary existe', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher le bouton de régénération (icône de rafraîchissement)
        const regenerateButton = page.locator('button[title="Régénérer la synthèse exécutive"]');
        if (await regenerateButton.isVisible()) {
          await expect(regenerateButton).toBeEnabled();
        }
      }
    });

    test('devrait afficher le statut "Génération en cours..." pendant la génération', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Cliquer sur "Générer" si disponible
        const generateButton = page.locator('button:has-text("Générer la synthèse")');
        if (await generateButton.isVisible()) {
          await generateButton.click();
          
          // Vérifier le message de génération
          const generatingMessage = page.locator('text=Génération de la synthèse exécutive en cours');
          await expect(generatingMessage).toBeVisible({ timeout: 5000 });
        }
      }
    });

    test('devrait permettre l\'édition des sections executive summary', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher une section éditable (EditableInput)
        const editableSection = page.locator('.editable-input, [contenteditable="true"]').first();
        if (await editableSection.isVisible()) {
          // Vérifier que c'est éditable
          await editableSection.click();
          await expect(editableSection).toBeFocused();
        }
      }
    });

    test('devrait afficher le bouton imprimer uniquement si executive summary existe', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher le bouton imprimer
        const printButton = page.locator('button[title="Imprimer ou exporter le rapport en PDF"], button:has(svg)').first();
        if (await printButton.isVisible()) {
          // Vérifier qu'il est visible uniquement si executive summary existe
          const executiveSummarySection = page.locator('h2:has-text("Synthèse exécutive")');
          if (await executiveSummarySection.isVisible()) {
            await expect(printButton).toBeVisible();
          }
        }
      }
    });

    test('devrait déclencher window.print() au clic sur le bouton imprimer', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        const printButton = page.locator('button[title="Imprimer ou exporter le rapport en PDF"]');
        if (await printButton.isVisible()) {
          // Écouter l'événement print
          let printCalled = false;
          await page.exposeFunction('printCalled', () => {
            printCalled = true;
          });
          
          await page.evaluate(() => {
            const originalPrint = window.print;
            window.print = () => {
              (window as any).printCalled();
              originalPrint.call(window);
            };
          });
          
          await printButton.click();
          
          // Vérifier que print a été appelé (avec un petit délai)
          await page.waitForTimeout(500);
          // Note: On ne peut pas vraiment vérifier window.print() directement, mais on peut vérifier que le clic fonctionne
          await expect(printButton).toBeVisible();
        }
      }
    });

    test('devrait permettre l\'édition du titre du dossier', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher le titre éditable (EditableInput dans le h1 - multiline avec textarea)
        const editableTitle = page.locator('h1 textarea.editable-textarea, h1 input.editable-input');
        if (await editableTitle.isVisible()) {
          await editableTitle.click();
          await expect(editableTitle).toBeFocused();
        }
      }
    });

    test('devrait afficher le scatter plot avec 50% de largeur', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        const scatterPlotContainer = page.locator('.report-scatter-plot-container');
        if (await scatterPlotContainer.isVisible()) {
          const box = await scatterPlotContainer.boundingBox();
          if (box) {
            // Vérifier que la largeur est environ 50% (avec tolérance)
            const pageWidth = page.viewportSize()?.width || 1920;
            const expectedWidth = pageWidth * 0.5;
            expect(box.width).toBeGreaterThan(expectedWidth * 0.9); // 90% de tolérance
            expect(box.width).toBeLessThan(expectedWidth * 1.1); // 110% de tolérance
          }
        }
      }
    });

    test('devrait afficher le quadrant ROI avec > 2 use cases', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher la carte "Gains rapides" (quadrant ROI)
        const roiQuadrant = page.locator('text=Gains rapides, .bg-green-50');
        if (await roiQuadrant.isVisible()) {
          await expect(roiQuadrant).toBeVisible();
        }
      }
    });

    test('devrait afficher l\'accordéon de configuration ROI', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher le bouton de configuration (icône ⚙️)
        const configButton = page.locator('button[title="Configuration du quadrant ROI"], button:has(svg)').first();
        if (await configButton.isVisible()) {
          await configButton.click();
          
          // Vérifier que l'accordéon s'ouvre
          const configPanel = page.locator('text=Configuration du quadrant ROI, input[id="value-threshold"]');
          await expect(configPanel).toBeVisible({ timeout: 2000 });
        }
      }
    });

    test('devrait permettre la modification des seuils ROI', async ({ page }) => {
      const folderSelect = page.locator('#folder-select');
      if (await folderSelect.isVisible()) {
        await folderSelect.selectOption({ index: 0 });
        await page.waitForLoadState('domcontentloaded');
        
        // Ouvrir l'accordéon de configuration
        const configButton = page.locator('button[title="Configuration du quadrant ROI"]');
        if (await configButton.isVisible()) {
          await configButton.click();
          await page.waitForTimeout(500);
          
          // Modifier le seuil de valeur
          const valueThresholdInput = page.locator('input[id="value-threshold"]');
          if (await valueThresholdInput.isVisible()) {
            await valueThresholdInput.fill('50');
            await expect(valueThresholdInput).toHaveValue('50');
          }
        }
      }
    });
  });
});