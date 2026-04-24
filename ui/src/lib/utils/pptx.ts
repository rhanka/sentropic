import { downloadGeneratedFile } from '$lib/utils/docx';

export async function downloadCompletedPptxJob(
  jobId: string,
  fallbackFileName: string
): Promise<void> {
  await downloadGeneratedFile({ jobId, fileName: fallbackFileName, format: 'pptx' });
}
