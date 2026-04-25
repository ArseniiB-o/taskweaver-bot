import type { Action } from './types.js';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { sanitizeFilename } from '../security/sanitize.js';

const SAFE_OUTPUT_NAME = (raw: unknown, fallback: string): string =>
  sanitizeFilename(String(raw ?? fallback), fallback);

export const archiveActions: Action[] = [
  {
    id: 'archive.zip_create',
    category: 'archive',
    name: 'Create ZIP',
    description: 'Create a ZIP archive from input files',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'archive.zip' },
    ],
    execute: async (params, ctx) => {
      try {
        const outFile = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_name, 'archive.zip'));
        await new Promise<void>((resolve, reject) => {
          const out = createWriteStream(outFile);
          const archive = archiver('zip', { zlib: { level: 9 } });
          out.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(out);
          for (const filePath of ctx.inputFiles) {
            const filename = filePath.split(/[\\/]/).pop() ?? 'file';
            archive.file(filePath, { name: filename });
          }
          archive.finalize();
        });
        ctx.log(`Created ZIP: ${outFile}`);
        return { files: [outFile] };
      } catch (err) {
        return { error: `zip_create failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.zip_extract',
    category: 'archive',
    name: 'Extract ZIP',
    description: 'Extract a ZIP archive',
    params: [
      { name: 'output_dir', type: 'string', required: false, description: 'Output directory name', default: 'extracted' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const outDir = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_dir, 'extracted'));
        await mkdir(outDir, { recursive: true });
        await extractZip(ctx.inputFiles[0], { dir: outDir });
        ctx.log(`Extracted ZIP to: ${outDir}`);
        return { files: [outDir] };
      } catch (err) {
        return { error: `zip_extract failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.tar_create',
    category: 'archive',
    name: 'Create TAR.GZ',
    description: 'Create a TAR.GZ archive from input files',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'archive.tar.gz' },
    ],
    execute: async (params, ctx) => {
      try {
        const outFile = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_name, 'archive.tar.gz'));
        await new Promise<void>((resolve, reject) => {
          const out = createWriteStream(outFile);
          const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
          out.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(out);
          for (const filePath of ctx.inputFiles) {
            const filename = filePath.split(/[\\/]/).pop() ?? 'file';
            archive.file(filePath, { name: filename });
          }
          archive.finalize();
        });
        ctx.log(`Created TAR.GZ: ${outFile}`);
        return { files: [outFile] };
      } catch (err) {
        return { error: `tar_create failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.tar_extract',
    category: 'archive',
    name: 'Extract TAR/TAR.GZ',
    description: 'Extract a TAR or TAR.GZ archive (requires tar CLI)',
    params: [
      { name: 'output_dir', type: 'string', required: false, description: 'Output directory name', default: 'extracted' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const outDir = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_dir, 'extracted'));
        await mkdir(outDir, { recursive: true });
        await ctx.runArgs('tar', ['-xf', ctx.inputFiles[0], '-C', outDir]);
        ctx.log(`Extracted TAR to: ${outDir}`);
        return { files: [outDir] };
      } catch (err) {
        return { error: `tar_extract failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.gzip',
    category: 'archive',
    name: 'Gzip Compress',
    description: 'Compress a single file using gzip (Node.js zlib)',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename (default: input + .gz)' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const baseName = ctx.inputFiles[0].split(/[\\/]/).pop() ?? 'file';
        const outFile = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_name, `${baseName}.gz`));
        await pipeline(createReadStream(ctx.inputFiles[0]), createGzip({ level: 9 }), createWriteStream(outFile));
        return { files: [outFile] };
      } catch (err) {
        return { error: `gzip failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.gunzip',
    category: 'archive',
    name: 'Gzip Decompress',
    description: 'Decompress a gzip-compressed file (Node.js zlib)',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename (default: filename without .gz)' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const baseName = (ctx.inputFiles[0].split(/[\\/]/).pop() ?? 'file').replace(/\.gz$/i, '');
        const outFile = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_name, baseName));
        await pipeline(createReadStream(ctx.inputFiles[0]), createGunzip(), createWriteStream(outFile));
        return { files: [outFile] };
      } catch (err) {
        return { error: `gunzip failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.list',
    category: 'archive',
    name: 'List Archive Contents',
    description: 'List the contents of a ZIP or TAR archive',
    params: [],
    execute: async (_params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const lower = ctx.inputFiles[0].toLowerCase();
        let result: string;
        if (lower.endsWith('.zip')) {
          result = await ctx.runArgs('unzip', ['-l', ctx.inputFiles[0]]);
        } else if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar.bz2')) {
          result = await ctx.runArgs('tar', ['-tf', ctx.inputFiles[0]]);
        } else {
          return { error: 'Unsupported archive format. Supported: .zip, .tar, .tar.gz, .tgz, .tar.bz2' };
        }
        return { text: result };
      } catch (err) {
        return { error: `archive.list failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.7z_create',
    category: 'archive',
    name: 'Create 7z Archive',
    description: 'Create a 7z archive from input files using the 7z CLI',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename', default: 'archive.7z' },
      { name: 'compression', type: 'number', required: false, description: 'Compression level 0-9', default: 5 },
    ],
    execute: async (params, ctx) => {
      try {
        const outFile = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_name, 'archive.7z'));
        const level = Math.min(9, Math.max(0, Math.trunc(Number(params.compression ?? 5)) || 5));
        const result = await ctx.runArgs('7z', ['a', `-mx=${level}`, outFile, ...ctx.inputFiles]);
        ctx.log(result);
        return { files: [outFile] };
      } catch (err) {
        return { error: `7z_create failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.7z_extract',
    category: 'archive',
    name: 'Extract 7z Archive',
    description: 'Extract a 7z archive using the 7z CLI',
    params: [
      { name: 'output_dir', type: 'string', required: false, description: 'Output directory name', default: 'extracted' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const outDir = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_dir, 'extracted'));
        await mkdir(outDir, { recursive: true });
        const result = await ctx.runArgs('7z', ['x', ctx.inputFiles[0], `-o${outDir}`, '-y']);
        ctx.log(result);
        return { files: [outDir] };
      } catch (err) {
        return { error: `7z_extract failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.rar_extract',
    category: 'archive',
    name: 'Extract RAR Archive',
    description: 'Extract a RAR archive using the unrar CLI',
    params: [
      { name: 'output_dir', type: 'string', required: false, description: 'Output directory name', default: 'extracted' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const outDir = ctx.outputPath(SAFE_OUTPUT_NAME(params.output_dir, 'extracted'));
        await mkdir(outDir, { recursive: true });
        const result = await ctx.runArgs('unrar', ['x', '-y', ctx.inputFiles[0], `${outDir}/`]);
        ctx.log(result);
        return { files: [outDir] };
      } catch (err) {
        return { error: `rar_extract failed: ${(err as Error).message}` };
      }
    },
  },
];
