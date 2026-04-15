# TaskWeaver

AI-powered Telegram bot with 217 built-in actions.

Send any task in plain language. The AI (via OpenRouter) picks the right tools, chains them in order, and returns the result to your Telegram chat.

## Features

217 actions across 11 categories:

| Category | Count | Examples |
|----------|-------|---------|
| audio    | 25    | convert, merge, trim, normalize, BPM detect, waveform |
| video    | 30    | convert, compress, merge, GIF, stabilize, picture-in-picture |
| image    | 35    | resize, crop, QR code, collage, watermark, round corners |
| document | 25    | PDF merge/split/compress, CSV/JSON/XML/YAML conversions |
| archive  | 10    | ZIP, TAR, 7z, RAR create/extract |
| code     | 20    | base64, SHA/MD5, UUID, JWT decode, cron explain |
| text     | 20    | case convert, sort, dedup, extract emails/URLs |
| web      | 12    | ping, DNS, WHOIS, SSL check, HTTP headers, download |
| data     | 15    | calculator, unit convert, Morse code, statistics |
| file     | 15    | hash, split, merge, encoding convert, head/tail |
| security | 10    | AES-256 encrypt/decrypt, password strength, sanitize HTML |

Full list: /actions in the bot.

## How It Works

1. You send a message (+ optional files) to the bot
2. AI sees all 217 action descriptions and creates a JSON execution plan
3. Executor runs the steps sequentially; useOutputFrom pipes outputs between steps
4. Files and text results are sent back to you in Telegram

## Quick Start

```
git clone https://github.com/ArseniiB-o/taskweaver-bot
cd taskweaver-bot
npm install
cp .env.example .env
```

Fill .env:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=google/gemini-2.5-flash
ALLOWED_USERS=123456789
```

```
npm run dev      # development with hot reload
npm run build    # TypeScript build
npm start        # production
```

## Requirements

**Required:**
- Node.js 22+
- ffmpeg (for audio/video actions)
- Telegram Bot Token (from @BotFather)
- OpenRouter API Key (openrouter.ai)

**Optional** (enables more actions):
qpdf, pdftoppm, pdftotext, wkhtmltopdf, openssl, 7z, unrar, diff, tree, whois, dig

Actions that need a missing tool return a helpful error instead of crashing.

## Adding a Custom Action

Add to any src/actions/*.ts file — AI discovers it automatically:

```typescript
{
  id: 'category.action_name',
  category: 'category',
  name: 'Human-readable name',
  description: 'What it does (shown to the AI)',
  params: [
    { name: 'format', type: 'string', required: true, description: 'Target format' },
  ],
  execute: async (params, ctx) => {
    try {
      const output = ctx.outputPath('result.ext');
      await ctx.run('some-cli ' + ctx.inputFiles[0] + ' -o ' + output);
      return { files: [output] };
    } catch (e) {
      return { error: e.message };
    }
  },
}
```

ctx provides: inputFiles, outputPath(name), run(cmd), workDir.

## Project Structure

```
src/
  index.ts         Entry point
  bot.ts           Telegram bot (Telegraf)
  ai.ts            OpenRouter planner
  executor.ts      Pipeline runner
  utils.ts         ExecContext helpers
  actions/
    types.ts       Interfaces
    registry.ts    Catalog builder (feeds AI prompt)
    audio.ts       25 audio actions
    video.ts       30 video actions
    image.ts       35 image actions
    document.ts    25 document actions
    archive.ts     10 archive actions
    code.ts        20 code/dev actions
    text.ts        20 text actions
    web.ts         12 web actions
    data.ts        15 data/math actions
    file.ts        15 file actions
    security.ts    10 security actions
```

## Bot Commands

- /start - welcome message
- /actions - paginated list of all 217 actions

Any other message (with or without files) is processed by the AI.

## Security Notes

- ALLOWED_USERS whitelist in .env (empty = public bot)
- MAX_FILE_SIZE_MB upload limit (default 50MB)
- Isolated temp directory per request, auto-cleaned after completion
- data.calc uses a custom recursive-descent parser, no dynamic code execution
- security.encrypt_text: AES-256-CBC with scrypt key derivation and random IV

## Tech Stack

- Node.js 24 + TypeScript 5
- Telegraf 4 (Telegram API)
- OpenRouter (OpenAI-compatible API for any LLM)
- sharp (image processing)
- pdf-lib (PDF manipulation)
- ffmpeg (media processing via CLI)
- archiver + extract-zip (archive handling)

## Example Prompts

- "Склей три видео в одно"
- "Конвертируй MP4 в GIF, 480px"
- "Объедини все PDF в один файл"
- "Зашифруй файл паролем hunter2"
- "Сколько будет 2^32?"
- "Сгенерируй пароль 20 символов"
- "Возьми фото, добавь круглые углы и водяной знак"
- "Нормализуй громкость аудио"
