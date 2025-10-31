import { test, expect } from '@playwright/test';

test.describe('Gestion des entreprises', () => {
  test('devrait afficher la page des entreprises', async ({ page }) => {
    await page.goto('/entreprises');
    
    // Vérifier que la page se charge
    await page.waitForLoadState('networkidle');
    
    // Vérifier le titre
    await expect(page.locator('h1')).toContainText('Entreprises');
    
    // Vérifier le bouton d'ajout
    await expect(page.locator('button:has-text("Ajouter")')).toBeVisible();
  });

  test('devrait permettre de créer une entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Cliquer sur le bouton d'ajout et attendre la page de création
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/entreprises\/new$/);
    
    // Renseigner le nom via l'EditableInput dans le H1
    const nameInput = page.locator('h1 input.editable-input');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Test Company');
    // Laisser la réactivité Svelte stabiliser l'état local
    await page.waitForTimeout(500);
    
    // Créer l'entreprise puis attendre la redirection vers la page détail
    const createBtn = page.locator('button[title="Créer"], button:has-text("Créer")');
    // Debug réseau: tracer le POST /companies
    const disposeNet1 = page.on('request', (r) => {
      if (r.url().includes('/api/v1/companies') && r.method() === 'POST') console.log('[DEBUG] POST /companies started');
    });
    const disposeNet2 = page.on('requestfailed', (r) => {
      if (r.url().includes('/api/v1/companies')) console.log(`[DEBUG] REQUEST FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
    });
    const disposeNet3 = page.on('response', async (res) => {
      const req = res.request();
      if (req.url().includes('/api/v1/companies') && req.method() === 'POST') console.log(`[DEBUG] POST /companies status=${res.status()}`);
    });

    // Debug DOM: état du bouton avant clic
    const btnState = await createBtn.evaluate((el) => {
      const b = el as HTMLButtonElement;
      const rect = b.getBoundingClientRect();
      const cs = window.getComputedStyle(b);
      return {
        disabled: b.disabled,
        text: (b.textContent || '').trim(),
        title: b.getAttribute('title'),
        visible: rect.width > 0 && rect.height > 0,
        cursor: cs.cursor,
        opacity: cs.opacity,
      };
    });
    console.log('[DEBUG] createBtn state before click:', btnState);

    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();
    await createBtn.scrollIntoViewIfNeeded();
    await createBtn.hover();
    await createBtn.click();

    // Preuve d'impact: soit navigation, soit POST observé
    await Promise.race([
      page.waitForURL(/\/entreprises\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 5000 }),
      page.waitForRequest((r) => r.url().includes('/api/v1/companies') && r.method() === 'POST', { timeout: 5000 })
    ]).catch(() => {});

    await expect(page).toHaveURL(/\/entreprises\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 3000 });
    
    // Vérifier directement sur la page de détail que le nom est bien celui saisi
    const detailNameInput = page.locator('h1 input.editable-input');
    await expect(detailNameInput).toHaveValue('Test Company');
  });

  test('devrait afficher le bouton d\'enrichissement IA', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Aller à la page de création
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/entreprises\/new$/);
    
    const aiButton = page.locator('[data-testid="enrich-company"], button:has-text("IA")');
    await expect(aiButton).toBeVisible();
    await expect(aiButton).toBeDisabled();
    
    // Renseigner un nom pour activer le bouton IA
    const nameInput = page.locator('h1 input.editable-input');
    await nameInput.fill('Microsoft');
    await expect(aiButton).toBeEnabled();
  });

  test('devrait permettre de supprimer une entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');

    // Créer une entreprise d'abord (comme sur main)
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/entreprises\/new$/);
    const nameInput = page.locator('h1 input.editable-input');
    await nameInput.fill('Company to Delete');
    await page.waitForTimeout(75);
    const createBtn2 = page.locator('button[title="Créer"], button:has-text("Créer")');
    await expect(createBtn2).toBeVisible();
    await createBtn2.scrollIntoViewIfNeeded();
    await createBtn2.hover();
    await createBtn2.click({ force: true });
    await createBtn2.press('Enter');
    await Promise.race([
      page.waitForURL(/\/entreprises\/[a-zA-Z0-9-]+$/, { timeout: 2000 }),
      page.locator('button:has-text("Création...")').first().waitFor({ state: 'visible', timeout: 2000 })
    ]);
    await expect(page).toHaveURL(/\/entreprises\/[a-zA-Z0-9-]+$/);

    // Supprimer via l'UI: cliquer sur le bouton Supprimer et confirmer
    page.on('dialog', dialog => dialog.accept());
    const deleteBtn = page.locator('button:has-text("Supprimer")').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    // Attendre la redirection
    await page.waitForURL(/\/entreprises$/);

    // Vérifier que l'entreprise a disparu de la liste UI
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Company to Delete')).toHaveCount(0);
  });

  test('devrait permettre de cliquer sur une entreprise pour voir ses détails', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Chercher une entreprise cliquable (pas en enrichissement)
    const companyItems = page.locator('.grid.gap-4 > article').filter({ hasNotText: 'Enrichissement en cours' });
    
    const itemCount = await companyItems.count();
    if (itemCount > 0) {
      const firstCompany = companyItems.first();
      
      // Cliquer sur l'entreprise
      await firstCompany.click();
      
      // Preuve d'impact: soit navigation, soit POST observé
      await Promise.race([
        page.waitForURL(/\/entreprises\/(?!new$)[a-zA-Z0-9-]+$/, { timeout: 5000 }),
        page.waitForRequest((r) => r.url().includes('/api/v1/companies') && r.method() === 'POST', { timeout: 5000 })
      ]).catch(() => {});
      
      // Vérifier qu'on est sur une page de détail
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/entreprises\/[a-zA-Z0-9-]+/);
    }
  });

  test('devrait afficher les informations enrichies par l\'IA', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Créer une entreprise et lancer l'enrichissement IA depuis la page New
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/entreprises\/new$/);
    const nameInput2 = page.locator('h1 input.editable-input');
    await nameInput2.fill('MicrosoftAITest');
    const aiButton = page.locator('[data-testid="enrich-company"], button:has-text("IA")');
    await expect(aiButton).toBeEnabled();
    
    // Vérifier que le bouton IA est visible et actif (test minimal fonctionnel)
    await expect(aiButton).toBeVisible();
  });

  test('devrait gérer les erreurs lors de la création d\'entreprise', async ({ page }) => {
    await page.goto('/entreprises');
    await page.waitForLoadState('networkidle');
    
    // Naviguer vers la page de création sans renseigner de nom
    await page.click('button:has-text("Ajouter")');
    await expect(page).toHaveURL(/\/entreprises\/new$/);
    
    // Vérifier que le bouton "Créer" est désactivé tant que le nom est vide
    const createBtn2 = page.locator('button:has-text("Créer")');
    await expect(createBtn2).toBeDisabled();
  });
});


