import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  isValidDomain,
  assertValidDomain,
  isValidHost,
  isPrivateIPv4,
  isPrivateIPv6,
  validateUrl,
  isValidFfmpegTime,
  isValidBitrate,
  clampInt,
  stripControlChars,
} from '../src/security/sanitize.js';

describe('sanitizeFilename', () => {
  it('strips path separators and dangerous chars', () => {
    const result = sanitizeFilename('../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    expect(result.startsWith('.')).toBe(false);
    expect(sanitizeFilename('a"b<c>d|e?f*g.txt')).not.toMatch(/[<>:"|?*]/);
  });
  it('returns fallback for empty', () => {
    expect(sanitizeFilename('', 'fb')).toBe('fb');
    expect(sanitizeFilename('   ', 'fb')).toBe('fb');
  });
  it('rejects null bytes', () => {
    expect(sanitizeFilename('foo\x00.txt')).not.toContain('\x00');
  });
  it('handles long filenames', () => {
    const long = 'a'.repeat(300) + '.txt';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(120);
    expect(sanitizeFilename(long)).toMatch(/\.txt$/);
  });
  it('preserves unicode', () => {
    expect(sanitizeFilename('документ.pdf')).toBe('документ.pdf');
  });
  it('escapes Windows reserved names', () => {
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('com1.txt')).toBe('_com1.txt');
  });
});

describe('isValidDomain / assertValidDomain', () => {
  it('accepts plain domains', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('a.b.c.example.co.uk')).toBe(true);
  });
  it('rejects shell metacharacters', () => {
    expect(isValidDomain('example.com; rm -rf /')).toBe(false);
    expect(isValidDomain('example.com`whoami`')).toBe(false);
    expect(isValidDomain('"injected"')).toBe(false);
    expect(isValidDomain('$(echo pwn)')).toBe(false);
  });
  it('rejects empty / spaces', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain(' ')).toBe(false);
    expect(isValidDomain('foo bar.com')).toBe(false);
  });
  it('throws on invalid', () => {
    expect(() => assertValidDomain('foo;rm')).toThrow();
  });
});

describe('isValidHost', () => {
  it('accepts hostnames and IPs', () => {
    expect(isValidHost('localhost')).toBe(true);
    expect(isValidHost('192.168.1.1')).toBe(true);
    expect(isValidHost('::1')).toBe(true);
    expect(isValidHost('example.com')).toBe(true);
  });
  it('rejects metacharacters', () => {
    expect(isValidHost('host;rm')).toBe(false);
    expect(isValidHost('host`whoami`')).toBe(false);
    expect(isValidHost('host && rm')).toBe(false);
  });
});

describe('isPrivateIPv4', () => {
  it('detects private ranges', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateIPv4('169.254.169.254')).toBe(true);
    expect(isPrivateIPv4('172.16.0.5')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    expect(isPrivateIPv4('100.64.0.1')).toBe(true);
    expect(isPrivateIPv4('0.0.0.0')).toBe(true);
    expect(isPrivateIPv4('255.255.255.255')).toBe(true);
  });
  it('rejects public IPs', () => {
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('1.1.1.1')).toBe(false);
  });
});

describe('isPrivateIPv6', () => {
  it('detects loopback / link-local', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true);
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
  });
});

describe('validateUrl', () => {
  it('accepts public http(s)', () => {
    expect(validateUrl('https://example.com').toString()).toContain('example.com');
  });
  it('rejects file:// and javascript:', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow();
    expect(() => validateUrl('javascript:alert(1)')).toThrow();
    expect(() => validateUrl('gopher://example.com')).toThrow();
  });
  it('rejects credentials in URL', () => {
    expect(() => validateUrl('https://user:pass@example.com')).toThrow();
  });
  it('blocks SSRF to private IPs', () => {
    expect(() => validateUrl('http://127.0.0.1/')).toThrow();
    expect(() => validateUrl('http://169.254.169.254/')).toThrow();
    expect(() => validateUrl('http://10.0.0.1/')).toThrow();
    expect(() => validateUrl('http://192.168.1.1/')).toThrow();
    expect(() => validateUrl('http://[::1]/')).toThrow();
  });
  it('blocks loopback hostnames', () => {
    expect(() => validateUrl('http://localhost/')).toThrow();
    expect(() => validateUrl('http://my.local/')).toThrow();
    expect(() => validateUrl('http://my.internal/')).toThrow();
  });
  it('allows private when explicitly configured', () => {
    expect(validateUrl('http://127.0.0.1/', { allowPrivate: true }).hostname).toBe('127.0.0.1');
  });
});

describe('ffmpeg time / bitrate validators', () => {
  it('accepts valid timestamps', () => {
    expect(isValidFfmpegTime('00:01:30')).toBe(true);
    expect(isValidFfmpegTime('1:30')).toBe(true);
    expect(isValidFfmpegTime('45')).toBe(true);
    expect(isValidFfmpegTime('45.5')).toBe(true);
  });
  it('rejects shell injection in timestamps', () => {
    expect(isValidFfmpegTime('00:01:30; rm -rf /')).toBe(false);
    expect(isValidFfmpegTime('"$(whoami)"')).toBe(false);
    expect(isValidFfmpegTime('')).toBe(false);
  });
  it('validates bitrate format', () => {
    expect(isValidBitrate('128k')).toBe(true);
    expect(isValidBitrate('320K')).toBe(true);
    expect(isValidBitrate('192')).toBe(true);
    expect(isValidBitrate('1m')).toBe(true);
    expect(isValidBitrate('128k; cat /etc/passwd')).toBe(false);
    expect(isValidBitrate('')).toBe(false);
  });
});

describe('clampInt', () => {
  it('clamps to range', () => {
    expect(clampInt(5, 0, 10, 0)).toBe(5);
    expect(clampInt(-1, 0, 10, 0)).toBe(0);
    expect(clampInt(11, 0, 10, 0)).toBe(10);
    expect(clampInt('bad', 0, 10, 3)).toBe(3);
  });
});

describe('stripControlChars', () => {
  it('removes control chars', () => {
    expect(stripControlChars('hello\x00\x07world')).toBe('helloworld');
    expect(stripControlChars('clean')).toBe('clean');
  });
  it('truncates to max', () => {
    expect(stripControlChars('a'.repeat(20), 5).length).toBe(5);
  });
});
