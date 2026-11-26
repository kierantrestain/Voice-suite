import { encodeWav } from '@shared/utils/audioTrim';

export async function readMono(file: Blob, sampleRate: number) {
  if (file.size > 15_000_000) throw new Error('studioCloud.invalidRecording');
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    if (audio.duration < 1 || audio.duration > 74) throw new Error('studioCloud.invalidRecording');
    const output = new OfflineAudioContext(1, Math.ceil(audio.duration * sampleRate), sampleRate);
    const source = output.createBufferSource();
    source.buffer = audio;
    source.connect(output.destination);
    source.start();
    return (await output.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}

export async function prepareCloudRecording(file: Blob) {
  const samples = await readMono(file, 24_000);
  return new File([encodeWav(samples, 24_000)], 'recording.wav', { type: 'audio/wav' });
}
