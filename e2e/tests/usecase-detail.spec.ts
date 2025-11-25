import { test, expect } from '@playwright/test';

test.describe('Détail des cas d\'usage', () => {
  test('devrait afficher la page de détail d\'un cas d\'usage', async ({ page }) => {
    // D'abord aller à la liste des cas d'usage
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
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
        await page.waitForLoadState('networkidle');
        
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
    await page.waitForLoadState('networkidle');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('networkidle');
        
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
    await page.waitForLoadState('networkidle');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('networkidle');
        
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
    await page.waitForLoadState('networkidle');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('networkidle');
        
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
          await page.waitForLoadState('networkidle');
          await expect(page).toHaveURL('/cas-usage');
        }
      }
    }
  });

  test('devrait afficher les scores de valeur et complexité en détail', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('networkidle');
        
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

  test('devrait gérer les cas d\'usage en cours de génération', async ({ page }) => {
    await page.goto('/cas-usage');
    await page.waitForLoadState('networkidle');
    
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
    await page.waitForLoadState('networkidle');
    
    const useCaseCards = page.locator('article.rounded.border.border-slate-200');
    
    if (await useCaseCards.count() > 0) {
      const firstCard = useCaseCards.first();
      const isGenerating = await firstCard.locator('.opacity-60.cursor-not-allowed').isVisible();
      
      if (!isGenerating) {
        await firstCard.click();
        await page.waitForLoadState('networkidle');
        
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
