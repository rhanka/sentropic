import { test, expect, request } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withWorkspaceAndFolderStorageState, withWorkspaceStorageState } from '../helpers/workspace-scope';

test.describe('Import / Export', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
  const USER_A_STATE = './.auth/user-a.json';
  let exportZipPath = '';
  let sourceWorkspaceId = '';
  let targetWorkspaceId = '';
  let targetFolderId = '';

  test.beforeAll(async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    const sourceRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: `Import Export Source ${Date.now()}` },
    });
    if (!sourceRes.ok()) throw new Error(`Impossible de créer workspace source (${sourceRes.status()})`);
    const sourceJson = await sourceRes.json().catch(() => null);
    sourceWorkspaceId = String(sourceJson?.id || '');
    if (!sourceWorkspaceId) throw new Error('sourceWorkspaceId introuvable');

    const orgRes = await userAApi.post(`/api/v1/organizations?workspace_id=${sourceWorkspaceId}`, {
      data: { name: 'Organisation Export', status: 'completed' },
    });
    if (!orgRes.ok()) throw new Error(`Impossible de créer organisation (${orgRes.status()})`);
    const orgJson = await orgRes.json().catch(() => null);
    const organizationId = String(orgJson?.id || '');

    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${sourceWorkspaceId}`, {
      data: { name: 'Dossier Export', description: 'Dossier pour import/export', organizationId },
    });
    if (!folderRes.ok()) throw new Error(`Impossible de créer dossier (${folderRes.status()})`);
    const folderJson = await folderRes.json().catch(() => null);
    const folderId = String(folderJson?.id || '');
    if (!folderId) throw new Error('folderId introuvable');

    const useCaseRes = await userAApi.post(`/api/v1/initiatives?workspace_id=${sourceWorkspaceId}`, {
      data: {
        folderId,
        organizationId,
        name: 'Cas d’usage Export',
        description: 'Cas d’usage pour import/export',
        process: 'Automatisation & productivité',
        domain: 'Opérations',
        technologies: ['RAG', 'NLP'],
        benefits: ['Réduction du temps de traitement', 'Meilleure qualité'],
        metrics: ['Temps de cycle', "Taux d'erreur"],
        risks: ['Dérive du modèle', 'Données sensibles'],
        nextSteps: ['POC', 'Pilote', 'Déploiement'],
        dataSources: ['ERP', 'Emails'],
        dataObjects: ['Commandes', 'Tickets'],
        references: [{ title: 'Doc interne', url: 'https://example.com' }],
      },
    });
    if (!useCaseRes.ok()) throw new Error(`Impossible de créer cas d'usage (${useCaseRes.status()})`);

    const exportRes = await userAApi.post(`/api/v1/exports?workspace_id=${sourceWorkspaceId}`, {
      data: {
        scope: 'workspace',
        include: ['organizations', 'folders', 'usecases', 'matrix'],
        include_comments: false,
        include_documents: false,
      },
    });
    if (!exportRes.ok()) throw new Error(`Impossible d'exporter (${exportRes.status()})`);
    const exportBuffer = await exportRes.body();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-import-export-'));
    exportZipPath = path.join(tempDir, 'export.zip');
    await fs.writeFile(exportZipPath, exportBuffer);

    const targetRes = await userAApi.post('/api/v1/workspaces', {
      data: { name: `Import Export Target ${Date.now()}` },
    });
    if (!targetRes.ok()) throw new Error(`Impossible de créer workspace cible (${targetRes.status()})`);
    const targetJson = await targetRes.json().catch(() => null);
    targetWorkspaceId = String(targetJson?.id || '');
    if (!targetWorkspaceId) throw new Error('targetWorkspaceId introuvable');

    const targetFolderRes = await userAApi.post(`/api/v1/folders?workspace_id=${targetWorkspaceId}`, {
      data: { name: 'Dossier Cible', description: 'Cible import' },
    });
    if (!targetFolderRes.ok()) throw new Error(`Impossible de créer dossier cible (${targetFolderRes.status()})`);
    const targetFolderJson = await targetFolderRes.json().catch(() => null);
    targetFolderId = String(targetFolderJson?.id || '');
    if (!targetFolderId) throw new Error('targetFolderId introuvable');

    await userAApi.dispose();
  });

  test('import preview + type selection + switch workspace', async ({ browser }) => {
    const userAContext = await browser.newContext({
      storageState: await withWorkspaceStorageState(USER_A_STATE, targetWorkspaceId),
    });
    const page = await userAContext.newPage();
    await page.goto('/folders');
    await page.waitForLoadState('domcontentloaded');

    const actionsButton = page.locator('button[aria-label="Actions dossier"]');
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();

    const importAction = page.locator('button:has-text("Importer")');
    await expect(importAction).toBeVisible();
    await importAction.click();

    const importDialog = page.locator('h3:has-text("Importer un dossier")');
    await expect(importDialog).toBeVisible({ timeout: 10_000 });
    const dialog = page.locator('div').filter({ has: importDialog }).first();

    const fileInput = dialog.locator('input[type="file"][accept=".zip"]');
    await expect(fileInput).toBeVisible();
    const previewResponsePromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/api/v1/imports/preview'),
      { timeout: 30_000 }
    );
    await fileInput.setInputFiles(exportZipPath);
    const previewRes = await previewResponsePromise;
    if (!previewRes.ok()) {
      const body = await previewRes.text().catch(() => '');
      throw new Error(`Erreur prévisualisation import: ${previewRes.status()} ${body.slice(0, 200)}`);
    }

    await expect(page.getByText('Types à importer')).toBeVisible({ timeout: 30_000 });
    const orgCheckbox = page.getByRole('checkbox', { name: /^Organisations/ });
    const foldersCheckbox = page.getByRole('checkbox', { name: /^Dossiers/ });
    const usecasesCheckbox = page.getByRole('checkbox', { name: /^Initiatives/ });
    const matrixCheckbox = page.getByRole('checkbox', { name: /^Matrices/ });
    await expect(orgCheckbox).toBeVisible();
    await expect(foldersCheckbox).toBeVisible();
    await expect(usecasesCheckbox).toBeVisible();
    await expect(matrixCheckbox).toBeVisible();
    if (await orgCheckbox.isEnabled()) {
      await orgCheckbox.uncheck();
    }

    const workspaceSelect = dialog.locator('label:has-text("Workspace cible") select');
    await expect(workspaceSelect).toBeVisible();
    await workspaceSelect.selectOption('__new__');

    const importResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/imports') && res.request().method() === 'POST'
    );
    await dialog.locator('button:has-text("Importer")').click();

    const importResponse = await importResponsePromise;
    expect(importResponse.ok()).toBe(true);
    const importPayload = await importResponse.json();
    const importedWorkspaceId = String(importPayload?.workspace_id || '');
    expect(importedWorkspaceId).toBeTruthy();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('workspaceScopeId')), { timeout: 10_000 })
      .toBe(importedWorkspaceId);
    await userAContext.close();
  });

  test('import use case avec creation de dossier', async ({ browser }) => {
    const userAContext = await browser.newContext({
      storageState: await withWorkspaceAndFolderStorageState(USER_A_STATE, targetWorkspaceId, targetFolderId),
    });
    const page = await userAContext.newPage();
    const folderLoaded = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/folders/${targetFolderId}`) && res.ok()
    );
    await page.goto(`/folders/${encodeURIComponent(targetFolderId)}`);
    await page.waitForLoadState('domcontentloaded');
    await folderLoaded;

    await expect(page.getByRole('button', { name: 'Exporter Excel (XLSX)' })).toBeVisible();
    const actionsButton = page.getByRole('button', { name: 'Actions' });
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();

    const importAction = page.locator('button:has-text("Importer")');
    await expect(importAction).toBeVisible();
    await importAction.click();

    const importDialog = page.locator('h3:has-text("Importer une initiative")');
    await expect(importDialog).toBeVisible({ timeout: 10_000 });
    const dialog = page.locator('div').filter({ has: importDialog }).first();

    const fileInput = dialog.locator('input[type="file"][accept=".zip"]');
    await expect(fileInput).toBeVisible();
    await fileInput.setInputFiles(exportZipPath);

    await expect(dialog.locator('text=Types à importer')).toBeVisible({ timeout: 10_000 });

    const targetSelect = dialog.locator('label:has-text("Dossier cible") select');
    await expect(targetSelect).toBeVisible();
    await targetSelect.selectOption('new');

    const importResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/imports') && res.request().method() === 'POST'
    );
    await dialog.locator('button:has-text("Importer")').click();

    const importResponse = await importResponsePromise;
    expect(importResponse.ok()).toBe(true);
    const importPayload = await importResponse.json();
    const newFolderId = String(importPayload?.target_folder_id || '');
    expect(newFolderId).toBeTruthy();

    await expect(page).toHaveURL(new RegExp(`/folders/${newFolderId}$`));
    await userAContext.close();
  });

  test('exporte un dossier en xlsx multi-onglets avec graphique natif', async () => {
    const userAApi = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: USER_A_STATE,
    });

    // Folders created via API get the workspace-type default matrix.
    const folderRes = await userAApi.post(`/api/v1/folders?workspace_id=${sourceWorkspaceId}`, {
      data: { name: `Dossier XLSX ${Date.now()}`, description: 'Export XLSX e2e' },
    });
    expect(folderRes.ok()).toBe(true);
    const folder = await folderRes.json();
    const xlsxFolderId = String(folder?.id || '');
    expect(xlsxFolderId).toBeTruthy();

    // Scored initiative so the prioritization quadrant has a data point.
    const ucRes = await userAApi.post(`/api/v1/initiatives?workspace_id=${sourceWorkspaceId}`, {
      data: {
        folderId: xlsxFolderId,
        name: 'Cas XLSX',
        description: 'Cas pour export xlsx',
        domain: 'Operations',
        problem: 'Processus lent',
        solution: 'Automatiser',
        valueScores: [{ axisId: 'business_value', rating: 89, description: '' }],
        complexityScores: [{ axisId: 'ai_maturity', rating: 8, description: '' }],
      },
    });
    expect(ucRes.ok()).toBe(true);

    // Enqueue async xlsx generation.
    const genRes = await userAApi.post(`/api/v1/xlsx/generate?workspace_id=${sourceWorkspaceId}`, {
      data: { entityType: 'folder', entityId: xlsxFolderId },
    });
    expect(genRes.ok()).toBe(true);
    const gen = await genRes.json();
    const jobId = String(gen?.jobId || '');
    expect(jobId).toBeTruthy();

    // Poll the job until completion.
    let completed = false;
    for (let attempt = 0; attempt < 40 && !completed; attempt++) {
      const jobRes = await userAApi.get(`/api/v1/queue/jobs/${jobId}?workspace_id=${sourceWorkspaceId}`);
      if (jobRes.ok()) {
        const job = await jobRes.json();
        if (job?.status === 'completed') completed = true;
        else if (job?.status === 'failed') throw new Error(`xlsx job failed: ${job?.error}`);
      }
      if (!completed) await new Promise((r) => setTimeout(r, 500));
    }
    expect(completed).toBe(true);

    // Download the workbook and assert it is a valid zip containing the
    // three worksheets plus the natively injected scatter chart part.
    const dlRes = await userAApi.get(`/api/v1/xlsx/jobs/${jobId}/download?workspace_id=${sourceWorkspaceId}`);
    expect(dlRes.ok()).toBe(true);
    expect(dlRes.headers()['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const xlsxBuffer = await dlRes.body();
    // ZIP local-file signature.
    expect(xlsxBuffer.slice(0, 2).toString('latin1')).toBe('PK');
    // OOXML part names are stored as plain text in the zip directory.
    const asText = xlsxBuffer.toString('latin1');
    expect(asText).toContain('xl/worksheets/sheet1.xml');
    expect(asText).toContain('xl/worksheets/sheet2.xml');
    expect(asText).toContain('xl/worksheets/sheet3.xml');
    expect(asText).toContain('xl/charts/chart1.xml');
    expect(asText).toContain('xl/drawings/drawing1.xml');

    await userAApi.dispose();
  });
});
