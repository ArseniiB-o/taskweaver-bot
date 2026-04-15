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

export interface ExecContext {
  workDir: string;
  inputFiles: string[];
  outputPath: (filename: string) => string;
  exec: (cmd: string, timeout?: number) => Promise<string>;
  run: (cmd: string, timeout?: number) => Promise<string>;
  log: (msg: string) => void;
}

export interface Action {
  id: string;
  category: string;
  name: string;
  description: string;
  params: ParamDef[];
  execute: (params: Record<string, any>, ctx: ExecContext) => Promise<ActionResult>;
}

export interface PlannedStep {
  action: string;
  params: Record<string, any>;
  useOutputFrom?: number;
}

export interface ExecutionPlan {
  steps: PlannedStep[];
  message: string;
}
