import type { APIRequestContext } from '@playwright/test';

export type CreatedOrganization = {
  id: string;
  name: string;
};

export type CreatedFolder = {
  id: string;
  name: string;
  organizationId: string | null;
};

export type CreatedUseCase = {
  id: string;
  folderId: string;
  organizationId: string | null;
  data: { name: string; description?: string };
};

async function assertOk(res: any, label: string) {
  if (!res.ok()) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} failed: ${res.status()} ${res.statusText()} ${body}`);
  }
}

export async function createOrganization(
  api: APIRequestContext,
  input: { name: string }
): Promise<CreatedOrganization> {
  const res = await api.post('/api/v1/organizations', {
    data: {
      name: input.name,
      status: 'completed',
    },
  });
  await assertOk(res, 'POST /api/v1/organizations');
  return (await res.json()) as CreatedOrganization;
}

export async function createFolder(
  api: APIRequestContext,
  input: { name: string; description?: string; organizationId?: string }
): Promise<CreatedFolder> {
  const res = await api.post('/api/v1/folders', {
    data: {
      name: input.name,
      description: input.description,
      organizationId: input.organizationId,
    },
  });
  await assertOk(res, 'POST /api/v1/folders');
  return (await res.json()) as CreatedFolder;
}

export async function createUseCase(
  api: APIRequestContext,
  input: {
    folderId: string;
    organizationId?: string;
    name: string;
    description?: string;
  }
): Promise<CreatedUseCase> {
  const res = await api.post('/api/v1/use-cases', {
    data: {
      folderId: input.folderId,
      organizationId: input.organizationId,
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


