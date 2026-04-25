# Security

## Threat model (v2)

| Threat                           | Mitigation |
|----------------------------------|------------|
| Command injection via shell      | All shell tools are invoked via `execFile` with `shell: false` and an `args[]` array. The original v1 string-interpolated `ctx.exec` API is gone. |
| SSRF (private IPs, metadata API) | `validateUrl` rejects loopback, RFC-1918, link-local, multicast, and `*.local`/`*.internal` hosts unless `ALLOW_PRIVATE_URLS=true`. |
| Path traversal via filenames     | Telegram-supplied filenames pass through `sanitizeFilename` (path separators, control chars, Windows reserved names, length cap, leading-dot strip). |
| Prompt injection via file names  | File names visible to the planner are stripped of control characters and length-capped; the system prompt instructs the model to treat them as data only. |
| Plan tampering / hallucination   | Plans are validated with Zod before execution: schema, action existence, `useOutputFrom` ordering, required params, enum constraints. |
| Resource abuse / cost bombing    | Per-user token bucket (refill-per-minute) plus a concurrency cap; the AI catalog is built once and reused. Per-step timeout (10 minutes) and an `AbortController` wired through `/cancel`. |
| Disk leaks                       | Per-job tempdir + per-job download dir, both cleaned in `finally`. Stream-based downloads enforce the byte budget mid-flight. |
| Secret exposure in logs          | The structured logger redacts any field whose key matches `/token|key|secret|password|authorization|cookie/i`. |
| Public deployment by accident    | `ALLOWED_USERS=` empty is allowed but logs a warning on every request. `.env.example` calls this out. |

## Default-deny posture

The bot **does not** default-deny — `ALLOWED_USERS=` empty means anyone who finds the bot can use it. This is preserved from v1 for compatibility, but the `.env.example` warns and a startup-time `info` log records `publicMode: true`. For any deployment beyond solo testing, set `ALLOWED_USERS`.

## Reporting

Open a private GitHub security advisory or contact the repository owner directly.

## Out of scope

- Hardening of third-party CLIs (`ffmpeg`, `qpdf`, `wkhtmltopdf`, `7z`, `unrar`). They are pinned via the Docker image; do not add untrusted CLIs to the image without review.
- Telegram-side abuse (spam blocking, IP bans). Use Telegram's BotFather settings.
