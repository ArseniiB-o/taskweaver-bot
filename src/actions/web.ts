import type { Action } from './types.js';
import { assertValidDomain, assertValidHost, validateUrl } from '../security/sanitize.js';
import { loadConfig } from '../config.js';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { sanitizeFilename } from '../security/sanitize.js';

const DEFAULT_DOWNLOAD_LIMIT = 50 * 1024 * 1024;

function urlOpts() {
  const cfg = loadConfig();
  return { allowPrivate: cfg.allowPrivateUrls };
}

async function safeFetchToFile(url: string, dest: string, maxBytes: number, timeoutMs = 60_000): Promise<void> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { redirect: 'follow', signal: ac.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const declared = Number(resp.headers.get('content-length') ?? '0');
    if (declared && declared > maxBytes) {
      throw new Error(`File too large (${declared} bytes > ${maxBytes})`);
    }
    if (!resp.body) throw new Error('Empty response body');

    let received = 0;
    const stream = Readable.fromWeb(resp.body as any);
    stream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        stream.destroy(new Error(`File exceeds ${maxBytes} bytes`));
      }
    });
    await pipeline(stream, createWriteStream(dest));
  } finally {
    clearTimeout(timeout);
  }
}

export const webActions: Action[] = [
  {
    id: 'web.screenshot',
    category: 'web',
    name: 'Screenshot URL',
    description: 'Take a screenshot of a webpage using wkhtmltoimage',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to screenshot (http/https)' },
      { name: 'width', type: 'number', required: false, description: 'Viewport width in pixels', default: 1280 },
    ],
    async execute(params, ctx) {
      try {
        const url = validateUrl(String(params.url ?? ''), urlOpts()).toString();
        const width = Math.min(4096, Math.max(320, Math.trunc(Number(params.width ?? 1280)) || 1280));
        const outFile = ctx.outputPath('screenshot.png');
        await ctx.runArgs('wkhtmltoimage', ['--width', String(width), url, outFile], { timeout: 30_000 });
        return { files: [outFile] };
      } catch (err) {
        return { error: `Screenshot failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.status_check',
    category: 'web',
    name: 'Check Website Status',
    description: 'Check if a website is up and return status code with headers',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to check' },
    ],
    async execute(params, ctx) {
      try {
        const url = validateUrl(String(params.url ?? ''), urlOpts()).toString();
        const status = await ctx.runArgs(
          'curl',
          ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-w', '%{http_code} %{time_total}s', url],
          { timeout: 15_000 }
        );
        const headers = await ctx.runArgs('curl', ['-s', '-I', '--max-time', '10', url], { timeout: 15_000 });
        return { text: `Status: ${status}\n\nHeaders:\n${headers}` };
      } catch (err) {
        return { error: `Status check failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.dns_lookup',
    category: 'web',
    name: 'DNS Lookup',
    description: 'Perform a DNS lookup for a domain',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to look up' },
    ],
    async execute(params, ctx) {
      try {
        const domain = assertValidDomain(String(params.domain ?? ''));
        try {
          return { text: await ctx.runArgs('dig', [domain], { timeout: 15_000 }) };
        } catch {
          try {
            return { text: await ctx.runArgs('nslookup', [domain], { timeout: 15_000 }) };
          } catch (err) {
            return { error: `dig/nslookup unavailable: ${(err as Error).message}` };
          }
        }
      } catch (err) {
        return { error: `DNS lookup failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.whois',
    category: 'web',
    name: 'WHOIS Lookup',
    description: 'Perform a WHOIS lookup for a domain',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to look up' },
    ],
    async execute(params, ctx) {
      try {
        const domain = assertValidDomain(String(params.domain ?? ''));
        const result = await ctx.runArgs('whois', [domain], { timeout: 30_000 });
        return { text: result };
      } catch (err) {
        return { error: `WHOIS lookup failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.download',
    category: 'web',
    name: 'Download File',
    description: 'Download a file from a URL (max 50MB, http/https only, no private IPs)',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to download' },
    ],
    async execute(params, ctx) {
      try {
        const cfg = loadConfig();
        const url = validateUrl(String(params.url ?? ''), urlOpts());
        const rawName = url.pathname.split('/').pop() || 'downloaded_file';
        const filename = sanitizeFilename(rawName.split('?')[0] || 'downloaded_file', 'downloaded_file');
        const outFile = ctx.outputPath(filename);
        const maxBytes = Math.min(cfg.maxFileSizeBytes, DEFAULT_DOWNLOAD_LIMIT);
        try {
          await safeFetchToFile(url.toString(), outFile, maxBytes, 60_000);
        } catch (err) {
          await unlink(outFile).catch(() => {});
          throw err;
        }
        return { files: [outFile] };
      } catch (err) {
        return { error: `Download failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.headers',
    category: 'web',
    name: 'Show HTTP Headers',
    description: 'Show HTTP response headers for a URL',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to check headers for' },
    ],
    async execute(params, ctx) {
      try {
        const url = validateUrl(String(params.url ?? ''), urlOpts()).toString();
        const result = await ctx.runArgs('curl', ['-s', '-I', '--max-time', '10', url], { timeout: 15_000 });
        return { text: result };
      } catch (err) {
        return { error: `Headers check failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.ssl_check',
    category: 'web',
    name: 'Check SSL Certificate',
    description: 'Check the SSL certificate for a domain',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to check SSL for' },
    ],
    async execute(params, ctx) {
      try {
        const domain = assertValidDomain(String(params.domain ?? ''));
        const result = await ctx.runArgs('openssl', [
          's_client',
          '-connect', `${domain}:443`,
          '-servername', domain,
          '-verify_return_error',
        ], { timeout: 20_000 }).catch(err => `${(err as Error).message}`);
        return { text: result };
      } catch (err) {
        return { error: `SSL check failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.ping',
    category: 'web',
    name: 'Ping Host',
    description: 'Ping a host 4 times and return results',
    params: [
      { name: 'host', type: 'string', required: true, description: 'Host to ping' },
    ],
    async execute(params, ctx) {
      try {
        const host = assertValidHost(String(params.host ?? ''));
        const args = process.platform === 'win32' ? ['-n', '4', host] : ['-c', '4', host];
        const result = await ctx.runArgs('ping', args, { timeout: 20_000 });
        return { text: result };
      } catch (err) {
        return { error: `Ping failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.curl',
    category: 'web',
    name: 'Custom HTTP Request',
    description: 'Make a custom HTTP request via fetch (GET/POST/PUT/DELETE)',
    params: [
      { name: 'url', type: 'string', required: true, description: 'URL to request' },
      { name: 'method', type: 'string', required: false, description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
      { name: 'data', type: 'string', required: false, description: 'Request body data' },
    ],
    async execute(params) {
      try {
        const url = validateUrl(String(params.url ?? ''), urlOpts()).toString();
        const method = String(params.method ?? 'GET').toUpperCase();
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
          return { error: `Unsupported HTTP method: ${method}` };
        }
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 30_000);
        try {
          const resp = await fetch(url, {
            method,
            body: params.data != null ? String(params.data) : undefined,
            signal: ac.signal,
            redirect: 'follow',
          });
          const text = await resp.text();
          const headers: Record<string, string> = {};
          resp.headers.forEach((v, k) => { headers[k] = v; });
          const limited = text.length > 20_000 ? text.slice(0, 20_000) + '\n…(truncated)' : text;
          return { text: `HTTP ${resp.status} ${resp.statusText}\n\nHeaders: ${JSON.stringify(headers, null, 2)}\n\nBody:\n${limited}` };
        } finally {
          clearTimeout(t);
        }
      } catch (err) {
        return { error: `HTTP request failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.ip_lookup',
    category: 'web',
    name: 'IP Geolocation',
    description: 'Look up geolocation information for an IP address',
    params: [
      { name: 'ip', type: 'string', required: true, description: 'Public IP address to look up' },
    ],
    async execute(params) {
      try {
        const ip = String(params.ip ?? '').trim();
        if (!/^[0-9.]{7,15}$|^[0-9a-f:]{2,45}$/i.test(ip)) {
          return { error: 'Invalid IP address' };
        }
        const lookupUrl = validateUrl(`http://ip-api.com/json/${encodeURIComponent(ip)}`, urlOpts()).toString();
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 15_000);
        try {
          const resp = await fetch(lookupUrl, { signal: ac.signal });
          const txt = await resp.text();
          try {
            const parsed = JSON.parse(txt);
            const lines = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join('\n');
            return { text: lines };
          } catch {
            return { text: txt };
          }
        } finally {
          clearTimeout(t);
        }
      } catch (err) {
        return { error: `IP lookup failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.url_encode',
    category: 'web',
    name: 'URL Encode',
    description: 'URL-encode a string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to encode' },
    ],
    async execute(params) {
      try {
        return { text: encodeURIComponent(String(params.text ?? '')) };
      } catch (err) {
        return { error: `URL encode failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'web.url_decode',
    category: 'web',
    name: 'URL Decode',
    description: 'URL-decode a string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to decode' },
    ],
    async execute(params) {
      try {
        return { text: decodeURIComponent(String(params.text ?? '')) };
      } catch (err) {
        return { error: `URL decode failed: ${(err as Error).message}` };
      }
    },
  },
];
