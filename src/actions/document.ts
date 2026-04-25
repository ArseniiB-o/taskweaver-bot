import type { Action } from './types.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';
import yaml from 'js-yaml';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { marked } from 'marked';
import sharp from 'sharp';

export const documentActions: Action[] = [
  {
    id: 'doc.pdf_merge',
    category: 'document',
    name: 'Merge PDFs',
    description: 'Merge multiple PDF files into a single PDF (requires 2+ input files)',
    params: [],
    async execute(params, ctx) {
      try {
        const inputs = ctx.inputFiles;
        if (inputs.length < 2) return { error: 'At least 2 PDF files required' };
        const merged = await PDFDocument.create();
        for (const pdfPath of inputs) {
          const buf = await readFile(pdfPath);
          const doc = await PDFDocument.load(buf);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          for (const page of pages) merged.addPage(page);
        }
        const outPath = ctx.outputPath('merged.pdf');
        await writeFile(outPath, await merged.save());
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_split',
    category: 'document',
    name: 'Split PDF',
    description: 'Extract specific pages from a PDF (e.g. "1-3,5,7-9")',
    params: [
      { name: 'pages', type: 'string', required: true, description: 'Page ranges to extract, e.g. "1-3,5,7-9"' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const buf = await readFile(input);
        const srcDoc = await PDFDocument.load(buf);
        const totalPages = srcDoc.getPageCount();

        const pageNums = parsePageRanges(String(params.pages), totalPages);
        if (pageNums.length === 0) return { error: 'No valid pages specified' };

        const newDoc = await PDFDocument.create();
        const indices = pageNums.map(n => n - 1).filter(i => i >= 0 && i < totalPages);
        const copied = await newDoc.copyPages(srcDoc, indices);
        for (const p of copied) newDoc.addPage(p);

        const outPath = ctx.outputPath('split.pdf');
        await writeFile(outPath, await newDoc.save());
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_compress',
    category: 'document',
    name: 'Compress PDF',
    description: 'Re-save PDF to reduce file size (basic compression via pdf-lib)',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const buf = await readFile(input);
        const doc = await PDFDocument.load(buf);
        const outPath = ctx.outputPath('compressed.pdf');
        await writeFile(outPath, await doc.save({ useObjectStreams: true }));
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_to_images',
    category: 'document',
    name: 'PDF Pages to Images',
    description: 'Convert each PDF page to a PNG image using pdftoppm CLI',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const outPrefix = ctx.outputPath('page');
        try {
          await ctx.runArgs('pdftoppm', ['-png', input, outPrefix], { timeout: 120_000 });
        } catch {
          return { error: 'pdftoppm is not available on this system. Install poppler-utils to use this action.' };
        }
        const { readdir } = await import('node:fs/promises');
        const dir = ctx.workDir;
        const entries = await readdir(dir);
        const files = entries
          .filter(e => e.startsWith('page') && e.endsWith('.png'))
          .map(e => join(dir, e))
          .sort();
        return files.length > 0 ? { files } : { error: 'No images generated' };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.images_to_pdf',
    category: 'document',
    name: 'Images to PDF',
    description: 'Convert one or more images into a single PDF document',
    params: [],
    async execute(params, ctx) {
      try {
        const inputs = ctx.inputFiles;
        if (inputs.length === 0) return { error: 'No input files provided' };
        const pdfDoc = await PDFDocument.create();
        for (const imgPath of inputs) {
          const meta = await sharp(imgPath).metadata();
          const fmt = meta.format;
          const imgBuf = await readFile(imgPath);
          let pdfImg;
          if (fmt === 'jpeg' || fmt === 'jpg') {
            pdfImg = await pdfDoc.embedJpg(imgBuf);
          } else {
            const pngBuf = await sharp(imgPath).png().toBuffer();
            pdfImg = await pdfDoc.embedPng(pngBuf);
          }
          const page = pdfDoc.addPage([pdfImg.width, pdfImg.height]);
          page.drawImage(pdfImg, { x: 0, y: 0, width: pdfImg.width, height: pdfImg.height });
        }
        const outPath = ctx.outputPath('images.pdf');
        await writeFile(outPath, await pdfDoc.save());
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_add_password',
    category: 'document',
    name: 'Add PDF Password',
    description: 'Encrypt a PDF with a password using qpdf CLI',
    params: [
      { name: 'password', type: 'string', required: true, description: 'Password to protect the PDF' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const password = String(params.password ?? '');
        if (password.length < 1 || password.length > 256) {
          return { error: 'Password must be 1-256 characters' };
        }
        const outPath = ctx.outputPath('protected.pdf');
        try {
          await ctx.runArgs(
            'qpdf',
            ['--encrypt', password, password, '256', '--', input, outPath],
            { timeout: 60_000 }
          );
        } catch {
          return { error: 'qpdf is not available on this system. Install qpdf to use this action.' };
        }
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_extract_text',
    category: 'document',
    name: 'Extract Text from PDF',
    description: 'Extract all text content from a PDF using pdftotext CLI',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        let text: string;
        try {
          text = await ctx.runArgs('pdftotext', [input, '-'], { timeout: 60_000 });
        } catch {
          return { error: 'pdftotext is not available. Install poppler-utils to use this action.' };
        }
        return { text };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_rotate',
    category: 'document',
    name: 'Rotate PDF Pages',
    description: 'Rotate all pages in a PDF by 90, 180, or 270 degrees',
    params: [
      {
        name: 'angle',
        type: 'string',
        required: true,
        description: 'Rotation angle',
        enum: ['90', '180', '270'],
      },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const angle = Number(params.angle);
        const buf = await readFile(input);
        const doc = await PDFDocument.load(buf);
        for (const page of doc.getPages()) {
          page.setRotation(degrees(angle));
        }
        const outPath = ctx.outputPath('rotated.pdf');
        await writeFile(outPath, await doc.save());
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_page_count',
    category: 'document',
    name: 'PDF Page Count',
    description: 'Return the number of pages in a PDF',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const buf = await readFile(input);
        const doc = await PDFDocument.load(buf);
        return { text: `Page count: ${doc.getPageCount()}` };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_metadata',
    category: 'document',
    name: 'PDF Metadata',
    description: 'Show metadata (title, author, creation date, etc.) of a PDF',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const buf = await readFile(input);
        const doc = await PDFDocument.load(buf);
        const lines = [
          `Title: ${doc.getTitle() ?? 'N/A'}`,
          `Author: ${doc.getAuthor() ?? 'N/A'}`,
          `Subject: ${doc.getSubject() ?? 'N/A'}`,
          `Keywords: ${doc.getKeywords() ?? 'N/A'}`,
          `Creator: ${doc.getCreator() ?? 'N/A'}`,
          `Producer: ${doc.getProducer() ?? 'N/A'}`,
          `Creation Date: ${doc.getCreationDate()?.toISOString() ?? 'N/A'}`,
          `Modification Date: ${doc.getModificationDate()?.toISOString() ?? 'N/A'}`,
          `Page Count: ${doc.getPageCount()}`,
        ];
        return { text: lines.join('\n') };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.html_to_pdf',
    category: 'document',
    name: 'HTML to PDF',
    description: 'Convert an HTML file to PDF using wkhtmltopdf CLI',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input HTML file provided' };
        const outPath = ctx.outputPath('output.pdf');
        try {
          await ctx.runArgs('wkhtmltopdf', [input, outPath], { timeout: 120_000 });
        } catch {
          return { error: 'wkhtmltopdf is not available. Install wkhtmltopdf to use this action.' };
        }
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.md_to_html',
    category: 'document',
    name: 'Markdown to HTML',
    description: 'Convert a Markdown file to an HTML document',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input Markdown file provided' };
        const md = await readFile(input, 'utf8');
        const html = await marked(md);
        const outPath = ctx.outputPath('output.html');
        await writeFile(outPath, html, 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.csv_to_json',
    category: 'document',
    name: 'CSV to JSON',
    description: 'Convert a CSV file to a JSON array',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input CSV file provided' };
        const raw = await readFile(input, 'utf8');
        const records = csvParse(raw, { columns: true, skip_empty_lines: true });
        const outPath = ctx.outputPath('output.json');
        await writeFile(outPath, JSON.stringify(records, null, 2), 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.json_to_csv',
    category: 'document',
    name: 'JSON to CSV',
    description: 'Convert a JSON array to a CSV file',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input JSON file provided' };
        const raw = await readFile(input, 'utf8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return { error: 'JSON must be an array of objects' };
        const csv = csvStringify(data, { header: true });
        const outPath = ctx.outputPath('output.csv');
        await writeFile(outPath, csv, 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.xml_to_json',
    category: 'document',
    name: 'XML to JSON',
    description: 'Convert an XML file to a JSON file',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input XML file provided' };
        const raw = await readFile(input, 'utf8');
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
        const obj = parser.parse(raw);
        const outPath = ctx.outputPath('output.json');
        await writeFile(outPath, JSON.stringify(obj, null, 2), 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.json_to_xml',
    category: 'document',
    name: 'JSON to XML',
    description: 'Convert a JSON file to an XML file',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input JSON file provided' };
        const raw = await readFile(input, 'utf8');
        const obj = JSON.parse(raw);
        const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
        const xml = builder.build(obj);
        const outPath = ctx.outputPath('output.xml');
        await writeFile(outPath, xml, 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.yaml_to_json',
    category: 'document',
    name: 'YAML to JSON',
    description: 'Convert a YAML file to a JSON file',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input YAML file provided' };
        const raw = await readFile(input, 'utf8');
        const obj = yaml.load(raw);
        const outPath = ctx.outputPath('output.json');
        await writeFile(outPath, JSON.stringify(obj, null, 2), 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.json_to_yaml',
    category: 'document',
    name: 'JSON to YAML',
    description: 'Convert a JSON file to a YAML file',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input JSON file provided' };
        const raw = await readFile(input, 'utf8');
        const obj = JSON.parse(raw);
        const outPath = ctx.outputPath('output.yaml');
        await writeFile(outPath, yaml.dump(obj), 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.json_format',
    category: 'document',
    name: 'Format JSON',
    description: 'Pretty-print a JSON file with configurable indentation',
    params: [
      { name: 'indent', type: 'number', required: false, description: 'Indentation spaces', default: 2 },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input JSON file provided' };
        const raw = await readFile(input, 'utf8');
        const obj = JSON.parse(raw);
        const indent = Math.max(0, Math.round(Number(params.indent ?? 2)));
        const outPath = ctx.outputPath('formatted.json');
        await writeFile(outPath, JSON.stringify(obj, null, indent), 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.json_minify',
    category: 'document',
    name: 'Minify JSON',
    description: 'Remove all whitespace from a JSON file to produce minimal output',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input JSON file provided' };
        const raw = await readFile(input, 'utf8');
        const obj = JSON.parse(raw);
        const outPath = ctx.outputPath('minified.json');
        await writeFile(outPath, JSON.stringify(obj), 'utf8');
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.json_validate',
    category: 'document',
    name: 'Validate JSON',
    description: 'Check whether a file contains valid JSON and report any parse errors',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input JSON file provided' };
        const raw = await readFile(input, 'utf8');
        try {
          JSON.parse(raw);
          return { text: 'Valid JSON' };
        } catch (parseErr: any) {
          return { text: `Invalid JSON: ${parseErr.message}` };
        }
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.csv_stats',
    category: 'document',
    name: 'CSV Statistics',
    description: 'Show row count, column names, and a sample of the CSV data',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input CSV file provided' };
        const raw = await readFile(input, 'utf8');
        const records = csvParse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
        const cols = records.length > 0 ? Object.keys(records[0]) : [];
        const sampleRows = records.slice(0, 3);
        const lines = [
          `Row count: ${records.length}`,
          `Columns (${cols.length}): ${cols.join(', ')}`,
          '',
          'Sample (first 3 rows):',
          ...sampleRows.map((r, i) => `  [${i + 1}] ${JSON.stringify(r)}`),
        ];
        return { text: lines.join('\n') };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.text_diff',
    category: 'document',
    name: 'Text Diff',
    description: 'Compare two text files and show the differences (requires 2 input files)',
    params: [],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Two input files required' };
        const [a, b] = ctx.inputFiles;
        let diff: string;
        try {
          diff = await ctx.runArgs('diff', [a, b], { timeout: 30_000 });
        } catch (execErr) {
          diff = (execErr as Error).message ?? String(execErr);
        }
        return { text: diff || 'Files are identical' };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.word_count',
    category: 'document',
    name: 'Word Count',
    description: 'Count words, lines, and characters in a text file',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const raw = await readFile(input, 'utf8');
        const lines = raw.split('\n').length;
        const words = raw.trim() === '' ? 0 : raw.trim().split(/\s+/).length;
        const chars = raw.length;
        const charsNoSpace = raw.replace(/\s/g, '').length;
        const result = [
          `Lines: ${lines}`,
          `Words: ${words}`,
          `Characters (with spaces): ${chars}`,
          `Characters (no spaces): ${charsNoSpace}`,
        ];
        return { text: result.join('\n') };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'doc.pdf_remove_pages',
    category: 'document',
    name: 'Remove PDF Pages',
    description: 'Remove specific pages from a PDF (e.g. "2,5,8")',
    params: [
      { name: 'pages', type: 'string', required: true, description: 'Page numbers to remove, e.g. "2,5,8"' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input PDF provided' };
        const buf = await readFile(input);
        const srcDoc = await PDFDocument.load(buf);
        const totalPages = srcDoc.getPageCount();

        const toRemove = new Set(parsePageRanges(String(params.pages), totalPages).map(n => n - 1));
        const keepIndices = Array.from({ length: totalPages }, (_, i) => i).filter(i => !toRemove.has(i));

        if (keepIndices.length === 0) return { error: 'Cannot remove all pages from a PDF' };

        const newDoc = await PDFDocument.create();
        const copied = await newDoc.copyPages(srcDoc, keepIndices);
        for (const p of copied) newDoc.addPage(p);

        const outPath = ctx.outputPath('pages_removed.pdf');
        await writeFile(outPath, await newDoc.save());
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a page range string like "1-3,5,7-9" into an array of 1-based page numbers.
 */
function parsePageRanges(rangeStr: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of rangeStr.split(',')) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= Math.min(end, totalPages); i++) pages.add(i);
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 1 && n <= totalPages) pages.add(n);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}
