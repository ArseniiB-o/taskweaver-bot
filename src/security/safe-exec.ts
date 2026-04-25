import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SafeExecOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export interface SafeExecResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT = 300_000;
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

export async function safeExec(
  command: string,
  args: string[],
  options: SafeExecOptions = {}
): Promise<SafeExecResult> {
  if (!command || typeof command !== 'string') {
    throw new Error('safeExec: command must be a non-empty string');
  }
  if (/[\s;&|`$<>(){}\\"'*?]/.test(command)) {
    throw new Error('safeExec: command name contains forbidden characters');
  }
  for (const a of args) {
    if (typeof a !== 'string') {
      throw new Error('safeExec: all args must be strings');
    }
  }

  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true,
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : Buffer.from(result.stdout as Uint8Array).toString('utf8');
  const stderr = typeof result.stderr === 'string' ? result.stderr : Buffer.from(result.stderr as Uint8Array).toString('utf8');
  return { stdout, stderr };
}

export async function safeExecOutput(
  command: string,
  args: string[],
  options: SafeExecOptions = {}
): Promise<string> {
  const { stdout, stderr } = await safeExec(command, args, options);
  return stdout || stderr;
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await safeExec('where', [command], { timeout: 5_000 });
    } else {
      await safeExec('which', [command], { timeout: 5_000 });
    }
    return true;
  } catch {
    return false;
  }
}
