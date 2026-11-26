import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch, apiJson, describeError } from '@/lib/api/client';
import { brandIcon } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { InstallProgress } from '@/components/model-install-progress';
import { useModelInstall } from '@/hooks/use-model-install';
import { useModelCatalogue } from '@/features/settings/model-catalogue-query';
import { ModelLicense } from '@/features/settings/model-license';
import { modelDiskShortfall } from '@/features/settings/model-disk-space';
import { fmtBytes } from '@shared/components/settings/models/format';
import { rememberSetupCompleted } from '@/lib/setup-progress';

type Preset = 'light' | 'balanced' | 'studio';
type ModelChoice = { role: 'speech' | 'clone' | 'asr'; repo: string; engine: string };
const speech: ModelChoice = {
  role: 'speech',
  repo: 'KittenML/kitten-tts-mini-0.8',
  engine: 'kittentts',
};

const presetKeys = {
  light: 'studioSetup.light',
  balanced: 'performanceProfile.balanced',
  studio: 'studioSetup.quality',
} as const;

function modelChoices(preset: Preset, appleSilicon: boolean): ModelChoice[] {
  const whisper = { light: 'base', balanced: 'small', studio: 'large-v3' }[preset];
  const transcription: ModelChoice = {
    role: 'asr',
    repo: `Systran/faster-whisper-${whisper}`,
    engine: 'faster-whisper',
  };
  if (!appleSilicon) return [speech, transcription];
  const clone: ModelChoice = {
    role: 'clone',
    repo:
      preset === 'studio'
        ? 'mlx-community/VoxCPM2-8bit'
        : 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit',
    engine: 'mlx-audio',
  };
  return [speech, clone, transcription];
}

const roleKeys = { speech: 'sidebarTools.tts', clone: 'nav.clone', asr: 'nav.transcribe' } as const;

export function StudioFirstRun({
  onComplete,
  onAdvanced,
}: {
  onComplete: () => void;
  onAdvanced: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const catalogue = useModelCatalogue();
  const hardware = useQuery({
    queryKey: ['studio-setup-hardware'],
    queryFn: ({ signal }) => apiJson<{ ram_total_gb: number }>('/system/info', { signal }),
    retry: false,
  });
  const footprint = useQuery({
    queryKey: ['storage-report'],
    queryFn: ({ signal }) =>
      apiJson<{ categories: { id: string; bytes: number }[] }>('/api/settings/storage', { signal }),
    staleTime: 300_000,
  });
  const ram = hardware.data?.ram_total_gb ?? 0;
  const appleSilicon = catalogue.data?.platform_tags?.includes('darwin-arm64') ?? false;
  const recommended: Preset = ram >= 12 ? 'balanced' : 'light';
  const [choice, setChoice] = useState<Preset | null>(null);
  const preset = choice ?? recommended;
  const models = modelChoices(preset, appleSilicon);
  const [activating, setActivating] = useState(false);
  const [speechReady, setSpeechReady] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [audio, setAudio] = useState('');
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio);
    },
    [audio],
  );

  const activate = async (model: ModelChoice) => {
    setActivating(true);
    setError('');
    try {
      await apiJson('/api/settings/commercial-mode', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true }),
      });
      await apiJson('/engines/select', {
        method: 'POST',
        body: JSON.stringify({
          family: model.role === 'asr' ? 'asr' : 'tts',
          backend_id: model.engine,
          model_id: model.role === 'speech' ? undefined : model.repo,
        }),
      });
      if (model.role === 'speech') setSpeechReady(true);
      await client.invalidateQueries({ queryKey: ['engines'] });
    } catch (error) {
      setError(describeError(error));
    } finally {
      setActivating(false);
    }
  };

  const install = useModelInstall(undefined, {
    onReady: (repo) => {
      const model = models.find((item) => item.repo === repo);
      if (model) void activate(model);
      void catalogue.refetch();
    },
  });
  const busy = install.active || install.busy || activating || generating;
  const totalBytes = models.reduce((sum, model) => {
    const record = catalogue.data?.models.find((row) => row.repo_id === model.repo);
    if (!record?.supported || record.license_info?.license_category !== 'commercial') return sum;
    return sum + Math.round(record.size_gb * 1e9);
  }, 0);
  const runtimeBytes = footprint.data?.categories
    .filter(({ id }) => ['runtime', 'desktop_app'].includes(id))
    .reduce((sum, category) => sum + category.bytes, 0);

  const trySpeech = async () => {
    setGenerating(true);
    setError('');
    try {
      const body = new FormData();
      body.set('text', t('demo.clone_prompt', { lng: 'en' }));
      body.set('engine', 'kittentts');
      body.set('language', 'English');
      body.set('wav_bits', '24');
      const response = await apiFetch('/generate', { method: 'POST', body });
      setAudio(URL.createObjectURL(await response.blob()));
    } catch (error) {
      setError(describeError(error));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-5 py-9">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <header className="space-y-2">
          <img src={brandIcon} alt="" className="size-10" />
          <h1 className="text-xl font-semibold">{t('setup.install_models')}</h1>
          <p className="text-sm text-muted-foreground">{t('studioSetup.pick')}</p>
        </header>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={t('models.pack_title')}>
          {(Object.keys(presetKeys) as Preset[]).map((value) => (
            <Button
              key={value}
              className="h-auto justify-start whitespace-normal px-3 py-3 text-start"
              variant={preset === value ? 'secondary' : 'outline'}
              aria-pressed={preset === value}
              disabled={busy || (value === 'studio' && ram < 16)}
              aria-describedby={
                value === 'studio' && ram < 16 ? 'studio-profile-memory' : undefined
              }
              onClick={() => setChoice(value)}
            >
              <span>
                {t(presetKeys[value])}
                {value === recommended && (
                  <span className="block text-xs text-muted-foreground">
                    {t('firstrun.chip_recommended')}
                  </span>
                )}
              </span>
            </Button>
          ))}
        </div>
        {ram < 16 && (
          <p id="studio-profile-memory" className="text-xs text-muted-foreground">
            {t('studioSetup.memory', { size: 16 })}
          </p>
        )}
        {catalogue.isError && (
          <Button variant="outline" onClick={() => void catalogue.refetch()}>
            {t('backend.retry')}
          </Button>
        )}
        {catalogue.isPending && <p role="status">{t('preferences.loading')}</p>}
        <div className="divide-y rounded-lg border">
          {models.map((model) => {
            const record = catalogue.data?.models.find((row) => row.repo_id === model.repo);
            if (!record?.supported || record.license_info?.license_category !== 'commercial')
              return null;
            const shortfall =
              !record.installed &&
              modelDiskShortfall(
                record.size_gb,
                catalogue.data?.disk_free_gb,
                catalogue.data?.disk_headroom_gb,
              );
            return (
              <div
                key={model.repo}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium">{t(roleKeys[model.role])}</h2>
                  <p className="break-words text-xs text-muted-foreground">{record.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBytes(Math.round(record.size_gb * 1e9))}
                    {' · '}
                    <ModelLicense
                      repoId={record.repo_id}
                      label={record.label}
                      info={record.license_info}
                      acceptance={record.license_acceptance}
                      dependencies={record.license_dependencies}
                      triggerLabel={record.license_info.license ?? undefined}
                    />
                  </p>
                  {shortfall && (
                    <p className="text-sm text-destructive">
                      {t('models.pack_low_disk', { ...shortfall })}
                    </p>
                  )}
                </div>
                <Button
                  variant={model.role === 'speech' ? 'default' : 'outline'}
                  size="sm"
                  disabled={busy || Boolean(shortfall)}
                  onClick={() =>
                    void (record.installed ? activate(model) : install.start(model.repo))
                  }
                >
                  {record.installed
                    ? t('studioSetup.useModel')
                    : t('models.reco_install_one', { label: t(roleKeys[model.role]) })}
                </Button>
              </div>
            );
          })}
        </div>
        {!!runtimeBytes && (
          <p className="text-xs text-muted-foreground">
            {t('studioSetup.estimated', { size: fmtBytes(runtimeBytes + totalBytes) })}
          </p>
        )}
        {install.view && install.view.stage !== 'ready' && (
          <InstallProgress
            view={install.view}
            busy={install.busy}
            onCancel={() => void install.cancel()}
            onRetry={() => void install.retry()}
            onDismiss={install.dismiss}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {audio && (
          <audio className="w-full" controls src={audio} aria-label={t('studioSetup.sample')} />
        )}
        <footer className="flex flex-wrap items-center gap-2">
          {speechReady && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void trySpeech()}>
                {t(generating ? 'preferences.loading' : 'studioSetup.sample')}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  rememberSetupCompleted();
                  onComplete();
                }}
              >
                {t('setup.enter_studio')}
              </Button>
            </>
          )}
          <Button variant="ghost" disabled={busy} onClick={onAdvanced}>
            {t('dub.advanced')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
