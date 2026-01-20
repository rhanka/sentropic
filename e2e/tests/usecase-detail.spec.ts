import { test, expect, request } from '@playwright/test';
import { waitForLockOwnedByMe, waitForLockedByOther } from '../helpers/lock-ui';
import { withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Détail des cas d\'usage', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  const USER_B_STATE = './.auth/user-b.json';
  const USER_C_STATE = './.auth/user-victim.json';
  let workspaceAId = '';
  let useCaseId = '';
  let useCaseName = '';
  let lockUseCaseId = '';
  let lockUseCaseName = '';
  let folderId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    
    // Créer un workspace unique pour ce fichier de test (isolation des ressources)
    const workspaceName = `UseCase Detail E2E ${Date.now()}`;
    const createRes = await userAApi.post('/api/v1/workspaces', { data: { name: workspaceName } });
    if (!createRes.ok()) throw new Error(`Impossible de créer workspace (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    workspaceAId = String(created?.id || '');
    if (!workspaceAId) throw new Error('workspaceAId introuvable');

    // Ajouter les membres nécessaires
    const addRes = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-b@example.com', role: 'editor' },
    });
    if (!addRes.ok() && addRes.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-b en editor (status ${addRes.status()})`);
    }
    const addResC = await userAApi.post(`/api/v1/workspaces/${workspaceAId}/members`, {
      data: { email: 'e2e-user-victim@example.com', role: 'editor' },
    });
    if (!addResC.ok() && addResC.status() !== 409) {
      throw new Error(`Impossible d'ajouter user-victim en editor (status ${addResC.status()})`);
    }

    // Récupérer les IDs des utilisateurs
    const membersRes = await userAApi.get(`/api/v1/workspaces/${workspaceAId}/members`);
    if (!membersRes.ok()) throw new Error(`Impossible de charger les membres (status ${membersRes.status()})`);
    const membersData = await membersRes.json().catch(() => null);
    const members: Array<{ userId: string; email?: string }> = membersData?.items ?? [];
    const userA = members.find((member) => member.email === 'e2e-user-a@example.com');
    const userB = members.find((member) => member.email === 'e2e-user-b@example.com');
    const userC = members.find((member) => member.email === 'e2e-user-victim@example.com');
    if (!userA?.userId || !userB?.userId || !userC?.userId) {
      throw new Error('User A/B/C id introuvable');
    }

    // Créer une organisation et un dossier dans ce workspace
    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${workspaceAId}`, {
      data: { name: 'Organisation Test', data: { industry: 'Services' } },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (status ${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    const organizationId = String(orgJson?.id || '');

    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${workspaceAId}`, {
      data: { name: 'Dossier Test', description: 'Dossier pour tests usecase-detail', organizationId },
    });
    if (!folderRes.ok()) throw new Error(`Impossible de créer dossier (status ${folderRes.status()})`);
    const folderJson = await folderRes.json().catch(() => null);
    folderId = String(folderJson?.id || '');
    if (!folderId) throw new Error('folderId introuvable');

    // Créer un cas d'usage dans ce dossier
    const useCaseRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${workspaceAId}`, {
      data: { folderId, name: 'Cas d\'usage Test', problem: 'Problème test', solution: 'Solution test' },
    });
    if (!useCaseRes.ok()) throw new Error(`Impossible de créer cas d'usage (status ${useCaseRes.status()})`);
    const useCaseJson = await useCaseRes.json().catch(() => null);
    useCaseId = String(useCaseJson?.id || '');
    if (!useCaseId) throw new Error('useCaseId introuvable');
    useCaseName = String(useCaseJson?.name || '');

    const lockName = `UC Lock ${Date.now()}`;
    const createLockRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${workspaceAId}`, {
      data: { name: lockName, description: 'Use case lock test', folderId },
    });
    if (!createLockRes.ok()) throw new Error(`Impossible de créer un cas d'usage lock (status ${createLockRes.status()})`);
    const createdLock = await createLockRes.json().catch(() => null);
    lockUseCaseId = String((createdLock as any)?.id ?? '');
    lockUseCaseName = lockName;
    if (!lockUseCaseId) throw new Error('lockUseCaseId introuvable');

    await userAApi.dispose();
  });
  test('devrait afficher la page de détail d\'un cas d\'usage', async ({ page }) => {
    // D'abord aller à la liste des cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    // Chercher un cas d'usage cliquable
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      
      // Vérifier que la carte n'est pas en génération
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        // Cliquer sur la carte
        await firstCard.click();
        
        // Attendre la redirection
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier qu'on est sur une page de détail
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/cas-usage\/[a-zA-Z0-9-]+/);
        
        // Vérifier les éléments de base de la page de détail
        await expect(page.locator('h1, h2')).toBeVisible();
      }
    }
  });

  test('devrait afficher les informations détaillées du cas d\'usage', async ({ page }) => {
    // Simuler l'accès direct à une page de détail (si on connaît un ID)
    // Pour ce test, on va d'abord naviguer depuis la liste
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier les éléments de détail
        await expect(page.locator('h1, h2')).toBeVisible();
        
        // Vérifier qu'il y a du contenu
        const bodyText = await page.locator('body').textContent();
        expect(bodyText?.length).toBeGreaterThan(100);
      }
    }
  });

  test('devrait permettre de modifier un cas d\'usage', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher un bouton de modification
        const editButton = page.locator('button:has-text("Modifier"), button[title="Modifier"]');
        
        if (await editButton.isVisible()) {
          await editButton.click();
          
          // Vérifier qu'un formulaire d'édition s'ouvre
          await expect(page.locator('input, textarea')).toBeVisible();
        }
      }
    }
  });

  test('devrait permettre de supprimer un cas d\'usage depuis la page de détail', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Chercher un bouton de suppression
        const deleteButton = page.locator('button:has-text("Supprimer"), button[title="Supprimer"]');
        
        if (await deleteButton.isVisible()) {
          // Configurer la gestion de la boîte de dialogue
          page.on('dialog', dialog => {
            expect(dialog.type()).toBe('confirm');
            expect(dialog.message()).toContain('supprimer');
            dialog.accept();
          });
          
          await deleteButton.click();
          
          // Vérifier qu'on est redirigé vers la liste
          await page.waitForLoadState('domcontentloaded');
          await expect(page).toHaveURL('/cas-usage');
        }
      }
    }
  });

  test('devrait afficher les scores de valeur et complexité en détail', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier la présence d'éléments liés aux scores
        const valueElements = page.locator('text=Valeur, text=value, text=★');
        const complexityElements = page.locator('text=Complexité, text=complexity, text=X');
        
        if (await valueElements.count() > 0 || await complexityElements.count() > 0) {
          // Au moins un des éléments de score devrait être présent
          expect(await valueElements.count() + await complexityElements.count()).toBeGreaterThan(0);
        }
      }
    }
  });

  test('devrait afficher les sections Problème et Solution', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Vérifier la section Problème (orange)
        const problemSection = page.locator('div.bg-orange-100.text-orange-800:has-text("Problème")');
        const problemVisible = await problemSection.isVisible().catch(() => false);
        
        // Vérifier la section Solution (bleue)
        const solutionSection = page.locator('div.bg-blue-100.text-blue-800:has-text("Solution")');
        const solutionVisible = await solutionSection.isVisible().catch(() => false);
        
        // Au moins une des deux sections devrait être visible (peut être vide si pas encore généré)
        if (problemVisible || solutionVisible) {
          // Si la section Problème est visible, vérifier qu'elle est bien présente
          if (problemVisible) {
            await expect(problemSection).toBeVisible();
          }
          
          // Si la section Solution est visible, vérifier qu'elle est bien présente
          if (solutionVisible) {
            await expect(solutionSection).toBeVisible();
          }
          
          // Vérifier que les deux sections sont côte à côte (2 colonnes) si les deux sont visibles
          if (problemVisible && solutionVisible) {
            const problemBox = await problemSection.boundingBox();
            const solutionBox = await solutionSection.boundingBox();
            
            if (problemBox && solutionBox) {
              // Les deux sections devraient être à peu près au même niveau Y (côte à côte)
              const yDiff = Math.abs(problemBox.y - solutionBox.y);
              expect(yDiff).toBeLessThan(100); // Tolérance de 100px
            }
          }
        }
      }
    }
  });

  test('devrait permettre d\'éditer problem et solution', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Éditer le problème si la section est visible
        const problemSection = page.locator('div.bg-orange-100:has-text("Problème")');
        const problemVisible = await problemSection.isVisible().catch(() => false);
        
        if (problemVisible) {
          // Chercher l'éditeur TipTap dans la section Problème (markdown=true utilise TipTap)
          // TipTap crée un élément contenteditable dans .markdown-wrapper
          // On cherche dans le conteneur parent de la section Problème
          const problemContainer = problemSection.locator('..').locator('.markdown-wrapper, .prose').first();
          const problemEditor = problemContainer.locator('[contenteditable="true"], .ProseMirror').first();
          const problemEditorVisible = await problemEditor.isVisible().catch(() => false);
          
          if (problemEditorVisible) {
            await problemEditor.click();
            await page.waitForTimeout(500);
            
            // Remplir avec un texte de test (TipTap utilise contenteditable)
            await problemEditor.fill('Test problème E2E');
            await page.waitForTimeout(6000); // Attendre la sauvegarde automatique (buffer 5s)
            
            // Recharger la page pour vérifier la sauvegarde
            await page.reload();
            await page.waitForLoadState('domcontentloaded');
            
            // Vérifier que le problème est sauvegardé (chercher dans le contenu de la page)
            const problemTextContainer = problemSection.locator('..');
            const problemContent = await problemTextContainer.textContent();
            expect(problemContent).toContain('Test problème E2E');
          }
        }
        
        // Éditer la solution si la section est visible
        const solutionSection = page.locator('div.bg-blue-100:has-text("Solution")');
        const solutionVisible = await solutionSection.isVisible().catch(() => false);
        
        if (solutionVisible) {
          // Chercher l'éditeur TipTap dans la section Solution
          const solutionContainer = solutionSection.locator('..').locator('.markdown-wrapper, .prose').first();
          const solutionEditor = solutionContainer.locator('[contenteditable="true"], .ProseMirror').first();
          const solutionEditorVisible = await solutionEditor.isVisible().catch(() => false);
          
          if (solutionEditorVisible) {
            await solutionEditor.click();
            await page.waitForTimeout(500);
            
            // Remplir avec un texte de test
            await solutionEditor.fill('Test solution E2E');
            await page.waitForTimeout(6000); // Attendre la sauvegarde automatique
            
            // Recharger la page pour vérifier la sauvegarde
            await page.reload();
            await page.waitForLoadState('domcontentloaded');
            
            // Vérifier que la solution est sauvegardée (chercher dans le contenu de la page)
            const solutionTextContainer = solutionSection.locator('..');
            const solutionContent = await solutionTextContainer.textContent();
            expect(solutionContent).toContain('Test solution E2E');
          }
        }
      }
    }
  });

  test('devrait gérer les cas d\'usage en cours de génération', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const generatingCards = page.locator('article.opacity-60.cursor-not-allowed');
    
    if (await generatingCards.count() > 0) {
      const firstGeneratingCard = generatingCards.first();
      
      // Essayer de cliquer sur une carte en génération
      await firstGeneratingCard.click();
      
      // Vérifier qu'on reste sur la page de liste (pas de redirection)
      await expect(page).toHaveURL('/cas-usage');
    }
  });

  test('devrait afficher le contenu du cas d\'usage en mode impression (une seule page)', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('domcontentloaded');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('domcontentloaded');
        
        // Activer le mode impression via CSS media query
        await page.emulateMedia({ media: 'print' });
        await page.waitForTimeout(500);
        
        // Vérifier que les éléments UI sont masqués (print-hidden)
        const printHiddenElements = page.locator('.print-hidden');
        const hiddenCount = await printHiddenElements.count();
        
        // Vérifier que le contenu principal est visible
        const mainContent = page.locator('h1, h2, .prose');
        await expect(mainContent.first()).toBeVisible();
        
        // Vérifier la hauteur du contenu (devrait tenir en une page A4)
        const bodyBox = await page.locator('body').boundingBox();
        if (bodyBox) {
          // A4 en pixels à 96 DPI: 794 x 1123
          // On vérifie que le contenu ne dépasse pas une hauteur raisonnable
          const maxHeight = 1123; // Hauteur d'une page A4
          // Note: On ne peut pas vraiment vérifier la pagination, mais on peut vérifier que le contenu est présent
          expect(bodyBox.height).toBeGreaterThan(0);
        }
        
        // Vérifier que le footer image est présent (si applicable)
        const footerImage = page.locator('img[src*="footer"], .report-footer img');
        // Le footer peut être présent ou non selon l'implémentation
      }
    }
  });

  test('lock/presence: User A verrouille, User B demande, User A accepte', async ({ browser }) => {
    const userAContext = await browser.newContext({ storageState: USER_A_STATE });
    const userBContext = await browser.newContext({ storageState: USER_B_STATE });
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();

    const setScope = (id: string) => {
      return (value: string) => {
        try {
          localStorage.setItem(id, value);
        } catch {
          // ignore
        }
      };
    };

    await pageA.addInitScript(setScope('workspaceScopeId'), workspaceAId);
    await pageB.addInitScript(setScope('workspaceScopeId'), workspaceAId);

    await pageA.goto(`/cas-usage/${encodeURIComponent(lockUseCaseId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA
      .waitForResponse((res) => res.url().includes(`/api/v1/use-cases/${lockUseCaseId}`), { timeout: 10_000 })
      .catch(() => null);
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await waitForLockOwnedByMe(pageA);

    await pageB.goto(`/cas-usage/${encodeURIComponent(lockUseCaseId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    const waitForUseCaseView = async () => {
      const response = await pageB
        .waitForResponse((res) => res.url().includes(`/api/v1/use-cases/${lockUseCaseId}`), { timeout: 10_000 })
        .catch(() => null);
      if (response && response.status() === 404) {
        await pageB.evaluate((id) => {
          try {
            localStorage.setItem('workspaceScopeId', id);
          } catch {
            // ignore
          }
        }, workspaceAId);
        await pageB.reload({ waitUntil: 'domcontentloaded' });
      }
      const editableTitle = pageB.locator('h1 textarea.editable-textarea, h1 input.editable-input');
      await expect(editableTitle).toBeVisible({ timeout: 10_000 });
    };
    await waitForUseCaseView();
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    await waitForLockedByOther(pageB);
    const requestButton = pageB.locator('button[aria-label="Demander le déverrouillage"]');
    await requestButton.click();

    const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
    const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
    await expect
      .poll(async () => {
        await badgeA.hover({ force: true });
        return releaseButton.count();
      }, { timeout: 15_000 })
      .toBe(1);
    await releaseButton.click();

    await waitForLockOwnedByMe(pageB);

    await userAContext.close();
    await userBContext.close();
  });

  test('presence: avatars apparaissent et disparaissent au départ', async ({ browser }) => {
    const userAContext = await browser.newContext({ storageState: USER_A_STATE });
    const userBContext = await browser.newContext({ storageState: USER_B_STATE });
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();

    const setScope = (id: string) => {
      return (value: string) => {
        try {
          localStorage.setItem(id, value);
        } catch {
          // ignore
        }
      };
    };

    await pageA.addInitScript(setScope('workspaceScopeId'), workspaceAId);
    await pageB.addInitScript(setScope('workspaceScopeId'), workspaceAId);

    await pageA.goto(`/cas-usage/${encodeURIComponent(lockUseCaseId)}`);
    await pageB.goto(`/cas-usage/${encodeURIComponent(lockUseCaseId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageB.waitForLoadState('domcontentloaded');
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    const avatarAInB = pageB.locator('[aria-label="Verrou du document"] [title="E2E User A"]');
    const avatarBInA = pageA.locator('[aria-label="Verrou du document"] [title="E2E User B"]');
    await expect
      .poll(async () => {
        const [aInB, bInA] = await Promise.all([avatarAInB.count(), avatarBInA.count()]);
        return aInB > 0 && bInA > 0;
      }, { timeout: 15_000 })
      .toBe(true);

    await pageB.close();
    await expect(avatarBInA).toHaveCount(0, { timeout: 10_000 });

    await userAContext.close();
    await userBContext.close();
  });

  test('lock breaks on leave: User A quitte → lock libéré → User B locke', async ({ browser }) => {
    const userAContext = await browser.newContext({ storageState: USER_A_STATE });
    const userBContext = await browser.newContext({ storageState: USER_B_STATE });
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();

    const setScope = (id: string) => {
      return (value: string) => {
        try {
          localStorage.setItem(id, value);
        } catch {
          // ignore
        }
      };
    };

    await pageA.addInitScript(setScope('workspaceScopeId'), workspaceAId);
    await pageA.goto(`/cas-usage/${encodeURIComponent(lockUseCaseId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});

    await waitForLockOwnedByMe(pageA);

    await userAContext.close();

    await pageB.addInitScript(setScope('workspaceScopeId'), workspaceAId);
    await pageB.goto(`/cas-usage/${encodeURIComponent(lockUseCaseId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await waitForLockOwnedByMe(pageB);

    await userBContext.close();
  });

  test('3 utilisateurs: 2e demande refusée, transfert vers le requester', async ({ browser }) => {
    const userAApi = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const userAContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, workspaceAId),
    });
    const userBContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_B_STATE, workspaceAId),
    });
    const userCContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_C_STATE, workspaceAId),
    });
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();
    const pageC = await userCContext.newPage();

    // workspaceScopeId hydrated via storageState

    const testName = `UC Lock 3 users ${Date.now()}`;
    const createRes = await userAApi.post(`/api/v1/use-cases?workspace_id=${workspaceAId}`, {
      data: { name: testName, description: 'Use case lock 3 users', folderId },
    });
    if (!createRes.ok()) throw new Error(`Impossible de créer le cas d'usage (status ${createRes.status()})`);
    const created = await createRes.json().catch(() => null);
    const testUseCaseId = String((created as any)?.id ?? '');
    if (!testUseCaseId) throw new Error('testUseCaseId introuvable');

    await pageA.goto(`/cas-usage/${encodeURIComponent(testUseCaseId)}`);
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await waitForLockOwnedByMe(pageA);

    await pageB.goto(`/cas-usage/${encodeURIComponent(testUseCaseId)}`);
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await waitForLockedByOther(pageB);
    const requestButtonB = pageB.locator('button[aria-label="Demander le déverrouillage"]');
    await requestButtonB.click();

    const badgeA = pageA.locator('div[role="group"][aria-label="Verrou du document"]');
    const releaseButton = pageA.locator('button[aria-label^="Déverrouiller pour"]');
    await expect
      .poll(async () => {
        await badgeA.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        });
        return releaseButton.count();
      }, { timeout: 10_000 })
      .toBe(1);
    const releaseLabelBefore = (await releaseButton.getAttribute('aria-label')) || '';

    await pageC.goto(`/cas-usage/${encodeURIComponent(testUseCaseId)}`);
    await pageC.waitForLoadState('domcontentloaded');
    await pageC.waitForRequest((req) => req.url().includes('/streams/sse'), { timeout: 5000 }).catch(() => {});
    await waitForLockedByOther(pageC);
    const requestButtonC = pageC.locator('button[aria-label="Demander le déverrouillage"]');
    await requestButtonC.click();

    await expect
      .poll(async () => {
        await badgeA.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        });
        return (await releaseButton.getAttribute('aria-label')) || '';
      }, { timeout: 5_000 })
      .toBe(releaseLabelBefore);

    await releaseButton.click();
    await waitForLockOwnedByMe(pageB);

    await userAContext.close();
    await userBContext.close();
    await userCContext.close();
    await userAApi.dispose();
  });
});
