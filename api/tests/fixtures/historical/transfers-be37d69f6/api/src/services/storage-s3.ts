import { getArtifactStore } from '../../../../../../../src/services/artifact-store';

export const getDocumentsBucketName = (): string => getArtifactStore().defaultBucket();

export const getObjectBytes = (
  ref: { bucket: string; key: string },
): Promise<Uint8Array> => getArtifactStore().getBytes(ref);

export const putObject = (input: {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType?: string;
}): Promise<unknown> => getArtifactStore().put(input);
