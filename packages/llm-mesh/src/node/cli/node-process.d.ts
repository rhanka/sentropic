// Minimal `node:process` surface for the llm-mesh-enroll CLI: the package
// typechecks against local stubs (see src/global.d.ts), so only the
// members declared here are available. At runtime this is the real core
// module; the declaration is type-only and erased on emit.
declare module 'node:process' {
  export interface ProcessWriteStream {
    write(chunk: string): void;
  }
  export const stdout: ProcessWriteStream;
  export const stderr: ProcessWriteStream;
  export const argv: string[];
  export function exit(code?: number): never;
}
