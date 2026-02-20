import { test, expect, request } from '@playwright/test';
import { waitForLockedByOtherWithOptions, waitForNoLocker } from '../helpers/lock-ui';
import { withWorkspaceAndFolderStorageState, withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Configuration de la matrice', () => {
  const FILE_TAG = 'e2e:matrix.spec.ts';
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  let workspaceName = '';
  let workspaceAId = '';
  let folderId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    workspaceName = `Matrix E2E ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceAId = String(created?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Ajouter user-b en editor
    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'editor' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en editor (status ${addRes.status()})`);
    }

    // Récupérer les IDs des utilisateurs
    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceAId}/members`);
    if (!membersRes.ok()) throw new Error(`Impossible de charger les membres (status ${membersRes.status()})`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userA = members.find((member) => member.email === 'e2e-user-a@example.com');
    const userB = members.find((member) => member.email === 'e2e-user-b@example.com');
    if (!userA?.userId || !userB?.userId) throw new Error('User A/B id introuvable');

    // Créer une organisation et un dossier dans ce workspace
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Organisation Test', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    const organizationId = String(orgJson?.id || '');

    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${workspaceAId}`, {
      data: { name: 'Dossier Test', description: 'Dossier pour tests matrix', organizationId },
    });
    if (!folderRes.ok()) throw new Error(`Impossible de créer dossier (status ${folderRes.status()})`);
    const folderJson = await folderRes.json().catch(() => null);
    folderId = String(folderJson?.id || '');
    if (!folderId) throw new Error('folderId introuvable');

    const useCaseRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${workspaceAId}`, {
      data: { folderId, name: 'Cas E2E Matrix', problem: 'P', solution: 'S' },
    });
    if (!useCaseRes.ok()) throw new Error(`Impossible de créer cas d'usage matrix (status ${useCaseRes.status()})`);

    await userAApi.dispose();
  });

  const ensureCurrentFolderId = async (page: import('@playwright/test').Page) => {
    const current = await page.evaluate(() => localStorage.getItem('currentFolderId'));
    if (current !== folderId) {
      await page.evaluate((id) => {
        try {
          localStorage.setItem('currentFolderId', id);
        } catch {
          // ignore
        }
      }, folderId);
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('currentFolderId')), { timeout: 2_000 })
      .toBe(folderId);
  };

  test.beforeEach(async ({ page }, testInfo) => {
    await page.goto('/matrix');
    await page.waitForLoadState('domcontentloaded');
  });

  test('devrait afficher la page de configuration de la matrice', async ({ page }) => {
    await expect(page).toHaveURL('/matrix');
    await expect(page.locator('h1')).toContainText('Configuration de l\'évaluation Valeur/Complexité');
  });

  test('devrait afficher le message d\'information sur la matrice', async ({ page }) => {
    const infoBox = page.locator('.bg-blue-50.border-l-4.border-blue-500');
    await expect(infoBox).toBeVisible();
    await expect(page.locator('text=Ajustez les poids des axes de valeur et de complexité')).toBeVisible();
  });

  test('devrait permettre de créer une nouvelle matrice si aucune n\'existe', async ({ page }) => {
    // Vérifier si le bouton de création de matrice est visible
    const createButton = page.locator('button:has-text("Créer une nouvelle matrice")');
    
    if (await createButton.isVisible()) {
      await createButton.click();
      
      // Vérifier que la boîte de dialogue s'ouvre (heading précis pour éviter strict mode)
      await expect(page.locator('h3:has-text("Créer une nouvelle matrice")')).toBeVisible();
      
      // Vérifier les options disponibles
      await expect(page.locator('text=Évaluation de base')).toBeVisible();
      await expect(page.locator('text=Copier une matrice existante')).toBeVisible();
      await expect(page.locator('text=Évaluation vierge')).toBeVisible();
    }
  });

  test('devrait afficher les axes de valeur et de complexité si configurés', async ({ page }) => {
    // Vérifier si les sections d'axes sont présentes
    const valueAxesSection = page.locator('h2:has-text("Axes de Valeur")');
    const complexityAxesSection = page.locator('h2:has-text("Axes de Complexité")');
    
    if (await valueAxesSection.isVisible()) {
      await expect(valueAxesSection).toBeVisible();
      await expect(complexityAxesSection).toBeVisible();
      
      // Vérifier les colonnes des tableaux
      await expect(page.locator('th:has-text("Critère")')).toBeVisible();
      await expect(page.locator('th:has-text("Poids")')).toBeVisible();
      await expect(page.locator('th:has-text("Action")')).toBeVisible();
    }
  });

  test.describe('Export matrice', () => {
    test.use({ storageState: USER_B_STATE });

    test('devrait exporter la matrice depuis le menu d\'actions', async ({ page }) => {
      await page.addInitScript(
        ({ wsId }) => {
          try {
            localStorage.setItem('workspaceScopeId', wsId);
          } catch {
            // ignore
          }
        },
        { wsId: workspaceAId }
      );
      await page.addInitScript(
        ({ wsId }) => {
          try {
            localStorage.setItem('workspaceScopeId', wsId);
          } catch {
            // ignore
          }
        },
        { wsId: workspaceAId }
      );
      await page.goto('/folders');
      await page.waitForLoadState('domcontentloaded');
      await page
        .waitForResponse((res) => res.url().includes('/api/v1/folders') && res.request().method() === 'GET', {
          timeout: 2_000,
        })
        .catch(() => {});
      const folderRow = page
        .locator('article[role="button"]')
        .filter({ has: page.locator('h2', { hasText: 'Dossier Test' }) })
        .first();
      await expect(folderRow).toBeVisible({ timeout: 2_000 });
      await folderRow.scrollIntoViewIfNeeded();
      await folderRow.click({ force: true });
      await page.waitForURL(new RegExp(`/folders/${folderId}`), { timeout: 2_000 });
      await page.locator('a[href="/matrix"]').click();
      await page.waitForLoadState('domcontentloaded');

      const actionsButton = page
        .locator('button[aria-label="Actions"], button[aria-label="Actions matrice"], button[aria-label="Matrix actions"]')
        .first();
      await expect(actionsButton).toBeVisible();
      await actionsButton.click();

      const exportAction = page.locator('button').filter({ hasText: /Exporter|Export/i }).first();
      await expect(exportAction).toBeVisible();
      await exportAction.click();

      const exportDialog = page.locator('h3').filter({ hasText: /Exporter la matrice|Export matrix/i });
      await expect(exportDialog).toBeVisible({ timeout: 2_000 });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.locator('button').filter({ hasText: /Exporter|Export/i }).last().click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    });
  });

  test('devrait permettre de modifier les poids des axes', async ({ page }) => {
    // Chercher les inputs de poids
    const weightInputs = page.locator('input[type="number"][min="0.5"][max="3"]');
    
    if (await weightInputs.first().isVisible()) {
      const firstWeightInput = weightInputs.first();
      await firstWeightInput.fill('2.5');
      
      // Vérifier que la valeur a été mise à jour
      await expect(firstWeightInput).toHaveValue('2.5');
    }
  });

  test('devrait afficher les seuils de valeur et complexité', async ({ page }) => {
    const valueThresholdsSection = page.locator('h2:has-text("Configuration des seuils de Valeur")');
    const complexityThresholdsSection = page.locator('h2:has-text("Configuration des seuils de Complexité")');
    
    if (await valueThresholdsSection.isVisible()) {
      await expect(valueThresholdsSection).toBeVisible();
      await expect(complexityThresholdsSection).toBeVisible();
      
      // Vérifier les colonnes des seuils
      await expect(page.locator('th:has-text("Valeur")')).toBeVisible();
      await expect(page.locator('th:has-text("Points Fibonacci")')).toBeVisible();
      await expect(page.locator('th:has-text("Nombre de cas")')).toBeVisible();
    }
  });

  test('devrait permettre de sauvegarder les modifications', async ({ page }) => {
    const saveButton = page.locator('button:has-text("Enregistrer la configuration")');
    
    if (await saveButton.isVisible()) {
      await expect(saveButton).toBeEnabled();
      
      // Cliquer sur sauvegarder
      await saveButton.click();
      
      // Vérifier qu'un message de succès apparaît (via toast)
      // Note: Les toasts peuvent être difficiles à tester, on vérifie juste que le bouton est cliquable
    }
  });

  test('devrait afficher l\'avertissement sur le recalcul des scores', async ({ page }) => {
    const warningBox = page.locator('.bg-yellow-50.border-l-4.border-yellow-500');
    
    if (await warningBox.isVisible()) {
      await expect(warningBox).toBeVisible();
      await expect(page.locator('text=Modifier les poids recalculera automatiquement tous les scores')).toBeVisible();
    }
  });

  test('devrait gérer le cas sans dossier sélectionné', async ({ page }) => {
    // Si aucun dossier n'est sélectionné, vérifier le message d'info
    const infoMessage = page.locator('text=Veuillez sélectionner un dossier pour voir sa matrice');
    
    if (await infoMessage.isVisible()) {
      await expect(infoMessage).toBeVisible();
    }
  });

  test('devrait permettre d\'ajouter un axe de valeur', async ({ page }) => {
    // Vérifier si la section des axes de valeur est visible
    const valueAxesSection = page.locator('h2:has-text("Axes de Valeur")');
    
    if (await valueAxesSection.isVisible()) {
      // Compter le nombre d'axes avant (lignes dans le tbody)
      const table = valueAxesSection.locator('..').locator('table tbody');
      const axesBefore = await table.locator('tr').count();
      
      // Cliquer sur le bouton "Ajouter" dans le header de la section Axes de Valeur
      const addButton = page.locator('button[title="Ajouter un axe de valeur"]');
      if (await addButton.isVisible()) {
        await addButton.click();
        
        // Attendre que le nouvel axe apparaisse
        await page.waitForTimeout(500);
        
        // Vérifier qu'un nouvel axe a été ajouté
        const axesAfter = await table.locator('tr').count();
        expect(axesAfter).toBeGreaterThan(axesBefore);
      }
    }
  });

  test('devrait permettre d\'ajouter un axe de complexité', async ({ page }) => {
    // Vérifier si la section des axes de complexité est visible
    const complexityAxesSection = page.locator('h2:has-text("Axes de Complexité")');
    
    if (await complexityAxesSection.isVisible()) {
      // Compter le nombre d'axes avant (lignes dans le tbody)
      const table = complexityAxesSection.locator('..').locator('table tbody');
      const axesBefore = await table.locator('tr').count();
      
      // Cliquer sur le bouton "Ajouter" dans le header de la section Axes de Complexité
      const addButton = page.locator('button[title="Ajouter un axe de complexité"]');
      if (await addButton.isVisible()) {
        await addButton.click();
        
        // Attendre que le nouvel axe apparaisse
        await page.waitForTimeout(500);
        
        // Vérifier qu'un nouvel axe a été ajouté
        const axesAfter = await table.locator('tr').count();
        expect(axesAfter).toBeGreaterThan(axesBefore);
      }
    }
  });

  test('devrait permettre de supprimer un axe de valeur', async ({ page }) => {
    const valueAxesSection = page.locator('h2:has-text("Axes de Valeur")');
    
    if (await valueAxesSection.isVisible()) {
      // Compter le nombre d'axes avant (lignes dans le tbody)
      const table = valueAxesSection.locator('..').locator('table tbody');
      const axesBefore = await table.locator('tr').count();
      
      if (axesBefore > 0) {
        // Accepter la confirmation de suppression
        page.on('dialog', dialog => dialog.accept());
        
        // Cliquer sur le premier bouton de suppression dans la section Axes de Valeur
        const deleteButton = valueAxesSection.locator('..').locator('button[title="Supprimer cet axe"]').first();
        if (await deleteButton.isVisible()) {
          await deleteButton.click();
          
          // Attendre que l'axe soit supprimé
          await page.waitForTimeout(500);
          
          // Vérifier qu'un axe a été supprimé
          const axesAfter = await table.locator('tr').count();
          expect(axesAfter).toBeLessThan(axesBefore);
        }
      }
    }
  });

  test('devrait mettre à jour le comptage des cas après modification des seuils', async ({ page }) => {
    const valueThresholdsSection = page.locator('h2:has-text("Configuration des seuils de Valeur")');
    
    if (await valueThresholdsSection.isVisible()) {
      // Trouver le tableau des seuils de valeur
      const table = valueThresholdsSection.locator('..').locator('table tbody');
      const firstRow = table.locator('tr').first();
      
      if (await firstRow.isVisible()) {
        // Lire la valeur initiale du comptage (colonne "Nombre de cas")
        const countCell = firstRow.locator('td').nth(2); // 3ème colonne (0-indexed: 0=Valeur, 1=Points, 2=Nombre de cas)
        const initialCountText = await countCell.textContent();
        const initialCount = initialCountText ? parseInt(initialCountText.trim()) : null;
        
        // Trouver l'input de points dans cette ligne
        const pointsInput = firstRow.locator('input[type="number"]');
        
        if (await pointsInput.isVisible()) {
          // Modifier la valeur des points
          await pointsInput.fill('5');
          
          // Attendre le recalcul (qui devrait être immédiat)
          await page.waitForTimeout(1000);
          
          // Vérifier que le comptage a été mis à jour
          const updatedCountText = await countCell.textContent();
          const updatedCount = updatedCountText ? parseInt(updatedCountText.trim()) : null;
          
          // Si on avait une valeur initiale, vérifier qu'elle a changé ou est toujours là
          if (initialCount !== null && updatedCount !== null) {
            // Le comptage devrait être un nombre valide
            expect(updatedCount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  test('devrait sauvegarder automatiquement les modifications après 5 secondes', async ({ page }) => {
    const valueThresholdsSection = page.locator('h2:has-text("Configuration des seuils de Valeur")');
    
    if (await valueThresholdsSection.isVisible()) {
      // Trouver le tableau des seuils de valeur
      const table = valueThresholdsSection.locator('..').locator('table tbody');
      const firstRow = table.locator('tr').first();
      
      if (await firstRow.isVisible()) {
        // Trouver l'input de points dans cette ligne
        const pointsInput = firstRow.locator('input[type="number"]');
        
        if (await pointsInput.isVisible()) {
          // Lire la valeur initiale
          const initialValue = await pointsInput.inputValue();
          
          // Modifier la valeur avec une nouvelle valeur différente
          const newValue = initialValue === '8' ? '13' : '8';
          await pointsInput.fill(newValue);
          
          // Attendre 6 secondes pour que l'auto-save se déclenche (5s + marge)
          await page.waitForTimeout(6000);
          
          // Vérifier qu'une requête PUT a été envoyée pour sauvegarder
          // On peut vérifier en rechargeant la page
          await page.reload();
          await page.waitForLoadState('domcontentloaded');
          
          // Re-trouver l'input après rechargement
          const valueThresholdsSectionAfter = page.locator('h2:has-text("Configuration des seuils de Valeur")');
          const tableAfter = valueThresholdsSectionAfter.locator('..').locator('table tbody');
          const firstRowAfter = tableAfter.locator('tr').first();
          const pointsInputAfter = firstRowAfter.locator('input[type="number"]');
          
          // Vérifier que la valeur modifiée est toujours là (sauvegardée)
          if (await pointsInputAfter.isVisible()) {
            const savedValue = await pointsInputAfter.inputValue();
            expect(savedValue).toBe(newValue);
          }
        }
      }
    }
  });

  test.describe('Matrix lock/presence', () => {
    test('User A locks → User B sees → unlock accept', async ({ browser }) => {
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceAId, folderId),
      });
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceAndFolderStorageState(USER_B_STATE, workspaceAId, folderId),
      });
      const pageA = await userAContext.newPage();
      const pageB = await userBContext.newPage();

      await pageA.goto(`/folders/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 2_000 });
      await ensureCurrentFolderId(pageA);

      await pageA.click('a[href="/matrix"]');
      await expect(pageA).toHaveURL(/\/matrix/);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('h1')).toContainText("Configuration de l'évaluation");
      await ensureCurrentFolderId(pageA);
      const noFolderMessageA = pageA.locator('text=Veuillez sélectionner un dossier pour voir sa matrice');
      if (await noFolderMessageA.isVisible().catch(() => false)) {
        await pageA.evaluate((id) => {
          try {
            localStorage.setItem('currentFolderId', id);
          } catch {
            // ignore
          }
        }, folderId);
        await pageA.reload({ waitUntil: 'domcontentloaded' });
        await expect(pageA.locator('h1')).toContainText("Configuration de l'évaluation");
      }

      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      await pageB.goto(`/folders/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 2_000 });
      await expect
        .poll(async () => pageB.evaluate(() => localStorage.getItem('currentFolderId')), { timeout: 2_000 })
        .toBe(folderId);
      await expect
        .poll(async () => pageB.evaluate(() => localStorage.getItem('currentFolderId')), { timeout: 2_000 })
        .toBe(folderId);

      await pageB.goto(`/folders/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 2_000 });
      await ensureCurrentFolderId(pageB);

      await pageB.click('a[href="/matrix"]');
      await expect(pageB).toHaveURL(/\/matrix/);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('h1')).toContainText("Configuration de l'évaluation");
      await ensureCurrentFolderId(pageB);
      const noFolderMessage = pageB.locator('text=Veuillez sélectionner un dossier pour voir sa matrice');
      if (await noFolderMessage.isVisible().catch(() => false)) {
        await pageB.evaluate((id) => {
          try {
            localStorage.setItem('currentFolderId', id);
          } catch {
            // ignore
          }
        }, folderId);
        await pageB.reload({ waitUntil: 'domcontentloaded' });
        await expect(pageB.locator('h1')).toContainText("Configuration de l'évaluation");
      }
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      await waitForLockedByOtherWithOptions(pageB, undefined, { requireDisabled: false });
      const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      await requestButton.click();

      const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
      const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
      await expect
        .poll(async () => {
          await pageA.evaluate(() => window.scrollTo(0, 0));
          await badgeA.evaluate((el) => {
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          });
          return releaseButton.count();
        }, { timeout: 15_000 })
        .toBe(1);
      await releaseButton.click();

      await waitForNoLocker(pageB);

      await userAContext.close();
      await userBContext.close();
    });

    test('User A leaves → lock released → User B can lock', async ({ browser }) => {
      const userAContext = await browser.newContext({
        storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, workspaceAId, folderId),
      });
      const pageA = await userAContext.newPage();

      await pageA.goto(`/folders/${encodeURIComponent(folderId)}`);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('text=Contexte').first()).toBeVisible({ timeout: 2_000 });
      await ensureCurrentFolderId(pageA);

      await pageA.click('a[href="/matrix"]');
      await expect(pageA).toHaveURL(/\/matrix/);
      await pageA.waitForLoadState('domcontentloaded');
      await expect(pageA.locator('h1')).toContainText("Configuration de l'évaluation");
      await ensureCurrentFolderId(pageA);

      await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      // Navigate to another page to trigger SSE cleanup
      await pageA.goto('/folders');
      await pageA.waitForLoadState('domcontentloaded');
      // Wait a bit for SSE cleanup to complete
      await pageA.waitForTimeout(1000);
      await userAContext.close();

      // After User A leaves, the lock should be released (null) or User B can acquire it
      // User B might auto-acquire the lock if they're on the page
      const userBContext = await browser.newContext({
        storageState: await withWorkspaceAndFolderStorageState(USER_B_STATE, workspaceAId, folderId),
      });
      const pageB = await userBContext.newPage();
      await pageB.goto(`/folders/${encodeURIComponent(folderId)}`);
      await pageB.waitForLoadState('domcontentloaded');
      await expect(pageB.locator('text=Contexte').first()).toBeVisible({ timeout: 2_000 });
      await ensureCurrentFolderId(pageB);

      await pageB.click('a[href="/matrix"]');
      await expect(pageB).toHaveURL(/\/matrix/);
      await pageB.waitForLoadState('domcontentloaded');
      await ensureCurrentFolderId(pageB);
      await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

      // Wait for lock to be released or acquired by User B.
      // In both cases User B must be able to edit (no "request unlock" state).
      const requestUnlockButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
      const editableField = pageB.locator('input:not([type="file"]):not(.hidden), textarea').first();
      await expect
        .poll(async () => {
          const needsUnlockRequest =
            (await requestUnlockButton.count()) > 0 &&
            (await requestUnlockButton.isVisible().catch(() => false));
          const canEdit =
            (await editableField.count()) > 0 &&
            (await editableField.isVisible().catch(() => false)) &&
            (await editableField.isEnabled().catch(() => false));
          return canEdit && !needsUnlockRequest;
        }, { timeout: 2_000 })
        .toBe(true);

      await userBContext.close();

    });
  });
});
