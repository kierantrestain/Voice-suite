import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RecordingInput } from './recording-input';

export function BrowserWorkspace() {
  const { t } = useTranslation();
  const [script, setScript] = useState('');
  const [voice, setVoice] = useState<'af_heart' | 'bm_george'>('af_heart');
  const [recording, setRecording] = useState<File | null>(null);
  const [audio, setAudio] = useState('');
  const [transcript, setTranscript] = useState('');
  const [working, setWorking] = useState<'speech' | 'asr' | null>(null);
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio);
    },
    [audio],
  );

  const run = async (kind: 'speech' | 'asr') => {
    if (working) return;
    setWorking(kind);
    setError('');
    try {
      const inference = await import('./browser-inference');
      if (kind === 'speech') {
        setAudio(URL.createObjectURL(await inference.generateInBrowser(script.trim(), voice)));
      } else if (recording) {
        setTranscript(await inference.transcribeInBrowser(recording));
      }
    } catch (error) {
      setError(
        error instanceof Error && error.message === 'studioCloud.invalidRecording'
          ? error.message
          : 'studioCloud.browserFailed',
      );
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{t('studioCloud.browser')}</h1>
        <p className="text-sm text-muted-foreground">{t('studioCloud.browserScope')}</p>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">{t('sidebarTools.tts')}</h2>
        <a
          className="text-xs text-muted-foreground underline"
          href="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX"
        >
          Kokoro 82M · Apache 2.0 · 92.4 MB
        </a>
        <Textarea
          rows={4}
          aria-label={t('sidebarTools.tts')}
          maxLength={450}
          value={script}
          onChange={(event) => setScript(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {(['af_heart', 'bm_george'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={voice === option ? 'secondary' : 'outline'}
              aria-pressed={voice === option}
              onClick={() => setVoice(option)}
            >
              {option === 'af_heart' ? 'Heart' : 'George'}
            </Button>
          ))}
        </div>
        <Button disabled={Boolean(working) || !script.trim()} onClick={() => void run('speech')}>
          {t(working === 'speech' ? 'preferences.loading' : 'studioCloud.generate')}
        </Button>
        {audio && (
          <>
            <p className="text-xs text-muted-foreground">{t('studioCloud.synthetic')}</p>
            <audio controls className="w-full" src={audio} aria-label={t('common.play')} />
            <a
              href={audio}
              download="Voice Suite.wav"
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('projects.export')} WAV
            </a>
          </>
        )}
      </section>
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">{t('nav.transcribe')}</h2>
        <a
          className="text-xs text-muted-foreground underline"
          href="https://huggingface.co/Xenova/whisper-tiny.en"
        >
          Whisper Tiny EN · MIT · 40.9 MB
        </a>
        <RecordingInput file={recording} disabled={Boolean(working)} onFile={setRecording} />
        <Button disabled={Boolean(working) || !recording} onClick={() => void run('asr')}>
          {t(working === 'asr' ? 'preferences.loading' : 'nav.transcribe')}
        </Button>
        {transcript && <Textarea aria-label={t('nav.transcribe')} readOnly value={transcript} />}
      </section>
    </div>
  );
}
