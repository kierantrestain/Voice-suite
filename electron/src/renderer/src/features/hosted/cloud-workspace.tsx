import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/features/clone/confirm-dialog';
import { prepareCloudRecording } from './audio';
import { RecordingInput } from './recording-input';

type Provider = 'elevenlabs' | 'openai' | 'groq';
const providerName: Record<Provider, string> = {
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  groq: 'Groq',
};

type Profile = { id: string; name: string; clone: 'ready' | 'none' | 'pending' | 'verification' };
type Project = { id: string; name: string };
type Take = { id: string; provider: Provider; createdAt: string; projectId: string | null };
type Workspace = {
  profiles: Profile[];
  projects: Project[];
  takes: Take[];
  providers: { clone: boolean; speech: Provider[]; transcription: Provider[] };
  budget: {
    month: string;
    limit: number;
    reserved: number;
    usage: Record<string, { calls: number }>;
  };
};

const apiUrl = (action: string, params: Record<string, string> = {}) =>
  `/api/cloud?${new URLSearchParams({ action, ...params })}`;

class CloudFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function cloud<T>(
  action: string,
  init?: RequestInit,
  params?: Record<string, string>,
): Promise<T> {
  const response = await fetch(apiUrl(action, params), {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok || result === null)
    throw new CloudFailure(result?.error ?? 'cloud.unavailable', response.status);
  return result as T;
}

const post = (body: object): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

const actionErrors: Record<string, string> = {
  'cloud.invite': 'studioSetup.codeExpired',
  'cloud.session': 'studioSetup.reconnect',
  'cloud.budget': 'studioCloud.budgetReached',
  'cloud.voiceRequired': 'studioCloud.cloneNeeded',
  'cloud.invalidRecording': 'studioCloud.invalidRecording',
  'cloud.consent': 'studioCloud.ownVoice',
  'cloud.providerUnavailable': 'studioCloud.unconfigured',
  'cloud.providerFailed': 'studioCloud.providerFailed',
  'cloud.providerBusy': 'studioCloud.providerFailed',
  'cloud.storageLimit': 'studioCloud.storageLimit',
  'cloud.busy': 'preferences.loading',
  'cloud.invalidInput': 'studioCloud.invalidInput',
  'cloud.missing': 'studioCloud.missing',
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function CloudWorkspace() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'signin' | 'ready'>('loading');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');
  const [recording, setRecording] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [ownVoice, setOwnVoice] = useState(false);
  const [shareWithProviders, setShareWithProviders] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [deleteProfile, setDeleteProfile] = useState<Profile | null>(null);
  const [deleteTake, setDeleteTake] = useState<Take | null>(null);
  const [script, setScript] = useState('');
  const [speechProvider, setSpeechProvider] = useState<Provider>('elevenlabs');
  const [transcriptionProvider, setTranscriptionProvider] = useState<Provider>('groq');
  const [selectedTakeId, setSelectedTakeId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [transcript, setTranscript] = useState('');
  const profile = workspace?.profiles.find((voice) => voice.id === profileId);
  const selectedProjectTakes =
    workspace?.takes.filter((item) => !projectId || item.projectId === projectId) ?? [];
  const take =
    selectedProjectTakes.find((item) => item.id === selectedTakeId) ?? selectedProjectTakes[0];

  const load = useCallback(async () => {
    const status = await cloud<{ configured: boolean; authenticated: boolean }>('status');
    if (!status.configured || !status.authenticated) {
      setWorkspace(null);
      setStatus(status.configured ? 'signin' : 'unavailable');
      return;
    }
    const next = await cloud<Workspace>('workspace');
    setWorkspace(next);
    setProfileId((current) =>
      next.profiles.some((voice) => voice.id === current) ? current : (next.profiles[0]?.id ?? ''),
    );
    setSpeechProvider((current) =>
      next.providers.speech.includes(current)
        ? current
        : (next.providers.speech[0] ?? 'elevenlabs'),
    );
    setTranscriptionProvider((current) =>
      next.providers.transcription.includes(current)
        ? current
        : (next.providers.transcription[0] ?? 'groq'),
    );
    setStatus('ready');
  }, []);

  const report = useCallback((failure: unknown) => {
    const code =
      failure instanceof CloudFailure
        ? failure.code
        : failure instanceof Error
          ? failure.message
          : '';
    setError(
      actionErrors[code] ??
        (code === 'studioCloud.invalidRecording' ? code : 'studioCloud.providerFailed'),
    );
    if (failure instanceof CloudFailure && failure.status === 401 && code !== 'cloud.invite') {
      setStatus('signin');
      setWorkspace(null);
    }
  }, []);

  useEffect(() => {
    void load().catch((error) => {
      setStatus('unavailable');
      report(error);
    });
  }, [load, report]);

  const run = async (task: () => Promise<unknown>, refresh = true) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
      if (refresh) await load();
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  };

  const errorNotice = error && (
    <p role="alert" className="text-sm text-destructive">
      {t(error)}
    </p>
  );
  if (status === 'loading') return <p role="status">{t('common.loading')}</p>;
  if (status === 'unavailable')
    return (
      <Block title={t('studioCloud.title')}>
        <p className="text-sm text-muted-foreground">{t('studioCloud.unconfigured')}</p>
        {errorNotice}
        <Button variant="outline" disabled={busy} onClick={() => void run(load, false)}>
          {t('backend.retry')}
        </Button>
      </Block>
    );
  if (status === 'signin' || !workspace)
    return (
      <Block title={t('studioCloud.title')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await cloud('signin', post({ code: invite }));
              setInvite('');
            });
          }}
          className="space-y-3"
        >
          <label className="block space-y-1 text-sm">
            {t('studioSetup.code')}
            <Input
              required
              maxLength={512}
              value={invite}
              autoComplete="one-time-code"
              onChange={(event) => setInvite(event.target.value)}
            />
          </label>
          {errorNotice}
          <Button disabled={busy} type="submit">
            {t('account.sign_in')}
          </Button>
        </form>
      </Block>
    );

  const money = (micros: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' }).format(
      micros / 1_000_000,
    );
  const cloneDisabled =
    !profile || profile.clone !== 'none' || !workspace.providers.clone || !shareWithProviders;
  const speechAllowed = workspace.providers.speech.includes(speechProvider);
  const canTranscribe = workspace.providers.transcription.includes(transcriptionProvider);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('studioCloud.title')}</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await cloud('signout', post({}));
              setRecording(null);
              setShareWithProviders(false);
              setOwnVoice(false);
              setScript('');
              setTranscript('');
            })
          }
        >
          {t('account.sign_out')}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground" role="status">
        {t('studioCloud.budget', {
          used: money(workspace.budget.reserved),
          limit: money(workspace.budget.limit),
        })}
        {' · '}
        {t('settings.usage')}{' '}
        {Object.values(workspace.budget.usage).reduce((total, row) => total + row.calls, 0)}
      </p>
      {errorNotice}
      <Block title={t('clone.reference_audio')}>
        <RecordingInput
          file={recording}
          disabled={busy}
          onFile={(file) => {
            setRecording(file);
            setOwnVoice(false);
          }}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!recording || !ownVoice) return;
            void run(async () => {
              const form = new FormData();
              form.set('audio', await prepareCloudRecording(recording));
              form.set('name', name);
              form.set('consent', 'own-voice');
              const profile = await cloud<Profile>('profile', { method: 'POST', body: form });
              setProfileId(profile.id);
              setName('');
              setOwnVoice(false);
            });
          }}
          className="space-y-3"
        >
          <label className="block space-y-1 text-sm">
            {t('clone.profile_name')}
            <Input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ownVoice}
              onChange={(event) => setOwnVoice(event.target.checked)}
            />
            {t('studioCloud.ownVoice')}
          </label>
          <Button disabled={busy || !recording || !ownVoice} type="submit">
            {t('clone.save')}
          </Button>
        </form>
      </Block>
      <Block title={t('clone.saved_profiles')}>
        <div className="flex flex-wrap gap-2">
          {workspace.profiles.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={profileId === item.id ? 'secondary' : 'outline'}
              aria-pressed={profileId === item.id}
              onClick={() => setProfileId(item.id)}
            >
              {item.name}
            </Button>
          ))}
        </div>
        {profile && (
          <div className="space-y-2">
            <audio
              controls
              className="w-full"
              src={apiUrl('audio', { kind: 'reference', id: profile.id })}
              aria-label={profile.name}
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={shareWithProviders}
                onChange={(event) => setShareWithProviders(event.target.checked)}
              />
              {t('studioCloud.providerConsent')}
            </label>
            <p className="text-xs text-muted-foreground">
              {t(
                profile.clone === 'verification'
                  ? 'studioCloud.verification'
                  : profile.clone === 'ready'
                    ? 'studioCloud.cloneReady'
                    : workspace.providers.clone
                      ? 'studioCloud.cloneNeeded'
                      : 'studioCloud.unconfigured',
              )}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={busy || cloneDisabled}
                onClick={() =>
                  void run(() => cloud('clone', post({ id: profile.id, confirm: true })))
                }
              >
                {t('nav.clone')} · ElevenLabs
              </Button>
              <Button
                variant="ghost"
                disabled={busy || profile.clone === 'pending'}
                onClick={() => setDeleteProfile(profile)}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        )}
        {!profile && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={shareWithProviders}
              onChange={(event) => setShareWithProviders(event.target.checked)}
            />
            {t('studioCloud.providerConsent')}
          </label>
        )}
      </Block>
      <Block title={t('projects.title')}>
        <div className="flex flex-wrap gap-2">
          {workspace.projects.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={projectId === item.id ? 'secondary' : 'outline'}
              aria-pressed={projectId === item.id}
              onClick={() => setProjectId(projectId === item.id ? '' : item.id)}
            >
              {item.name}
            </Button>
          ))}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const project = await cloud<Project>('project', post({ name: projectName }));
              setProjectId(project.id);
              setProjectName('');
            });
          }}
        >
          <Input
            aria-label={t('projects.title')}
            className="max-w-xs"
            required
            maxLength={80}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            {t('common.save')}
          </Button>
        </form>
      </Block>
      <Block title={t('sidebarTools.tts')}>
        <div className="flex flex-wrap gap-2">
          {workspace.providers.speech.map((engine) => (
            <Button
              key={engine}
              size="sm"
              variant={speechProvider === engine ? 'secondary' : 'outline'}
              aria-pressed={speechProvider === engine}
              onClick={() => setSpeechProvider(engine)}
            >
              {providerName[engine]}
            </Button>
          ))}
        </div>
        <Textarea
          rows={4}
          aria-label={t('sidebarTools.tts')}
          maxLength={1500}
          value={script}
          onChange={(event) => setScript(event.target.value)}
        />
        {!speechAllowed && (
          <p className="text-sm text-muted-foreground">{t('studioCloud.unconfigured')}</p>
        )}
        <Button
          disabled={
            busy ||
            !speechAllowed ||
            !script.trim() ||
            !shareWithProviders ||
            (speechProvider === 'elevenlabs' && profile?.clone !== 'ready')
          }
          onClick={() =>
            void run(async () => {
              const take = await cloud<Take>(
                'speech',
                post({
                  text: script,
                  provider: speechProvider,
                  profileId,
                  projectId,
                  confirm: true,
                }),
              );
              setSelectedTakeId(take.id);
            })
          }
        >
          {t('studioCloud.generate')}
        </Button>
        {take && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('studioCloud.synthetic')} · {providerName[take.provider]}
            </p>
            <audio
              className="w-full"
              controls
              src={apiUrl('audio', { id: take.id })}
              aria-label={t('common.play')}
            />
            <div className="flex flex-wrap gap-2">
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={apiUrl('audio', { id: take.id, download: '1' })}
              >
                {t('projects.export')} MP3
              </a>
              <Button variant="ghost" disabled={busy} onClick={() => setDeleteTake(take)}>
                {t('clone.history_delete')}
              </Button>
            </div>
          </div>
        )}
        {selectedProjectTakes.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {selectedProjectTakes.map((item) => (
              <Button
                key={item.id}
                size="xs"
                aria-pressed={item.id === take?.id}
                variant={item.id === take?.id ? 'secondary' : 'ghost'}
                onClick={() => setSelectedTakeId(item.id)}
              >
                {new Date(item.createdAt).toLocaleString(i18n.language)} ·{' '}
                {providerName[item.provider]}
              </Button>
            ))}
          </div>
        )}
      </Block>
      <Block title={t('nav.transcribe')}>
        <div className="flex flex-wrap gap-2">
          {workspace.providers.transcription.map((engine) => (
            <Button
              key={engine}
              size="sm"
              variant={transcriptionProvider === engine ? 'secondary' : 'outline'}
              aria-pressed={transcriptionProvider === engine}
              onClick={() => setTranscriptionProvider(engine)}
            >
              {providerName[engine]}
            </Button>
          ))}
        </div>
        {!canTranscribe && (
          <p className="text-sm text-muted-foreground">{t('studioCloud.unconfigured')}</p>
        )}
        <Button
          disabled={busy || !recording || !shareWithProviders || !canTranscribe}
          onClick={() =>
            void run(async () => {
              if (!recording) return;
              const form = new FormData();
              form.set('audio', await prepareCloudRecording(recording));
              form.set('provider', transcriptionProvider);
              form.set('confirm', 'true');
              const result = await cloud<{ text: string }>('transcribe', {
                method: 'POST',
                body: form,
              });
              setTranscript(result.text);
            })
          }
        >
          {t('nav.transcribe')}
        </Button>
        {transcript && <Textarea aria-label={t('nav.transcribe')} readOnly value={transcript} />}
      </Block>
      {deleteProfile && (
        <ConfirmDialog
          open
          title={t('clone.delete_profile')}
          description={t('clone.delete_profile_confirm', { name: deleteProfile.name })}
          confirmLabel={t('common.delete')}
          onOpenChange={(open) => {
            if (!open) setDeleteProfile(null);
          }}
          onConfirm={() => {
            const id = deleteProfile.id;
            setDeleteProfile(null);
            void run(() => cloud('profile', { method: 'DELETE' }, { id }));
          }}
        />
      )}
      {deleteTake && (
        <ConfirmDialog
          open
          title={t('clone.history_delete')}
          description={t('clone.delete_profile_confirm', {
            name: new Date(deleteTake.createdAt).toLocaleString(i18n.language),
          })}
          confirmLabel={t('common.delete')}
          onOpenChange={(open) => {
            if (!open) setDeleteTake(null);
          }}
          onConfirm={() => {
            const id = deleteTake.id;
            setDeleteTake(null);
            void run(() => cloud('audio', { method: 'DELETE' }, { id }));
          }}
        />
      )}
    </div>
  );
}
