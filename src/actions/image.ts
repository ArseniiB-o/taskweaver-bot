import type { Action } from './types.js';
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';

export const imageActions: Action[] = [
  {
    id: 'image.convert',
    category: 'image',
    name: 'Convert Image Format',
    description: 'Convert an image to a different format (png, jpg, webp, tiff, avif, gif)',
    params: [
      {
        name: 'format',
        type: 'string',
        required: true,
        description: 'Target format',
        enum: ['png', 'jpg', 'webp', 'tiff', 'avif', 'gif'],
      },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const fmt = params.format as string;
        const outPath = ctx.outputPath(`output.${fmt}`);
        await sharp(input).toFormat(fmt as any).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.resize',
    category: 'image',
    name: 'Resize Image',
    description: 'Resize image to specified width (and optional height)',
    params: [
      { name: 'width', type: 'number', required: true, description: 'Target width in pixels' },
      { name: 'height', type: 'number', required: false, description: 'Target height in pixels (optional, maintains aspect ratio if omitted)' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('resized.png');
        const w = Math.round(Number(params.width));
        const h = params.height ? Math.round(Number(params.height)) : undefined;
        await sharp(input).resize(w, h).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.crop',
    category: 'image',
    name: 'Crop Image',
    description: 'Crop a region from the image',
    params: [
      { name: 'left', type: 'number', required: true, description: 'Left offset in pixels' },
      { name: 'top', type: 'number', required: true, description: 'Top offset in pixels' },
      { name: 'width', type: 'number', required: true, description: 'Crop width in pixels' },
      { name: 'height', type: 'number', required: true, description: 'Crop height in pixels' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('cropped.png');
        await sharp(input)
          .extract({
            left: Math.round(Number(params.left)),
            top: Math.round(Number(params.top)),
            width: Math.round(Number(params.width)),
            height: Math.round(Number(params.height)),
          })
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.rotate',
    category: 'image',
    name: 'Rotate Image',
    description: 'Rotate image by specified angle in degrees',
    params: [
      { name: 'angle', type: 'number', required: true, description: 'Rotation angle in degrees' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('rotated.png');
        await sharp(input).rotate(Number(params.angle)).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.flip_h',
    category: 'image',
    name: 'Flip Horizontal',
    description: 'Flip image horizontally (mirror left-right)',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('flipped_h.png');
        await sharp(input).flop().toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.flip_v',
    category: 'image',
    name: 'Flip Vertical',
    description: 'Flip image vertically (mirror top-bottom)',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('flipped_v.png');
        await sharp(input).flip().toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.watermark_text',
    category: 'image',
    name: 'Add Text Watermark',
    description: 'Overlay a semi-transparent text watermark on the image',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Watermark text' },
      {
        name: 'position',
        type: 'string',
        required: false,
        description: 'Watermark position',
        enum: ['center', 'topleft', 'topright', 'bottomleft', 'bottomright'],
        default: 'center',
      },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const meta = await sharp(input).metadata();
        const w = meta.width ?? 400;
        const h = meta.height ?? 400;
        const text = String(params.text);
        const position = String(params.position ?? 'center');
        const fontSize = Math.max(16, Math.round(w / 15));

        const posMap: Record<string, { x: number; y: number; anchor: string }> = {
          center: { x: w / 2, y: h / 2, anchor: 'middle' },
          topleft: { x: 20, y: fontSize + 10, anchor: 'start' },
          topright: { x: w - 20, y: fontSize + 10, anchor: 'end' },
          bottomleft: { x: 20, y: h - 20, anchor: 'start' },
          bottomright: { x: w - 20, y: h - 20, anchor: 'end' },
        };
        const { x, y, anchor } = posMap[position] ?? posMap['center'];

        const svg = Buffer.from(
          `<svg width="${w}" height="${h}">
            <text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle"
              font-size="${fontSize}" font-family="Arial" fill="white" opacity="0.6"
              stroke="black" stroke-width="1">${text}</text>
          </svg>`
        );

        const outPath = ctx.outputPath('watermarked.png');
        await sharp(input)
          .composite([{ input: svg, blend: 'over' }])
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.compress',
    category: 'image',
    name: 'Compress Image',
    description: 'Compress/optimize image quality',
    params: [
      { name: 'quality', type: 'number', required: false, description: 'Quality 1-100', default: 80 },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const quality = Math.min(100, Math.max(1, Number(params.quality ?? 80)));
        const outPath = ctx.outputPath('compressed.jpg');
        await sharp(input).jpeg({ quality }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.thumbnail',
    category: 'image',
    name: 'Create Thumbnail',
    description: 'Create a square thumbnail of the image',
    params: [
      { name: 'size', type: 'number', required: false, description: 'Thumbnail size in pixels', default: 150 },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const size = Math.round(Number(params.size ?? 150));
        const outPath = ctx.outputPath('thumbnail.png');
        await sharp(input).resize(size, size, { fit: 'cover' }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.collage',
    category: 'image',
    name: 'Create Collage',
    description: 'Arrange multiple images into a grid collage',
    params: [],
    async execute(params, ctx) {
      try {
        const inputs = ctx.inputFiles;
        if (inputs.length < 2) return { error: 'At least 2 input files required' };

        const cellSize = 300;
        const cols = Math.ceil(Math.sqrt(inputs.length));
        const rows = Math.ceil(inputs.length / cols);
        const totalW = cols * cellSize;
        const totalH = rows * cellSize;

        const baseImg = sharp({
          create: { width: totalW, height: totalH, channels: 3, background: '#ffffff' },
        }).png();

        const composites: sharp.OverlayOptions[] = [];
        for (let i = 0; i < inputs.length; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const buf = await sharp(inputs[i])
            .resize(cellSize, cellSize, { fit: 'cover' })
            .toBuffer();
          composites.push({ input: buf, left: col * cellSize, top: row * cellSize });
        }

        const outPath = ctx.outputPath('collage.png');
        await baseImg.composite(composites).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.to_pdf',
    category: 'image',
    name: 'Images to PDF',
    description: 'Convert one or more images into a single PDF document',
    params: [],
    async execute(params, ctx) {
      try {
        const inputs = ctx.inputFiles;
        if (inputs.length === 0) return { error: 'No input files provided' };

        const pdfDoc = await PDFDocument.create();
        for (const imgPath of inputs) {
          const imgBuf = await readFile(imgPath);
          const meta = await sharp(imgPath).metadata();
          const fmt = meta.format;
          let pdfImage;
          if (fmt === 'jpeg' || fmt === 'jpg') {
            pdfImage = await pdfDoc.embedJpg(imgBuf);
          } else {
            const pngBuf = await sharp(imgPath).png().toBuffer();
            pdfImage = await pdfDoc.embedPng(pngBuf);
          }
          const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
          page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });
        }

        const outPath = ctx.outputPath('images.pdf');
        const pdfBytes = await pdfDoc.save();
        await writeFile(outPath, pdfBytes);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.grayscale',
    category: 'image',
    name: 'Grayscale',
    description: 'Convert image to grayscale',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('grayscale.png');
        await sharp(input).grayscale().toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.sepia',
    category: 'image',
    name: 'Sepia Tone',
    description: 'Apply a warm sepia tone effect to the image',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('sepia.png');
        await sharp(input).grayscale().tint({ r: 112, g: 66, b: 20 }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.blur',
    category: 'image',
    name: 'Blur Image',
    description: 'Apply Gaussian blur to the image',
    params: [
      { name: 'sigma', type: 'number', required: false, description: 'Blur sigma (strength)', default: 5 },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const sigma = Math.max(0.3, Number(params.sigma ?? 5));
        const outPath = ctx.outputPath('blurred.png');
        await sharp(input).blur(sigma).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.sharpen',
    category: 'image',
    name: 'Sharpen Image',
    description: 'Sharpen image details',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('sharpened.png');
        await sharp(input).sharpen().toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.brightness',
    category: 'image',
    name: 'Adjust Brightness',
    description: 'Adjust image brightness (0.5 = darker, 1.0 = normal, 1.5 = brighter)',
    params: [
      { name: 'factor', type: 'number', required: true, description: 'Brightness factor (e.g. 0.5–1.5)' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const factor = Number(params.factor);
        const outPath = ctx.outputPath('brightness.png');
        await sharp(input).modulate({ brightness: factor }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.contrast',
    category: 'image',
    name: 'Adjust Contrast',
    description: 'Adjust image contrast using linear transform',
    params: [
      { name: 'factor', type: 'number', required: true, description: 'Contrast factor (e.g. 0.5–2.0)' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const factor = Number(params.factor);
        // sharp linear: a*(x) + b; factor > 1 increases contrast
        const a = factor;
        const b = 128 * (1 - factor);
        const outPath = ctx.outputPath('contrast.png');
        await sharp(input).linear(a, b).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.saturation',
    category: 'image',
    name: 'Adjust Saturation',
    description: 'Adjust color saturation (0 = grayscale, 1 = normal, >1 = more vivid)',
    params: [
      { name: 'factor', type: 'number', required: true, description: 'Saturation multiplier' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const factor = Number(params.factor);
        const outPath = ctx.outputPath('saturation.png');
        await sharp(input).modulate({ saturation: factor }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.border',
    category: 'image',
    name: 'Add Border',
    description: 'Add a solid color border around the image',
    params: [
      { name: 'width', type: 'number', required: false, description: 'Border width in pixels', default: 10 },
      { name: 'color', type: 'string', required: false, description: 'Border color hex (e.g. #000000)', default: '#000000' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const bw = Math.round(Number(params.width ?? 10));
        const color = String(params.color ?? '#000000');
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const outPath = ctx.outputPath('bordered.png');
        await sharp(input)
          .extend({ top: bw, bottom: bw, left: bw, right: bw, background: { r, g, b, alpha: 1 } })
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.text_overlay',
    category: 'image',
    name: 'Text Overlay',
    description: 'Add custom text on image at specified coordinates',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text to overlay' },
      { name: 'x', type: 'number', required: true, description: 'X position' },
      { name: 'y', type: 'number', required: true, description: 'Y position' },
      { name: 'fontsize', type: 'number', required: false, description: 'Font size in pixels', default: 24 },
      { name: 'color', type: 'string', required: false, description: 'Text color', default: 'white' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const meta = await sharp(input).metadata();
        const iw = meta.width ?? 800;
        const ih = meta.height ?? 600;
        const text = String(params.text);
        const x = Number(params.x);
        const y = Number(params.y);
        const fontsize = Number(params.fontsize ?? 24);
        const color = String(params.color ?? 'white');

        const svg = Buffer.from(
          `<svg width="${iw}" height="${ih}">
            <text x="${x}" y="${y}" font-size="${fontsize}" font-family="Arial"
              fill="${color}">${text}</text>
          </svg>`
        );

        const outPath = ctx.outputPath('text_overlay.png');
        await sharp(input).composite([{ input: svg, blend: 'over' }]).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.strip_exif',
    category: 'image',
    name: 'Strip EXIF Metadata',
    description: 'Remove all EXIF metadata from the image',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('no_exif.png');
        await sharp(input).withMetadata({ exif: {} }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.to_ico',
    category: 'image',
    name: 'Convert to ICO',
    description: 'Convert image to ICO format (32x32 PNG saved as .ico)',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('icon.ico');
        await sharp(input).resize(32, 32).png().toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.base64_encode',
    category: 'image',
    name: 'Base64 Encode Image',
    description: 'Encode image file to a base64 string',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const buf = await readFile(input);
        const b64 = buf.toString('base64');
        return { text: b64 };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.base64_decode',
    category: 'image',
    name: 'Base64 Decode Image',
    description: 'Decode a base64 string and save it as an image file',
    params: [
      { name: 'data', type: 'string', required: true, description: 'Base64-encoded image data' },
      { name: 'format', type: 'string', required: false, description: 'Output image format', default: 'png' },
    ],
    async execute(params, ctx) {
      try {
        const data = String(params.data);
        const fmt = String(params.format ?? 'png');
        const buf = Buffer.from(data, 'base64');
        const outPath = ctx.outputPath(`decoded.${fmt}`);
        await sharp(buf).toFormat(fmt as any).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.qr_generate',
    category: 'image',
    name: 'Generate QR Code',
    description: 'Generate a QR code image from text or URL',
    params: [
      { name: 'data', type: 'string', required: true, description: 'Text or URL to encode in QR' },
      { name: 'size', type: 'number', required: false, description: 'QR code size in pixels', default: 300 },
    ],
    async execute(params, ctx) {
      try {
        const data = String(params.data);
        const size = Math.round(Number(params.size ?? 300));
        const outPath = ctx.outputPath('qr.png');
        await QRCode.toFile(outPath, data, { width: size, type: 'png' });
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.negative',
    category: 'image',
    name: 'Negative / Invert Colors',
    description: 'Invert all colors in the image to create a negative effect',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const outPath = ctx.outputPath('negative.png');
        await sharp(input).negate().toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.pixelate',
    category: 'image',
    name: 'Pixelate Image',
    description: 'Apply a pixelation effect by resizing down then up',
    params: [
      { name: 'size', type: 'number', required: false, description: 'Pixel block size', default: 10 },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const blockSize = Math.max(2, Math.round(Number(params.size ?? 10)));
        const meta = await sharp(input).metadata();
        const origW = meta.width ?? 100;
        const origH = meta.height ?? 100;
        const smallW = Math.max(1, Math.floor(origW / blockSize));
        const smallH = Math.max(1, Math.floor(origH / blockSize));
        const outPath = ctx.outputPath('pixelated.png');
        await sharp(input)
          .resize(smallW, smallH, { fit: 'fill', kernel: 'nearest' })
          .resize(origW, origH, { fit: 'fill', kernel: 'nearest' })
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.round_corners',
    category: 'image',
    name: 'Round Corners',
    description: 'Apply rounded corners to the image using an SVG mask',
    params: [
      { name: 'radius', type: 'number', required: false, description: 'Corner radius in pixels', default: 20 },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const meta = await sharp(input).metadata();
        const w = meta.width ?? 200;
        const h = meta.height ?? 200;
        const r = Number(params.radius ?? 20);

        const mask = Buffer.from(
          `<svg width="${w}" height="${h}">
            <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="white"/>
          </svg>`
        );

        const outPath = ctx.outputPath('rounded.png');
        await sharp(input)
          .composite([{ input: mask, blend: 'dest-in' }])
          .png()
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.tint',
    category: 'image',
    name: 'Apply Color Tint',
    description: 'Apply a color tint overlay to the image',
    params: [
      { name: 'color', type: 'string', required: true, description: 'Tint color hex (e.g. #ff0000)' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const color = String(params.color);
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const outPath = ctx.outputPath('tinted.png');
        await sharp(input).tint({ r, g, b }).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.metadata',
    category: 'image',
    name: 'Show Image Metadata',
    description: 'Return dimensions, format, size and other metadata about the image',
    params: [],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const meta = await sharp(input).metadata();
        const { readFile: rf } = await import('node:fs/promises');
        const buf = await rf(input);
        const lines = [
          `Format: ${meta.format ?? 'unknown'}`,
          `Width: ${meta.width ?? 'N/A'} px`,
          `Height: ${meta.height ?? 'N/A'} px`,
          `Channels: ${meta.channels ?? 'N/A'}`,
          `Depth: ${meta.depth ?? 'N/A'}`,
          `Density: ${meta.density ?? 'N/A'} DPI`,
          `Color Space: ${meta.space ?? 'N/A'}`,
          `Has Alpha: ${meta.hasAlpha ?? false}`,
          `Has Profile: ${meta.hasProfile ?? false}`,
          `File Size: ${(buf.length / 1024).toFixed(2)} KB`,
        ];
        return { text: lines.join('\n') };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.extend',
    category: 'image',
    name: 'Add Padding',
    description: 'Extend image canvas with padding on each side',
    params: [
      { name: 'top', type: 'number', required: true, description: 'Top padding in pixels' },
      { name: 'bottom', type: 'number', required: true, description: 'Bottom padding in pixels' },
      { name: 'left', type: 'number', required: true, description: 'Left padding in pixels' },
      { name: 'right', type: 'number', required: true, description: 'Right padding in pixels' },
      { name: 'color', type: 'string', required: false, description: 'Fill color (color name or hex)', default: 'white' },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const color = String(params.color ?? 'white');
        let bg: sharp.Color;
        if (color.startsWith('#')) {
          const hex = color.replace('#', '');
          bg = { r: parseInt(hex.substring(0, 2), 16), g: parseInt(hex.substring(2, 4), 16), b: parseInt(hex.substring(4, 6), 16), alpha: 1 };
        } else {
          bg = color as any;
        }
        const outPath = ctx.outputPath('extended.png');
        await sharp(input)
          .extend({
            top: Math.round(Number(params.top)),
            bottom: Math.round(Number(params.bottom)),
            left: Math.round(Number(params.left)),
            right: Math.round(Number(params.right)),
            background: bg,
          })
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.overlay',
    category: 'image',
    name: 'Overlay Image',
    description: 'Overlay a second image on top of the first at specified coordinates (requires 2 input files)',
    params: [
      { name: 'x', type: 'number', required: false, description: 'X offset for overlay', default: 0 },
      { name: 'y', type: 'number', required: false, description: 'Y offset for overlay', default: 0 },
    ],
    async execute(params, ctx) {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Two input files required (base and overlay)' };
        const base = ctx.inputFiles[0];
        const overlay = ctx.inputFiles[1];
        const x = Math.round(Number(params.x ?? 0));
        const y = Math.round(Number(params.y ?? 0));
        const overlayBuf = await sharp(overlay).toBuffer();
        const outPath = ctx.outputPath('overlay.png');
        await sharp(base)
          .composite([{ input: overlayBuf, left: x, top: y }])
          .toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.extract_channel',
    category: 'image',
    name: 'Extract Color Channel',
    description: 'Extract a single color channel (red, green, or blue) as a grayscale image',
    params: [
      {
        name: 'channel',
        type: 'string',
        required: true,
        description: 'Color channel to extract',
        enum: ['red', 'green', 'blue'],
      },
    ],
    async execute(params, ctx) {
      try {
        const input = ctx.inputFiles[0];
        if (!input) return { error: 'No input file provided' };
        const channel = String(params.channel) as 'red' | 'green' | 'blue';
        const outPath = ctx.outputPath(`channel_${channel}.png`);
        await sharp(input).extractChannel(channel).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.merge_horizontal',
    category: 'image',
    name: 'Merge Images Side by Side',
    description: 'Stitch multiple images horizontally into one wide image',
    params: [],
    async execute(params, ctx) {
      try {
        const inputs = ctx.inputFiles;
        if (inputs.length < 2) return { error: 'At least 2 input files required' };

        const metas = await Promise.all(inputs.map(f => sharp(f).metadata()));
        const maxH = Math.max(...metas.map(m => m.height ?? 0));
        const totalW = metas.reduce((sum, m) => sum + (m.width ?? 0), 0);

        const base = sharp({
          create: { width: totalW, height: maxH, channels: 3, background: '#ffffff' },
        }).png();

        const composites: sharp.OverlayOptions[] = [];
        let offsetX = 0;
        for (let i = 0; i < inputs.length; i++) {
          const h = metas[i].height ?? maxH;
          const buf = await sharp(inputs[i]).resize(undefined, maxH).toBuffer();
          composites.push({ input: buf, left: offsetX, top: 0 });
          offsetX += metas[i].width ?? 0;
        }

        const outPath = ctx.outputPath('merged_h.png');
        await base.composite(composites).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },

  {
    id: 'image.merge_vertical',
    category: 'image',
    name: 'Merge Images Vertically',
    description: 'Stack multiple images vertically into one tall image',
    params: [],
    async execute(params, ctx) {
      try {
        const inputs = ctx.inputFiles;
        if (inputs.length < 2) return { error: 'At least 2 input files required' };

        const metas = await Promise.all(inputs.map(f => sharp(f).metadata()));
        const maxW = Math.max(...metas.map(m => m.width ?? 0));
        const totalH = metas.reduce((sum, m) => sum + (m.height ?? 0), 0);

        const base = sharp({
          create: { width: maxW, height: totalH, channels: 3, background: '#ffffff' },
        }).png();

        const composites: sharp.OverlayOptions[] = [];
        let offsetY = 0;
        for (let i = 0; i < inputs.length; i++) {
          const buf = await sharp(inputs[i]).resize(maxW).toBuffer();
          composites.push({ input: buf, left: 0, top: offsetY });
          offsetY += metas[i].height ?? 0;
        }

        const outPath = ctx.outputPath('merged_v.png');
        await base.composite(composites).toFile(outPath);
        return { files: [outPath] };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  },
];
