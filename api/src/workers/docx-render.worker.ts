import { parentPort, workerData } from 'node:worker_threads';
import {
  generateDocxForEntity,
  type DocxGenerateRequest,
} from '../services/docx-generation.ts';

type WorkerInput = Omit<DocxGenerateRequest, 'onProgress' | 'requestId'> & {
  requestId?: string;
};

type WorkerProgressMessage = {
  type: 'progress';
  event: {
    state: string;
    progress?: number;
    current?: number;
    total?: number;
    message?: string;
  };
};

type WorkerDoneMessage = {
  type: 'done';
  fileName: string;
  mimeType: string;
  bufferBase64: string;
};

type WorkerErrorMessage = {
  type: 'error';
  error: {
    name: string;
    message: string;
    stack?: string;
  };
};

type WorkerMessage = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage;

function post(message: WorkerMessage): void {
  parentPort?.postMessage(message);
}

function toSerializableError(error: unknown): { name: string; message: string; stack?: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}

function reportFatal(kind: string, error: unknown): void {
  const serialized = toSerializableError(error);
  console.error(`[DOCX-WORKER:${kind}]`, serialized.stack || serialized.message);
  post({
    type: 'error',
    error: serialized,
  });
}

process.on('uncaughtException', (error) => {
  reportFatal('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  reportFatal('unhandledRejection', reason);
});

async function run(): Promise<void> {
  if (!parentPort) {
    throw new Error('DOCX worker requires parentPort');
  }

  const input = workerData as WorkerInput;
  const result = await generateDocxForEntity({
    ...input,
    onProgress: async (event) => {
      post({ type: 'progress', event });
    },
  });

  post({
    type: 'done',
    fileName: result.fileName,
    mimeType: result.mimeType,
    bufferBase64: result.buffer.toString('base64'),
  });
}

void run().catch((error: unknown) => {
  reportFatal('run', error);
});
