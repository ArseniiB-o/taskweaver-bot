function parseIntEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseUserList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Number.parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0);
}

export interface AppConfig {
  telegramToken: string;
  openrouterApiKey: string;
  openrouterModel: string;
  allowedUsers: number[];
  maxFileSizeBytes: number;
  maxTotalFilesPerRequest: number;
  tempDir: string;
  rateCapacity: number;
  rateRefillPerMinute: number;
  maxConcurrentPerUser: number;
  webhookEnabled: boolean;
  healthCheckPort: number;
  allowPrivateUrls: boolean;
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const openrouterApiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!telegramToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!openrouterApiKey) throw new Error('OPENROUTER_API_KEY is required');

  cached = {
    telegramToken,
    openrouterApiKey,
    openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
    allowedUsers: parseUserList(process.env.ALLOWED_USERS),
    maxFileSizeBytes: parseIntEnv('MAX_FILE_SIZE_MB', 50, 1, 2000) * 1024 * 1024,
    maxTotalFilesPerRequest: parseIntEnv('MAX_FILES_PER_REQUEST', 10, 1, 50),
    tempDir: process.env.TEMP_DIR || '',
    rateCapacity: parseIntEnv('RATE_CAPACITY', 10, 1, 1000),
    rateRefillPerMinute: parseIntEnv('RATE_REFILL_PER_MINUTE', 20, 1, 10000),
    maxConcurrentPerUser: parseIntEnv('MAX_CONCURRENT_PER_USER', 1, 1, 10),
    webhookEnabled: (process.env.WEBHOOK_ENABLED || '').toLowerCase() === 'true',
    healthCheckPort: parseIntEnv('HEALTHCHECK_PORT', 0, 0, 65535),
    allowPrivateUrls: (process.env.ALLOW_PRIVATE_URLS || '').toLowerCase() === 'true',
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
