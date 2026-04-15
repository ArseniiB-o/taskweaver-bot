import type { Action } from './types.js';
import { escPath } from '../utils.js';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
        const outputName = (params.output_name as string) || 'archive.zip';
        const outputFile = ctx.outputPath(outputName);

        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(outputFile);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);

          for (const filePath of ctx.inputFiles) {
            const filename = filePath.split(/[\\/]/).pop() ?? filePath;
            archive.file(filePath, { name: filename });
          }

          archive.finalize();
        });

        ctx.log(`Created ZIP: ${outputFile}`);
        return { files: [outputFile] };
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
        const outputDir = ctx.outputPath((params.output_dir as string) || 'extracted');
        await extractZip(ctx.inputFiles[0], { dir: outputDir });
        ctx.log(`Extracted ZIP to: ${outputDir}`);
        return { files: [outputDir] };
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
        const outputName = (params.output_name as string) || 'archive.tar.gz';
        const outputFile = ctx.outputPath(outputName);

        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(outputFile);
          const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });

          output.on('close', resolve);
          archive.on('error', reject);
          archive.pipe(output);

          for (const filePath of ctx.inputFiles) {
            const filename = filePath.split(/[\\/]/).pop() ?? filePath;
            archive.file(filePath, { name: filename });
          }

          archive.finalize();
        });

        ctx.log(`Created TAR.GZ: ${outputFile}`);
        return { files: [outputFile] };
      } catch (err) {
        return { error: `tar_create failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.tar_extract',
    category: 'archive',
    name: 'Extract TAR/TAR.GZ',
    description: 'Extract a TAR or TAR.GZ archive',
    params: [
      { name: 'output_dir', type: 'string', required: false, description: 'Output directory name', default: 'extracted' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const outputDir = ctx.outputPath((params.output_dir as string) || 'extracted');
        const src = escPath(ctx.inputFiles[0]);
        const dest = escPath(outputDir);
        await ctx.exec(`mkdir -p ${dest} && tar -xf ${src} -C ${dest}`);
        ctx.log(`Extracted TAR to: ${outputDir}`);
        return { files: [outputDir] };
      } catch (err) {
        return { error: `tar_extract failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.gzip',
    category: 'archive',
    name: 'Gzip Compress',
    description: 'Compress a single file using gzip',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename (default: input + .gz)' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const baseName = ctx.inputFiles[0].split(/[\\/]/).pop() ?? 'file';
        const outputName = (params.output_name as string) || `${baseName}.gz`;
        const outputFile = ctx.outputPath(outputName);
        const src = escPath(ctx.inputFiles[0]);
        const dest = escPath(outputFile);
        await ctx.exec(`gzip -c ${src} > ${dest}`);
        ctx.log(`Compressed: ${outputFile}`);
        return { files: [outputFile] };
      } catch (err) {
        return { error: `gzip failed: ${(err as Error).message}` };
      }
    },
  },

  {
    id: 'archive.gunzip',
    category: 'archive',
    name: 'Gzip Decompress',
    description: 'Decompress a gzip-compressed file',
    params: [
      { name: 'output_name', type: 'string', required: false, description: 'Output filename (default: filename without .gz)' },
    ],
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const baseName = (ctx.inputFiles[0].split(/[\\/]/).pop() ?? 'file').replace(/\.gz$/i, '');
        const outputName = (params.output_name as string) || baseName;
        const outputFile = ctx.outputPath(outputName);
        const src = escPath(ctx.inputFiles[0]);
        const dest = escPath(outputFile);
        await ctx.exec(`gunzip -c ${src} > ${dest}`);
        ctx.log(`Decompressed: ${outputFile}`);
        return { files: [outputFile] };
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
    execute: async (params, ctx) => {
      try {
        if (!ctx.inputFiles[0]) return { error: 'No input file provided' };
        const lowerName = ctx.inputFiles[0].toLowerCase();
        const src = escPath(ctx.inputFiles[0]);

        let result: string;
        if (lowerName.endsWith('.zip')) {
          result = await ctx.exec(`unzip -l ${src}`);
        } else if (
          lowerName.endsWith('.tar') ||
          lowerName.endsWith('.tar.gz') ||
          lowerName.endsWith('.tgz') ||
          lowerName.endsWith('.tar.bz2')
        ) {
          result = await ctx.exec(`tar -tf ${src}`);
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
        const outputName = (params.output_name as string) || 'archive.7z';
        const outputFile = ctx.outputPath(outputName);
        const dest = escPath(outputFile);
        const level = (params.compression as number) ?? 5;
        const fileList = ctx.inputFiles.map(escPath).join(' ');

        const result = await ctx.exec(`7z a -mx=${level} ${dest} ${fileList}`);
        ctx.log(result);
        return { files: [outputFile] };
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
        const outputDir = ctx.outputPath((params.output_dir as string) || 'extracted');
        const src = escPath(ctx.inputFiles[0]);
        const dest = escPath(outputDir);

        const result = await ctx.exec(`7z x ${src} -o${dest} -y`);
        ctx.log(result);
        return { files: [outputDir] };
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
        const outputDir = ctx.outputPath((params.output_dir as string) || 'extracted');
        const src = escPath(ctx.inputFiles[0]);
        const dest = escPath(outputDir);

        const result = await ctx.exec(`unrar x -y ${src} ${dest}/`);
        ctx.log(result);
        return { files: [outputDir] };
      } catch (err) {
        return { error: `rar_extract failed: ${(err as Error).message}` };
      }
    },
  },
];
