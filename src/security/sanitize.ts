import { isIP } from 'node:net';

const FILENAME_MAX_LEN = 120;
const FILENAME_INVALID = /[<>:"/\\|?*\x00-\x1f]/g;
const FILENAME_RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFilename(input: string, fallback = 'file'): string {
  if (!input || typeof input !== 'string') return fallback;
  let name = input.normalize('NFKC').replace(FILENAME_INVALID, '_').replace(/^\.+/, '_');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) return fallback;
  if (name.length > FILENAME_MAX_LEN) {
    const dot = name.lastIndexOf('.');
    if (dot > 0 && dot > name.length - 12) {
      name = name.slice(0, FILENAME_MAX_LEN - (name.length - dot)) + name.slice(dot);
    } else {
      name = name.slice(0, FILENAME_MAX_LEN);
    }
  }
  const stem = name.split('.')[0] ?? name;
  if (FILENAME_RESERVED_WIN.test(stem)) name = '_' + name;
  return name;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isValidDomain(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  return DOMAIN_RE.test(input.trim());
}

export function assertValidDomain(input: string): string {
  const v = (input ?? '').trim();
  if (!isValidDomain(v)) {
    throw new Error(`Invalid domain: ${JSON.stringify(input)}`);
  }
  return v;
}

const HOST_RE = /^[a-z0-9._-]{1,253}$/i;

export function isValidHost(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const v = input.trim();
  if (isIP(v)) return true;
  return HOST_RE.test(v) && !v.startsWith('-') && !v.endsWith('-');
}

export function assertValidHost(input: string): string {
  const v = (input ?? '').trim();
  if (!isValidHost(v)) {
    throw new Error(`Invalid host: ${JSON.stringify(input)}`);
  }
  return v;
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('ff')) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

export interface UrlValidationOptions {
  allowedSchemes?: string[];
  allowPrivate?: boolean;
}

export function validateUrl(input: string, opts: UrlValidationOptions = {}): URL {
  const allowedSchemes = opts.allowedSchemes ?? ['http:', 'https:'];
  const allowPrivate = opts.allowPrivate ?? false;
  if (!input || typeof input !== 'string') throw new Error('URL is required');

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid URL: ${JSON.stringify(input)}`);
  }
  if (!allowedSchemes.includes(url.protocol)) {
    throw new Error(`Disallowed URL scheme "${url.protocol}". Allowed: ${allowedSchemes.join(', ')}`);
  }
  if (url.username || url.password) {
    throw new Error('URLs with credentials are not allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL host is empty');

  if (!allowPrivate) {
    const ipKind = isIP(host);
    if (ipKind === 4 && isPrivateIPv4(host)) {
      throw new Error('URL points to a private/loopback IPv4 address');
    }
    if (ipKind === 6 && isPrivateIPv6(host)) {
      throw new Error('URL points to a private/loopback IPv6 address');
    }
    if (ipKind === 0) {
      const lowered = host.toLowerCase();
      const blockedHosts = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
      if (blockedHosts.has(lowered)) {
        throw new Error('URL points to a loopback hostname');
      }
      if (lowered.endsWith('.localhost') || lowered.endsWith('.local') || lowered.endsWith('.internal')) {
        throw new Error('URL points to an internal hostname');
      }
    }
  }
  return url;
}

export function assertSafeUrl(input: string, opts: UrlValidationOptions = {}): string {
  return validateUrl(input, opts).toString();
}

const FFMPEG_TIME_RE = /^(\d+:)?\d{1,3}(:\d{1,2}(\.\d+)?)?$|^\d+(\.\d+)?$/;

export function isValidFfmpegTime(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  return FFMPEG_TIME_RE.test(input.trim());
}

export function assertFfmpegTime(input: string): string {
  const v = (input ?? '').trim();
  if (!isValidFfmpegTime(v)) {
    throw new Error(`Invalid timestamp: ${JSON.stringify(input)}`);
  }
  return v;
}

const BITRATE_RE = /^\d{1,5}[kKmM]?$/;

export function isValidBitrate(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  return BITRATE_RE.test(input.trim());
}

export function assertBitrate(input: string): string {
  const v = (input ?? '').trim();
  if (!isValidBitrate(v)) {
    throw new Error(`Invalid bitrate: ${JSON.stringify(input)}`);
  }
  return v;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

const CONTROL_CHAR_RE = /[\x00-\x08\x0e-\x1f\x7f]/g;

export function stripControlChars(input: string, max = 4_000): string {
  if (!input || typeof input !== 'string') return '';
  return input.replace(CONTROL_CHAR_RE, '').slice(0, max);
}
