import type { Action } from './types.js';
import { readFile, writeFile } from 'node:fs/promises';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Read text from input file or params.text (file takes priority when both present). */
async function resolveText(params: Record<string, any>, ctx: { inputFiles: string[] }): Promise<string | null> {
  if (ctx.inputFiles[0]) {
    return readFile(ctx.inputFiles[0], 'utf8');
  }
  if (params.text != null) {
    return String(params.text);
  }
  return null;
}

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function toCamelCase(str: string): string {
  return str
    .trim()
    .replace(/[\s_\-]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, c => c.toLowerCase());
}

function toSnakeCase(str: string): string {
  return str
    .trim()
    .replace(/[\s\-]+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function toKebabCase(str: string): string {
  return str
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function wrapLines(text: string, width: number): string {
  return text
    .split('\n')
    .map(line => {
      if (line.length <= width) return line;
      const words = line.split(' ');
      const result: string[] = [];
      let current = '';
      for (const word of words) {
        if (!current) {
          current = word;
        } else if (current.length + 1 + word.length <= width) {
          current += ' ' + word;
        } else {
          result.push(current);
          current = word;
        }
      }
      if (current) result.push(current);
      return result.join('\n');
    })
    .join('\n');
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

function transliterate(text: string): string {
  return text
    .split('')
    .map(ch => {
      const lower = ch.toLowerCase();
      if (lower in CYRILLIC_TO_LATIN) {
        const lat = CYRILLIC_TO_LATIN[lower];
        return ch === ch.toUpperCase() ? lat.toUpperCase() : lat;
      }
      return ch;
    })
    .join('');
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export const textActions: Action[] = [
  {
    id: 'text.count',
    category: 'text',
    name: 'Count Characters / Words / Lines',
    description: 'Count characters, words, and lines in text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to count (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        const content = await resolveText(params, ctx);
        if (content === null) return { error: 'Provide params.text or an input file' };
        const chars = content.length;
        const words = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
        const lines = content.split('\n').length;
        return { text: `Characters: ${chars}\nWords: ${words}\nLines: ${lines}` };
      } catch (err) {
        return { error: `text.count failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.find_replace',
    category: 'text',
    name: 'Find and Replace',
    description: 'Find and replace text in a file',
    params: [
      { name: 'find', type: 'string', required: true, description: 'String to find' },
      { name: 'replace', type: 'string', required: true, description: 'Replacement string' },
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'output.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const result = content.split(String(params.find)).join(String(params.replace));
        const outputFile = ctx.outputPath((params.output_name as string) || 'output.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `find_replace failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.case_upper',
    category: 'text',
    name: 'Uppercase',
    description: 'Convert text to uppercase',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'upper.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const outputFile = ctx.outputPath((params.output_name as string) || 'upper.txt');
        await writeFile(outputFile, content.toUpperCase(), 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `case_upper failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.case_lower',
    category: 'text',
    name: 'Lowercase',
    description: 'Convert text to lowercase',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'lower.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const outputFile = ctx.outputPath((params.output_name as string) || 'lower.txt');
        await writeFile(outputFile, content.toLowerCase(), 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `case_lower failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.case_title',
    category: 'text',
    name: 'Title Case',
    description: 'Convert text to title case',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'title.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const outputFile = ctx.outputPath((params.output_name as string) || 'title.txt');
        await writeFile(outputFile, toTitleCase(content), 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `case_title failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.case_camel',
    category: 'text',
    name: 'camelCase',
    description: 'Convert a string to camelCase',
    params: [
      { name: 'text', type: 'string', required: true, description: 'String to convert' },
    ],
    execute: async (params, _ctx) => {
      try {
        return { text: toCamelCase(String(params.text)) };
      } catch (err) {
        return { error: `case_camel failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.case_snake',
    category: 'text',
    name: 'snake_case',
    description: 'Convert a string to snake_case',
    params: [
      { name: 'text', type: 'string', required: true, description: 'String to convert' },
    ],
    execute: async (params, _ctx) => {
      try {
        return { text: toSnakeCase(String(params.text)) };
      } catch (err) {
        return { error: `case_snake failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.case_kebab',
    category: 'text',
    name: 'kebab-case',
    description: 'Convert a string to kebab-case',
    params: [
      { name: 'text', type: 'string', required: true, description: 'String to convert' },
    ],
    execute: async (params, _ctx) => {
      try {
        return { text: toKebabCase(String(params.text)) };
      } catch (err) {
        return { error: `case_kebab failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.remove_duplicates',
    category: 'text',
    name: 'Remove Duplicate Lines',
    description: 'Remove duplicate lines from a file, preserving order',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'deduped.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const seen = new Set<string>();
        const result = content
          .split('\n')
          .filter(line => {
            if (seen.has(line)) return false;
            seen.add(line);
            return true;
          })
          .join('\n');
        const outputFile = ctx.outputPath((params.output_name as string) || 'deduped.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `remove_duplicates failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.sort_lines',
    category: 'text',
    name: 'Sort Lines',
    description: 'Sort lines alphabetically',
    params: [
      { name: 'reverse', type: 'boolean', required: false, description: 'Sort in reverse order', default: false },
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'sorted.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const lines = content.split('\n');
        const sorted = [...lines].sort((a, b) => a.localeCompare(b));
        if (params.reverse) sorted.reverse();
        const outputFile = ctx.outputPath((params.output_name as string) || 'sorted.txt');
        await writeFile(outputFile, sorted.join('\n'), 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `sort_lines failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.reverse_text',
    category: 'text',
    name: 'Reverse Text',
    description: 'Reverse the entire text character by character',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to reverse (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        const content = await resolveText(params, ctx);
        if (content === null) return { error: 'Provide params.text or an input file' };
        return { text: [...content].reverse().join('') };
      } catch (err) {
        return { error: `reverse_text failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.reverse_lines',
    category: 'text',
    name: 'Reverse Line Order',
    description: 'Reverse the order of lines in a file',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'reversed.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const result = content.split('\n').reverse().join('\n');
        const outputFile = ctx.outputPath((params.output_name as string) || 'reversed.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `reverse_lines failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.trim_lines',
    category: 'text',
    name: 'Trim Lines',
    description: 'Trim leading and trailing whitespace from each line',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'trimmed.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const result = content.split('\n').map(l => l.trim()).join('\n');
        const outputFile = ctx.outputPath((params.output_name as string) || 'trimmed.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `trim_lines failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.number_lines',
    category: 'text',
    name: 'Number Lines',
    description: 'Prefix each line with its line number',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'numbered.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const lines = content.split('\n');
        const width = String(lines.length).length;
        const result = lines
          .map((line, i) => `${String(i + 1).padStart(width, ' ')}\t${line}`)
          .join('\n');
        const outputFile = ctx.outputPath((params.output_name as string) || 'numbered.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `number_lines failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.extract_emails',
    category: 'text',
    name: 'Extract Emails',
    description: 'Extract all email addresses from text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to search (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        const content = await resolveText(params, ctx);
        if (content === null) return { error: 'Provide params.text or an input file' };
        const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
        const matches = [...new Set(content.match(emailRe) ?? [])];
        return { text: matches.length ? matches.join('\n') : 'No email addresses found' };
      } catch (err) {
        return { error: `extract_emails failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.extract_urls',
    category: 'text',
    name: 'Extract URLs',
    description: 'Extract all URLs from text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to search (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        const content = await resolveText(params, ctx);
        if (content === null) return { error: 'Provide params.text or an input file' };
        const urlRe = /https?:\/\/[^\s"'<>()[\]{}]+/gi;
        const matches = [...new Set(content.match(urlRe) ?? [])];
        return { text: matches.length ? matches.join('\n') : 'No URLs found' };
      } catch (err) {
        return { error: `extract_urls failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.extract_phones',
    category: 'text',
    name: 'Extract Phone Numbers',
    description: 'Extract phone numbers from text or file',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to search (omit to use input file)' },
    ],
    execute: async (params, ctx) => {
      try {
        const content = await resolveText(params, ctx);
        if (content === null) return { error: 'Provide params.text or an input file' };
        // Matches international and local formats, e.g. +1-800-555-1234, (123) 456-7890, +49 30 12345678
        const phoneRe = /(?:\+?[\d\s\-().]{7,}(?:\d))/g;
        const raw = content.match(phoneRe) ?? [];
        const matches = [...new Set(raw.map(m => m.trim()).filter(m => m.replace(/\D/g, '').length >= 7))];
        return { text: matches.length ? matches.join('\n') : 'No phone numbers found' };
      } catch (err) {
        return { error: `extract_phones failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.remove_empty_lines',
    category: 'text',
    name: 'Remove Empty Lines',
    description: 'Remove all empty (or whitespace-only) lines from a file',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'no_empty.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const result = content.split('\n').filter(l => l.trim().length > 0).join('\n');
        const outputFile = ctx.outputPath((params.output_name as string) || 'no_empty.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `remove_empty_lines failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.wrap_lines',
    category: 'text',
    name: 'Wrap Long Lines',
    description: 'Wrap lines longer than a given width at word boundaries',
    params: [
      { name: 'width', type: 'number', required: false, description: 'Maximum line width', default: 80 },
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'wrapped.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const width = Number(params.width ?? 80);
        const result = wrapLines(content, width);
        const outputFile = ctx.outputPath((params.output_name as string) || 'wrapped.txt');
        await writeFile(outputFile, result, 'utf8');
        return { files: [outputFile] };
      } catch (err) {
        return { error: `wrap_lines failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'text.transliterate',
    category: 'text',
    name: 'Transliterate Cyrillic to Latin',
    description: 'Transliterate Cyrillic characters to Latin equivalents',
    params: [
      { name: 'text', type: 'string', required: false, description: 'Text to transliterate (omit to use input file)' },
      { name: 'output_file', type: 'boolean', required: false, description: 'Write result to a file', default: false },
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'transliterated.txt' },
    ],
    execute: async (params, ctx) => {
      try {
        const content = await resolveText(params, ctx);
        if (content === null) return { error: 'Provide params.text or an input file' };
        const result = transliterate(content);
        if (params.output_file || ctx.inputFiles[0]) {
          const outputFile = ctx.outputPath((params.output_name as string) || 'transliterated.txt');
          await writeFile(outputFile, result, 'utf8');
          return { files: [outputFile] };
        }
        return { text: result };
      } catch (err) {
        return { error: `transliterate failed: ${(err as Error).message}` };
      }
    },
  },
];
