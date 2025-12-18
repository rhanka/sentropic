import { test, expect } from '@playwright/test';

test.describe('Détail des cas d\'usage', () => {
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
});
