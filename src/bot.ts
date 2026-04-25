import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { createPlan } from './ai.js';
import { executePlan } from './executor.js';
import { cleanupWorkDir, fileExt } from './utils.js';
import { stat, unlink, mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { RateLimiter } from './security/rate-limit.js';
import { logger } from './security/logger.js';
import { sanitizeFilename } from './security/sanitize.js';

interface MessageFile {
  fileId: string;
  fileName: string;
  size?: number;
}

interface RequestStats {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

const userStats = new Map<number, RequestStats>();

function bumpStat(userId: number, key: keyof RequestStats): void {
  const cur = userStats.get(userId) ?? { total: 0, succeeded: 0, failed: 0, cancelled: 0 };
  cur[key] = (cur[key] ?? 0) + 1;
  userStats.set(userId, cur);
}

function newJobId(): string {
  return randomBytes(6).toString('hex');
}

async function streamDownloadToFile(
  url: string,
  dest: string,
  maxBytes: number,
  timeoutMs = 120_000
): Promise<number> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let received = 0;
  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const declared = Number(resp.headers.get('content-length') ?? '0');
    if (declared && declared > maxBytes) throw new Error(`File too large: ${declared} bytes > ${maxBytes}`);
    if (!resp.body) throw new Error('Empty response body');

    const stream = Readable.fromWeb(resp.body as any);
    stream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) stream.destroy(new Error(`File exceeds ${maxBytes} bytes`));
    });
    await pipeline(stream, createWriteStream(dest));
    return received;
  } finally {
    clearTimeout(t);
  }
}

export function createBot(): Telegraf {
  const cfg = loadConfig();
  const allowedSet = new Set(cfg.allowedUsers);
  const limiter = new RateLimiter({
    capacity: cfg.rateCapacity,
    refillPerMinute: cfg.rateRefillPerMinute,
    maxConcurrentPerUser: cfg.maxConcurrentPerUser,
  });

  const bot = new Telegraf(cfg.telegramToken, { handlerTimeout: 90_000 });

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (allowedSet.size > 0) {
      if (!userId || !allowedSet.has(userId)) {
        logger.warn('rejected: user not allowed', { userId });
        await ctx.reply('⛔ Нет доступа.').catch(() => {});
        return;
      }
    } else if (userId) {
      logger.warn('public mode: ALLOWED_USERS is empty — anyone can use the bot', { userId });
    }
    return next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🤖 TaskWeaver Bot\n\n' +
      'Отправь файл(ы) с описанием задачи или просто текст.\n\n' +
      'Команды:\n' +
      '• /actions — все действия\n' +
      '• /stats — твоя статистика\n' +
      '• /cancel — отменить активную задачу\n\n' +
      'Примеры:\n' +
      '• Конвертируй в mp3\n' +
      '• Сожми видео\n' +
      '• Сгенерируй QR: https://example.com\n' +
      '• Сколько 2^32?'
    );
  });

  bot.command('actions', async (ctx) => {
    const { buildActionCatalog } = await import('./actions/registry.js');
    const catalog = buildActionCatalog();
    for (const chunk of splitMessage(catalog, 4000)) {
      await ctx.reply(chunk).catch(() => {});
    }
  });

  bot.command('stats', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const stats = userStats.get(userId) ?? { total: 0, succeeded: 0, failed: 0, cancelled: 0 };
    const status = limiter.getStatus(userId);
    await ctx.reply(
      `📊 Stats\n` +
      `Total:     ${stats.total}\n` +
      `OK:        ${stats.succeeded}\n` +
      `Failed:    ${stats.failed}\n` +
      `Cancelled: ${stats.cancelled}\n\n` +
      `Tokens:    ${status.tokens}\n` +
      `Active:    ${status.activeJobs}\n` +
      `In flight: ${status.inFlight}`
    );
  });

  bot.command('cancel', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const cancelled = limiter.cancelJobs(userId);
    await ctx.reply(cancelled > 0 ? `🛑 Отменено задач: ${cancelled}` : 'Активных задач нет.');
  });

  const handler = async (ctx: any) => handleMessage(ctx, limiter);
  bot.on(message('document'), handler);
  bot.on(message('photo'), handler);
  bot.on(message('video'), handler);
  bot.on(message('audio'), handler);
  bot.on(message('voice'), handler);
  bot.on(message('video_note'), handler);
  bot.on(message('sticker'), handler);
  bot.on(message('text'), handler);

  bot.catch((err) => {
    logger.error('Bot error', { err });
  });

  return bot;
}

async function handleMessage(ctx: any, limiter: RateLimiter): Promise<void> {
  const userId = ctx.from?.id as number | undefined;
  if (!userId) return;

  const userText = String(ctx.message?.text ?? ctx.message?.caption ?? '').slice(0, 4000);
  const files: MessageFile[] = [];

  const collect = (fileId: string, fileName: string, size?: number) => {
    files.push({ fileId, fileName, size });
  };

  if (ctx.message?.document) collect(ctx.message.document.file_id, ctx.message.document.file_name || 'document', ctx.message.document.file_size);
  if (ctx.message?.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    collect(photo.file_id, 'photo.jpg', photo.file_size);
  }
  if (ctx.message?.video) collect(ctx.message.video.file_id, ctx.message.video.file_name || 'video.mp4', ctx.message.video.file_size);
  if (ctx.message?.audio) collect(ctx.message.audio.file_id, ctx.message.audio.file_name || 'audio.mp3', ctx.message.audio.file_size);
  if (ctx.message?.voice) collect(ctx.message.voice.file_id, 'voice.ogg', ctx.message.voice.file_size);
  if (ctx.message?.video_note) collect(ctx.message.video_note.file_id, 'videonote.mp4', ctx.message.video_note.file_size);
  if (ctx.message?.sticker?.file_id) collect(ctx.message.sticker.file_id, 'sticker.webp', ctx.message.sticker.file_size);

  if (!userText && files.length === 0) return;
  if (!userText && files.length > 0) {
    await ctx.reply('📎 Файл получен. Что с ним сделать? Напиши задачу.').catch(() => {});
    return;
  }

  const cfg = loadConfig();
  if (files.length > cfg.maxTotalFilesPerRequest) {
    await ctx.reply(`⚠️ Слишком много файлов (макс ${cfg.maxTotalFilesPerRequest}).`).catch(() => {});
    return;
  }

  const acquire = limiter.tryAcquire(userId);
  if (!acquire.ok) {
    if (acquire.reason === 'too_many_concurrent') {
      await ctx.reply('⏳ У тебя уже выполняется задача. Жди завершения или используй /cancel.').catch(() => {});
    } else {
      await ctx.reply(`⏳ Лимит запросов. Повтори через ${acquire.retryAfterSec ?? 60}с.`).catch(() => {});
    }
    return;
  }

  const jobId = newJobId();
  const log = logger.child({ jobId, userId });
  const ac = new AbortController();
  limiter.registerJob(userId, jobId, () => ac.abort());
  bumpStat(userId, 'total');

  let downloadDir = '';
  let workDirToCleanup = '';

  try {
    await ctx.reply('🔄 Анализирую запрос...').catch(() => {});

    downloadDir = await mkdtemp(join(tmpdir(), 'tgaiw-dl-'));

    const downloadedFiles: string[] = [];
    const fileDescriptions: string[] = [];

    for (const f of files) {
      try {
        const fileLink = await ctx.telegram.getFileLink(f.fileId);
        const safeName = sanitizeFilename(f.fileName, 'file');
        const tmpPath = join(downloadDir, `${downloadedFiles.length}_${safeName}`);
        const size = await streamDownloadToFile(fileLink.href, tmpPath, cfg.maxFileSizeBytes, 120_000);
        downloadedFiles.push(tmpPath);
        fileDescriptions.push(`${safeName} (${formatSize(size)})`);
      } catch (err) {
        log.warn('download failed', { fileName: f.fileName, err });
        await ctx.reply(`⚠️ Не удалось скачать ${f.fileName}: ${(err as Error).message}`).catch(() => {});
      }
    }

    const plan = await createPlan(userText, fileDescriptions);

    if (plan.steps.length === 0) {
      await ctx.reply(`ℹ️ ${plan.message}`).catch(() => {});
      bumpStat(userId, 'failed');
      return;
    }

    await ctx.reply(`📋 ${plan.message}\n⏳ Шагов: ${plan.steps.length} (jobId: ${jobId})`).catch(() => {});

    const result = await executePlan(plan, downloadedFiles, {
      jobId,
      abortSignal: ac.signal,
      onProgress: async (step, total, name) => {
        if (total > 1) await ctx.reply(`⚙️ ${step}/${total}: ${name}...`).catch(() => {});
      },
    });

    workDirToCleanup = result.workDir;

    if (!result.success) {
      bumpStat(userId, result.cancelled ? 'cancelled' : 'failed');
      await ctx.reply(`❌ ${result.cancelled ? 'Отменено' : 'Ошибка'}: ${result.error}`).catch(() => {});
      return;
    }

    bumpStat(userId, 'succeeded');

    if (result.text) {
      for (const chunk of splitMessage(result.text, 4000)) {
        await ctx.reply(chunk).catch(() => {});
      }
    }

    for (const filePath of result.files) {
      try {
        const fileStat = await stat(filePath);
        if (fileStat.size > 50 * 1024 * 1024) {
          await ctx.reply(`⚠️ Файл слишком большой (${formatSize(fileStat.size)}).`).catch(() => {});
          continue;
        }
        const ext = fileExt(filePath);
        const source = { source: filePath };
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) && fileStat.size < 10 * 1024 * 1024) {
          await ctx.replyWithPhoto(source).catch(() => ctx.replyWithDocument(source));
        } else if (['mp4', 'mov'].includes(ext) && fileStat.size < 50 * 1024 * 1024) {
          await ctx.replyWithVideo(source).catch(() => ctx.replyWithDocument(source));
        } else if (ext === 'ogg') {
          await ctx.replyWithVoice(source).catch(() => ctx.replyWithDocument(source));
        } else if (['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) {
          await ctx.replyWithAudio(source).catch(() => ctx.replyWithDocument(source));
        } else {
          await ctx.replyWithDocument(source).catch(() => {});
        }
      } catch (err) {
        log.warn('send file failed', { filePath, err });
      }
    }

    if (!result.text && result.files.length === 0) {
      await ctx.reply('✅ Готово!').catch(() => {});
    }
  } catch (err) {
    log.error('handler crashed', { err });
    bumpStat(userId, 'failed');
    await ctx.reply(`❌ Внутренняя ошибка.`).catch(() => {});
  } finally {
    limiter.unregisterJob(userId, jobId);
    limiter.release(userId);
    if (workDirToCleanup) await cleanupWorkDir(workDirToCleanup);
    if (downloadDir) {
      const { rm } = await import('node:fs/promises');
      await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
