import type { APIRequestContext } from '@playwright/test';

export type CreatedCompany = {
  id: string;
  name: string;
};

export type CreatedFolder = {
  id: string;
  name: string;
  companyId: string | null;
};

export type CreatedUseCase = {
  id: string;
  folderId: string;
  companyId: string | null;
  data: { name: string; description?: string };
};

async function assertOk(res: any, label: string) {
  if (!res.ok()) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()} ${body}`);
  }
}

export async function createCompany(
  api: APIRequestContext,
  input: { name: string }
): Promise<CreatedCompany> {
  const res = await api.post('/api/v1/companies', {
    data: {
      name: input.name,
      status: 'completed',
    },
  });
  await assertOk(res, 'POST /api/v1/companies');
  return (await res.json()) as CreatedCompany;
}

export async function createFolder(
  api: APIRequestContext,
  input: { name: string; description?: string; companyId?: string }
): Promise<CreatedFolder> {
  const res = await api.post('/api/v1/folders', {
    data: {
      name: input.name,
      description: input.description,
      companyId: input.companyId,
    },
  });
  await assertOk(res, 'POST /api/v1/folders');
  return (await res.json()) as CreatedFolder;
}

export async function createUseCase(
  api: APIRequestContext,
  input: {
    folderId: string;
    companyId?: string;
    name: string;
    description?: string;
  }
): Promise<CreatedUseCase> {
  const res = await api.post('/api/v1/use-cases', {
    data: {
      folderId: input.folderId,
      companyId: input.companyId,
      name: input.name,
      description: input.description,
      process: 'Automatisation & productivité',
      domain: 'Opérations',
      technologies: ['RAG', 'NLP'],
      benefits: ['Réduction du temps de traitement', 'Meilleure qualité'],
      metrics: ['Temps de cycle', 'Taux d’erreur'],
      risks: ['Dérive du modèle', 'Données sensibles'],
      nextSteps: ['POC', 'Pilote', 'Déploiement'],
      dataSources: ['ERP', 'Emails'],
      dataObjects: ['Commandes', 'Tickets'],
      references: [{ title: 'Doc interne', url: 'https://example.com' }],
    },
  });
  await assertOk(res, 'POST /api/v1/use-cases');
  return (await res.json()) as CreatedUseCase;
}


