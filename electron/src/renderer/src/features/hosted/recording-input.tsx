import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRecording } from '@/hooks/use-recording';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { prepareCloudRecording } from './audio';

export function RecordingInput({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (file: File) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const recorder = useRecording(onFile, false, { clean: false, maxSeconds: 65 });
  const [url, setUrl] = useState<string>();
  const [invalidAudio, setInvalidAudio] = useState(false);
  useEffect(() => {
    setUrl(undefined);
    setInvalidAudio(false);
    if (!file) return;
    let active = true;
    let preview: string | undefined;
    // Only decoded PCM audio is published to the page as a blob URL.
    void prepareCloudRecording(file)
      .then((wave) => {
        if (!active) return;
        preview = URL.createObjectURL(wave);
        setUrl(preview);
      })
      .catch(() => {
        if (active) setInvalidAudio(true);
      });
    return () => {
      active = false;
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [file]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={recorder.isRecording ? 'secondary' : 'outline'}
          disabled={disabled || recorder.isStarting}
          onClick={() => (recorder.isRecording ? recorder.stop() : void recorder.start())}
        >
          {t(recorder.isRecording ? 'common.stop' : 'clone.record')}
          {recorder.isRecording ? ` (${Math.floor(recorder.seconds)}s)` : ''}
        </Button>
        <Input
          type="file"
          accept="audio/*,.webm,.mp4"
          aria-label={t('clone.reference_audio')}
          disabled={disabled || recorder.isRecording}
          className="max-w-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
      </div>
      {invalidAudio && (
        <p role="alert" className="text-sm text-destructive">
          {t('studioCloud.invalidRecording')}
        </p>
      )}
      {url && (
        <audio className="w-full" controls src={url} aria-label={t('clone.reference_audio')} />
      )}
    </div>
  );
}
