import type { Action } from './types.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertFfmpegTime, assertBitrate } from '../security/sanitize.js';

function input(ctx: { inputFiles: string[] }): string {
  if (!ctx.inputFiles[0]) throw new Error('No input file provided');
  return ctx.inputFiles[0];
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

const ENUM_FORMATS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']);

export const audioActions: Action[] = [
  {
    id: 'audio.convert',
    category: 'audio',
    name: 'Convert Audio Format',
    description: 'Convert audio to a different format',
    params: [
      { name: 'format', type: 'string', required: true, description: 'Output format', enum: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] },
      { name: 'bitrate', type: 'string', required: false, description: 'Output bitrate, e.g. 192k' },
    ],
    async execute(params, ctx) {
      try {
        const fmt = String(params.format ?? '');
        if (!ENUM_FORMATS.has(fmt)) return { error: `Unsupported format: ${fmt}` };
        const out = ctx.outputPath(`output.${fmt}`);
        const args = ['-y', '-i', input(ctx)];
        if (params.bitrate) args.push('-b:a', assertBitrate(String(params.bitrate)));
        args.push(out);
        await ctx.runArgs('ffmpeg', args);
        return { files: [out] };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },
  {
    id: 'audio.extract_from_video',
    category: 'audio',
    name: 'Extract Audio from Video',
    description: 'Extract the audio track from a video file',
    params: [
      { name: 'format', type: 'string', required: false, description: 'Output audio format', enum: ['mp3', 'wav', 'aac', 'flac'], default: 'mp3' },
    ],
    async execute(params, ctx) {
      try {
        const fmt = String(params.format ?? 'mp3');
        if (!['mp3', 'wav', 'aac', 'flac'].includes(fmt)) return { error: `Unsupported format: ${fmt}` };
        const out = ctx.outputPath(`audio.${fmt}`);
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-vn', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.merge',
    category: 'audio',
    name: 'Merge Audio Files',
    description: 'Merge multiple audio files into one using concat filter',
    params: [],
    async execute(_params, ctx) {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'At least 2 audio files required' };
        const args: string[] = ['-y'];
        for (const f of ctx.inputFiles) args.push('-i', f);
        const filter = ctx.inputFiles.map((_, i) => `[${i}:a]`).join('') + `concat=n=${ctx.inputFiles.length}:v=0:a=1[out]`;
        const out = ctx.outputPath('merged.mp3');
        args.push('-filter_complex', filter, '-map', '[out]', out);
        await ctx.runArgs('ffmpeg', args);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.split',
    category: 'audio',
    name: 'Split Audio at Timestamp',
    description: 'Split audio into two parts at a given timestamp',
    params: [
      { name: 'time', type: 'string', required: true, description: 'Split point in HH:MM:SS format' },
    ],
    async execute(params, ctx) {
      try {
        const t = assertFfmpegTime(String(params.time ?? ''));
        const inp = input(ctx);
        const part1 = ctx.outputPath('part1.mp3');
        const part2 = ctx.outputPath('part2.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', inp, '-t', t, part1]);
        await ctx.runArgs('ffmpeg', ['-y', '-i', inp, '-ss', t, part2]);
        return { files: [part1, part2] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.trim',
    category: 'audio',
    name: 'Trim Audio',
    description: 'Trim audio between start and end timestamps',
    params: [
      { name: 'start', type: 'string', required: true, description: 'Start time in HH:MM:SS format' },
      { name: 'end', type: 'string', required: true, description: 'End time in HH:MM:SS format' },
    ],
    async execute(params, ctx) {
      try {
        const start = assertFfmpegTime(String(params.start ?? ''));
        const end = assertFfmpegTime(String(params.end ?? ''));
        const out = ctx.outputPath('trimmed.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-ss', start, '-to', end, '-c', 'copy', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.change_bitrate',
    category: 'audio',
    name: 'Change Bitrate',
    description: 'Re-encode audio with a different bitrate',
    params: [
      { name: 'bitrate', type: 'string', required: true, description: 'Target bitrate, e.g. 128k, 320k' },
    ],
    async execute(params, ctx) {
      try {
        const bitrate = assertBitrate(String(params.bitrate ?? ''));
        const out = ctx.outputPath('output.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-b:a', bitrate, out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.normalize',
    category: 'audio',
    name: 'Normalize Volume',
    description: 'Normalize audio loudness using the loudnorm filter',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('normalized.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af', 'loudnorm', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.fade',
    category: 'audio',
    name: 'Add Fade In/Out',
    description: 'Add fade in and/or fade out to audio',
    params: [
      { name: 'fade_in', type: 'number', required: false, description: 'Fade in duration in seconds', default: 0 },
      { name: 'fade_out', type: 'number', required: false, description: 'Fade out duration in seconds', default: 0 },
    ],
    async execute(params, ctx) {
      try {
        const fi = clampNumber(params.fade_in, 0, 600, 0);
        const fo = clampNumber(params.fade_out, 0, 600, 0);
        const filters: string[] = [];
        if (fi > 0) filters.push(`afade=t=in:d=${fi}`);
        if (fo > 0) filters.push(`afade=t=out:st=0:d=${fo}`);
        const out = ctx.outputPath('faded.mp3');
        const args = ['-y', '-i', input(ctx)];
        if (filters.length > 0) args.push('-af', filters.join(','));
        args.push(out);
        await ctx.runArgs('ffmpeg', args);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.speed',
    category: 'audio',
    name: 'Change Playback Speed',
    description: 'Speed up or slow down audio playback',
    params: [
      { name: 'speed', type: 'number', required: true, description: 'Speed multiplier, e.g. 1.5 for 50% faster' },
    ],
    async execute(params, ctx) {
      try {
        const speed = clampNumber(params.speed, 0.25, 4, 1);
        const out = ctx.outputPath('speed.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af', `atempo=${speed}`, out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.reverse',
    category: 'audio',
    name: 'Reverse Audio',
    description: 'Reverse the audio playback',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('reversed.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af', 'areverse', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.remove_silence',
    category: 'audio',
    name: 'Remove Silence',
    description: 'Remove silent parts from audio using silenceremove filter',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('no_silence.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af',
          'silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-50dB', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.loop',
    category: 'audio',
    name: 'Loop Audio',
    description: 'Loop audio N times',
    params: [
      { name: 'count', type: 'number', required: true, description: 'Number of times to loop' },
    ],
    async execute(params, ctx) {
      try {
        const count = clampNumber(params.count, 1, 100, 2);
        const loops = Math.max(0, count - 1);
        const out = ctx.outputPath('looped.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-stream_loop', String(loops), '-i', input(ctx), '-c', 'copy', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.mix',
    category: 'audio',
    name: 'Mix Two Audio Tracks',
    description: 'Mix two audio tracks together using amix filter (requires 2 input files)',
    params: [],
    async execute(_p, ctx) {
      try {
        if (ctx.inputFiles.length < 2) return { error: 'Two input files are required for mixing' };
        const out = ctx.outputPath('mixed.mp3');
        await ctx.runArgs('ffmpeg', [
          '-y', '-i', ctx.inputFiles[0], '-i', ctx.inputFiles[1],
          '-filter_complex', 'amix=inputs=2:duration=longest', out,
        ]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.volume',
    category: 'audio',
    name: 'Adjust Volume',
    description: 'Adjust audio volume by a multiplier',
    params: [
      { name: 'volume', type: 'string', required: true, description: 'Volume multiplier, e.g. "1.5" or "0.5"' },
    ],
    async execute(params, ctx) {
      try {
        const v = clampNumber(params.volume, 0, 32, 1);
        const out = ctx.outputPath('volume.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af', `volume=${v}`, out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.channels_mono',
    category: 'audio',
    name: 'Convert to Mono',
    description: 'Convert audio to mono channel',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('mono.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-ac', '1', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.channels_stereo',
    category: 'audio',
    name: 'Convert to Stereo',
    description: 'Convert audio to stereo (2 channels)',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('stereo.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-ac', '2', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.metadata',
    category: 'audio',
    name: 'Show Audio Metadata',
    description: 'Display audio file metadata using ffprobe',
    params: [],
    async execute(_p, ctx) {
      try {
        const text = await ctx.runArgs('ffprobe', [
          '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input(ctx),
        ]);
        return { text };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.waveform',
    category: 'audio',
    name: 'Generate Waveform Image',
    description: 'Generate a waveform PNG visualization using showwavespic filter',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('waveform.png');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-filter_complex',
          'showwavespic=s=1280x240:colors=0x00aaff', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.spectrum',
    category: 'audio',
    name: 'Generate Spectrogram Image',
    description: 'Generate a spectrogram PNG using showspectrumpic filter',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('spectrum.png');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-lavfi',
          'showspectrumpic=s=1280x512:mode=combined', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.noise_reduce',
    category: 'audio',
    name: 'Reduce Noise',
    description: 'Reduce noise using highpass and lowpass filters',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('denoised.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af',
          'highpass=f=200,lowpass=f=3000', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.equalizer',
    category: 'audio',
    name: 'Apply Equalizer Preset',
    description: 'Apply a named equalizer preset to audio',
    params: [
      { name: 'preset', type: 'string', required: true, description: 'Equalizer preset name', enum: ['bass_boost', 'treble_boost', 'vocal', 'flat'] },
    ],
    async execute(params, ctx) {
      try {
        const presets: Record<string, string> = {
          bass_boost: 'equalizer=f=100:width_type=o:width=2:g=6',
          treble_boost: 'equalizer=f=8000:width_type=o:width=2:g=6',
          vocal: 'equalizer=f=1000:width_type=o:width=2:g=4,equalizer=f=3000:width_type=o:width=2:g=3',
          flat: 'equalizer=f=1000:width_type=o:width=2:g=0',
        };
        const filter = presets[String(params.preset ?? 'flat')] ?? presets.flat;
        const out = ctx.outputPath('eq.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-af', filter, out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.sample_rate',
    category: 'audio',
    name: 'Change Sample Rate',
    description: 'Re-sample audio to a different sample rate',
    params: [
      { name: 'rate', type: 'string', required: true, description: 'Target sample rate in Hz', enum: ['8000', '16000', '22050', '44100', '48000', '96000'] },
    ],
    async execute(params, ctx) {
      try {
        const rate = String(params.rate ?? '');
        if (!['8000', '16000', '22050', '44100', '48000', '96000'].includes(rate)) {
          return { error: `Unsupported sample rate: ${rate}` };
        }
        const out = ctx.outputPath('resampled.mp3');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-ar', rate, out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.to_ringtone',
    category: 'audio',
    name: 'Create Ringtone',
    description: 'Create a 30-second m4r ringtone from audio',
    params: [],
    async execute(_p, ctx) {
      try {
        const out = ctx.outputPath('ringtone.m4r');
        await ctx.runArgs('ffmpeg', ['-y', '-i', input(ctx), '-t', '30', '-c:a', 'aac', out]);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.detect_bpm',
    category: 'audio',
    name: 'Detect BPM',
    description: 'Analyze audio properties via ffprobe (precise BPM requires a dedicated tool)',
    params: [],
    async execute(_p, ctx) {
      try {
        const text = await ctx.runArgs('ffprobe', [
          '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input(ctx),
        ]);
        return { text: `Audio analysis (BPM requires a dedicated tool):\n${text}` };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
  {
    id: 'audio.silence_insert',
    category: 'audio',
    name: 'Insert Silence',
    description: 'Insert a period of silence at the start or end of audio',
    params: [
      { name: 'duration', type: 'number', required: true, description: 'Duration of silence in seconds' },
      { name: 'position', type: 'string', required: true, description: 'Where to insert silence', enum: ['start', 'end'] },
    ],
    async execute(params, ctx) {
      try {
        const duration = clampNumber(params.duration, 0.1, 600, 1);
        const pos = String(params.position ?? 'end');
        if (!['start', 'end'].includes(pos)) return { error: `Invalid position: ${pos}` };

        const inp = input(ctx);
        const silencePath = join(ctx.workDir, 'silence.mp3');
        const out = ctx.outputPath('with_silence.mp3');

        await ctx.runArgs('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', String(duration), silencePath,
        ]);
        const args = pos === 'start'
          ? ['-y', '-i', silencePath, '-i', inp]
          : ['-y', '-i', inp, '-i', silencePath];
        args.push('-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[out]', '-map', '[out]', out);
        await ctx.runArgs('ffmpeg', args);
        return { files: [out] };
      } catch (e) { return { error: (e as Error).message }; }
    },
  },
];
