import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRecording } from '@/hooks/use-recording';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
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
      {url && (
        <audio className="w-full" controls src={url} aria-label={t('clone.reference_audio')} />
      )}
    </div>
  );
}
