import { getAction } from './actions/registry.js';
import { createExecContext, createWorkDir, cleanupWorkDir } from './utils.js';
import type { ExecutionPlan, ActionResult } from './actions/types.js';
import { copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

export interface ExecutionResult {
  success: boolean;
  files: string[];
  text: string;
  error?: string;
  workDir: string;
}

export async function executePlan(
  plan: ExecutionPlan,
  inputFiles: string[],
  onProgress?: (step: number, total: number, actionName: string) => void
): Promise<ExecutionResult> {
  const workDir = await createWorkDir();
  const allOutputFiles: string[] = [];
  const allText: string[] = [];
  const stepResults: ActionResult[] = [];

  // Copy input files to work directory
  const localInputFiles: string[] = [];
  for (const f of inputFiles) {
    const dest = join(workDir, basename(f));
    await copyFile(f, dest);
    localInputFiles.push(dest);
  }

  try {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const action = getAction(step.action);

      if (!action) {
        return {
          success: false,
          files: [],
          text: '',
          error: `Действие "${step.action}" не найдено`,
          workDir,
        };
      }

      onProgress?.(i + 1, plan.steps.length, action.name);

      // Determine input files for this step
      let stepInputFiles = localInputFiles;
      if (step.useOutputFrom !== undefined && step.useOutputFrom !== null) {
        const prevResult = stepResults[step.useOutputFrom];
        if (prevResult?.files) {
          stepInputFiles = prevResult.files;
        }
      }

      const ctx = createExecContext(workDir, stepInputFiles);

      try {
        const result = await action.execute(step.params || {}, ctx);
        stepResults.push(result);

        if (result.error) {
          return {
            success: false,
            files: [],
            text: '',
            error: `Шаг ${i + 1} (${action.name}): ${result.error}`,
            workDir,
          };
        }

        if (result.files) {
          allOutputFiles.push(...result.files);
        }
        if (result.text) {
          allText.push(result.text);
        }
      } catch (err: any) {
        return {
          success: false,
          files: [],
          text: '',
          error: `Шаг ${i + 1} (${action.name}): ${err.message}`,
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
  } catch (err: any) {
    return {
      success: false,
      files: [],
      text: '',
      error: err.message,
      workDir,
    };
  }
}
