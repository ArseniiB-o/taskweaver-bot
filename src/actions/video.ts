import type { Action, ExecContext } from './types.js';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertFfmpegTime } from '../security/sanitize.js';

function input(ctx: { inputFiles: string[] }): string {
  if (!ctx.inputFiles[0]) throw new Error('No input file provided');
  return ctx.inputFiles[0];
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function intArg(v: unknown, min: number, max: number, fallback: number): string {
  return String(Math.trunc(clampNum(v, min, max, fallback)));
}

async function ffmpegSimple(ctx: ExecContext, extraArgs: string[], outputName: string): Promise<{ files: string[] } | { error: string }> {
  try {
    const inp = input(ctx);
    const out = ctx.outputPath(outputName);
    await ctx.runArgs('ffmpeg', ['-y', '-i', inp, ...extraArgs, out]);
    return { files: [out] };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const VIDEO_FORMATS = ['mp4', 'avi', 'mkv', 'webm', 'mov', 'flv', 'wmv'];

export const videoActions: Action[] = [
  {
    id: 'video.convert',
    category: 'video',
    name: 'Конвертация видео',
    description: 'Convert video to another format (mp4, avi, mkv, webm, mov, flv, wmv)',
    params: [{ name: 'format', type: 'string', required: true, description: 'Target format', enum: VIDEO_FORMATS }],
    execute: async (params, ctx) => {
      const fmt = String(params.format ?? 'mp4');
      if (!VIDEO_FORMATS.includes(fmt)) return { error: `Unsupported format: ${fmt}` };
      return ffmpegSimple(ctx, ['-c:v', 'libx264', '-c:a', 'aac'], `output.${fmt}`);
    },
  },
  {
    id: 'video.compress',
    category: 'video',
    name: 'Сжатие видео',
    description: 'Compress video with quality preset',
    params: [{ name: 'quality', type: 'string', required: false, description: 'Quality preset', enum: ['low', 'medium', 'high'], default: 'medium' }],
    execute: async (params, ctx) => {
      const crfMap: Record<string, number> = { low: 32, medium: 26, high: 20 };
      const crf = crfMap[String(params.quality ?? 'medium')] ?? 26;
      return ffmpegSimple(ctx, [
        '-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium',
        '-c:a', 'aac', '-b:a', '128k',
      ], 'compressed.mp4');
    },
  },
  {
    id: 'video.trim',
    category: 'video',
    name: 'Обрезка видео',
    description: 'Trim video to time range',
    params: [
      { name: 'start', type: 'string', required: true, description: 'Start time (HH:MM:SS)' },
      { name: 'end', type: 'string', required: true, description: 'End time (HH:MM:SS)' },
    ],
    execute: async (params, ctx) => {
      try {
        const start = assertFfmpegTime(String(params.start ?? ''));
        const end = assertFfmpegTime(String(params.end ?? ''));
        return ffmpegSimple(ctx, ['-ss', start, '-to', end, '-c', 'copy'], 'trimmed.mp4');
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.merge',
    category: 'video',
    name: 'Склейка видео',
    description: 'Concatenate multiple videos into one',
    params: [],
    execute: async (_p, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'At least 2 videos required' };
        const listPath = join(ctx.workDir, 'filelist.txt');
        const txt = ctx.inputFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
        await writeFile(listPath, txt);
        const out = ctx.outputPath('merged.mp4');
        await ctx.runArgs('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
          '-c:a', 'aac', '-b:a', '128k', out,
        ]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.extract_audio',
    category: 'video',
    name: 'Извлечь аудио',
    description: 'Extract audio from video',
    params: [{ name: 'format', type: 'string', required: false, description: 'Audio format', enum: ['mp3', 'wav', 'aac'], default: 'mp3' }],
    execute: async (params, ctx) => {
      const fmt = String(params.format ?? 'mp3');
      if (!['mp3', 'wav', 'aac'].includes(fmt)) return { error: `Unsupported format: ${fmt}` };
      const codec = fmt === 'wav' ? 'pcm_s16le' : fmt === 'aac' ? 'aac' : 'libmp3lame';
      return ffmpegSimple(ctx, ['-vn', '-c:a', codec], `audio.${fmt}`);
    },
  },
  {
    id: 'video.extract_frames',
    category: 'video',
    name: 'Извлечь кадры',
    description: 'Extract frames as images',
    params: [{ name: 'fps', type: 'number', required: false, description: 'Frames per second', default: 1 }],
    execute: async (params, ctx) => {
      try {
        const fps = clampNum(params.fps, 0.1, 60, 1);
        const pattern = ctx.outputPath('frame_%04d.jpg');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-vf', `fps=${fps}`, pattern]);
        const files = await readdir(ctx.workDir);
        return { files: files.filter(f => f.includes('frame_')).map(f => join(ctx.workDir, f)) };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.to_gif',
    category: 'video',
    name: 'Видео в GIF',
    description: 'Convert video to GIF',
    params: [
      { name: 'fps', type: 'number', required: false, description: 'GIF frame rate', default: 10 },
      { name: 'width', type: 'number', required: false, description: 'GIF width', default: 480 },
    ],
    execute: async (params, ctx) => {
      const fps = clampNum(params.fps, 1, 30, 10);
      const width = Math.trunc(clampNum(params.width, 32, 1920, 480));
      return ffmpegSimple(ctx, ['-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`], 'output.gif');
    },
  },
  {
    id: 'video.from_images',
    category: 'video',
    name: 'Видео из картинок',
    description: 'Create video from image sequence',
    params: [{ name: 'fps', type: 'number', required: false, description: 'Frame rate', default: 24 }],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'No images provided' };
        const fps = clampNum(params.fps, 1, 60, 24);
        const listPath = join(ctx.workDir, 'images.txt');
        const dur = (1 / fps).toFixed(4);
        const lines = ctx.inputFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'\nduration ${dur}`).join('\n');
        const lastLine = `\nfile '${ctx.inputFiles[ctx.inputFiles.length - 1].replace(/'/g, "'\\''")}'`;
        await writeFile(listPath, lines + lastLine);
        const out = ctx.outputPath('slideshow.mp4');
        await ctx.runArgs('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-vsync', 'vfr', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-r', String(fps), out,
        ]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.resize',
    category: 'video',
    name: 'Изменить размер',
    description: 'Resize video to dimensions',
    params: [
      { name: 'width', type: 'number', required: true, description: 'Width' },
      { name: 'height', type: 'number', required: true, description: 'Height' },
    ],
    execute: async (params, ctx) => ffmpegSimple(ctx, [
      '-vf', `scale=${intArg(params.width, 16, 7680, 1280)}:${intArg(params.height, 16, 4320, 720)}`,
    ], 'resized.mp4'),
  },
  {
    id: 'video.crop',
    category: 'video',
    name: 'Обрезать видео',
    description: 'Crop video to region',
    params: [
      { name: 'width', type: 'number', required: true, description: 'Crop width' },
      { name: 'height', type: 'number', required: true, description: 'Crop height' },
      { name: 'x', type: 'number', required: true, description: 'X offset' },
      { name: 'y', type: 'number', required: true, description: 'Y offset' },
    ],
    execute: async (params, ctx) => ffmpegSimple(ctx, [
      '-vf', `crop=${intArg(params.width, 1, 7680, 100)}:${intArg(params.height, 1, 4320, 100)}:${intArg(params.x, 0, 7680, 0)}:${intArg(params.y, 0, 4320, 0)}`,
    ], 'cropped.mp4'),
  },
  {
    id: 'video.rotate',
    category: 'video',
    name: 'Повернуть',
    description: 'Rotate video 90/180/270 degrees',
    params: [{ name: 'angle', type: 'string', required: true, description: 'Angle', enum: ['90', '180', '270'] }],
    execute: async (params, ctx) => {
      const map: Record<string, string> = { '90': 'transpose=1', '180': 'transpose=1,transpose=1', '270': 'transpose=2' };
      const angle = String(params.angle ?? '90');
      return ffmpegSimple(ctx, ['-vf', map[angle] ?? map['90']], 'rotated.mp4');
    },
  },
  { id: 'video.flip_h', category: 'video', name: 'Зеркально H', description: 'Flip horizontal', params: [], execute: async (_p, ctx) => ffmpegSimple(ctx, ['-vf', 'hflip'], 'flipped.mp4') },
  { id: 'video.flip_v', category: 'video', name: 'Зеркально V', description: 'Flip vertical', params: [], execute: async (_p, ctx) => ffmpegSimple(ctx, ['-vf', 'vflip'], 'flipped.mp4') },
  {
    id: 'video.watermark',
    category: 'video',
    name: 'Водяной знак',
    description: 'Add image watermark (requires 2 files: video + image)',
    params: [{ name: 'position', type: 'string', required: false, description: 'Position', enum: ['topleft', 'topright', 'bottomleft', 'bottomright'], default: 'bottomright' }],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: '2 input files required' };
        const pos: Record<string, string> = {
          topleft: '10:10', topright: 'main_w-overlay_w-10:10',
          bottomleft: '10:main_h-overlay_h-10', bottomright: 'main_w-overlay_w-10:main_h-overlay_h-10',
        };
        const p = String(params.position ?? 'bottomright');
        const out = ctx.outputPath('watermarked.mp4');
        await ctx.runArgs('ffmpeg', [
          '-y', '-i', ctx.inputFiles[0], '-i', ctx.inputFiles[1],
          '-filter_complex', `overlay=${pos[p] ?? pos.bottomright}`, out,
        ]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.speed',
    category: 'video',
    name: 'Скорость',
    description: 'Change playback speed',
    params: [{ name: 'speed', type: 'number', required: true, description: 'Speed multiplier' }],
    execute: async (params, ctx) => {
      const s = clampNum(params.speed, 0.25, 4, 1);
      const atempo = s >= 0.5 && s <= 2 ? `atempo=${s}` : s > 2 ? `atempo=2.0,atempo=${s / 2}` : `atempo=0.5,atempo=${s * 2}`;
      return ffmpegSimple(ctx, [
        '-filter_complex', `[0:v]setpts=${1 / s}*PTS[v];[0:a]${atempo}[a]`,
        '-map', '[v]', '-map', '[a]',
      ], 'speed.mp4');
    },
  },
  { id: 'video.reverse', category: 'video', name: 'Реверс', description: 'Reverse video', params: [], execute: async (_p, ctx) => ffmpegSimple(ctx, ['-vf', 'reverse', '-af', 'areverse'], 'reversed.mp4') },
  {
    id: 'video.thumbnail',
    category: 'video',
    name: 'Превью',
    description: 'Extract thumbnail at time',
    params: [{ name: 'time', type: 'string', required: false, description: 'Time (HH:MM:SS)', default: '00:00:01' }],
    execute: async (params, ctx) => {
      try {
        const t = assertFfmpegTime(String(params.time ?? '00:00:01'));
        return ffmpegSimple(ctx, ['-ss', t, '-vframes', '1'], 'thumbnail.jpg');
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.split',
    category: 'video',
    name: 'Разрезать',
    description: 'Split into equal parts',
    params: [{ name: 'duration', type: 'number', required: true, description: 'Part duration (seconds)' }],
    execute: async (params, ctx) => {
      try {
        const dur = clampNum(params.duration, 1, 3600, 30);
        const pattern = ctx.outputPath('part_%03d.mp4');
        await ctx.runArgs('ffmpeg', [
          '-y', '-i', input(ctx), '-c', 'copy', '-map', '0',
          '-segment_time', String(dur), '-f', 'segment',
          '-reset_timestamps', '1', pattern,
        ]);
        const files = await readdir(ctx.workDir);
        return { files: files.filter(f => f.includes('part_')).map(f => join(ctx.workDir, f)) };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.loop',
    category: 'video',
    name: 'Зациклить',
    description: 'Loop video N times',
    params: [{ name: 'count', type: 'number', required: true, description: 'Loop count' }],
    execute: async (params, ctx) => {
      const count = Math.trunc(clampNum(params.count, 1, 100, 2));
      return ffmpegSimple(ctx, ['-stream_loop', String(Math.max(0, count - 1)), '-c', 'copy'], 'looped.mp4');
    },
  },
  {
    id: 'video.add_audio',
    category: 'video',
    name: 'Добавить аудио',
    description: 'Replace audio track (requires 2 files)',
    params: [],
    execute: async (_p, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: '2 input files required' };
        const out = ctx.outputPath('with_audio.mp4');
        await ctx.runArgs('ffmpeg', [
          '-y', '-i', ctx.inputFiles[0], '-i', ctx.inputFiles[1],
          '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out,
        ]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  { id: 'video.remove_audio', category: 'video', name: 'Убрать аудио', description: 'Remove audio track', params: [], execute: async (_p, ctx) => ffmpegSimple(ctx, ['-c:v', 'copy', '-an'], 'muted.mp4') },
  {
    id: 'video.brightness',
    category: 'video',
    name: 'Яркость/контраст',
    description: 'Adjust brightness and contrast',
    params: [
      { name: 'brightness', type: 'number', required: false, description: 'Brightness -1..1', default: 0 },
      { name: 'contrast', type: 'number', required: false, description: 'Contrast 0..2', default: 1 },
    ],
    execute: async (params, ctx) => {
      const b = clampNum(params.brightness, -1, 1, 0);
      const c = clampNum(params.contrast, 0, 2, 1);
      return ffmpegSimple(ctx, ['-vf', `eq=brightness=${b}:contrast=${c}`], 'adjusted.mp4');
    },
  },
  {
    id: 'video.fps',
    category: 'video',
    name: 'Изменить FPS',
    description: 'Change frame rate',
    params: [{ name: 'fps', type: 'number', required: true, description: 'Target FPS' }],
    execute: async (params, ctx) => {
      const fps = Math.trunc(clampNum(params.fps, 1, 240, 30));
      return ffmpegSimple(ctx, ['-r', String(fps)], 'fps.mp4');
    },
  },
  {
    id: 'video.metadata',
    category: 'video',
    name: 'Метаданные',
    description: 'Show video metadata',
    params: [],
    execute: async (_p, ctx) => {
      try {
        const text = await ctx.runArgs('ffprobe', [
          '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input(ctx),
        ]);
        return { text };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.snapshot',
    category: 'video',
    name: 'Скриншот',
    description: 'Screenshot at time',
    params: [{ name: 'time', type: 'string', required: true, description: 'Time (HH:MM:SS)' }],
    execute: async (params, ctx) => {
      try {
        const t = assertFfmpegTime(String(params.time ?? ''));
        return ffmpegSimple(ctx, ['-ss', t, '-vframes', '1'], 'snapshot.jpg');
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'video.add_text',
    category: 'video',
    name: 'Добавить текст',
    description: 'Add text overlay',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text' },
      { name: 'fontsize', type: 'number', required: false, description: 'Font size', default: 24 },
      { name: 'position', type: 'string', required: false, description: 'Position', enum: ['top', 'center', 'bottom'], default: 'bottom' },
    ],
    execute: async (params, ctx) => {
      const text = String(params.text ?? '').slice(0, 200).replace(/[\\:'"]/g, '');
      const fontsize = Math.trunc(clampNum(params.fontsize, 6, 256, 24));
      const posMap: Record<string, string> = { top: 'y=10', center: 'y=(h-text_h)/2', bottom: 'y=h-text_h-10' };
      const pos = posMap[String(params.position ?? 'bottom')] ?? posMap.bottom;
      return ffmpegSimple(ctx, [
        '-vf', `drawtext=text='${text}':fontsize=${fontsize}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:${pos}`,
      ], 'text.mp4');
    },
  },
  {
    id: 'video.blur',
    category: 'video',
    name: 'Размытие',
    description: 'Blur video',
    params: [{ name: 'strength', type: 'number', required: false, description: 'Blur strength', default: 5 }],
    execute: async (params, ctx) => {
      const s = clampNum(params.strength, 1, 50, 5);
      return ffmpegSimple(ctx, ['-vf', `boxblur=${s}`], 'blurred.mp4');
    },
  },
  { id: 'video.grayscale', category: 'video', name: 'ЧБ', description: 'Grayscale video', params: [], execute: async (_p, ctx) => ffmpegSimple(ctx, ['-vf', 'hue=s=0'], 'grayscale.mp4') },
  {
    id: 'video.stabilize',
    category: 'video',
    name: 'Стабилизация',
    description: 'Stabilize shaky video (two-pass, requires libvidstab)',
    params: [],
    execute: async (_p, ctx) => {
      try {
        const inp = input(ctx);
        const transforms = join(ctx.workDir, 'transforms.trf');
        const out = ctx.outputPath('stabilized.mp4');
        await ctx.runArgs('ffmpeg', ['-y', '-i', inp, '-vf', `vidstabdetect=shakiness=10:accuracy=15:result=${transforms}`, '-f', 'null', '-']);
        await ctx.runArgs('ffmpeg', ['-y', '-i', inp, '-vf', `vidstabtransform=input=${transforms}:zoom=5:smoothing=30`, '-c:a', 'copy', out]);
        return { files: [out] };
      } catch (e) { return { error: `Requires libvidstab: ${(e as Error).message}` }; }
    },
  },
  {
    id: 'video.picture_in_picture',
    category: 'video',
    name: 'Картинка в картинке',
    description: 'Overlay small video on main (requires 2 files)',
    params: [
      { name: 'position', type: 'string', required: false, description: 'Position', enum: ['topleft', 'topright', 'bottomleft', 'bottomright'], default: 'topright' },
      { name: 'scale', type: 'number', required: false, description: 'Scale 0-1', default: 0.25 },
    ],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: '2 videos required' };
        const pos: Record<string, string> = {
          topleft: '10:10', topright: 'W-w-10:10',
          bottomleft: '10:H-h-10', bottomright: 'W-w-10:H-h-10',
        };
        const p = String(params.position ?? 'topright');
        const scale = clampNum(params.scale, 0.05, 1, 0.25);
        const out = ctx.outputPath('pip.mp4');
        await ctx.runArgs('ffmpeg', [
          '-y', '-i', ctx.inputFiles[0], '-i', ctx.inputFiles[1],
          '-filter_complex', `[1:v]scale=iw*${scale}:-1[pip];[0:v][pip]overlay=${pos[p] ?? pos.topright}`,
          '-c:a', 'copy', out,
        ]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
];
