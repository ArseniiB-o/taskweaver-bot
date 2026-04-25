# TaskWeaver

AI-powered Telegram bot — natural-language file/media processing with 200+ built-in actions.

Send a request (with or without files) and the AI picks the right tools, chains them, and returns the result.

## Highlights (v2)

- **Hardened command execution** — every shell tool is invoked via `execFile` with an argv array; no string interpolation, no `shell: true`. Closes the wide command-injection surface that was present in v1.
- **SSRF protection** — outbound URLs are validated; private/loopback/link-local IPs are rejected by default (`ALLOW_PRIVATE_URLS` opt-in).
- **Filename sanitisation** — Telegram filenames go through a whitelist before they touch the FS (no path traversal, no Windows reserved names, length-capped).
- **Per-user rate + concurrency limits** — token bucket per user; only one job at a time by default. `/cancel` interrupts a running job mid-step.
- **Plan validation with Zod** — every AI plan is parsed against a strict schema; unknown action ids, out-of-range `useOutputFrom`, missing required params, and bad enums are rejected before execution.
- **Per-job structured logging** — JSON log lines with a `jobId` correlation across download → plan → executor → cleanup.
- **Streaming downloads with size guard** — Telegram and `web.download` stream into the workdir and abort the moment they exceed the per-file budget.
- **Tests, CI, Docker** — Vitest suite (`npm test`), GitHub Actions running typecheck + lint + tests + Docker build, multi-stage Dockerfile that bundles ffmpeg, qpdf, poppler, 7z, etc.

## Quick start

```bash
git clone https://github.com/ArseniiB-o/taskweaver-bot
cd taskweaver-bot
npm install
cp .env.example .env
# fill TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY, ALLOWED_USERS at minimum
npm run dev      # development with hot reload
npm run build && npm start  # production
```

### Docker

```bash
docker build -t taskweaver-bot .
docker run --env-file .env --rm -it taskweaver-bot
```

The image bundles ffmpeg, openssl, poppler-utils, qpdf, p7zip, unrar, dnsutils, whois, ping, and diff. Runs as non-root `worker` (uid 10001) under `tini`.

## Configuration

| Var                       | Default                  | Notes |
|---------------------------|--------------------------|-------|
| `TELEGRAM_BOT_TOKEN`      | —                        | required |
| `OPENROUTER_API_KEY`      | —                        | required |
| `OPENROUTER_MODEL`        | `google/gemini-2.5-flash`| any OpenRouter model |
| `ALLOWED_USERS`           | empty (= public mode)    | comma-separated Telegram user ids; **leaving it empty exposes the bot publicly**, a warning is logged on every request |
| `MAX_FILE_SIZE_MB`        | `50`                     | per-file cap (1–2000) |
| `MAX_FILES_PER_REQUEST`   | `10`                     | |
| `TEMP_DIR`                | OS tmp                   | |
| `RATE_CAPACITY`           | `10`                     | token-bucket size |
| `RATE_REFILL_PER_MINUTE`  | `20`                     | |
| `MAX_CONCURRENT_PER_USER` | `1`                      | |
| `LOG_LEVEL`               | `info`                   | `debug`/`info`/`warn`/`error` |
| `ALLOW_PRIVATE_URLS`      | `false`                  | enable to allow loopback/RFC-1918 in `web.*` and downloads |

## Bot commands

- `/start` — welcome message
- `/actions` — paginated catalog of all action ids
- `/stats` — per-user counters (total / ok / failed / cancelled / tokens)
- `/cancel` — abort the user's currently running job (sends abort signal to the executor, stops the next ffmpeg/curl call)

Anything else is treated as a task description. Files attached on the same message are passed to the executor.

## Architecture

```
src/
  index.ts           Entry point
  config.ts          Env loader + validation
  bot.ts             Telegraf handlers, /stats, /cancel, streaming downloads
  ai.ts              OpenRouter planner with Zod validation + retries
  executor.ts        Sequential plan runner with per-step timeout + abort
  utils.ts           ExecContext, workdir lifecycle
  security/
    safe-exec.ts     execFile-based runner (no shell)
    sanitize.ts      filename / URL / SSRF / domain / host validators
    logger.ts        Structured JSON logger with secret redaction
    rate-limit.ts    Per-user token bucket + concurrency tracker
  actions/
    types.ts         Action / ExecContext / Plan interfaces
    registry.ts      Action catalog
    audio/video/image/document/archive/code/text/web/data/file/security/...
```

### How a request flows

1. Bot middleware checks `ALLOWED_USERS`, then the rate limiter.
2. Files are streamed into a temp dir with sanitised names; size is enforced during download.
3. The user message + file descriptions go to the AI planner. The AI sees only descriptions, not file contents — files cannot inject prompt instructions through their *names* either (control chars stripped, length capped).
4. The plan is parsed with Zod and verified: every `action` id exists, `useOutputFrom` references previous steps only, required params are present, enum constraints hold.
5. The executor copies inputs into a fresh workdir and runs steps sequentially. Each step has a 10-minute timeout and respects an `AbortSignal`.
6. Outputs are streamed back to Telegram. Workdir + download dir are deleted in `finally`.

## Adding an action

```typescript
{
  id: 'category.action_name',
  category: 'category',
  name: 'Human name',
  description: 'What it does (the AI sees this)',
  params: [
    { name: 'format', type: 'string', required: true, description: '...', enum: ['png', 'jpg'] },
  ],
  async execute(params, ctx) {
    try {
      const out = ctx.outputPath('result.png');
      await ctx.runArgs('some-tool', ['--in', ctx.inputFiles[0], '--out', out, '--format', String(params.format)]);
      return { files: [out] };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
}
```

`ctx.runArgs(command, args[])` is the only execution primitive — it forwards to `execFile` with `shell: false`. Never build a shell string. If you need to validate user-controlled args, use the helpers from `src/security/sanitize.ts` (`assertFfmpegTime`, `assertBitrate`, `assertValidDomain`, `validateUrl`, `sanitizeFilename`).

## Development

```bash
npm run dev          # hot reload
npm test             # Vitest
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run coverage     # tests with coverage
```

## Security

See [SECURITY.md](./SECURITY.md) for threat model and reporting.
