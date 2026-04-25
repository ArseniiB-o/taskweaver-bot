import { getAction } from './actions/registry.js';
import { createExecContext, createWorkDir } from './utils.js';
import type { ExecutionPlan, ActionResult } from './actions/types.js';
import { copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { logger } from './security/logger.js';
import { sanitizeFilename } from './security/sanitize.js';

export interface ExecutionResult {
  success: boolean;
  files: string[];
  text: string;
  error?: string;
  workDir: string;
  cancelled?: boolean;
}

export interface ExecutionOptions {
  jobId: string;
  abortSignal?: AbortSignal;
  onProgress?: (step: number, total: number, actionName: string) => void | Promise<void>;
}

const PER_STEP_TIMEOUT = 10 * 60_000;

function scrubError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/\b\/(?:home|Users|root|tmp|var)\/[^\s"]+/g, '<path>')
    .replace(/\b[A-Z]:\\[^\s"]+/g, '<path>')
    .slice(0, 400);
}

export async function executePlan(
  plan: ExecutionPlan,
  inputFiles: string[],
  options: ExecutionOptions
): Promise<ExecutionResult> {
  const log = logger.child({ jobId: options.jobId });
  const workDir = await createWorkDir();
  const allOutputFiles: string[] = [];
  const allText: string[] = [];
  const stepResults: ActionResult[] = [];

  const localInputFiles: string[] = [];
  for (const f of inputFiles) {
    const safe = sanitizeFilename(basename(f), 'input');
    const dest = join(workDir, `in_${localInputFiles.length}_${safe}`);
    await copyFile(f, dest);
    localInputFiles.push(dest);
  }

  try {
    for (let i = 0; i < plan.steps.length; i++) {
      if (options.abortSignal?.aborted) {
        return {
          success: false,
          files: [],
          text: '',
          error: 'Job cancelled',
          workDir,
          cancelled: true,
        };
      }

      const step = plan.steps[i];
      const action = getAction(step.action);
      if (!action) {
        return {
          success: false,
          files: [],
          text: '',
          error: `Action not found: ${step.action}`,
          workDir,
        };
      }

      try {
        await options.onProgress?.(i + 1, plan.steps.length, action.name);
      } catch (err) {
        log.debug('progress callback failed', { err });
      }

      let stepInputFiles = localInputFiles;
      if (step.useOutputFrom != null) {
        const prev = stepResults[step.useOutputFrom];
        if (prev?.files && prev.files.length > 0) {
          stepInputFiles = prev.files;
        }
      }

      const ctx = createExecContext(workDir, stepInputFiles, {
        jobId: options.jobId,
        abortSignal: options.abortSignal,
      });

      try {
        const stepPromise = action.execute(step.params ?? {}, ctx);
        const timeoutPromise = new Promise<ActionResult>((_, reject) =>
          setTimeout(() => reject(new Error('Step timeout exceeded')), PER_STEP_TIMEOUT)
        );
        const result = await Promise.race([stepPromise, timeoutPromise]);
        stepResults.push(result);

        if (result.error) {
          return {
            success: false,
            files: [],
            text: '',
            error: `Step ${i + 1} (${action.name}): ${result.error}`.slice(0, 600),
            workDir,
          };
        }

        if (result.files) allOutputFiles.push(...result.files);
        if (result.text) allText.push(result.text);
      } catch (err) {
        return {
          success: false,
          files: [],
          text: '',
          error: `Step ${i + 1} (${action.name}): ${scrubError(err)}`,
          workDir,
        };
      }
    }

    return {
      success: true,
      files: allOutputFiles,
      text: allText.join('\n\n'),
      workDir,
    };
  } catch (err) {
    return {
      success: false,
      files: [],
      text: '',
      error: scrubError(err),
      workDir,
    };
  }
}
