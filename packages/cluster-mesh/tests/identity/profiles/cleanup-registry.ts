// Per-test-file cleanup registry for the identity profile shims. Vitest
// isolates each spec file, so module state is per file; the setup file flushes
// in LIFO order so a shared driver closes after the resources it owns.

export type ProfileCleanup = () => void | Promise<void>;

const cleanups: ProfileCleanup[] = [];

export const registerCleanup = (cleanup: ProfileCleanup): void => {
  cleanups.push(cleanup);
};

export const flushCleanups = async (): Promise<void> => {
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    const cleanup = cleanups[index];
    cleanups[index] = undefined as never;
    await Promise.resolve(cleanup()).catch(() => undefined);
  }
  cleanups.length = 0;
};
