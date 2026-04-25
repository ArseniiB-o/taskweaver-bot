type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): Level {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') return env;
  return 'info';
}

let cachedLevel: Level = activeLevel();

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[cachedLevel];
}

function safeStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, replacer);
  } catch {
    return String(value);
  }
}

const SECRET_KEYS = /^(.*(token|key|secret|password|authorization|cookie).*)$/i;

function replacer(this: unknown, key: string, value: unknown): unknown {
  if (key && SECRET_KEYS.test(key)) return '[redacted]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  };
  const line = safeStringify(payload);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
  child: (bindings: Record<string, unknown>) => ({
    debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, { ...bindings, ...(fields ?? {}) }),
    info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, { ...bindings, ...(fields ?? {}) }),
    warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, { ...bindings, ...(fields ?? {}) }),
    error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, { ...bindings, ...(fields ?? {}) }),
  }),
  setLevel: (level: Level) => { cachedLevel = level; },
};

export type Logger = typeof logger;
