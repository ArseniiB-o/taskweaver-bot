import type { Action } from './types.js';
import { readFile, writeFile, readdir, stat, copyFile, mkdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizeFilename } from '../security/sanitize.js';

const VALID_HASH = new Set(['md5', 'sha1', 'sha256', 'sha512']);

export const fileActions: Action[] = [
  {
    id: 'file.info',
    category: 'file',
    name: 'File Information',
    description: 'Show file size, type, and modification/creation dates',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const stats = await stat(filePath);
        const lines = [
          `Path:     ${basename(filePath)}`,
          `Size:     ${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`,
          `Type:     ${stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other'}`,
          `Created:  ${stats.birthtime.toISOString()}`,
          `Modified: ${stats.mtime.toISOString()}`,
          `Accessed: ${stats.atime.toISOString()}`,
        ];
        return { text: lines.join('\n') };
      } catch (err) {
        return { error: `File info failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.hash',
    category: 'file',
    name: 'File Hash',
    description: 'Calculate a cryptographic hash of the input file',
    params: [
      { name: 'algorithm', type: 'string', required: false, description: 'Hash algorithm', enum: ['md5', 'sha1', 'sha256', 'sha512'], default: 'sha256' },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const algo = String(params.algorithm ?? 'sha256');
        if (!VALID_HASH.has(algo)) return { error: `Unsupported algorithm: ${algo}` };
        const data = await readFile(ctx.inputFiles[0]);
        const hash = createHash(algo).update(data).digest('hex');
        return { text: `${algo.toUpperCase()}: ${hash}` };
      } catch (err) {
        return { error: `File hash failed: ${(err as Error).message}` };
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
        const newName = sanitizeFilename(String(params.name ?? ''), 'renamed');
        const outFile = ctx.outputPath(newName);
        await copyFile(ctx.inputFiles[0], outFile);
        return { files: [outFile] };
      } catch (err) {
        return { error: `File rename failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.split',
    category: 'file',
    name: 'Split File',
    description: 'Split the input file into chunks of a given size (Node.js stream)',
    params: [
      { name: 'size_mb', type: 'number', required: false, description: 'Chunk size in MB', default: 10 },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const sizeMb = Math.min(1024, Math.max(1, Math.trunc(Number(params.size_mb ?? 10)) || 10));
        const chunkBytes = sizeMb * 1024 * 1024;
        const filePath = ctx.inputFiles[0];
        const baseName = basename(filePath);

        const parts: string[] = [];
        let chunkIdx = 0;
        let buffer = Buffer.alloc(0);

        await new Promise<void>((resolve, reject) => {
          const rs = createReadStream(filePath, { highWaterMark: 1 * 1024 * 1024 });
          rs.on('data', (chunkRaw: string | Buffer) => {
            const chunk = Buffer.isBuffer(chunkRaw) ? chunkRaw : Buffer.from(chunkRaw);
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= chunkBytes) {
              const part = buffer.subarray(0, chunkBytes);
              buffer = buffer.subarray(chunkBytes);
              const partFile = ctx.outputPath(`${baseName}.part_${String(chunkIdx).padStart(3, '0')}`);
              parts.push(partFile);
              chunkIdx += 1;
              writeFile(partFile, part).catch(reject);
            }
          });
          rs.on('end', async () => {
            if (buffer.length > 0) {
              const partFile = ctx.outputPath(`${baseName}.part_${String(chunkIdx).padStart(3, '0')}`);
              parts.push(partFile);
              try { await writeFile(partFile, buffer); resolve(); } catch (e) { reject(e); }
            } else resolve();
          });
          rs.on('error', reject);
        });

        return { files: parts, text: `Split into ${parts.length} parts` };
      } catch (err) {
        return { error: `File split failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.merge',
    category: 'file',
    name: 'Merge File Parts',
    description: 'Merge all provided input files into a single output file',
    params: [
      { name: 'output_name', type: 'string', required: true, description: 'Name for the merged output file' },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input files provided' };
        const outName = sanitizeFilename(String(params.output_name ?? 'merged'), 'merged');
        const outFile = ctx.outputPath(outName);
        const ws = createWriteStream(outFile);
        try {
          for (const part of ctx.inputFiles) {
            await new Promise<void>((resolve, reject) => {
              const rs = createReadStream(part);
              rs.pipe(ws, { end: false });
              rs.on('end', resolve);
              rs.on('error', reject);
            });
          }
        } finally {
          ws.end();
        }
        return { files: [outFile] };
      } catch (err) {
        return { error: `File merge failed: ${(err as Error).message}` };
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
        const fromEnc = String(params.from_enc ?? '').replace(/[^A-Za-z0-9_.+:-]/g, '');
        const toEnc = String(params.to_enc ?? '').replace(/[^A-Za-z0-9_.+:-]/g, '');
        if (!fromEnc || !toEnc) return { error: 'from_enc and to_enc are required' };
        const filePath = ctx.inputFiles[0];
        const outFile = ctx.outputPath(basename(filePath));
        const result = await ctx.runArgs('iconv', ['-f', fromEnc, '-t', toEnc, filePath], { timeout: 30_000 });
        await writeFile(outFile, result, 'utf8');
        return { files: [outFile] };
      } catch (err) {
        return { error: `Encoding conversion failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.line_endings_unix',
    category: 'file',
    name: 'Convert to Unix Line Endings',
    description: 'Convert Windows CRLF line endings to Unix LF',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const outFile = ctx.outputPath(basename(filePath));
        const content = await readFile(filePath, 'utf8');
        const converted = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        await writeFile(outFile, converted, 'utf8');
        return { files: [outFile], text: 'Converted to Unix (LF) line endings' };
      } catch (err) {
        return { error: `Line ending conversion failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.line_endings_windows',
    category: 'file',
    name: 'Convert to Windows Line Endings',
    description: 'Convert Unix LF line endings to Windows CRLF',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const filePath = ctx.inputFiles[0];
        const outFile = ctx.outputPath(basename(filePath));
        const content = await readFile(filePath, 'utf8');
        const converted = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
        await writeFile(outFile, converted, 'utf8');
        return { files: [outFile], text: 'Converted to Windows (CRLF) line endings' };
      } catch (err) {
        return { error: `Line ending conversion failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.tree',
    category: 'file',
    name: 'Directory Tree',
    description: 'Show the directory tree of the work directory (Node.js implementation)',
    params: [],
    async execute(_p, ctx) {
      try {
        const lines: string[] = [];
        const walk = async (dir: string, prefix = ''): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true });
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const last = i === entries.length - 1;
            const connector = last ? '└── ' : '├── ';
            lines.push(prefix + connector + entry.name);
            if (entry.isDirectory()) {
              await walk(join(dir, entry.name), prefix + (last ? '    ' : '│   '));
            }
          }
        };
        lines.push(basename(ctx.workDir));
        await walk(ctx.workDir);
        return { text: lines.join('\n') };
      } catch (err) {
        return { error: `Directory tree failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.count_files',
    category: 'file',
    name: 'Count Files by Extension',
    description: 'Count files grouped by extension in the work directory',
    params: [],
    async execute(_p, ctx) {
      try {
        const counts = new Map<string, number>();
        const recurse = async (dir: string): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) await recurse(full);
            else {
              const ext = extname(entry.name).toLowerCase() || '(no extension)';
              counts.set(ext, (counts.get(ext) ?? 0) + 1);
            }
          }
        };
        await recurse(ctx.workDir);
        if (counts.size === 0) return { text: 'No files found' };
        const lines = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([ext, n]) => `${n}\t${ext}`);
        lines.unshift('Count\tExtension', '-----\t---------');
        return { text: lines.join('\n') };
      } catch (err) {
        return { error: `Count files failed: ${(err as Error).message}` };
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
        const n = Math.min(10_000, Math.max(1, Math.trunc(Number(params.lines ?? 10)) || 10));
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        return { text: content.split('\n').slice(0, n).join('\n') };
      } catch (err) {
        return { error: `File head failed: ${(err as Error).message}` };
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
        const n = Math.min(10_000, Math.max(1, Math.trunc(Number(params.lines ?? 10)) || 10));
        const content = await readFile(ctx.inputFiles[0], 'utf8');
        const allLines = content.split('\n');
        return { text: allLines.slice(Math.max(0, allLines.length - n)).join('\n') };
      } catch (err) {
        return { error: `File tail failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.compare',
    category: 'file',
    name: 'Compare Files',
    description: 'Compare two input files — identical or show differences',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Two input files are required' };
        const [fileA, fileB] = ctx.inputFiles;
        const [bufA, bufB] = await Promise.all([readFile(fileA), readFile(fileB)]);
        const hashA = createHash('sha256').update(bufA).digest('hex');
        const hashB = createHash('sha256').update(bufB).digest('hex');
        if (hashA === hashB) return { text: 'Files are identical.' };
        try {
          const diff = await ctx.runArgs('diff', [fileA, fileB], { timeout: 15_000 });
          return { text: `Files differ:\n\n${diff}` };
        } catch (err) {
          const msg = (err as Error).message ?? '';
          return { text: `Files differ.\nSHA-256 A: ${hashA}\nSHA-256 B: ${hashB}\n${msg}` };
        }
      } catch (err) {
        return { error: `File comparison failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.size_human',
    category: 'file',
    name: 'Human-Readable File Size',
    description: 'Show file size in human-readable units (B, KB, MB, GB, TB)',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const stats = await stat(ctx.inputFiles[0]);
        const bytes = stats.size;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unit = units[0];
        for (let i = 1; i < units.length && size >= 1024; i++) {
          size /= 1024;
          unit = units[i];
        }
        return { text: `${bytes} bytes = ${size.toFixed(2)} ${unit}` };
      } catch (err) {
        return { error: `File size failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'file.type_detect',
    category: 'file',
    name: 'Detect File MIME Type',
    description: 'Detect the MIME type of the input file using the `file` CLI',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No input file provided' };
        const result = await ctx.runArgs('file', ['--mime-type', '-b', ctx.inputFiles[0]], { timeout: 10_000 });
        return { text: result.trim() };
      } catch (err) {
        return { error: `MIME type detection failed: ${(err as Error).message}` };
      }
    },
  },
];
