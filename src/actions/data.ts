import type { Action } from './types.js';

// ---------------------------------------------------------------------------
// Safe math expression parser — recursive descent, no code evaluation
// Supports: +  -  *  /  ^  %  unary-  sqrt()  abs()  floor()  ceil()  round()  PI  E
// ---------------------------------------------------------------------------
class MathParser {
  private pos = 0;
  private input = '';

  parse(expr: string): number {
    this.input = expr.replace(/\s+/g, '');
    // Whitelist: digits, operators, parens, dot, named identifiers
    if (!/^[0-9+\-*/().,^%a-zA-Z_]+$/.test(this.input)) {
      throw new Error('Expression contains invalid characters');
    }
    this.pos = 0;
    const result = this.parseAddSub();
    if (this.pos !== this.input.length) {
      throw new Error('Unexpected token at position ' + this.pos + ': "' + this.input[this.pos] + '"');
    }
    return result;
  }

  private peek(): string { return this.input[this.pos] ?? ''; }
  private consume(): string { return this.input[this.pos++] ?? ''; }
  private expect(ch: string): void {
    const got = this.consume();
    if (got !== ch) throw new Error('Expected "' + ch + '" but got "' + got + '" at position ' + (this.pos - 1));
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.consume();
      const right = this.parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parsePow();
    while (this.peek() === '*' || this.peek() === '/' || this.peek() === '%') {
      const op = this.consume();
      const right = this.parsePow();
      if (op === '*') left = left * right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        left = left % right;
      }
    }
    return left;
  }

  private parsePow(): number {
    const base = this.parseUnary();
    if (this.peek() === '^') {
      this.consume();
      return Math.pow(base, this.parseUnary());
    }
    return base;
  }

  private parseUnary(): number {
    if (this.peek() === '-') { this.consume(); return -this.parseAtom(); }
    if (this.peek() === '+') { this.consume(); return this.parseAtom(); }
    return this.parseAtom();
  }

  private parseAtom(): number {
    if (this.peek() === '(') {
      this.consume();
      const val = this.parseAddSub();
      this.expect(')');
      return val;
    }
    if (/[0-9.]/.test(this.peek())) return this.parseNumber();
    return this.parseNamedValue();
  }

  private parseNumber(): number {
    let s = '';
    while (/[0-9.]/.test(this.peek())) s += this.consume();
    const n = parseFloat(s);
    if (isNaN(n)) throw new Error('Invalid number literal: ' + s);
    return n;
  }

  private parseNamedValue(): number {
    let name = '';
    while (/[a-zA-Z_]/.test(this.peek())) name += this.consume();
    if (!name) throw new Error('Expected identifier at position ' + this.pos);

    if (name === 'PI') return Math.PI;
    if (name === 'E') return Math.E;

    // Built-in math functions
    const mathFunctions: Record<string, (x: number) => number> = {
      sqrt:  Math.sqrt,
      abs:   Math.abs,
      floor: Math.floor,
      ceil:  Math.ceil,
      round: Math.round,
    };
    if (name in mathFunctions) {
      this.expect('(');
      const arg = this.parseAddSub();
      this.expect(')');
      return mathFunctions[name](arg);
    }
    throw new Error('Unknown identifier: ' + name);
  }
}

function safeMath(expr: string): number {
  const result = new MathParser().parse(expr);
  if (!isFinite(result)) throw new Error('Expression produced a non-finite result');
  return result;
}

// ---------------------------------------------------------------------------
// Unit conversion table
// ---------------------------------------------------------------------------
type ConvFn = (v: number) => number;
const CONVERSIONS: Record<string, Record<string, ConvFn>> = {
  km:   { mi: (v) => v * 0.621371, m: (v) => v * 1000, cm: (v) => v * 100000, ft: (v) => v * 3280.84 },
  mi:   { km: (v) => v * 1.60934,  m: (v) => v * 1609.34, ft: (v) => v * 5280 },
  m:    { km: (v) => v / 1000, mi: (v) => v / 1609.34, ft: (v) => v * 3.28084, cm: (v) => v * 100 },
  cm:   { m: (v) => v / 100, in: (v) => v / 2.54, km: (v) => v / 100000 },
  ft:   { m: (v) => v / 3.28084, mi: (v) => v / 5280, km: (v) => v / 3280.84, in: (v) => v * 12 },
  in:   { cm: (v) => v * 2.54, ft: (v) => v / 12, m: (v) => v * 0.0254 },
  kg:   { lb: (v) => v * 2.20462, g: (v) => v * 1000, oz: (v) => v * 35.274 },
  lb:   { kg: (v) => v * 0.453592, g: (v) => v * 453.592, oz: (v) => v * 16 },
  g:    { kg: (v) => v / 1000, lb: (v) => v / 453.592, oz: (v) => v / 28.3495 },
  oz:   { g: (v) => v * 28.3495, lb: (v) => v / 16, kg: (v) => v / 35.274 },
  C:    { F: (v) => v * 9 / 5 + 32, K: (v) => v + 273.15 },
  F:    { C: (v) => (v - 32) * 5 / 9, K: (v) => (v - 32) * 5 / 9 + 273.15 },
  K:    { C: (v) => v - 273.15, F: (v) => (v - 273.15) * 9 / 5 + 32 },
  L:    { gal: (v) => v * 0.264172, ml: (v) => v * 1000 },
  gal:  { L: (v) => v * 3.78541, ml: (v) => v * 3785.41 },
  ml:   { L: (v) => v / 1000, gal: (v) => v / 3785.41 },
  km_h: { mph: (v) => v * 0.621371, ms: (v) => v / 3.6 },
  mph:  { km_h: (v) => v * 1.60934, ms: (v) => v * 0.44704 },
  ms:   { km_h: (v) => v * 3.6, mph: (v) => v / 0.44704 },
};

// ---------------------------------------------------------------------------
// Morse code
// ---------------------------------------------------------------------------
const MORSE_ENCODE: Record<string, string> = {
  A: '.-',    B: '-...',  C: '-.-.',  D: '-..',   E: '.',     F: '..-.',
  G: '--.',   H: '....',  I: '..',    J: '.---',  K: '-.-',   L: '.-..',
  M: '--',    N: '-.',    O: '---',   P: '.--.',  Q: '--.-',  R: '.-.',
  S: '...',   T: '-',     U: '..-',   V: '...-',  W: '.--',   X: '-..-',
  Y: '-.--',  Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...',
  ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.',
  '-': '-....-', '_': '..--.-', '"': '.-..-.', '@': '.--.-.', ' ': '/',
};
const MORSE_DECODE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_ENCODE).map(([k, v]) => [v, k]),
);

// ---------------------------------------------------------------------------
// Roman numerals
// ---------------------------------------------------------------------------
const ROMAN_TABLE: Array<[string, number]> = [
  ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
  ['C', 100],  ['XC', 90],  ['L', 50],  ['XL', 40],
  ['X', 10],   ['IX', 9],   ['V', 5],   ['IV', 4], ['I', 1],
];

function toRoman(n: number): string {
  if (n <= 0 || n > 3999) throw new Error('Value must be between 1 and 3999');
  let result = '';
  let rem = n;
  for (const [sym, val] of ROMAN_TABLE) {
    while (rem >= val) { result += sym; rem -= val; }
  }
  return result;
}

function fromRoman(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let result = 0;
  const upper = s.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const curr = map[upper[i]];
    const next = map[upper[i + 1]];
    if (curr === undefined) throw new Error('Invalid Roman numeral character: ' + upper[i]);
    result += (next !== undefined && next > curr) ? -curr : curr;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Actions export
// ---------------------------------------------------------------------------
export const dataActions: Action[] = [
  {
    id: 'data.calc',
    category: 'data',
    name: 'Calculate Expression',
    description: 'Evaluate a math expression safely using a recursive descent parser. Supports +,-,*,/,^,%,sqrt(),abs(),floor(),ceil(),round(),PI,E',
    params: [
      { name: 'expression', type: 'string', required: true, description: 'Math expression to evaluate' },
    ],
    async execute(params, _ctx) {
      try {
        const expr = params.expression as string;
        const result = safeMath(expr);
        return { text: expr + ' = ' + result };
      } catch (err: any) {
        return { error: 'Calculation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.unit_convert',
    category: 'data',
    name: 'Unit Converter',
    description: 'Convert between common units: km/mi/m/ft, kg/lb/g/oz, C/F/K, cm/in, L/gal/ml, km_h/mph/ms',
    params: [
      { name: 'value', type: 'number', required: true, description: 'Numeric value to convert' },
      { name: 'from', type: 'string', required: true, description: 'Source unit (e.g. km, kg, C)' },
      { name: 'to', type: 'string', required: true, description: 'Target unit (e.g. mi, lb, F)' },
    ],
    async execute(params, _ctx) {
      try {
        const value = params.value as number;
        const from = params.from as string;
        const to = params.to as string;
        if (from === to) return { text: value + ' ' + from + ' = ' + value + ' ' + to };
        const row = CONVERSIONS[from];
        if (!row) return { error: 'Unknown source unit: ' + from };
        const fn = row[to];
        if (!fn) return { error: 'Cannot convert ' + from + ' to ' + to };
        const converted = fn(value);
        return { text: value + ' ' + from + ' = ' + converted.toFixed(6).replace(/\.?0+$/, '') + ' ' + to };
      } catch (err: any) {
        return { error: 'Unit conversion failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.date_calc',
    category: 'data',
    name: 'Date Calculation',
    description: 'Add or subtract days, weeks, months, or years from a date',
    params: [
      { name: 'date', type: 'string', required: true, description: 'Start date (YYYY-MM-DD or ISO 8601)' },
      { name: 'operation', type: 'string', required: true, description: 'add or subtract', enum: ['add', 'subtract'] },
      { name: 'amount', type: 'number', required: true, description: 'Amount to add/subtract' },
      { name: 'unit', type: 'string', required: true, description: 'Time unit', enum: ['days', 'weeks', 'months', 'years'] },
    ],
    async execute(params, _ctx) {
      try {
        const d = new Date(params.date as string);
        if (isNaN(d.getTime())) return { error: 'Invalid date: ' + params.date };
        const delta = (params.operation === 'subtract' ? -1 : 1) * (params.amount as number);
        switch (params.unit) {
          case 'days':   d.setDate(d.getDate() + delta); break;
          case 'weeks':  d.setDate(d.getDate() + delta * 7); break;
          case 'months': d.setMonth(d.getMonth() + delta); break;
          case 'years':  d.setFullYear(d.getFullYear() + delta); break;
        }
        return { text: d.toISOString().split('T')[0] };
      } catch (err: any) {
        return { error: 'Date calculation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.timezone_convert',
    category: 'data',
    name: 'Timezone Converter',
    description: 'Convert a timestamp between two IANA timezones',
    params: [
      { name: 'time', type: 'string', required: true, description: 'Timestamp (ISO 8601 or parseable date string)' },
      { name: 'from_tz', type: 'string', required: true, description: 'Source IANA timezone (e.g. America/New_York)' },
      { name: 'to_tz', type: 'string', required: true, description: 'Target IANA timezone (e.g. Europe/Berlin)' },
    ],
    async execute(params, _ctx) {
      try {
        const date = new Date(params.time as string);
        if (isNaN(date.getTime())) return { error: 'Invalid time: ' + params.time };
        const format = (tz: string) => new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(date);
        return {
          text: 'Source (' + params.from_tz + '): ' + format(params.from_tz as string) +
                '\nTarget (' + params.to_tz + '): ' + format(params.to_tz as string),
        };
      } catch (err: any) {
        return { error: 'Timezone conversion failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.random_number',
    category: 'data',
    name: 'Random Number',
    description: 'Generate one or more random integers in a given range',
    params: [
      { name: 'min', type: 'number', required: false, description: 'Minimum value (inclusive)', default: 1 },
      { name: 'max', type: 'number', required: false, description: 'Maximum value (inclusive)', default: 100 },
      { name: 'count', type: 'number', required: false, description: 'How many numbers to generate', default: 1 },
    ],
    async execute(params, _ctx) {
      try {
        const min = (params.min as number) ?? 1;
        const max = (params.max as number) ?? 100;
        const count = Math.min((params.count as number) ?? 1, 1000);
        if (min > max) return { error: 'min must be <= max' };
        const nums = Array.from({ length: count }, () =>
          Math.floor(Math.random() * (max - min + 1)) + min,
        );
        return { text: nums.join(', ') };
      } catch (err: any) {
        return { error: 'Random number generation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.random_string',
    category: 'data',
    name: 'Random String',
    description: 'Generate a random string with a chosen character set',
    params: [
      { name: 'length', type: 'number', required: false, description: 'String length', default: 16 },
      {
        name: 'charset',
        type: 'string',
        required: false,
        description: 'Character set to use',
        enum: ['alpha', 'numeric', 'alphanumeric', 'hex'],
        default: 'alphanumeric',
      },
    ],
    async execute(params, _ctx) {
      try {
        const length = Math.min((params.length as number) ?? 16, 4096);
        const charsets: Record<string, string> = {
          alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
          numeric: '0123456789',
          alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          hex: '0123456789abcdef',
        };
        const charset = charsets[(params.charset as string) ?? 'alphanumeric'] ?? charsets.alphanumeric;
        let result = '';
        for (let i = 0; i < length; i++) result += charset[Math.floor(Math.random() * charset.length)];
        return { text: result };
      } catch (err: any) {
        return { error: 'Random string generation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.random_password',
    category: 'data',
    name: 'Random Password',
    description: 'Generate a strong password guaranteed to include uppercase, lowercase, digits, and symbols',
    params: [
      { name: 'length', type: 'number', required: false, description: 'Password length (min 8)', default: 16 },
    ],
    async execute(params, _ctx) {
      try {
        const length = Math.min((params.length as number) ?? 16, 256);
        if (length < 8) return { error: 'Password length must be at least 8' };
        const lower   = 'abcdefghijklmnopqrstuvwxyz';
        const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const digits  = '0123456789';
        const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        const all = lower + upper + digits + symbols;
        const chars: string[] = [
          lower[Math.floor(Math.random() * lower.length)],
          upper[Math.floor(Math.random() * upper.length)],
          digits[Math.floor(Math.random() * digits.length)],
          symbols[Math.floor(Math.random() * symbols.length)],
        ];
        for (let i = chars.length; i < length; i++) chars.push(all[Math.floor(Math.random() * all.length)]);
        // Fisher-Yates shuffle
        for (let i = chars.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        return { text: chars.join('') };
      } catch (err: any) {
        return { error: 'Password generation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.statistics',
    category: 'data',
    name: 'Statistics',
    description: 'Calculate min, max, mean, median, and standard deviation for a list of numbers',
    params: [
      { name: 'numbers', type: 'string', required: true, description: 'Comma-separated numbers' },
    ],
    async execute(params, _ctx) {
      try {
        const nums = (params.numbers as string)
          .split(',')
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !isNaN(n));
        if (nums.length === 0) return { error: 'No valid numbers provided' };
        const sorted = [...nums].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
        const stddev = Math.sqrt(variance);
        return {
          text: [
            'Count:  ' + nums.length,
            'Min:    ' + min,
            'Max:    ' + max,
            'Mean:   ' + mean.toFixed(6).replace(/\.?0+$/, ''),
            'Median: ' + median,
            'StdDev: ' + stddev.toFixed(6).replace(/\.?0+$/, ''),
          ].join('\n'),
        };
      } catch (err: any) {
        return { error: 'Statistics calculation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.barcode_text',
    category: 'data',
    name: 'Barcode Text',
    description: 'ASCII text representation of a barcode (visual approximation)',
    params: [
      { name: 'data', type: 'string', required: true, description: 'Data to represent' },
    ],
    async execute(params, _ctx) {
      try {
        const data = params.data as string;
        const bars = data.split('').map((c) => {
          const code = c.charCodeAt(0);
          return (code & 1 ? '|' : '||') + (code & 2 ? ' ' : '  ') +
                 (code & 4 ? '|' : '||') + (code & 8 ? ' ' : '  ');
        }).join('');
        return {
          text: '|' + bars + '|\n' +
                ' ' + data.split('').join(' ') + '\n' +
                '(ASCII approximation — use a barcode library for production use)',
        };
      } catch (err: any) {
        return { error: 'Barcode generation failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.morse_encode',
    category: 'data',
    name: 'Morse Code Encode',
    description: 'Encode text to International Morse code',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to encode' },
    ],
    async execute(params, _ctx) {
      try {
        const encoded = (params.text as string).toUpperCase().split('').map((c) =>
          c === ' ' ? '/' : (MORSE_ENCODE[c] ?? '?'),
        ).join(' ');
        return { text: encoded };
      } catch (err: any) {
        return { error: 'Morse encode failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.morse_decode',
    category: 'data',
    name: 'Morse Code Decode',
    description: 'Decode Morse code to text. Use space between letters and " / " between words',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Morse code string' },
    ],
    async execute(params, _ctx) {
      try {
        const decoded = (params.text as string)
          .split(' / ')
          .map((word) => word.split(' ').map((code) => MORSE_DECODE[code] ?? '?').join(''))
          .join(' ');
        return { text: decoded };
      } catch (err: any) {
        return { error: 'Morse decode failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.binary_to_decimal',
    category: 'data',
    name: 'Binary to Decimal',
    description: 'Convert a binary string to its decimal value',
    params: [
      { name: 'value', type: 'string', required: true, description: 'Binary string (e.g. 1010)' },
    ],
    async execute(params, _ctx) {
      try {
        const bin = (params.value as string).trim();
        if (!/^[01]+$/.test(bin)) return { error: 'Invalid binary number: ' + bin };
        return { text: bin + ' (binary) = ' + parseInt(bin, 2) + ' (decimal)' };
      } catch (err: any) {
        return { error: 'Binary to decimal failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.decimal_to_binary',
    category: 'data',
    name: 'Decimal to Binary',
    description: 'Convert a decimal integer to its binary representation',
    params: [
      { name: 'value', type: 'number', required: true, description: 'Decimal integer' },
    ],
    async execute(params, _ctx) {
      try {
        const n = params.value as number;
        if (!Number.isInteger(n)) return { error: 'Value must be an integer' };
        return { text: n + ' (decimal) = ' + n.toString(2) + ' (binary)' };
      } catch (err: any) {
        return { error: 'Decimal to binary failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.hex_convert',
    category: 'data',
    name: 'Hex Converter',
    description: 'Convert a number between hexadecimal, decimal, and binary bases',
    params: [
      { name: 'value', type: 'string', required: true, description: 'Value to convert' },
      { name: 'from', type: 'string', required: true, description: 'Source base', enum: ['hex', 'decimal', 'binary'] },
      { name: 'to', type: 'string', required: true, description: 'Target base', enum: ['hex', 'decimal', 'binary'] },
    ],
    async execute(params, _ctx) {
      try {
        const raw = (params.value as string).trim().replace(/^0x/i, '');
        const from = params.from as string;
        const to = params.to as string;
        const baseMap: Record<string, number> = { hex: 16, decimal: 10, binary: 2 };
        const asDecimal = parseInt(raw, baseMap[from]);
        if (isNaN(asDecimal)) return { error: 'Invalid ' + from + ' value: ' + params.value };
        const converted = asDecimal.toString(baseMap[to]);
        return { text: params.value + ' (' + from + ') = ' + converted + ' (' + to + ')' };
      } catch (err: any) {
        return { error: 'Number base conversion failed: ' + err.message };
      }
    },
  },

  {
    id: 'data.roman_numeral',
    category: 'data',
    name: 'Roman Numerals',
    description: 'Convert between Roman numerals and Arabic numbers. Input type is auto-detected',
    params: [
      { name: 'value', type: 'string', required: true, description: 'Arabic number (e.g. 42) or Roman numeral (e.g. XLII)' },
    ],
    async execute(params, _ctx) {
      try {
        const input = (params.value as string).trim();
        if (/^\d+$/.test(input)) {
          return { text: input + ' = ' + toRoman(parseInt(input, 10)) };
        }
        return { text: input.toUpperCase() + ' = ' + fromRoman(input) };
      } catch (err: any) {
        return { error: 'Roman numeral conversion failed: ' + err.message };
      }
    },
  },
];
