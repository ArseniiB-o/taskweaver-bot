export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file';
  required: boolean;
  description: string;
  enum?: string[];
  default?: string | number | boolean;
}

export interface ActionResult {
  files?: string[];
  text?: string;
  error?: string;
}

export interface ExecRunOptions {
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecContext {
  workDir: string;
  inputFiles: string[];
  jobId: string;
  abortSignal?: AbortSignal;
  outputPath: (filename: string) => string;
  runArgs: (command: string, args: string[], options?: ExecRunOptions) => Promise<string>;
  log: (msg: string) => void;
}

export interface Action {
  id: string;
  category: string;
  name: string;
  description: string;
  params: ParamDef[];
  execute: (params: Record<string, unknown>, ctx: ExecContext) => Promise<ActionResult>;
}

export interface PlannedStep {
  action: string;
  params: Record<string, unknown>;
  useOutputFrom?: number | null;
}

export interface ExecutionPlan {
  steps: PlannedStep[];
  message: string;
}
