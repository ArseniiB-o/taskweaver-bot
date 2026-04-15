import { execFile, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, mkdir, stat, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, extname, basename } from 'path';
import type { ExecContext } from './actions/types.js';

const execAsync = promisify(execCb);

export async function createWorkDir(): Promise<string> {
  const dir = await mkdtemp(join(process.env.TEMP_DIR || tmpdir(), 'worker-'));
  return dir;
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

export function createExecContext(workDir: string, inputFiles: string[]): ExecContext {
  let outputCounter = 0;
  const runCmd = async (cmd: string, timeout = 300_000) => {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: workDir,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
      shell: 'bash',
    });
    if (stderr && !stdout) return stderr;
    return stdout;
  };
  return {
    workDir,
    inputFiles,
    outputPath: (filename: string) => {
      outputCounter++;
      const name = `${outputCounter}_${filename}`;
      return join(workDir, name);
    },
    exec: runCmd,
    run: runCmd,
    log: (msg: string) => console.log(`[worker] ${msg}`),
  };
}

export function fileExt(filepath: string): string {
  return extname(filepath).slice(1).toLowerCase();
}

export function fileName(filepath: string): string {
  return basename(filepath, extname(filepath));
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => join(dir, e.name));
  } catch {
    return [];
  }
}

export function escPath(p: string): string {
  return p.replace(/\\/g, '/');
}
