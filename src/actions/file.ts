import type { Action } from './types.js';
import { escPath } from '../utils.js';
import { readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const fileActions: Action[] = [
  {
    id: 'file.info',
    category: 'file',
    name: 'File Information',
    description: 'Show file size, type, and modification/creation dates',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const stats = await stat(filePath);
        const lines = [
          'Path:     ' + filePath,
          'Size:     ' + stats.size + ' bytes (' + (stats.size / 1024).toFixed(2) + ' KB)',
          'Type:     ' + (stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other'),
          'Created:  ' + stats.birthtime.toISOString(),
          'Modified: ' + stats.mtime.toISOString(),
          'Accessed: ' + stats.atime.toISOString(),
        ];
        return { text: lines.join('\n') };
      } catch (err: any) {
        return { error: 'File info failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.hash',
    category: 'file',
    name: 'File Hash',
    description: 'Calculate a cryptographic hash of the input file',
    params: [
      {
        name: 'algorithm',
        type: 'string',
        required: false,
        description: 'Hash algorithm',
        enum: ['md5', 'sha1', 'sha256', 'sha512'],
        default: 'sha256',
      },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const algorithm = (params.algorithm as string) ?? 'sha256';
        const data = await readFile(filePath);
        const hash = createHash(algorithm).update(data).digest('hex');
        return { text: algorithm.toUpperCase() + ': ' + hash + '\nFile: ' + filePath };
      } catch (err: any) {
        return { error: 'File hash failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.rename',
    category: 'file',
    name: 'Rename File',
    description: 'Rename (copy to a new name) the input file',
    params: [
      { name: 'name', type: 'string', required: true, description: 'New filename (without path)' },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const src = ctx.inputFiles[0];
        const outFile = ctx.outputPath(params.name as string);
        await copyFile(src, outFile);
        return { files: [outFile] };
      } catch (err: any) {
        return { error: 'File rename failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.split',
    category: 'file',
    name: 'Split File',
    description: 'Split the input file into chunks of a given size using the split CLI',
    params: [
      { name: 'size_mb', type: 'number', required: false, description: 'Chunk size in MB', default: 10 },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const sizeMb = (params.size_mb as number) ?? 10;
        const prefix = ctx.outputPath(basename(filePath) + '.part_');
        await ctx.exec(
          'split -b ' + sizeMb + 'm "' + escPath(filePath) + '" "' + escPath(prefix) + '"',
          60000,
        );
        const dir = prefix.replace(/[^/\\]+$/, '');
        const namePrefix = basename(filePath) + '.part_';
        let parts: string[] = [];
        try {
          const entries = await readdir(dir);
          parts = entries.filter((e) => e.startsWith(namePrefix)).map((e) => join(dir, e));
        } catch { /* ignore */ }
        return { files: parts, text: 'Split into ' + (parts.length || '?') + ' parts' };
      } catch (err: any) {
        return { error: 'File split failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.merge',
    category: 'file',
    name: 'Merge File Parts',
    description: 'Merge all provided input files into a single output file using cat',
    params: [
      { name: 'output_name', type: 'string', required: true, description: 'Name for the merged output file' },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input files provided' };
        const outFile = ctx.outputPath(params.output_name as string);
        const partsList = ctx.inputFiles.map((f) => '"' + escPath(f) + '"').join(' ');
        await ctx.exec('cat ' + partsList + ' > "' + escPath(outFile) + '"', 60000);
        return { files: [outFile] };
      } catch (err: any) {
        return { error: 'File merge failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.encoding_convert',
    category: 'file',
    name: 'Convert Text Encoding',
    description: 'Convert file text encoding using iconv',
    params: [
      { name: 'from_enc', type: 'string', required: true, description: 'Source encoding (e.g. ISO-8859-1)' },
      { name: 'to_enc', type: 'string', required: true, description: 'Target encoding (e.g. UTF-8)' },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const outFile = ctx.outputPath(basename(filePath));
        await ctx.exec(
          'iconv -f "' + (params.from_enc as string) + '" -t "' + (params.to_enc as string) +
          '" "' + escPath(filePath) + '" > "' + escPath(outFile) + '"',
          30000,
        );
        return { files: [outFile] };
      } catch (err: any) {
        return { error: 'Encoding conversion failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.line_endings_unix',
    category: 'file',
    name: 'Convert to Unix Line Endings',
    description: 'Convert Windows CRLF line endings to Unix LF',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const outFile = ctx.outputPath(basename(filePath));
        const content = await readFile(filePath);
        const converted = content.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        await writeFile(outFile, converted, 'utf8');
        return { files: [outFile], text: 'Converted to Unix (LF) line endings' };
      } catch (err: any) {
        return { error: 'Line ending conversion failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.line_endings_windows',
    category: 'file',
    name: 'Convert to Windows Line Endings',
    description: 'Convert Unix LF line endings to Windows CRLF',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const outFile = ctx.outputPath(basename(filePath));
        const content = await readFile(filePath);
        const converted = content.toString()
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/\n/g, '\r\n');
        await writeFile(outFile, converted, 'utf8');
        return { files: [outFile], text: 'Converted to Windows (CRLF) line endings' };
      } catch (err: any) {
        return { error: 'Line ending conversion failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.tree',
    category: 'file',
    name: 'Directory Tree',
    description: 'Show the directory tree of the work directory',
    params: [],
    async execute(params, ctx) {
      try {
        let result: string;
        try {
          result = await ctx.exec('tree "' + escPath(ctx.workDir) + '"', 15000);
        } catch {
          result = await ctx.exec('ls -R "' + escPath(ctx.workDir) + '"', 15000);
        }
        return { text: result };
      } catch (err: any) {
        return { error: 'Directory tree failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.count_files',
    category: 'file',
    name: 'Count Files by Extension',
    description: 'Count files grouped by extension in the work directory',
    params: [],
    async execute(params, ctx) {
      try {
        const counts = new Map<string, number>();
        const recurse = async (dir: string): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
              await recurse(full);
            } else {
              const ext = extname(entry.name).toLowerCase() || '(no extension)';
              counts.set(ext, (counts.get(ext) ?? 0) + 1);
            }
          }
        };
        await recurse(ctx.workDir);
        if (counts.size === 0) return { text: 'No files found in ' + ctx.workDir };
        const lines = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([ext, n]) => n + '\t' + ext);
        lines.unshift('Count\tExtension', '-----\t---------');
        return { text: lines.join('\n') };
      } catch (err: any) {
        return { error: 'Count files failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.head',
    category: 'file',
    name: 'Show First Lines',
    description: 'Show the first N lines of the input file',
    params: [
      { name: 'lines', type: 'number', required: false, description: 'Number of lines to show', default: 10 },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const n = (params.lines as number) ?? 10;
        const content = await readFile(filePath, 'utf8');
        const result = content.split('\n').slice(0, n).join('\n');
        return { text: result };
      } catch (err: any) {
        return { error: 'File head failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.tail',
    category: 'file',
    name: 'Show Last Lines',
    description: 'Show the last N lines of the input file',
    params: [
      { name: 'lines', type: 'number', required: false, description: 'Number of lines to show', default: 10 },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const n = (params.lines as number) ?? 10;
        const content = await readFile(filePath, 'utf8');
        const allLines = content.split('\n');
        const result = allLines.slice(Math.max(0, allLines.length - n)).join('\n');
        return { text: result };
      } catch (err: any) {
        return { error: 'File tail failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.compare',
    category: 'file',
    name: 'Compare Files',
    description: 'Compare two input files — identical or show differences',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Two input files are required' };
        const [fileA, fileB] = ctx.inputFiles;
        const [bufA, bufB] = await Promise.all([readFile(fileA), readFile(fileB)]);
        const hashA = createHash('sha256').update(bufA).digest('hex');
        const hashB = createHash('sha256').update(bufB).digest('hex');
        if (hashA === hashB) return { text: 'Files are identical.' };
        try {
          const diff = await ctx.exec('diff "' + escPath(fileA) + '" "' + escPath(fileB) + '"', 15000);
          return { text: 'Files differ:\n\n' + diff };
        } catch {
          return { text: 'Files differ (binary or diff unavailable).\nSHA-256 A: ' + hashA + '\nSHA-256 B: ' + hashB };
        }
      } catch (err: any) {
        return { error: 'File comparison failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.size_human',
    category: 'file',
    name: 'Human-Readable File Size',
    description: 'Show file size in human-readable units (B, KB, MB, GB, TB)',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const stats = await stat(filePath);
        const bytes = stats.size;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unit = units[0];
        for (let i = 1; i < units.length && size >= 1024; i++) {
          size /= 1024;
          unit = units[i];
        }
        return { text: bytes + ' bytes = ' + size.toFixed(2) + ' ' + unit + '\nFile: ' + filePath };
      } catch (err: any) {
        return { error: 'File size failed: ' + err.message };
      }
    },
  },

  {
    id: 'file.type_detect',
    category: 'file',
    name: 'Detect File MIME Type',
    description: 'Detect the MIME type of the input file using the file CLI',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const result = await ctx.exec('file --mime-type -b "' + escPath(filePath) + '"', 10000);
        return { text: result.trim() };
      } catch (err: any) {
        return { error: 'MIME type detection failed: ' + err.message };
      }
    },
  },
];
