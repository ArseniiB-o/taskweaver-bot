import type { Action } from './types.js';
import { escPath } from '../utils.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildTsInterface(name: string, value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    const inner = buildTsInterface('Item', value[0], indent);
    return `${inner}[]`;
  }
  if (typeof value === 'object') {
    const lines: string[] = [`interface ${name} {`];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const propType = buildTsInterface(capitalize(k), v, indent + 1);
      lines.push(`${'  '.repeat(indent + 1)}${k}: ${propType};`);
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'unknown';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LOREM_PARAGRAPH =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugat nulla pariatur.';

const CRON_FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function explainCronField(field: string, index: number): string {
  if (field === '*') return `every ${CRON_FIELD_NAMES[index]}`;
  if (field.startsWith('*/')) return `every ${field.slice(2)} ${CRON_FIELD_NAMES[index]}(s)`;
  const labels = index === 3 ? MONTH_NAMES : index === 4 ? DOW_NAMES : null;
  if (field.includes(',')) {
    const parts = field.split(',').map(v => labels ? (labels[parseInt(v, 10)] ?? v) : v);
    return `at ${CRON_FIELD_NAMES[index]}(s) ${parts.join(', ')}`;
  }
  if (field.includes('-')) {
    const [from, to] = field.split('-');
    const fLabel = labels ? (labels[parseInt(from, 10)] ?? from) : from;
    const tLabel = labels ? (labels[parseInt(to, 10)] ?? to) : to;
    return `from ${CRON_FIELD_NAMES[index]} ${fLabel} to ${tLabel}`;
  }
  const label = labels ? (labels[parseInt(field, 10)] ?? field) : field;
  return `at ${CRON_FIELD_NAMES[index]} ${label}`;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export const codeActions: Action[] = [
  {
    id: 'code.base64_encode',
    category: 'code',
    name: 'Base64 Encode',
    description: 'Base64-encode text or file content',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to encode (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        let input: string;
        if (params.text != null) {
          input = String(params.text);
        } else if (ctx.inputFiles[0]) {
          input = await readFile(ctx.inputFiles[0], 'utf8');
        } else {
          return { error: 'Provide params.text or an input file' };
        }
        return { text: Buffer.from(input, 'utf8').toString('base64') };
      } catch (err) {
        return { error: `base64_encode failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.base64_decode',
    category: 'code',
    name: 'Base64 Decode',
    description: 'Base64-decode text or file content',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Base64 string to decode (omit to use input file)' },
      { name: 'output_file', type: 'boolean', required: false, description: 'Write result to a file', default: false },
    ],
    execute: async (params, ctx) => {
      try {
        let encoded: string;
        if (params.text != null) {
          encoded = String(params.text).trim();
        } else if (ctx.inputFiles[0]) {
          encoded = (await readFile(ctx.inputFiles[0], 'utf8')).trim();
        } else {
          return { error: 'Provide params.text or an input file' };
        }
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        if (params.output_file) {
          const outputFile = ctx.outputPath('decoded.txt');
          await writeFile(outputFile, decoded, 'utf8');
          return { files: [outputFile] };
        }
        return { text: decoded };
      } catch (err) {
        return { error: `base64_decode failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.url_encode',
    category: 'code',
    name: 'URL Encode',
    description: 'URL-encode a string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'String to URL-encode' },
    ],
    execute: async (params, _ctx) => {
      try {
        return { text: encodeURIComponent(String(params.text)) };
      } catch (err) {
        return { error: `url_encode failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.url_decode',
    category: 'code',
    name: 'URL Decode',
    description: 'URL-decode a string',
    params: [
      { name: 'text', type: 'string', required: true, description: 'String to URL-decode' },
    ],
    execute: async (params, _ctx) => {
      try {
        return { text: decodeURIComponent(String(params.text)) };
      } catch (err) {
        return { error: `url_decode failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.hash_md5',
    category: 'code',
    name: 'MD5 Hash',
    description: 'Compute MD5 hash of text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to hash (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        let data: string | Buffer;
        if (params.text != null) {
          data = String(params.text);
        } else if (ctx.inputFiles[0]) {
          data = await readFile(ctx.inputFiles[0]);
        } else {
          return { error: 'Provide params.text or an input file' };
        }
        return { text: createHash('md5').update(data).digest('hex') };
      } catch (err) {
        return { error: `hash_md5 failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.hash_sha256',
    category: 'code',
    name: 'SHA-256 Hash',
    description: 'Compute SHA-256 hash of text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to hash (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        let data: string | Buffer;
        if (params.text != null) {
          data = String(params.text);
        } else if (ctx.inputFiles[0]) {
          data = await readFile(ctx.inputFiles[0]);
        } else {
          return { error: 'Provide params.text or an input file' };
        }
        return { text: createHash('sha256').update(data).digest('hex') };
      } catch (err) {
        return { error: `hash_sha256 failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.hash_sha512',
    category: 'code',
    name: 'SHA-512 Hash',
    description: 'Compute SHA-512 hash of text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to hash (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        let data: string | Buffer;
        if (params.text != null) {
          data = String(params.text);
        } else if (ctx.inputFiles[0]) {
          data = await readFile(ctx.inputFiles[0]);
        } else {
          return { error: 'Provide params.text or an input file' };
        }
        return { text: createHash('sha512').update(data).digest('hex') };
      } catch (err) {
        return { error: `hash_sha512 failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.uuid',
    category: 'code',
    name: 'Generate UUID v4',
    description: 'Generate one or more UUID v4 values',
    params: [
      { name: 'count', type: 'number', required: false, description: 'Number of UUIDs to generate', default: 1 },
    ],
    execute: async (params, _ctx) => {
      try {
        const count = Math.max(1, Math.min(1000, Number(params.count ?? 1)));
        const uuids = Array.from({ length: count }, () => randomUUID());
        return { text: uuids.join('\n') };
      } catch (err) {
        return { error: `uuid failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.jwt_decode',
    category: 'code',
    name: 'Decode JWT',
    description: 'Decode a JWT token without signature verification',
    params: [
      { name: 'token', type: 'string', required: true, description: 'JWT token string' },
    ],
    execute: async (params, _ctx) => {
      try {
        const token = String(params.token).trim();
        const parts = token.split('.');
        if (parts.length < 2) return { error: 'Invalid JWT: expected at least 2 dot-separated parts' };

        const decodeB64 = (b64: string): unknown => {
          const padded = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=');
          return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        };

        const header = decodeB64(parts[0]);
        const payload = decodeB64(parts[1]);
        const result = `Header:\n${JSON.stringify(header, null, 2)}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`;
        return { text: result };
      } catch (err) {
        return { error: `jwt_decode failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.regex_test',
    category: 'code',
    name: 'Test Regex',
    description: 'Test a regular expression against text and return all matches',
    params: [
      { name: 'pattern', type: 'string', required: true, description: 'Regular expression pattern' },
      { name: 'text', type: 'string', required: true, description: 'Text to match against' },
      { name: 'flags', type: 'string', required: false, description: 'Regex flags (e.g. gi)', default: 'g' },
    ],
    execute: async (params, _ctx) => {
      try {
        const flags = String(params.flags ?? 'g');
        const globalFlags = flags.includes('g') ? flags : flags + 'g';
        const re = new RegExp(String(params.pattern), globalFlags);
        const matches: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(String(params.text))) !== null) {
          matches.push(m[0]);
          if (m[0].length === 0) re.lastIndex++;
        }
        const summary = matches.length === 0
          ? 'No matches found'
          : `Found ${matches.length} match(es):\n${matches.map((v, i) => `  [${i + 1}] ${JSON.stringify(v)}`).join('\n')}`;
        return { text: summary };
      } catch (err) {
        return { error: `regex_test failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.color_hex_to_rgb',
    category: 'code',
    name: 'Hex to RGB',
    description: 'Convert a hex color code to RGB values',
    params: [
      { name: 'color', type: 'string', required: true, description: 'Hex color (e.g. #ff8800 or ff8800)' },
    ],
    execute: async (params, _ctx) => {
      try {
        const hex = String(params.color).replace(/^#/, '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { error: 'Invalid hex color; expected 6 hex digits' };
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return { text: `rgb(${r}, ${g}, ${b})` };
      } catch (err) {
        return { error: `color_hex_to_rgb failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.color_rgb_to_hex',
    category: 'code',
    name: 'RGB to Hex',
    description: 'Convert RGB values to a hex color code',
    params: [
      { name: 'r', type: 'number', required: true, description: 'Red (0-255)' },
      { name: 'g', type: 'number', required: true, description: 'Green (0-255)' },
      { name: 'b', type: 'number', required: true, description: 'Blue (0-255)' },
    ],
    execute: async (params, _ctx) => {
      try {
        const r = Number(params.r);
        const g = Number(params.g);
        const b = Number(params.b);
        if ([r, g, b].some(v => v < 0 || v > 255 || !Number.isInteger(v))) {
          return { error: 'r, g, b must be integers between 0 and 255' };
        }
        const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
        return { text: hex };
      } catch (err) {
        return { error: `color_rgb_to_hex failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.timestamp_to_date',
    category: 'code',
    name: 'Timestamp to Date',
    description: 'Convert a Unix timestamp (seconds) to a human-readable date string',
    params: [
      { name: 'timestamp', type: 'number', required: true, description: 'Unix timestamp in seconds' },
      { name: 'timezone', type: 'string', required: false, description: 'IANA timezone (e.g. Europe/Berlin)', default: 'UTC' },
    ],
    execute: async (params, _ctx) => {
      try {
        const ts = Number(params.timestamp) * 1000;
        const tz = String(params.timezone ?? 'UTC');
        const date = new Date(ts);
        const formatted = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
          timeZoneName: 'short',
        }).format(date);
        return { text: formatted };
      } catch (err) {
        return { error: `timestamp_to_date failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.date_to_timestamp',
    category: 'code',
    name: 'Date to Timestamp',
    description: 'Convert a date string to a Unix timestamp (seconds)',
    params: [
      { name: 'date', type: 'string', required: true, description: 'Date string (e.g. 2024-01-15T12:00:00Z)' },
    ],
    execute: async (params, _ctx) => {
      try {
        const ms = Date.parse(String(params.date));
        if (isNaN(ms)) return { error: 'Invalid date string' };
        return { text: String(Math.floor(ms / 1000)) };
      } catch (err) {
        return { error: `date_to_timestamp failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.cron_explain',
    category: 'code',
    name: 'Explain Cron',
    description: 'Explain a 5-field cron expression in human-readable form',
    params: [
      { name: 'expression', type: 'string', required: true, description: 'Cron expression (5 fields: min hour dom month dow)' },
    ],
    execute: async (params, _ctx) => {
      try {
        const fields = String(params.expression).trim().split(/\s+/);
        if (fields.length !== 5) {
          return { error: 'Expected exactly 5 fields: minute hour day-of-month month day-of-week' };
        }
        const [min, hour, dom, month, dow] = fields;
        const parts = fields.map((f, i) => explainCronField(f, i));

        const lines = [
          `Cron: ${params.expression}`,
          '',
          `  Minute:       ${parts[0]}`,
          `  Hour:         ${parts[1]}`,
          `  Day of month: ${parts[2]}`,
          `  Month:        ${parts[3]}`,
          `  Day of week:  ${parts[4]}`,
        ];

        let summary = 'Runs ';
        if (min === '0' && hour !== '*' && !hour.includes(',') && !hour.includes('-') && !hour.includes('/')) {
          summary += `at ${hour}:00`;
        } else {
          summary += `${parts[0]}, ${parts[1]}`;
        }
        if (dom !== '*') summary += `, ${parts[2]}`;
        if (month !== '*') summary += `, ${parts[3]}`;
        if (dow !== '*') summary += `, ${parts[4]}`;

        lines.push('', summary);
        return { text: lines.join('\n') };
      } catch (err) {
        return { error: `cron_explain failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.json_to_typescript',
    category: 'code',
    name: 'JSON to TypeScript Interface',
    description: 'Generate TypeScript interface(s) from a JSON sample',
    params: [
      { name: 'name', type: 'string', required: false, description: 'Root interface name', default: 'Root' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'Provide a JSON input file' };
        const raw = await readFile(ctx.inputFiles[0], 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const rootName = String(params.name ?? 'Root');
        const result = buildTsInterface(rootName, parsed);
        return { text: result };
      } catch (err) {
        return { error: `json_to_typescript failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.lorem',
    category: 'code',
    name: 'Lorem Ipsum',
    description: 'Generate lorem ipsum placeholder text',
    params: [
      { name: 'paragraphs', type: 'number', required: false, description: 'Number of paragraphs', default: 1 },
    ],
    execute: async (params, _ctx) => {
      try {
        const count = Math.max(1, Math.min(100, Number(params.paragraphs ?? 1)));
        const result = Array.from({ length: count }, () => LOREM_PARAGRAPH).join('\n\n');
        return { text: result };
      } catch (err) {
        return { error: `lorem failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.diff',
    category: 'code',
    name: 'Diff Two Files',
    description: 'Show the unified diff between two input files',
    params: [],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Two input files are required' };
        const a = escPath(ctx.inputFiles[0]);
        const b = escPath(ctx.inputFiles[1]);
        const result = await ctx.exec(`diff -u ${a} ${b} || true`);
        return { text: result || '(no differences)' };
      } catch (err) {
        return { error: `diff failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.minify_json',
    category: 'code',
    name: 'Minify JSON',
    description: 'Minify a JSON file by removing whitespace',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'minified.json' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const raw = await readFile(ctx.inputFiles[0], 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const outputFile = ctx.outputPath((params.output_name as string) || 'minified.json');
        await writeFile(outputFile, JSON.stringify(parsed), 'utf8');
        ctx.log(`Minified JSON: ${outputFile}`);
        return { files: [outputFile] };
      } catch (err) {
        return { error: `minify_json failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'code.format_json',
    category: 'code',
    name: 'Format JSON',
    description: 'Pretty-print a JSON file',
    params: [
      { name: 'indent', type: 'number', required: false, description: 'Indentation spaces', default: 2 },
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'formatted.json' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const raw = await readFile(ctx.inputFiles[0], 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const indent = Number(params.indent ?? 2);
        const outputFile = ctx.outputPath((params.output_name as string) || 'formatted.json');
        await writeFile(outputFile, JSON.stringify(parsed, null, indent), 'utf8');
        ctx.log(`Formatted JSON: ${outputFile}`);
        return { files: [outputFile] };
      } catch (err) {
        return { error: `format_json failed: ${(err as Error).message}` };
      }
    },
  },
];
