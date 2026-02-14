import { Worker } from 'node:worker_threads';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

type DocxWorkerInput = {
  templateId: 'usecase-onepage' | 'executive-synthesis-multipage';
  entityType: 'usecase' | 'folder';
  entityId: string;
  workspaceId: string;
  provided?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  locale?: string;
  requestId?: string;
};

type DocxWorkerProgressEvent = {
  state: string;
  progress?: number;
  current?: number;
  total?: number;
  message?: string;
};

type DocxWorkerResult = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

type WorkerProgressMessage = {
  type: 'progress';
  event: DocxWorkerProgressEvent;
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

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

async function buildDevWorkerBundle(): Promise<URL> {
  const [{ build }] = await Promise.all([import('esbuild')]);
  const sourcePath = resolve(process.cwd(), 'src', 'workers', 'docx-render.worker.ts');
  const outputPath = resolve(
    process.cwd(),
    'node_modules',
    '.cache',
    'docx-render.worker.dev.mjs'
  );
  await mkdir(resolve(process.cwd(), 'node_modules', '.cache'), { recursive: true });

  await build({
    entryPoints: [sourcePath],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: 'inline',
    packages: 'external',
  });

  return pathToFileURL(outputPath);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveDocxWorkerRuntimeSpec(): Promise<{ entry: URL; execArgv: string[] }> {
  const distWorkerPath = resolve(process.cwd(), 'dist', 'workers', 'docx-render.worker.js');

  if (await fileExists(distWorkerPath)) {
    return {
      entry: pathToFileURL(distWorkerPath),
      execArgv: [],
    };
  }

  return {
    entry: await buildDevWorkerBundle(),
    execArgv: [],
  };
}

export async function runDocxGenerationInWorker(params: {
  input: DocxWorkerInput;
  signal?: AbortSignal;
  onProgress?: (event: DocxWorkerProgressEvent) => void | Promise<void>;
}): Promise<DocxWorkerResult> {
  const { input, signal, onProgress } = params;
  const runtime = await resolveDocxWorkerRuntimeSpec();

  return new Promise<DocxWorkerResult>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(runtime.entry, {
      workerData: input,
      execArgv: runtime.execArgv,
      stdout: true,
      stderr: true,
    });
    let workerStdout = '';
    let workerStderr = '';

    worker.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerStdout += text;
      if (text.trim()) {
        console.log(`[DOCX-WORKER:stdout] ${text.trim()}`);
      }
    });

    worker.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerStderr += text;
      if (text.trim()) {
        console.error(`[DOCX-WORKER:stderr] ${text.trim()}`);
      }
    });

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.removeAllListeners('message');
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const resolveOnce = (result: DocxWorkerResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      void worker.terminate().finally(() => {
        rejectOnce(createAbortError('Docx generation cancelled'));
      });
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.on('message', (raw: WorkerMessage) => {
      if (!raw || typeof raw !== 'object') return;

      if (raw.type === 'progress') {
        if (onProgress) {
          void Promise.resolve(onProgress(raw.event)).catch(() => {
            // Progress callback errors are non-fatal.
          });
        }
        return;
      }

      if (raw.type === 'done') {
        resolveOnce({
          fileName: raw.fileName,
          mimeType: raw.mimeType,
          buffer: Buffer.from(raw.bufferBase64, 'base64'),
        });
        void worker.terminate().catch(() => {
          // Worker may already be exiting naturally.
        });
        return;
      }

      if (raw.type === 'error') {
        const err = new Error(raw.error?.message || 'Docx worker failed');
        if (raw.error?.name) err.name = raw.error.name;
        if (raw.error?.stack) err.stack = raw.error.stack;
        rejectOnce(err);
        void worker.terminate().catch(() => {
          // Worker may already be exiting naturally.
        });
      }
    });

    worker.on('error', (error) => {
      rejectOnce(error instanceof Error ? error : new Error(String(error)));
    });

    worker.on('exit', (code) => {
      if (settled) return;
      if (code !== 0) {
        const details = [workerStderr.trim(), workerStdout.trim()].filter(Boolean).join('\n');
        rejectOnce(
          new Error(
            details
              ? `Docx worker exited with code ${code}: ${details}`
              : `Docx worker exited with code ${code}`
          )
        );
      }
    });
  });
}
