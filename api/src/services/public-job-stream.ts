import type { OrganizationEnrichJobData, InitiativeListJobData, MatrixGenerateJobData,
  InitiativeDetailJobData, ExecutiveSummaryJobData, DocumentSummaryJobData } from './queue-manager';

export function getPublicJobStreamId(job: { readonly id: string; readonly type: string; readonly data: unknown }): string {
  const rawData = (job.data ?? {}) as unknown as Record<string, unknown>;
  if (job?.type === 'organization_enrich' && (job.data as OrganizationEnrichJobData | undefined)?.organizationId) {
    return `organization_${(job.data as OrganizationEnrichJobData).organizationId}`;
  }
  if (job?.type === 'initiative_list' && ((job.data as InitiativeListJobData | undefined)?.folderId || rawData.folder_id)) {
    const folderId =
      (job.data as InitiativeListJobData).folderId ??
      String(rawData.folder_id ?? '');
    return `folder_${folderId}`;
  }
  if (job?.type === 'matrix_generate' && ((job.data as MatrixGenerateJobData | undefined)?.folderId || rawData.folder_id)) {
    const folderId =
      (job.data as MatrixGenerateJobData).folderId ??
      String(rawData.folder_id ?? '');
    return `matrix_${folderId}`;
  }
  if (job?.type === 'initiative_detail' && ((job.data as InitiativeDetailJobData | undefined)?.initiativeId || rawData.use_case_id)) {
    const initiativeId =
      (job.data as InitiativeDetailJobData).initiativeId ??
      String(rawData.use_case_id ?? '');
    return `initiative_${initiativeId}`;
  }
  if (job?.type === 'executive_summary' && ((job.data as ExecutiveSummaryJobData | undefined)?.folderId || rawData.folder_id)) {
    const folderId =
      (job.data as ExecutiveSummaryJobData).folderId ??
      String(rawData.folder_id ?? '');
    return `folder_${folderId}`;
  }
  if (job?.type === 'document_summary' && ((job.data as DocumentSummaryJobData | undefined)?.documentId || rawData.document_id)) {
    const documentId =
      (job.data as DocumentSummaryJobData).documentId ??
      String(rawData.document_id ?? '');
    return `document_${documentId}`;
  }
  if (job?.type === 'chat_message' && typeof (job.data as { assistantMessageId?: unknown })?.assistantMessageId === 'string') {
    return String((job.data as { assistantMessageId: string }).assistantMessageId);
  }
  return `job_${job.id}`;
}
