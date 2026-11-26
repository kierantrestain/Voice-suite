import { cloudDatabaseUrl, StudioError } from './store.mjs';

const API = {
  elevenlabs: 'https://api.elevenlabs.io/v1',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};
const MAX_AUDIO_BYTES = 4_000_000;

export function cloudConfig(env) {
  let budget;
  try {
    budget = JSON.parse(env.VOICE_SUITE_CLOUD_BUDGET ?? '{}');
  } catch {
    budget = {};
  }
  const cents = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000
      ? Math.ceil(value * 1_000_000)
      : null;
  const rates = {
    clone: cents(budget?.clone),
    elevenlabsSpeech: cents(budget?.elevenlabsSpeechPer1000),
    openaiSpeech: cents(budget?.openaiSpeechPer1000),
    openaiTranscribe: cents(budget?.openaiTranscribePerMinute),
    groqTranscribe: cents(budget?.groqTranscribePerMinute),
  };
  const keys = {
    elevenlabs: env.ELEVENLABS_API_KEY?.trim(),
    openai: env.OPENAI_API_KEY?.trim(),
    groq: env.GROQ_API_KEY?.trim(),
  };
  return {
    ready:
      env.VOICE_SUITE_CLOUD_ENABLED === '1' &&
      Boolean(env.VOICE_SUITE_CLOUD_SECRET?.length >= 32) &&
      Boolean(cloudDatabaseUrl(env)) &&
      Boolean(cents(budget?.monthly)),
    secret: env.VOICE_SUITE_CLOUD_SECRET,
    monthly: cents(budget?.monthly),
    rates,
    keys,
    capabilities: {
      clone: Boolean(keys.elevenlabs && rates.clone),
      speech: ['elevenlabs', 'openai'].filter(
        (provider) => keys[provider] && rates[provider + 'Speech'],
      ),
      transcription: ['openai', 'groq'].filter(
        (provider) => keys[provider] && rates[provider + 'Transcribe'],
      ),
    },
  };
}

export function pcmRecording(bytes) {
  const b = Buffer.from(bytes);
  const bad = () => {
    throw new StudioError(400, 'cloud.invalidRecording');
  };
  if (
    b.length < 46 ||
    b.length > MAX_AUDIO_BYTES ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    b.readUInt32LE(4) !== b.length - 8 ||
    b.readUInt32LE(16) !== 16 ||
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt16LE(32) !== 2 ||
    b.readUInt16LE(34) !== 16 ||
    b.toString('ascii', 36, 40) !== 'data' ||
    b.readUInt32LE(40) !== b.length - 44
  )
    bad();
  const rate = b.readUInt32LE(24);
  if (rate !== 24000 || b.readUInt32LE(28) !== rate * 2 || b.length % 2 !== 0) bad();
  const seconds = (b.length - 44) / (rate * 2);
  if (seconds < 1 || seconds > 75) bad();
  return { bytes: b, seconds };
}

function tokenHeader(config, provider) {
  const key = config.keys[provider];
  if (!key) throw new StudioError(503, 'cloud.providerUnavailable');
  return provider === 'elevenlabs' ? { 'xi-api-key': key } : { Authorization: `Bearer ${key}` };
}

export function providers(config, fetchImpl = fetch) {
  async function call(provider, path, init = {}, allowMissing = false) {
    try {
      const response = await fetchImpl(API[provider] + path, {
        ...init,
        headers: { ...tokenHeader(config, provider), ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(45_000),
      });
      if (allowMissing && response.status === 404) return response;
      if (!response.ok) {
        throw new StudioError(
          502,
          response.status === 429 ? 'cloud.providerBusy' : 'cloud.providerFailed',
        );
      }
      return response;
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError(502, 'cloud.providerFailed');
    }
  }
  return {
    async clone(name, recording) {
      const body = new FormData();
      body.set('name', name);
      body.append('files', new Blob([recording], { type: 'audio/wav' }), 'reference.wav');
      const result = await (
        await call('elevenlabs', '/voices/add', { method: 'POST', body })
      ).json();
      if (!/^[a-zA-Z0-9_-]{5,100}$/.test(result.voice_id ?? ''))
        throw new StudioError(502, 'cloud.providerFailed');
      return { id: result.voice_id, verificationRequired: result.requires_verification === true };
    },
    async revoke(voiceId) {
      await call(
        'elevenlabs',
        '/voices/' + encodeURIComponent(voiceId),
        { method: 'DELETE' },
        true,
      );
    },
    async speech(provider, text, voiceId) {
      const eleven = provider === 'elevenlabs';
      const path = eleven
        ? `/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`
        : '/audio/speech';
      const body = eleven
        ? { text, model_id: 'eleven_multilingual_v2' }
        : {
            input: text,
            model: 'gpt-4o-mini-tts',
            voice: voiceId || 'alloy',
            response_format: 'mp3',
          };
      const response = await call(provider, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length < 16 ||
        bytes.length > MAX_AUDIO_BYTES ||
        (bytes.toString('ascii', 0, 3) !== 'ID3' &&
          (bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0))
      )
        throw new StudioError(502, 'cloud.providerFailed');
      return markSpeech(bytes);
    },
    async transcribe(provider, recording) {
      const form = new FormData();
      form.set('model', provider === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-4o-mini-transcribe');
      form.set('response_format', 'json');
      form.set('file', new Blob([recording], { type: 'audio/wav' }), 'recording.wav');
      const result = await (
        await call(provider, '/audio/transcriptions', { method: 'POST', body: form })
      ).json();
      if (typeof result.text !== 'string') throw new StudioError(502, 'cloud.providerFailed');
      return result.text.trim();
    },
  };
}

/** Add an ID3v2.3 title/comment on Cloud exports, preserving MPEG frames. */
function markSpeech(audio) {
  const title = Buffer.from('\x00Voice Suite (AI-generated)', 'latin1');
  const comment = Buffer.from('\x00eng\x00Synthetic speech generated by Voice Suite.', 'latin1');
  const frames = [
    ['TIT2', title],
    ['COMM', comment],
  ].map(([id, payload]) => {
    const head = Buffer.alloc(10);
    head.write(id, 'ascii');
    head.writeUInt32BE(payload.length, 4);
    return Buffer.concat([head, payload]);
  });
  const payload = Buffer.concat(frames);
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    0,
    0,
    payload.length >> 7,
    payload.length & 0x7f,
  ]);
  let offset = 0;
  if (audio.toString('ascii', 0, 3) === 'ID3' && audio.length >= 10) {
    offset = 10 + (audio[6] << 21) + (audio[7] << 14) + (audio[8] << 7) + audio[9];
    if ((audio[5] & 0x10) !== 0) offset += 10;
  }
  if (offset >= audio.length) throw new StudioError(502, 'cloud.providerFailed');
  return Buffer.concat([header, payload, audio.subarray(offset)]);
}
