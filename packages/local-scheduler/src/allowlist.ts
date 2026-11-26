import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { PolicyRefusalError } from './errors.js';

const DENYLISTED_BINS = new Set([
  'sh', 'bash', 'dash', 'zsh', 'fish', 'ksh', 'csh', 'env',
  'python', 'python2', 'python3', 'perl', 'ruby', 'awk', 'xargs',
  'sudo', 'su', 'pkexec', 'doas', 'ssh', 'curl', 'wget',
]);
const NODE_FLAG_REJECTS = new Set(['-e', '--eval', '-p', '--print', '-r', '--require', '--import']);
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

function isDenylistedInterpreter(binPath: string): boolean {
  const base = path.basename(binPath).toLowerCase();
  return DENYLISTED_BINS.has(base) || /^python(\d+(\.\d+)*)?$/.test(base);
}
export function isNodeInterpreter(canonicalBin: string): boolean {
  try {
    if (canonicalBin === realpathSync(process.execPath)) return true;
  } catch { /* fall through to basename check */ }
  return path.basename(canonicalBin) === 'node';
}
function checkExecutableMode(targetPath: string, requireExec: boolean, role: string): string {
  if (!path.isAbsolute(targetPath)) {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} path must be absolute: ${targetPath}`);
  }
  let canonical: string;
  try {
    canonical = realpathSync(targetPath);
  } catch {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} cannot be resolved: ${targetPath}`);
  }
  let st;
  try {
    st = statSync(canonical);
  } catch {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `${role} cannot be stat-ed: ${canonical}`);
  }
  if (!st.isFile()) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `${role} is not a regular file: ${canonical}`);
  }
  const uid = process.getuid ? process.getuid() : 0;
  if (st.uid !== uid && st.uid !== 0) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `${role} has untrusted owner uid=${st.uid}: ${canonical}`);
  }
  if ((st.mode & 0o022) !== 0) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `${role} is group/world writable: ${canonical}`);
  }
  if (requireExec && (st.mode & 0o100) === 0) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `${role} is not owner-executable: ${canonical}`);
  }
  return canonical;
}
function checkShebangSafety(filePath: string, role: string): void {
  const buf = Buffer.alloc(256);
  let bytesRead = 0;
  const fd = openSync(filePath, 'r');
  try {
    bytesRead = readSync(fd, buf, 0, 256, 0);
  } finally {
    closeSync(fd);
  }
  const head = buf.subarray(0, bytesRead);
  if (head.length >= 4 && head.subarray(0, 4).equals(ELF_MAGIC)) return;
  if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) {
    const firstLine = head.toString('utf8').split(/\r?\n/, 1)[0].slice(2).trim();
    const interpreter = firstLine.split(/\s+/)[0] ?? '';
    if (!interpreter || !path.isAbsolute(interpreter)) {
      throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} shebang must use an absolute interpreter`);
    }
    if (path.basename(interpreter) === 'env' || isDenylistedInterpreter(interpreter)) {
      throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} shebang interpreter is denylisted: ${interpreter}`);
    }
  }
}
/** Enforces allow-list, file-mode, shebang, and Node script constraints on an executable + argv. */
export function validateAllowedExecutable(
  bin: string,
  args: readonly string[],
  allowedBins: readonly string[],
  allowedScripts: readonly string[] | undefined,
  role: string,
): { readonly canonicalBin: string; readonly canonicalScript?: string } {
  const canonicalBin = checkExecutableMode(bin, true, role);
  if (isDenylistedInterpreter(canonicalBin)) {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} binary is denylisted: ${canonicalBin}`);
  }
  const canonicalAllowedBins = new Set(allowedBins.map((b) => {
    try { return realpathSync(b); } catch { return b; }
  }));
  if (!canonicalAllowedBins.has(canonicalBin)) {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} binary is not in allowedBins: ${canonicalBin}`);
  }
  checkShebangSafety(canonicalBin, role);
  if (!isNodeInterpreter(canonicalBin)) return { canonicalBin };
  const firstArg = args[0];
  if (!firstArg || NODE_FLAG_REJECTS.has(firstArg) || firstArg.startsWith('-')) {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} Node invocation must pass script path as args[0]`);
  }
  const canonicalScript = checkExecutableMode(firstArg, false, `${role} script`);
  if (!allowedScripts || allowedScripts.length === 0) {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} requires allowedScripts for Node interpreter`);
  }
  const canonicalAllowedScripts = new Set(allowedScripts.map((s) => {
    try { return realpathSync(s); } catch { return s; }
  }));
  if (!canonicalAllowedScripts.has(canonicalScript)) {
    throw new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', `${role} script is not in allowedScripts: ${canonicalScript}`);
  }
  checkShebangSafety(canonicalScript, `${role} script`);
  return { canonicalBin, canonicalScript };
}
