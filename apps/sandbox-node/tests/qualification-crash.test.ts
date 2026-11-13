import { describe, expect, it, vi } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualifyCrashAndFailure } from '../src/qualification-crash.js';
import { assertCleanStartup } from '../src/restart.js';
vi.mock('../src/restart.js', () => ({ assertCleanStartup: vi.fn() }));
vi.mock('../src/qualification-processes.js', () => ({ assertQualificationProcessesGone: vi.fn() }));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>(); let kills = 0;
  return { ...actual, readFileSync: (path: string, ...args: any[]) => path.endsWith('/memory.events')
    ? `oom_kill ${kills++}` : (actual.readFileSync as any)(path, ...args) };
});
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(), spawn: vi.fn(actual.spawn) };
});

describe('crash gate parent supervision', () => {
  it('should really SIGKILL its child and reconcile each policy, also after workload failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qualification-crash-'));
    writeFileSync(join(directory, 'qualification.erofs'), 'fixture');
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const launched: Array<{ path: string; network: string }> = [];
    let surviving = false;
    vi.mocked(spawn).mockImplementation((_file, args) => {
      const path = String(args?.[1]);
      surviving = true;
      const child = actual.spawn(process.execPath, ['-e', `
        const f=require('fs'),p=${JSON.stringify(path)};
        const options=JSON.parse(f.readFileSync(p+'/options.json'));
        f.writeFileSync(p+'/ready.json',JSON.stringify({pids:[],namespaces:[]}));
        if(options.command[2].includes('process.exit(1)')||options.command[2].includes('buffers'))setTimeout(()=>process.exit(7),50);
        else setInterval(()=>{},1000);
      `]);
      launched.push({ path, network: existsSync(join(path, 'options.json')) ? 'recorded' : 'missing' });
      return child;
    });
    vi.mocked(execFileSync).mockImplementation(file => { if (file === 'runsc') surviving = false; return ''; });
    vi.mocked(assertCleanStartup).mockImplementation(() => {
      // Once ready exists, the crashed scope inventory must block startup.
      if (surviving) throw new Error('startup blocked: surviving sandbox resources');
    });
    try {
      await qualifyCrashAndFailure(directory, directory);
      expect(launched).toHaveLength(6);
      expect(launched.every(item => item.network === 'recorded')).toBe(true);
      expect(readdirSync(directory)).toEqual(['qualification.erofs']);
      expect(execFileSync).toHaveBeenCalledWith('runsc', expect.arrayContaining(['list']), expect.anything());
    } finally { vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); }
  });
});
