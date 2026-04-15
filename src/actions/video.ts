import type { Action } from './types.js';
import { escPath } from '../utils.js';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ffmpegRun = async (ctx: any, args: string, output: string): Promise<{ files: string[] } | { error: string }> => {
  try {
    const input = ctx.inputFiles[0];
    if (!input) return { error: 'Нет входного файла' };
    await ctx.run(`ffmpeg -y -i "${escPath(input)}" ${args} "${escPath(output)}"`);
    return { files: [output] };
  } catch (e: any) {
    return { error: e.message };
  }
};

export const videoActions: Action[] = [
  {
    id: 'video.convert',
    category: 'video',
    name: 'Конвертация видео',
    description: 'Convert video to another format (mp4, avi, mkv, webm, mov, flv, wmv)',
    params: [{ name: 'format', type: 'string', required: true, description: 'Target format', enum: ['mp4','avi','mkv','webm','mov','flv','wmv'] }],
    execute: async (params, ctx) => ffmpegRun(ctx, '-c:v libx264 -c:a aac', ctx.outputPath(`output.${params.format}`)),
  },
  {
    id: 'video.compress',
    category: 'video',
    name: 'Сжатие видео',
    description: 'Compress video with quality preset',
    params: [{ name: 'quality', type: 'string', required: false, description: 'Quality preset', enum: ['low','medium','high'], default: 'medium' }],
    execute: async (params, ctx) => {
      const crfMap: Record<string, number> = { low: 32, medium: 26, high: 20 };
      const crf = crfMap[params.quality || 'medium'] || 26;
      return ffmpegRun(ctx, `-c:v libx264 -crf ${crf} -preset medium -c:a aac -b:a 128k`, ctx.outputPath('compressed.mp4'));
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
    execute: async (params, ctx) => ffmpegRun(ctx, `-ss ${params.start} -to ${params.end} -c copy`, ctx.outputPath('trimmed.mp4')),
  },
  {
    id: 'video.merge',
    category: 'video',
    name: 'Склейка видео',
    description: 'Concatenate multiple videos into one',
    params: [],
    execute: async (_p, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Нужно минимум 2 видео' };
        const listPath = join(ctx.workDir, 'filelist.txt');
        const txt = ctx.inputFiles.map(f => `file '${escPath(f)}'`).join('\n');
        await writeFile(listPath, txt);
        const output = ctx.outputPath('merged.mp4');
        await ctx.run(`ffmpeg -y -f concat -safe 0 -i "${escPath(listPath)}" -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k "${escPath(output)}"`);
        return { files: [output] };
      } catch (e: any) { return { error: e.message }; }
    },
  },
  {
    id: 'video.extract_audio',
    category: 'video',
    name: 'Извлечь аудио',
    description: 'Extract audio from video',
    params: [{ name: 'format', type: 'string', required: false, description: 'Audio format', enum: ['mp3','wav','aac'], default: 'mp3' }],
    execute: async (params, ctx) => {
      const fmt = params.format || 'mp3';
      const codec = fmt === 'wav' ? 'pcm_s16le' : fmt === 'aac' ? 'aac' : 'libmp3lame';
      return ffmpegRun(ctx, `-vn -c:a ${codec}`, ctx.outputPath(`audio.${fmt}`));
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
        const fps = params.fps || 1;
        const pattern = ctx.outputPath('frame_%04d.jpg');
        await ctx.run(`ffmpeg -y -i "${escPath(ctx.inputFiles[0])}" -vf fps=${fps} "${escPath(pattern)}"`);
        const files = await readdir(ctx.workDir);
        return { files: files.filter(f => f.includes('frame_')).map(f => join(ctx.workDir, f)) };
      } catch (e: any) { return { error: e.message }; }
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
    execute: async (params, ctx) => ffmpegRun(ctx, `-vf "fps=${params.fps||10},scale=${params.width||480}:-1:flags=lanczos"`, ctx.outputPath('output.gif')),
  },
  {
    id: 'video.from_images',
    category: 'video',
    name: 'Видео из картинок',
    description: 'Create video from image sequence',
    params: [{ name: 'fps', type: 'number', required: false, description: 'Frame rate', default: 24 }],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length === 0) return { error: 'Нет картинок' };
        const fps = params.fps || 24;
        const listPath = join(ctx.workDir, 'images.txt');
        const lines = ctx.inputFiles.map(f => `file '${escPath(f)}'\nduration ${(1/fps).toFixed(4)}`).join('\n');
        await writeFile(listPath, lines + `\nfile '${escPath(ctx.inputFiles[ctx.inputFiles.length-1])}'`);
        const output = ctx.outputPath('slideshow.mp4');
        await ctx.run(`ffmpeg -y -f concat -safe 0 -i "${escPath(listPath)}" -vsync vfr -pix_fmt yuv420p -c:v libx264 -r ${fps} "${escPath(output)}"`);
        return { files: [output] };
      } catch (e: any) { return { error: e.message }; }
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
    execute: async (params, ctx) => ffmpegRun(ctx, `-vf scale=${params.width}:${params.height}`, ctx.outputPath('resized.mp4')),
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
    execute: async (params, ctx) => ffmpegRun(ctx, `-vf crop=${params.width}:${params.height}:${params.x}:${params.y}`, ctx.outputPath('cropped.mp4')),
  },
  {
    id: 'video.rotate',
    category: 'video',
    name: 'Повернуть',
    description: 'Rotate video 90/180/270 degrees',
    params: [{ name: 'angle', type: 'string', required: true, description: 'Angle', enum: ['90','180','270'] }],
    execute: async (params, ctx) => {
      const filters: Record<string, string> = { '90': 'transpose=1', '180': 'transpose=1,transpose=1', '270': 'transpose=2' };
      return ffmpegRun(ctx, `-vf "${filters[params.angle]||filters['90']}"`, ctx.outputPath('rotated.mp4'));
    },
  },
  { id: 'video.flip_h', category: 'video', name: 'Зеркально H', description: 'Flip horizontal', params: [], execute: async (_p, ctx) => ffmpegRun(ctx, '-vf hflip', ctx.outputPath('flipped.mp4')) },
  { id: 'video.flip_v', category: 'video', name: 'Зеркально V', description: 'Flip vertical', params: [], execute: async (_p, ctx) => ffmpegRun(ctx, '-vf vflip', ctx.outputPath('flipped.mp4')) },
  {
    id: 'video.watermark',
    category: 'video',
    name: 'Водяной знак',
    description: 'Add image watermark (requires 2 files: video + image)',
    params: [{ name: 'position', type: 'string', required: false, description: 'Position', enum: ['topleft','topright','bottomleft','bottomright'], default: 'bottomright' }],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Нужно 2 файла' };
        const pos: Record<string,string> = { topleft:'10:10', topright:'main_w-overlay_w-10:10', bottomleft:'10:main_h-overlay_h-10', bottomright:'main_w-overlay_w-10:main_h-overlay_h-10' };
        const output = ctx.outputPath('watermarked.mp4');
        await ctx.run(`ffmpeg -y -i "${escPath(ctx.inputFiles[0])}" -i "${escPath(ctx.inputFiles[1])}" -filter_complex "overlay=${pos[params.position||'bottomright']}" "${escPath(output)}"`);
        return { files: [output] };
      } catch (e: any) { return { error: e.message }; }
    },
  },
  {
    id: 'video.speed',
    category: 'video',
    name: 'Скорость',
    description: 'Change playback speed',
    params: [{ name: 'speed', type: 'number', required: true, description: 'Speed multiplier' }],
    execute: async (params, ctx) => {
      const s = params.speed;
      const atempo = s >= 0.5 && s <= 2 ? `atempo=${s}` : s > 2 ? `atempo=2.0,atempo=${s/2}` : `atempo=0.5,atempo=${s*2}`;
      return ffmpegRun(ctx, `-filter_complex "[0:v]setpts=${1/s}*PTS[v];[0:a]${atempo}[a]" -map "[v]" -map "[a]"`, ctx.outputPath('speed.mp4'));
    },
  },
  { id: 'video.reverse', category: 'video', name: 'Реверс', description: 'Reverse video', params: [], execute: async (_p, ctx) => ffmpegRun(ctx, '-vf reverse -af areverse', ctx.outputPath('reversed.mp4')) },
  {
    id: 'video.thumbnail',
    category: 'video',
    name: 'Превью',
    description: 'Extract thumbnail at time',
    params: [{ name: 'time', type: 'string', required: false, description: 'Time (HH:MM:SS)', default: '00:00:01' }],
    execute: async (params, ctx) => ffmpegRun(ctx, `-ss ${params.time||'00:00:01'} -vframes 1`, ctx.outputPath('thumbnail.jpg')),
  },
  {
    id: 'video.split',
    category: 'video',
    name: 'Разрезать',
    description: 'Split into equal parts',
    params: [{ name: 'duration', type: 'number', required: true, description: 'Part duration (seconds)' }],
    execute: async (params, ctx) => {
      try {
        const pattern = ctx.outputPath('part_%03d.mp4');
        await ctx.run(`ffmpeg -y -i "${escPath(ctx.inputFiles[0])}" -c copy -map 0 -segment_time ${params.duration} -f segment -reset_timestamps 1 "${escPath(pattern)}"`);
        const files = await readdir(ctx.workDir);
        return { files: files.filter(f => f.includes('part_')).map(f => join(ctx.workDir, f)) };
      } catch (e: any) { return { error: e.message }; }
    },
  },
  {
    id: 'video.loop',
    category: 'video',
    name: 'Зациклить',
    description: 'Loop video N times',
    params: [{ name: 'count', type: 'number', required: true, description: 'Loop count' }],
    execute: async (params, ctx) => ffmpegRun(ctx, `-stream_loop ${params.count-1} -c copy`, ctx.outputPath('looped.mp4')),
  },
  {
    id: 'video.add_audio',
    category: 'video',
    name: 'Добавить аудио',
    description: 'Replace audio track (requires 2 files)',
    params: [],
    execute: async (_p, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Нужно 2 файла' };
        const output = ctx.outputPath('with_audio.mp4');
        await ctx.run(`ffmpeg -y -i "${escPath(ctx.inputFiles[0])}" -i "${escPath(ctx.inputFiles[1])}" -map 0:v -map 1:a -c:v copy -c:a aac -shortest "${escPath(output)}"`);
        return { files: [output] };
      } catch (e: any) { return { error: e.message }; }
    },
  },
  { id: 'video.remove_audio', category: 'video', name: 'Убрать аудио', description: 'Remove audio track', params: [], execute: async (_p, ctx) => ffmpegRun(ctx, '-c:v copy -an', ctx.outputPath('muted.mp4')) },
  {
    id: 'video.brightness',
    category: 'video',
    name: 'Яркость/контраст',
    description: 'Adjust brightness and contrast',
    params: [
      { name: 'brightness', type: 'number', required: false, description: 'Brightness -1..1', default: 0 },
      { name: 'contrast', type: 'number', required: false, description: 'Contrast 0..2', default: 1 },
    ],
    execute: async (params, ctx) => ffmpegRun(ctx, `-vf "eq=brightness=${params.brightness||0}:contrast=${params.contrast||1}"`, ctx.outputPath('adjusted.mp4')),
  },
  {
    id: 'video.fps',
    category: 'video',
    name: 'Изменить FPS',
    description: 'Change frame rate',
    params: [{ name: 'fps', type: 'number', required: true, description: 'Target FPS' }],
    execute: async (params, ctx) => ffmpegRun(ctx, `-r ${params.fps}`, ctx.outputPath('fps.mp4')),
  },
  {
    id: 'video.metadata',
    category: 'video',
    name: 'Метаданные',
    description: 'Show video metadata',
    params: [],
    execute: async (_p, ctx) => {
      try {
        const out = await ctx.run(`ffprobe -v quiet -print_format json -show_format -show_streams "${escPath(ctx.inputFiles[0])}"`);
        return { text: out };
      } catch (e: any) { return { error: e.message }; }
    },
  },
  {
    id: 'video.snapshot',
    category: 'video',
    name: 'Скриншот',
    description: 'Screenshot at time',
    params: [{ name: 'time', type: 'string', required: true, description: 'Time (HH:MM:SS)' }],
    execute: async (params, ctx) => ffmpegRun(ctx, `-ss ${params.time} -vframes 1`, ctx.outputPath('snapshot.jpg')),
  },
  {
    id: 'video.add_text',
    category: 'video',
    name: 'Добавить текст',
    description: 'Add text overlay',
    params: [
      { name: 'text', type: 'string', required: true, description: 'Text' },
      { name: 'fontsize', type: 'number', required: false, description: 'Font size', default: 24 },
      { name: 'position', type: 'string', required: false, description: 'Position', enum: ['top','center','bottom'], default: 'bottom' },
    ],
    execute: async (params, ctx) => {
      const text = String(params.text).replace(/'/g, "\\'").replace(/:/g, '\\:');
      const posMap: Record<string, string> = { top: 'y=10', center: 'y=(h-text_h)/2', bottom: 'y=h-text_h-10' };
      return ffmpegRun(ctx, `-vf "drawtext=text='${text}':fontsize=${params.fontsize||24}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:${posMap[params.position||'bottom']}"`, ctx.outputPath('text.mp4'));
    },
  },
  {
    id: 'video.blur',
    category: 'video',
    name: 'Размытие',
    description: 'Blur video',
    params: [{ name: 'strength', type: 'number', required: false, description: 'Blur strength', default: 5 }],
    execute: async (params, ctx) => ffmpegRun(ctx, `-vf "boxblur=${params.strength||5}"`, ctx.outputPath('blurred.mp4')),
  },
  { id: 'video.grayscale', category: 'video', name: 'ЧБ', description: 'Grayscale video', params: [], execute: async (_p, ctx) => ffmpegRun(ctx, '-vf "hue=s=0"', ctx.outputPath('grayscale.mp4')) },
  {
    id: 'video.stabilize',
    category: 'video',
    name: 'Стабилизация',
    description: 'Stabilize shaky video (two-pass)',
    params: [],
    execute: async (_p, ctx) => {
      try {
        const input = ctx.inputFiles[0];
        const transforms = join(ctx.workDir, 'transforms.trf');
        const output = ctx.outputPath('stabilized.mp4');
        await ctx.run(`ffmpeg -y -i "${escPath(input)}" -vf vidstabdetect=shakiness=10:accuracy=15:result="${escPath(transforms)}" -f null -`);
        await ctx.run(`ffmpeg -y -i "${escPath(input)}" -vf vidstabtransform=input="${escPath(transforms)}":zoom=5:smoothing=30 -c:a copy "${escPath(output)}"`);
        return { files: [output] };
      } catch (e: any) { return { error: `Требует libvidstab: ${e.message}` }; }
    },
  },
  {
    id: 'video.picture_in_picture',
    category: 'video',
    name: 'Картинка в картинке',
    description: 'Overlay small video on main (requires 2 files)',
    params: [
      { name: 'position', type: 'string', required: false, description: 'Position', enum: ['topleft','topright','bottomleft','bottomright'], default: 'topright' },
      { name: 'scale', type: 'number', required: false, description: 'Scale 0-1', default: 0.25 },
    ],
    execute: async (params, ctx) => {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Нужно 2 видео' };
        const pos: Record<string,string> = { topleft:'10:10', topright:'W-w-10:10', bottomleft:'10:H-h-10', bottomright:'W-w-10:H-h-10' };
        const output = ctx.outputPath('pip.mp4');
        await ctx.run(`ffmpeg -y -i "${escPath(ctx.inputFiles[0])}" -i "${escPath(ctx.inputFiles[1])}" -filter_complex "[1:v]scale=iw*${params.scale||0.25}:-1[pip];[0:v][pip]overlay=${pos[params.position||'topright']}" -c:a copy "${escPath(output)}"`);
        return { files: [output] };
      } catch (e: any) { return { error: e.message }; }
    },
  },
];
