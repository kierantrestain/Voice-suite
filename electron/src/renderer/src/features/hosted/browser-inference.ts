import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { KokoroTTS } from 'kokoro-js';
import { encodeWav } from '@shared/utils/audioTrim';
import { readMono } from './audio';

const KOKORO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const WHISPER = 'Xenova/whisper-tiny.en';
const WHISPER_REVISION = '79fb389fc764e7c395bd330e9531d9d32ada7049';

function browserDevice(): 'webgpu' | 'wasm' {
  return 'gpu' in navigator ? 'webgpu' : 'wasm';
}

let speech: { model: KokoroTTS; device: 'webgpu' | 'wasm' } | undefined;
let transcription: AutomaticSpeechRecognitionPipeline | undefined;

async function loadSpeech(device: 'webgpu' | 'wasm') {
  if (speech?.device === device) return speech.model;
  await speech?.model.model.dispose();
  speech = undefined;
  const { KokoroTTS } = await import('kokoro-js');
  const model = await KokoroTTS.from_pretrained(KOKORO, { dtype: 'q8', device });
  speech = { model, device };
  return model;
}

async function loadTranscription() {
  if (transcription) return transcription;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  // The quantized Whisper decoder can emit corrupt tokens on WebGPU.
  const model = await pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', WHISPER, {
    dtype: 'q8',
    device: 'wasm',
    revision: WHISPER_REVISION,
  });
  transcription = model;
  return model;
}

async function runLocal<T>(work: (device: 'webgpu' | 'wasm') => Promise<T>): Promise<T> {
  const device = browserDevice();
  if (device === 'wasm') return work(device);
  try {
    return await work(device);
  } catch {
    return work('wasm');
  }
}

function syntheticWav(samples: Float32Array, sampleRate: number) {
  const audio = encodeWav(samples, sampleRate);
  const label = new TextEncoder().encode('AI-generated speech by Voice Suite\0');
  const length = 20 + label.length + (label.length % 2);
  const chunk = new ArrayBuffer(length);
  const bytes = new Uint8Array(chunk);
  const view = new DataView(chunk);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('LIST'), 0);
  view.setUint32(4, length - 8, true);
  bytes.set(encoder.encode('INFOICMT'), 8);
  view.setUint32(16, label.length, true);
  bytes.set(label, 20);
  new DataView(audio).setUint32(4, audio.byteLength + length - 8, true);
  return new Blob([audio, chunk], { type: 'audio/wav' });
}

export async function generateInBrowser(text: string, voice: 'af_heart' | 'bm_george') {
  if (transcription) {
    await transcription.dispose();
    transcription = undefined;
  }
  return runLocal(async (device) => {
    const model = await loadSpeech(device);
    // Sentence streaming avoids silently truncating Kokoro's tokenizer at its context limit.
    const { TextSplitterStream } = await import('kokoro-js');
    const sentences = new TextSplitterStream();
    sentences.push(text);
    sentences.close();
    const chunks: Float32Array<ArrayBufferLike>[] = [];
    for await (const result of model.stream(sentences, { voice })) {
      chunks.push(result.audio.audio);
    }
    const samples = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    if (samples.length === 0) throw new Error('No audio produced');
    return syntheticWav(samples, 24_000);
  });
}

export async function transcribeInBrowser(recording: Blob) {
  if (speech) {
    await speech.model.model.dispose();
    speech = undefined;
  }
  const samples = await readMono(recording, 16_000);
  const model = await loadTranscription();
  const result = await model(samples, { chunk_length_s: 25, stride_length_s: 4 });
  return Array.isArray(result)
    ? result
        .map(({ text }) => text)
        .join(' ')
        .trim()
    : result.text.trim();
}
