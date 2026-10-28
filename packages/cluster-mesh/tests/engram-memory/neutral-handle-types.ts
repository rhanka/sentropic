import type { createPostgresKernel, InjectedPgDriver } from '../../src/storage/postgres/index.js';
import type { MemoryNeutralHostDriver, MemoryNeutralKernelPort } from '../../src/engram-memory/neutral-handle.js';

type PgKernel = Awaited<ReturnType<typeof createPostgresKernel>>;
// Assign actual installed-kernel types without casts or fake replacements.
export const kernelConforms = (kernel: PgKernel): MemoryNeutralKernelPort => kernel;
export const driverConforms = (driver: InjectedPgDriver): MemoryNeutralHostDriver => driver;
