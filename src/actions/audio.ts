import type { Action } from './types.js';
import { escPath } from '../utils.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath(`output.${params.format as string}`));
      const bitrateFlag = params.bitrate ? `-b:a ${params.bitrate as string}` : '';
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" ${bitrateFlag} "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
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
      const fmt = (params.format as string) ?? 'mp3';
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath(`audio.${fmt}`));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -vn "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.merge',
    category: 'audio',
    name: 'Merge Audio Files',
    description: 'Merge multiple audio files into one using concat filter',
    params: [],
    async execute(params, ctx) {
      const inputs = ctx.inputFiles.map(f => escPath(f));
      const filterInputs = inputs.map((_, i) => `[${i}:a]`).join('');
      const filterChain = `${filterInputs}concat=n=${inputs.length}:v=0:a=1[out]`;
      const inputFlags = inputs.map(f => `-i "${f}"`).join(' ');
      const output = escPath(ctx.outputPath('merged.mp3'));
      try {
        await ctx.exec(`ffmpeg -y ${inputFlags} -filter_complex "${filterChain}" -map "[out]" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const part1 = escPath(ctx.outputPath('part1.mp3'));
      const part2 = escPath(ctx.outputPath('part2.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -t "${params.time as string}" "${part1}"`);
        await ctx.exec(`ffmpeg -y -i "${input}" -ss "${params.time as string}" "${part2}"`);
        return { files: [part1, part2] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('trimmed.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -ss "${params.start as string}" -to "${params.end as string}" -c copy "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('output.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -b:a ${params.bitrate as string} "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.normalize',
    category: 'audio',
    name: 'Normalize Volume',
    description: 'Normalize audio loudness using the loudnorm filter',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('normalized.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af loudnorm "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('faded.mp3'));
      const fadeIn = (params.fade_in as number) ?? 0;
      const fadeOut = (params.fade_out as number) ?? 0;
      const filters: string[] = [];
      if (fadeIn > 0) filters.push(`afade=t=in:d=${fadeIn}`);
      if (fadeOut > 0) filters.push(`afade=t=out:st=0:d=${fadeOut}`);
      const af = filters.length > 0 ? `-af "${filters.join(',')}"` : '';
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" ${af} "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('speed.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af "atempo=${params.speed as number}" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.reverse',
    category: 'audio',
    name: 'Reverse Audio',
    description: 'Reverse the audio playback',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('reversed.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af areverse "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.remove_silence',
    category: 'audio',
    name: 'Remove Silence',
    description: 'Remove silent parts from audio using silenceremove filter',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('no_silence.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-50dB" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('looped.mp3'));
      const loops = (params.count as number) - 1;
      try {
        await ctx.exec(`ffmpeg -y -stream_loop ${loops} -i "${input}" -c copy "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.mix',
    category: 'audio',
    name: 'Mix Two Audio Tracks',
    description: 'Mix two audio tracks together using amix filter (requires 2 input files)',
    params: [],
    async execute(params, ctx) {
      if (ctx.inputFiles.length < 2) {
        return { error: 'Two input files are required for mixing' };
      }
      const input1 = escPath(ctx.inputFiles[0]);
      const input2 = escPath(ctx.inputFiles[1]);
      const output = escPath(ctx.outputPath('mixed.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input1}" -i "${input2}" -filter_complex "amix=inputs=2:duration=longest" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('volume.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af "volume=${params.volume as string}" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.channels_mono',
    category: 'audio',
    name: 'Convert to Mono',
    description: 'Convert audio to mono channel',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('mono.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -ac 1 "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.channels_stereo',
    category: 'audio',
    name: 'Convert to Stereo',
    description: 'Convert audio to stereo (2 channels)',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('stereo.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -ac 2 "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.metadata',
    category: 'audio',
    name: 'Show Audio Metadata',
    description: 'Display audio file metadata using ffprobe',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      try {
        const result = await ctx.exec(`ffprobe -v quiet -print_format json -show_format -show_streams "${input}"`);
        return { text: result };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.waveform',
    category: 'audio',
    name: 'Generate Waveform Image',
    description: 'Generate a waveform PNG visualization using showwavespic filter',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('waveform.png'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -filter_complex "showwavespic=s=1280x240:colors=0x00aaff" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.spectrum',
    category: 'audio',
    name: 'Generate Spectrogram Image',
    description: 'Generate a spectrogram PNG using showspectrumpic filter',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('spectrum.png'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -lavfi "showspectrumpic=s=1280x512:mode=combined" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.noise_reduce',
    category: 'audio',
    name: 'Reduce Noise',
    description: 'Reduce noise using highpass and lowpass filters',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('denoised.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af "highpass=f=200,lowpass=f=3000" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('eq.mp3'));
      const presets: Record<string, string> = {
        bass_boost: 'equalizer=f=100:width_type=o:width=2:g=6',
        treble_boost: 'equalizer=f=8000:width_type=o:width=2:g=6',
        vocal: 'equalizer=f=1000:width_type=o:width=2:g=4,equalizer=f=3000:width_type=o:width=2:g=3',
        flat: 'equalizer=f=1000:width_type=o:width=2:g=0',
      };
      const filter = presets[params.preset as string] ?? presets['flat'];
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -af "${filter}" "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('resampled.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -ar ${params.rate as string} "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.to_ringtone',
    category: 'audio',
    name: 'Create Ringtone',
    description: 'Create a 30-second m4r ringtone from audio',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('ringtone.m4r'));
      try {
        await ctx.exec(`ffmpeg -y -i "${input}" -t 30 -c:a aac "${output}"`);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  {
    id: 'audio.detect_bpm',
    category: 'audio',
    name: 'Detect BPM',
    description: 'Analyze audio properties via ffprobe (precise BPM requires a dedicated tool)',
    params: [],
    async execute(params, ctx) {
      const input = escPath(ctx.inputFiles[0]);
      try {
        const result = await ctx.exec(`ffprobe -v quiet -print_format json -show_format -show_streams "${input}"`);
        return { text: `Audio analysis (BPM requires a dedicated tool):\n${result}` };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
      const input = escPath(ctx.inputFiles[0]);
      const output = escPath(ctx.outputPath('with_silence.mp3'));
      const silencePath = escPath(join(ctx.workDir, 'silence.mp3'));
      try {
        await ctx.exec(`ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -t ${params.duration as number} "${silencePath}"`);
        const cmd = params.position === 'start'
          ? `ffmpeg -y -i "${silencePath}" -i "${input}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" -map "[out]" "${output}"`
          : `ffmpeg -y -i "${input}" -i "${silencePath}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" -map "[out]" "${output}"`;
        await ctx.exec(cmd);
        return { files: [output] };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
];
