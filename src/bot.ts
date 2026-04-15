import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { createPlan } from './ai.js';
import { executePlan } from './executor.js';
import { cleanupWorkDir, fileExt } from './utils.js';
import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || '50') || 50) * 1024 * 1024;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number);

export function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new Telegraf(token);

  // Auth middleware
  bot.use(async (ctx, next) => {
    if (ALLOWED_USERS.length > 0) {
      const userId = ctx.from?.id;
      if (!userId || !ALLOWED_USERS.includes(userId)) {
        await ctx.reply('⛔ Нет доступа.');
        return;
      }
    }
    return next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🤖 AI Worker Bot\n\n' +
      'Отправь мне файл(ы) с описанием задачи, или просто текстовый запрос.\n\n' +
      'Примеры:\n' +
      '• Конвертируй в mp3\n' +
      '• Сожми видео\n' +
      '• Объедини эти PDF\n' +
      '• Сгенерируй QR-код: https://example.com\n' +
      '• Посчитай 2^32\n' +
      '• Сгенерируй пароль 20 символов\n\n' +
      '/actions — список всех действий'
    );
  });

  bot.command('actions', async (ctx) => {
    const { buildActionCatalog } = await import('./actions/registry.js');
    const catalog = buildActionCatalog();

    // Split into chunks if too long for Telegram
    const chunks = splitMessage(catalog, 4000);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  });

  // Handle messages with files
  bot.on(message('document'), handleMessage);
  bot.on(message('photo'), handleMessage);
  bot.on(message('video'), handleMessage);
  bot.on(message('audio'), handleMessage);
  bot.on(message('voice'), handleMessage);
  bot.on(message('video_note'), handleMessage);
  bot.on(message('sticker'), handleMessage);
  bot.on(message('text'), handleMessage);

  return bot;
}

async function handleMessage(ctx: any): Promise<void> {
  const userText = ctx.message?.text || ctx.message?.caption || '';
  const files: Array<{ fileId: string; fileName: string }> = [];

  // Collect file IDs from message
  if (ctx.message?.document) {
    files.push({
      fileId: ctx.message.document.file_id,
      fileName: ctx.message.document.file_name || 'document',
    });
  }
  if (ctx.message?.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    files.push({ fileId: photo.file_id, fileName: 'photo.jpg' });
  }
  if (ctx.message?.video) {
    files.push({
      fileId: ctx.message.video.file_id,
      fileName: ctx.message.video.file_name || 'video.mp4',
    });
  }
  if (ctx.message?.audio) {
    files.push({
      fileId: ctx.message.audio.file_id,
      fileName: ctx.message.audio.file_name || 'audio.mp3',
    });
  }
  if (ctx.message?.voice) {
    files.push({ fileId: ctx.message.voice.file_id, fileName: 'voice.ogg' });
  }
  if (ctx.message?.video_note) {
    files.push({ fileId: ctx.message.video_note.file_id, fileName: 'videonote.mp4' });
  }
  if (ctx.message?.sticker?.file_id) {
    files.push({ fileId: ctx.message.sticker.file_id, fileName: 'sticker.webp' });
  }

  // If no text and no files, ignore
  if (!userText && files.length === 0) return;

  // If only file without text, ask what to do
  if (!userText && files.length > 0) {
    await ctx.reply('📎 Файл получен. Что с ним сделать? Напиши задачу.');
    return;
  }

  // Check for pending files in media group
  const pendingFiles = (ctx as any).__pendingFiles || [];

  try {
    await ctx.reply('🔄 Анализирую запрос...');

    // Download files
    const downloadedFiles: string[] = [];
    const fileDescriptions: string[] = [];

    for (const f of files) {
      try {
        const fileLink = await ctx.telegram.getFileLink(f.fileId);
        const tmpPath = join(tmpdir(), `tgdl_${Date.now()}_${f.fileName}`);

        const response = await fetch(fileLink.href);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_FILE_SIZE) {
          await ctx.reply(`⚠️ Файл ${f.fileName} слишком большой (макс ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
          continue;
        }

        await writeFile(tmpPath, buffer);
        downloadedFiles.push(tmpPath);
        fileDescriptions.push(`${f.fileName} (${formatSize(buffer.length)})`);
      } catch (err: any) {
        await ctx.reply(`⚠️ Не удалось скачать ${f.fileName}: ${err.message}`);
      }
    }

    // Create AI plan
    const plan = await createPlan(userText, fileDescriptions);

    if (plan.steps.length === 0) {
      await ctx.reply(`ℹ️ ${plan.message}`);
      return;
    }

    await ctx.reply(`📋 План: ${plan.message}\n⏳ Выполняю ${plan.steps.length} шаг(ов)...`);

    // Execute plan
    const result = await executePlan(plan, downloadedFiles, async (step, total, name) => {
      if (total > 1) {
        await ctx.reply(`⚙️ Шаг ${step}/${total}: ${name}...`).catch(() => {});
      }
    });

    // Send results
    if (!result.success) {
      await ctx.reply(`❌ Ошибка: ${result.error}`);
    } else {
      // Send text results
      if (result.text) {
        const chunks = splitMessage(result.text, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }

      // Send file results
      for (const filePath of result.files) {
        try {
          const fileStat = await stat(filePath);
          if (fileStat.size > 50 * 1024 * 1024) {
            await ctx.reply(`⚠️ Файл слишком большой для отправки через Telegram (${formatSize(fileStat.size)})`);
            continue;
          }

          const ext = fileExt(filePath);
          const source = { source: filePath };

          if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) && fileStat.size < 10 * 1024 * 1024) {
            await ctx.replyWithPhoto(source);
          } else if (['mp4', 'mov', 'avi'].includes(ext) && fileStat.size < 50 * 1024 * 1024) {
            await ctx.replyWithVideo(source);
          } else if (['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) {
            await ctx.replyWithAudio(source);
          } else if (ext === 'ogg') {
            await ctx.replyWithVoice(source);
          } else {
            await ctx.replyWithDocument(source);
          }
        } catch (err: any) {
          await ctx.reply(`⚠️ Не удалось отправить файл: ${err.message}`);
        }
      }

      if (!result.text && result.files.length === 0) {
        await ctx.reply('✅ Готово!');
      }
    }

    // Cleanup
    await cleanupWorkDir(result.workDir);
  } catch (err: any) {
    console.error('Handler error:', err);
    await ctx.reply(`❌ Ошибка: ${err.message}`);
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
    if (splitAt === -1 || splitAt < maxLen / 2) {
      splitAt = maxLen;
    }

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
