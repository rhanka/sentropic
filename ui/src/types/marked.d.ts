/**
 * Type declarations for 'marked' library
 * This ensures TypeScript Language Server in VSCode can resolve the marked module correctly
 */
declare module 'marked' {
  export function marked(src: string | string[]): string;
  export default marked;
}


