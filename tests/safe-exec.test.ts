import { describe, it, expect } from 'vitest';
import { safeExec } from '../src/security/safe-exec.js';

const isWin = process.platform === 'win32';

describe('safeExec', () => {
  it('executes a basic command without shell', async () => {
    const cmd = isWin ? 'cmd' : 'echo';
    const args = isWin ? ['/c', 'echo', 'hello'] : ['hello world'];
    const { stdout } = await safeExec(cmd, args, { timeout: 5_000 });
    expect(stdout).toContain('hello');
  });

  it('rejects shell metacharacters in command name', async () => {
    await expect(safeExec('echo; rm -rf /', [], { timeout: 5_000 })).rejects.toThrow();
    await expect(safeExec('echo`whoami`', [], { timeout: 5_000 })).rejects.toThrow();
  });

  it('treats dangerous chars in args as literal', async () => {
    const cmd = isWin ? 'cmd' : 'echo';
    const args = isWin ? ['/c', 'echo', '$(whoami)'] : ['; rm -rf / `whoami`'];
    const { stdout } = await safeExec(cmd, args, { timeout: 5_000 });
    if (isWin) expect(stdout).toContain('whoami');
    else expect(stdout).toContain('rm -rf');
  });

  it('respects timeout', async () => {
    if (isWin) return;
    await expect(safeExec('sleep', ['10'], { timeout: 200 })).rejects.toThrow();
  });
});
