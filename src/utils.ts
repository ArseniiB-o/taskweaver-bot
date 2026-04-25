import { mkdtemp, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import type { ExecContext } from './actions/types.js';
import { safeExec } from './security/safe-exec.js';
import { logger } from './security/logger.js';
import { sanitizeFilename } from './security/sanitize.js';

export async function createWorkDir(): Promise<string> {
  const root = process.env.TEMP_DIR || tmpdir();
  return mkdtemp(join(root, 'tgaiw-'));
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  if (!dir || !dir.includes('tgaiw-')) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    logger.debug('cleanupWorkDir failed', { dir, err });
  }
}

export interface ExecContextOptions {
  jobId: string;
  abortSignal?: AbortSignal;
}

export function createExecContext(
  workDir: string,
  inputFiles: string[],
  options: ExecContextOptions
): ExecContext {
  let outputCounter = 0;
  const log = logger.child({ jobId: options.jobId });

  const runArgs = async (
    command: string,
    args: string[],
    runOpts: { timeout?: number; maxBuffer?: number } = {}
  ): Promise<string> => {
    if (options.abortSignal?.aborted) {
      throw new Error('Job cancelled');
    }
    log.debug('exec', { command, args });
    const { stdout, stderr } = await safeExec(command, args, {
      cwd: workDir,
      timeout: runOpts.timeout,
      maxBuffer: runOpts.maxBuffer,
    });
    return stdout || stderr;
  };

  return {
    workDir,
    inputFiles,
    jobId: options.jobId,
    abortSignal: options.abortSignal,
    outputPath: (filename: string) => {
      outputCounter += 1;
      const safe = sanitizeFilename(filename, `out-${outputCounter}`);
      return join(workDir, `${outputCounter}_${safe}`);
    },
    runArgs,
    log: (msg: string) => log.info(msg),
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
