import type { Action } from './types.js';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync, generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import sanitizeHtml from 'sanitize-html';
import { assertValidDomain } from '../security/sanitize.js';

const generateKeyPairAsync = promisify(generateKeyPair);

function deriveKeyAndIv(password: string, salt: Buffer): { key: Buffer; iv: Buffer } {
  const derived = scryptSync(password, salt, 48) as Buffer;
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

function scorePassword(password: string): { score: number; feedback: string[] } {
  const feedback: string[] = [];
  let score = 0;
  if (password.length >= 8) score += 1; else feedback.push('Use at least 8 characters');
  if (password.length >= 12) score += 1; else feedback.push('12+ characters recommended');
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password)) score += 1; else feedback.push('Add lowercase letters');
  if (/[A-Z]/.test(password)) score += 1; else feedback.push('Add uppercase letters');
  if (/[0-9]/.test(password)) score += 1; else feedback.push('Add digits');
  if (/[^a-zA-Z0-9]/.test(password)) score += 2; else feedback.push('Add symbols (!@#$...)');
  if (/(.)\1{2,}/.test(password)) { score -= 1; feedback.push('Avoid repeated characters'); }
  if (/^[a-zA-Z]+$/.test(password)) { score -= 1; feedback.push('Mix with digits/symbols'); }
  if (/^[0-9]+$/.test(password)) { score -= 2; feedback.push('Do not use only digits'); }
  return { score: Math.max(0, Math.min(score, 5)), feedback };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function pickIndex(byteVal: number, max: number): number {
  return byteVal % max;
}

export const securityActions: Action[] = [
  {
    id: 'security.password_generate',
    category: 'security',
    name: 'Generate Password',
    description: 'Generate a cryptographically random password with configurable character sets',
    params: [
      { name: 'length',    type: 'number',  required: false, description: 'Password length', default: 16 },
      { name: 'uppercase', type: 'boolean', required: false, description: 'Include uppercase letters', default: true },
      { name: 'lowercase', type: 'boolean', required: false, description: 'Include lowercase letters', default: true },
      { name: 'numbers',   type: 'boolean', required: false, description: 'Include digits', default: true },
      { name: 'symbols',   type: 'boolean', required: false, description: 'Include symbols', default: true },
    ],
    async execute(params) {
      try {
        const length = Math.min(Math.max(Number(params.length ?? 16) || 16, 4), 256);
        const useUpper   = params.uppercase !== false;
        const useLower   = params.lowercase !== false;
        const useNumbers = params.numbers   !== false;
        const useSymbols = params.symbols   !== false;

        const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lower   = 'abcdefghijklmnopqrstuvwxyz';
        const digits  = '0123456789';
        const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

        let pool = '';
        if (useUpper)   pool += upper;
        if (useLower)   pool += lower;
        if (useNumbers) pool += digits;
        if (useSymbols) pool += symbols;
        if (!pool) return { error: 'At least one character type must be selected' };

        const chars: string[] = [];
        const required: string[] = [];
        if (useUpper)   required.push(upper);
        if (useLower)   required.push(lower);
        if (useNumbers) required.push(digits);
        if (useSymbols) required.push(symbols);

        for (const set of required) {
          const buf = randomBytes(1);
          chars.push(set[pickIndex(buf[0], set.length)]);
        }
        while (chars.length < length) {
          const buf = randomBytes(1);
          chars.push(pool[pickIndex(buf[0], pool.length)]);
        }
        // Fisher-Yates with crypto random
        const shuffleBytes = randomBytes(chars.length);
        for (let i = chars.length - 1; i > 0; i--) {
          const j = shuffleBytes[i] % (i + 1);
          [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        return { text: chars.join('') };
      } catch (err) {
        return { error: `Password generation failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.password_strength',
    category: 'security',
    name: 'Password Strength Check',
    description: 'Score password strength and provide actionable improvement feedback',
    params: [
      { name: 'password', type: 'string', required: true, description: 'Password to analyse' },
    ],
    async execute(params) {
      try {
        const password = String(params.password ?? '');
        const { score, feedback } = scorePassword(password);
        const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
        const label = levels[score] ?? 'Unknown';
        const bar = '='.repeat(score) + ' '.repeat(Math.max(0, 5 - score));
        const lines = [
          `Strength: ${label} (${score}/5)`,
          `Score:    [${bar}]`,
          `Length:   ${password.length} chars`,
        ];
        if (feedback.length > 0) lines.push('\nSuggestions:\n' + feedback.map(f => `  - ${f}`).join('\n'));
        return { text: lines.join('\n') };
      } catch (err) {
        return { error: `Password strength check failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.encrypt_text',
    category: 'security',
    name: 'Encrypt Text (AES-256-CBC)',
    description: 'Encrypt plaintext with AES-256-CBC. Key derived from password via scrypt. Output is base64',
    params: [
      { name: 'text',     type: 'string', required: true, description: 'Plaintext to encrypt' },
      { name: 'password', type: 'string', required: true, description: 'Encryption password' },
    ],
    async execute(params) {
      try {
        const salt = randomBytes(16);
        const { key, iv } = deriveKeyAndIv(String(params.password ?? ''), salt);
        const cipher = createCipheriv('aes-256-cbc', key, iv);
        const encrypted = Buffer.concat([
          cipher.update(Buffer.from(String(params.text ?? ''), 'utf8')),
          cipher.final(),
        ]);
        return { text: Buffer.concat([salt, iv, encrypted]).toString('base64') };
      } catch (err) {
        return { error: `Encryption failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.decrypt_text',
    category: 'security',
    name: 'Decrypt Text (AES-256-CBC)',
    description: 'Decrypt base64 ciphertext produced by security.encrypt_text',
    params: [
      { name: 'encrypted', type: 'string', required: true, description: 'Base64 ciphertext' },
      { name: 'password',  type: 'string', required: true, description: 'Decryption password' },
    ],
    async execute(params) {
      try {
        const payload = Buffer.from(String(params.encrypted ?? ''), 'base64');
        if (payload.length < 33) return { error: 'Invalid ciphertext: too short' };
        const salt      = payload.subarray(0, 16);
        const iv        = payload.subarray(16, 32);
        const encrypted = payload.subarray(32);
        const { key } = deriveKeyAndIv(String(params.password ?? ''), salt);
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return { text: decrypted.toString('utf8') };
      } catch (err) {
        return { error: `Decryption failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.hash_text',
    category: 'security',
    name: 'Hash Text',
    description: 'Compute a cryptographic hash of a text string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to hash' },
      { name: 'algorithm', type: 'string', required: false, description: 'Hash algorithm', enum: ['md5', 'sha1', 'sha256', 'sha512'], default: 'sha256' },
    ],
    async execute(params) {
      try {
        const algo = String(params.algorithm ?? 'sha256');
        if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo)) return { error: `Unsupported algorithm: ${algo}` };
        const hash = createHash(algo).update(String(params.text ?? ''), 'utf8').digest('hex');
        return { text: `${algo.toUpperCase()}: ${hash}` };
      } catch (err) {
        return { error: `Hash failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.checksum_verify',
    category: 'security',
    name: 'Verify File Checksum',
    description: 'Verify that the input file matches an expected checksum',
    params: [
      { name: 'expected', type: 'string', required: true, description: 'Expected hash (hex)' },
      { name: 'algorithm', type: 'string', required: false, description: 'Hash algorithm', enum: ['md5', 'sha1', 'sha256'], default: 'sha256' },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const algo = String(params.algorithm ?? 'sha256');
        if (!['md5', 'sha1', 'sha256'].includes(algo)) return { error: `Unsupported algorithm: ${algo}` };
        const data = await readFile(ctx.inputFiles[0]);
        const actual = createHash(algo).update(data).digest('hex');
        const expected = String(params.expected ?? '').toLowerCase().trim();
        const match = actual === expected;
        return {
          text: `${match ? 'MATCH' : 'MISMATCH'}\nExpected: ${expected}\nActual:   ${actual}`,
        };
      } catch (err) {
        return { error: `Checksum verification failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.sanitize_html',
    category: 'security',
    name: 'Sanitize HTML',
    description: 'Strip dangerous HTML tags and attributes using sanitize-html',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const raw = await readFile(ctx.inputFiles[0], 'utf8');
        const clean = sanitizeHtml(raw, {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3']),
          allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            img: ['src', 'alt', 'title', 'width', 'height'],
          },
        });
        const outFile = ctx.outputPath('sanitized.html');
        await writeFile(outFile, clean, 'utf8');
        return { files: [outFile], text: 'HTML sanitized. Removed unsafe tags and attributes.' };
      } catch (err) {
        return { error: `HTML sanitization failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.email_validate',
    category: 'security',
    name: 'Validate Email Format',
    description: 'Check whether a string matches a valid email address format',
    params: [
      { name: 'email', type: 'string', required: true, description: 'Email address to validate' },
    ],
    async execute(params) {
      try {
        const email = String(params.email ?? '').trim();
        const valid = isValidEmail(email);
        return { text: `${valid ? 'VALID' : 'INVALID'}: "${email}" ${valid ? 'is a valid email format.' : 'is not a valid email format.'}` };
      } catch (err) {
        return { error: `Email validation failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.generate_keypair',
    category: 'security',
    name: 'Generate RSA Key Pair',
    description: 'Generate an RSA-2048 key pair (PEM format) using Node.js crypto',
    params: [],
    async execute(params, ctx) {
      try {
        const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding:  { type: 'spki',  format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const pubFile  = ctx.outputPath('public_key.pem');
        const privFile = ctx.outputPath('private_key.pem');
        await writeFile(pubFile, publicKey as string, 'utf8');
        await writeFile(privFile, privateKey as string, 'utf8');
        return { files: [pubFile, privFile], text: `RSA-2048 key pair generated.\n\nPublic Key:\n${publicKey}` };
      } catch (err) {
        return { error: `Key pair generation failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'security.cert_info',
    category: 'security',
    name: 'Certificate Info',
    description: 'Show TLS certificate details for a domain using openssl s_client',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to inspect (e.g. example.com)' },
    ],
    async execute(params, ctx) {
      try {
        const domain = assertValidDomain(String(params.domain ?? ''));
        const info = await ctx.runArgs('openssl', [
          's_client',
          '-connect', `${domain}:443`,
          '-servername', domain,
          '-showcerts',
        ], { timeout: 25_000 }).catch(err => `${(err as Error).message}`);
        return { text: info };
      } catch (err) {
        return { error: `Certificate info failed: ${(err as Error).message}` };
      }
    },
  },
];
