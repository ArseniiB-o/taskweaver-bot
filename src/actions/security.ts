import type { Action } from './types.js';
import { escPath } from '../utils.js';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive key (32 B) and IV (16 B) from password + salt using scrypt. */
function deriveKeyAndIv(password: string, salt: Buffer): { key: Buffer; iv: Buffer } {
  const derived = scryptSync(password, salt, 48) as Buffer;
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

/** Simple password strength scorer. Returns score 0-5 and feedback strings. */
function scorePassword(password: string): { score: number; feedback: string[] } {
  const feedback: string[] = [];
  let score = 0;
  if (password.length >= 8)  score += 1; else feedback.push('Use at least 8 characters');
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

/** Lightweight email format check. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
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
    async execute(params, _ctx) {
      try {
        const length = Math.min((params.length as number) ?? 16, 256);
        if (length < 4) return { error: 'Password length must be at least 4' };
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

        const bytes = randomBytes(length * 2 + 8);
        const chars: string[] = [];
        let idx = 0;

        if (useUpper)   chars.push(upper[bytes[idx++] % upper.length]);
        if (useLower)   chars.push(lower[bytes[idx++] % lower.length]);
        if (useNumbers) chars.push(digits[bytes[idx++] % digits.length]);
        if (useSymbols) chars.push(symbols[bytes[idx++] % symbols.length]);

        while (chars.length < length) chars.push(pool[bytes[idx++ % bytes.length] % pool.length]);

        const shuffleBytes = randomBytes(chars.length);
        for (let i = chars.length - 1; i > 0; i--) {
          const j = shuffleBytes[i] % (i + 1);
          [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        return { text: chars.join('') };
      } catch (err: any) {
        return { error: 'Password generation failed: ' + err.message };
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
    async execute(params, _ctx) {
      try {
        const password = params.password as string;
        const { score, feedback } = scorePassword(password);
        const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
        const label = levels[score] ?? 'Unknown';
        const bar = '='.repeat(score) + ' '.repeat(Math.max(0, 5 - score));
        const lines = [
          'Strength: ' + label + ' (' + score + '/5)',
          'Score:    [' + bar + ']',
          'Length:   ' + password.length + ' chars',
        ];
        if (feedback.length > 0) {
          lines.push('\nSuggestions:\n' + feedback.map((f) => '  - ' + f).join('\n'));
        }
        return { text: lines.join('\n') };
      } catch (err: any) {
        return { error: 'Password strength check failed: ' + err.message };
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
    async execute(params, _ctx) {
      try {
        const salt = randomBytes(16);
        const { key, iv } = deriveKeyAndIv(params.password as string, salt);
        const cipher = createCipheriv('aes-256-cbc', key, iv);
        const encrypted = Buffer.concat([
          cipher.update(Buffer.from(params.text as string, 'utf8')),
          cipher.final(),
        ]);
        // Payload layout: salt(16) + iv(16) + ciphertext
        return { text: Buffer.concat([salt, iv, encrypted]).toString('base64') };
      } catch (err: any) {
        return { error: 'Encryption failed: ' + err.message };
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
    async execute(params, _ctx) {
      try {
        const payload = Buffer.from(params.encrypted as string, 'base64');
        if (payload.length < 33) return { error: 'Invalid ciphertext: too short' };
        const salt      = payload.subarray(0, 16);
        const iv        = payload.subarray(16, 32);
        const encrypted = payload.subarray(32);
        const { key } = deriveKeyAndIv(params.password as string, salt);
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return { text: decrypted.toString('utf8') };
      } catch (err: any) {
        return { error: 'Decryption failed: ' + err.message };
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
      {
        name: 'algorithm',
        type: 'string',
        required: false,
        description: 'Hash algorithm',
        enum: ['md5', 'sha1', 'sha256', 'sha512'],
        default: 'sha256',
      },
    ],
    async execute(params, _ctx) {
      try {
        const algo = (params.algorithm as string) ?? 'sha256';
        const hash = createHash(algo).update(params.text as string, 'utf8').digest('hex');
        return { text: algo.toUpperCase() + ': ' + hash };
      } catch (err: any) {
        return { error: 'Hash failed: ' + err.message };
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
      {
        name: 'algorithm',
        type: 'string',
        required: false,
        description: 'Hash algorithm',
        enum: ['md5', 'sha1', 'sha256'],
        default: 'sha256',
      },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const algo = (params.algorithm as string) ?? 'sha256';
        const data = await readFile(ctx.inputFiles[0]);
        const actual = createHash(algo).update(data).digest('hex');
        const expected = (params.expected as string).toLowerCase().trim();
        const match = actual === expected;
        return {
          text: (match ? 'MATCH' : 'MISMATCH') + '\n' +
                'Expected: ' + expected + '\nActual:   ' + actual,
        };
      } catch (err: any) {
        return { error: 'Checksum verification failed: ' + err.message };
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
        const { writeFile } = await import('node:fs/promises');
        await writeFile(outFile, clean, 'utf8');
        return { files: [outFile], text: 'HTML sanitized. Removed unsafe tags and attributes.' };
      } catch (err: any) {
        return { error: 'HTML sanitization failed: ' + err.message };
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
    async execute(params, _ctx) {
      try {
        const email = (params.email as string).trim();
        const valid = isValidEmail(email);
        return {
          text: (valid ? 'VALID' : 'INVALID') + ': "' + email + '" ' +
                (valid ? 'is a valid email format.' : 'is not a valid email format.'),
        };
      } catch (err: any) {
        return { error: 'Email validation failed: ' + err.message };
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
        const { generateKeyPairSync } = await import('node:crypto');
        const { publicKey, privateKey } = generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding:  { type: 'spki',  format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const pubFile  = ctx.outputPath('public_key.pem');
        const privFile = ctx.outputPath('private_key.pem');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(pubFile,  publicKey,  'utf8');
        await writeFile(privFile, privateKey, 'utf8');
        return { files: [pubFile, privFile], text: 'RSA-2048 key pair generated.\n\nPublic Key:\n' + publicKey };
      } catch (err: any) {
        // Fallback to openssl CLI
        try {
          const privFile = ctx.outputPath('private_key.pem');
          const pubFile  = ctx.outputPath('public_key.pem');
          await ctx.exec('openssl genrsa -out "' + escPath(privFile) + '" 2048', 30000);
          await ctx.exec('openssl rsa -in "' + escPath(privFile) + '" -pubout -out "' + escPath(pubFile) + '"', 15000);
          const pub = await readFile(pubFile, 'utf8');
          return { files: [pubFile, privFile], text: 'RSA-2048 key pair generated (openssl).\n\nPublic Key:\n' + pub };
        } catch (fallback: any) {
          return { error: 'Key pair generation failed: ' + err.message + '; openssl: ' + fallback.message };
        }
      }
    },
  },

  {
    id: 'security.cert_info',
    category: 'security',
    name: 'Certificate Info',
    description: 'Show TLS certificate details for a domain using openssl',
    params: [
      { name: 'domain', type: 'string', required: true, description: 'Domain to inspect (e.g. example.com)' },
    ],
    async execute(params, ctx) {
      try {
        const domain = params.domain as string;
        const info = await ctx.exec(
          'echo "" | openssl s_client -connect "' + domain + ':443" -servername "' + domain +
          '" 2>/dev/null | openssl x509 -noout -text 2>&1',
          25000,
        );
        return { text: info };
      } catch (err: any) {
        return { error: 'Certificate info failed: ' + err.message };
      }
    },
  },
];
