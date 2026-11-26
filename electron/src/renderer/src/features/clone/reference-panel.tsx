import { Link } from '@tanstack/react-router';
import { AgentFixButton } from '@/components/agent-fix-button';
import type { useReferenceTranscript } from '@/hooks/use-reference-transcript';
import { useReferenceAsrInstall } from '@/hooks/use-reference-asr-install';
import { InstallProgress } from '@/components/model-install-progress';
import { apiJson, profileAudioUrl } from '@/lib/api/client';
import { PortraitSearch } from './portrait-search';
import { ProfileImageEditor } from './profile-image-editor';
import { ProfilePhoto } from './profile-photo';
import { useForm } from '@tanstack/react-form';
import {
  ChevronDownIcon,
  DownloadIcon,
  FileAudioIcon,
  LoaderCircleIcon,
  MicIcon,
  PencilIcon,
  SaveIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WaveformPlayer } from '@/components/waveform-player';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useProfiles, useCreateCloneProfile } from '@/hooks/use-profiles';
import { setCloneSetting, useCloneSetting } from '@/lib/store/clone-settings';
import { selectCloneProfile, setReferenceFile, useReference } from '@/lib/store/reference';
import { setWorkspace } from '@/lib/store/workspace';
import { cn } from '@/lib/utils';
import { ReferenceSourcePicker, ReferenceUsageNote } from './reference-input';
import { FOCUS_TRANSCRIPT_EVENT } from './add-transcript-button';

interface SaveProfileFormProps {
  metadata?: { refText: string; instruct: string; language: string; seed: number | null };
  selectOnSave?: boolean;
  transcribing?: boolean;
  file: File;
  onDone: () => void;
}

export function SaveProfileForm({
  file,
  onDone,
  transcribing = false,
  metadata,
  selectOnSave = true,
}: SaveProfileFormProps) {
  const { t } = useTranslation();
  const refText = useCloneSetting('refText');
  const instruct = useCloneSetting('instruct');
  const language = useCloneSetting('language');
  const create = useCreateCloneProfile();
  const [image, setImage] = useState<File>();
  const [imageUrl, setImageUrl] = useState<string>();
  const [consentBasis, setConsentBasis] = useState<'own_voice' | 'speaker_permission'>('own_voice');
  const [consentConfirmed, setConsentConfirmed] = useState(true);
  useEffect(() => {
    if (!image) {
      setImageUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const nameId = useId();
  const errorId = useId();
  const consentCheckboxId = useId();

  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      if (transcribing || create.isPending || !consentConfirmed) return;
      try {
        const created = await create.mutateAsync({
          name: value.name.trim(),
          image,
          refAudio: file,
          refAudioName: file.name,
          refText: metadata?.refText ?? refText,
          instruct: metadata?.instruct ?? instruct,
          language: metadata?.language ?? language,
          seed: metadata?.seed,
        });
        if (created?.id) {
          await Promise.resolve(
            apiJson(`/profiles/${encodeURIComponent(created.id)}/attestation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ basis: consentBasis }),
            }),
          ).catch(() => {});
        }
        if (selectOnSave) {
          // A saved profile becomes the one identity source. Release the raw
          // upload and keep metadata returned by the server, including its
          // best-effort local ASR transcript when the draft was blank.
          selectCloneProfile(created);
        }
        onDone();
      } catch {
        /* The mutation displays the localized error; keep this draft. */
      }
    },
  });

  const required = ({ value }: { value: string }) =>
    value.trim() ? undefined : t('clone.profile_name_required');

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border/60 bg-muted/20 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div>
        <h3 className="text-base font-semibold">{t('clone.save_as_profile')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('profileIdentity.save_hint')}</p>
      </div>
      <div className="flex flex-col gap-4">
        <form.Field name="name" validators={{ onChange: required, onSubmit: required }}>
          {(field) => {
            const errors = field.state.meta.errors.filter(Boolean).map(String);
            const invalid = field.state.meta.isTouched && errors.length > 0;
            return (
              <div className="flex items-center gap-4">
                <ProfilePhoto
                  name={field.state.value}
                  imageUrl={imageUrl}
                  onFile={setImage}
                  label={t('profileIdentity.upload_image')}
                  className="size-16 text-lg"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Label htmlFor={nameId}>{t('clone.profile_name')}</Label>
                  <Input
                    id={nameId}
                    autoFocus
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder={`${t('clone.profile_name')}…`}
                    aria-label={t('clone.profile_name')}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorId : undefined}
                  />
                </div>
                {invalid ? (
                  <p
                    id={errorId}
                    className="text-[length:var(--text-label)] text-destructive"
                    role="alert"
                  >
                    {errors[0]}
                  </p>
                ) : null}
              </div>
            );
          }}
        </form.Field>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t('cloneFlow.photo_hint')}</span>
          {image && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setImage(undefined)}>
              <XIcon data-icon="inline-start" />
              {t('cloneFlow.remove_photo')}
            </Button>
          )}
        </div>
        <form.Subscribe selector={(state) => state.values.name}>
          {(name) => <PortraitSearch name={name} onSelect={setImage} />}
        </form.Subscribe>

        <div
          className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3.5 text-xs"
          data-testid="voice-cloning-consent-section"
        >
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t('voice_profile.consent_title')} — Voice Cloning Consent &amp; Rights</span>
            </p>
            <p className="text-muted-foreground">{t('voice_profile.attest_explain')}</p>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label={t('voice_profile.consent_title')}>
            <Button
              type="button"
              size="sm"
              variant={consentBasis === 'own_voice' ? 'secondary' : 'outline'}
              aria-pressed={consentBasis === 'own_voice'}
              onClick={() => setConsentBasis('own_voice')}
            >
              {t('voice_profile.attest_own_voice')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={consentBasis === 'speaker_permission' ? 'secondary' : 'outline'}
              aria-pressed={consentBasis === 'speaker_permission'}
              onClick={() => setConsentBasis('speaker_permission')}
            >
              {t('voice_profile.attest_permission')}
            </Button>
          </div>

          <label
            htmlFor={consentCheckboxId}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5"
          >
            <input
              id={consentCheckboxId}
              type="checkbox"
              checked={consentConfirmed}
              onChange={(event) => setConsentConfirmed(event.currentTarget.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="leading-snug text-foreground">
              I confirm that I have explicit rights and speaker authorization to clone this voice
              profile ({consentBasis === 'own_voice' ? t('voice_profile.attest_own_voice') : t('voice_profile.attest_permission')}).
            </span>
          </label>

          {!consentConfirmed && (
            <p role="alert" className="font-medium text-destructive">
              Explicit voice cloning consent and speaker rights confirmation is required before
              saving a voice profile.
            </p>
          )}

          <div className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
            <ShieldCheckIcon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            <span>
              Synthetic Audio Provenance: All cloned speech outputs carry local 16-bit AudioSeal
              neural provenance watermarking (mark_synthetic).
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="submit"
                size="default"
                disabled={isSubmitting || transcribing || !consentConfirmed}
              >
                {isSubmitting || transcribing ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <SaveIcon />
                )}
                {t(
                  transcribing
                    ? 'referenceAsr.busy'
                    : isSubmitting
                      ? 'preferences.loading'
                      : 'clone.save',
                )}
              </Button>
            )}
          </form.Subscribe>
          <Button type="button" variant="ghost" disabled={create.isPending} onClick={onDone}>
            {t(selectOnSave ? 'profileIdentity.use_once' : 'common.cancel')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ReferenceAsrInstall({
  model,
  onInstalled,
}: {
  model: NonNullable<ReturnType<typeof useReferenceTranscript>['recommended']>;
  onInstalled: () => void;
}) {
  const { t } = useTranslation();
  const install = useReferenceAsrInstall(model.repo_id, onInstalled);
  return (
    <div className="space-y-2">
      {!install.installing && install.view?.stage !== 'failed' && (
        <Button
          type="button"
          size="sm"
          disabled={install.busy}
          onClick={() => void install.start()}
        >
          <DownloadIcon />
          {t('referenceAsr.install', { label: model.label, size: model.size_gb })}
        </Button>
      )}
      {install.view && install.view.stage !== 'ready' && (
        <InstallProgress
          view={install.view}
          name={model.label}
          busy={install.busy}
          onCancel={() => void install.cancel()}
          onRetry={() => void install.retry()}
          onDismiss={install.view.stage === 'failed' ? install.dismiss : undefined}
        />
      )}
      {install.installing && (
        <p className="text-xs text-muted-foreground">
          {t('referenceAsr.installing', { label: model.label })}
        </p>
      )}
    </div>
  );
}

export function OptionalDetails({
  transcription,
}: {
  transcription?: ReturnType<typeof useReferenceTranscript>;
}) {
  const { t } = useTranslation();
  const refText = useCloneSetting('refText');
  const instruct = useCloneSetting('instruct');
  const [open, setOpen] = useState(() => Boolean(refText || instruct));
  useEffect(() => {
    if (
      refText ||
      transcription?.state === 'busy' ||
      transcription?.state === 'failed' ||
      transcription?.state === 'unavailable'
    )
      setOpen(true);
  }, [refText, transcription?.state]);
  const transcriptId = useId();
  const styleId = useId();
  useEffect(() => {
    const focus = () => {
      setOpen(true);
      // The box mounts with the opened panel, so focus it on the next frame.
      requestAnimationFrame(() => document.getElementById(transcriptId)?.focus());
    };
    window.addEventListener(FOCUS_TRANSCRIPT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_TRANSCRIPT_EVENT, focus);
  }, [transcriptId]);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[length:var(--text-label)] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {t('clone.optional_details')}
        <ChevronDownIcon
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-1 gap-3 px-3 pb-3 @min-[420px]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={transcriptId} className="text-[length:var(--text-label)]">
              {t('clone.transcript')}
            </Label>
            <Textarea
              id={transcriptId}
              rows={2}
              value={refText}
              className="min-h-16 resize-y"
              onChange={(event) => setCloneSetting('refText', event.target.value)}
              placeholder={t('clone.optional')}
            />
            <p
              role="status"
              className={cn(
                'text-[length:var(--text-caption)] text-muted-foreground',
                transcription?.state === 'failed' && 'text-destructive',
              )}
            >
              {t(
                transcription?.state === 'busy'
                  ? 'referenceAsr.busy'
                  : transcription?.state === 'failed'
                    ? 'transcriptions.failed'
                    : 'clone.transcript_hint',
              )}
            </p>
            {transcription?.state === 'unavailable' && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{t('asr_missing.message')}</p>
                {transcription.recommended && (
                  <ReferenceAsrInstall
                    model={transcription.recommended}
                    onInstalled={transcription.retry}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <AgentFixButton request="Restore local reference-audio transcription. Install and activate the best compatible ASR model through VoiceStudio, preserve the uploaded reference and manual transcript, then verify automatic transcription is ready to retry." />
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link to="/settings/models/$family" params={{ family: 'asr' }} />}
                  >
                    <MicIcon />
                    {t('engineSidebar.asr')} · {t('modelSettings.models')}
                  </Button>
                </div>
              </div>
            )}
            {(transcription?.state === 'failed' || transcription?.state === 'unavailable') && (
              <Button type="button" variant="ghost" size="sm" onClick={transcription.retry}>
                {t('referenceAsr.retry')}
              </Button>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={styleId} className="text-[length:var(--text-label)]">
              {t('clone.style')}
            </Label>
            <Input
              id={styleId}
              value={instruct}
              onChange={(event) => setCloneSetting('instruct', event.target.value)}
              placeholder={t('clone.style_placeholder')}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ReferencePanel({
  setup = false,
  hideSave = false,
  transcription,
}: {
  setup?: boolean;
  hideSave?: boolean;
  transcription?: ReturnType<typeof useReferenceTranscript>;
} = {}) {
  const { t } = useTranslation();
  const reference = useReference();
  const profiles = useProfiles();
  const selectedProfileId = useCloneSetting('selectedProfileId');
  const [saving, setSaving] = useState(false);

  const profile =
    !setup && selectedProfileId
      ? (profiles.data?.find((p) => p.id === selectedProfileId) ?? null)
      : null;
  const file = profile || setup ? null : reference.file;
  const hasReference = Boolean(profile || file);

  return (
    <Card size="sm" className="rounded-none bg-transparent py-0 ring-0">
      <CardContent className="flex flex-col gap-3 px-0 [container-type:inline-size]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {!hasReference && (
              <span className="text-[length:var(--text-label)] text-muted-foreground">
                {t('clone.reference_hint')}
              </span>
            )}
          </div>
        </div>

        {!hasReference ? <ReferenceSourcePicker /> : null}

        {file ? (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileAudioIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
              {reference.durationSeconds != null ? (
                <span className="text-[length:var(--text-caption)] text-muted-foreground tabular-nums">
                  {t('clone.duration_seconds', { seconds: reference.durationSeconds.toFixed(1) })}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setSaving(false);
                  void setReferenceFile(null);
                }}
              >
                <XIcon data-icon="inline-start" />
                {t('clone.clear')}
              </Button>
            </div>
            {reference.objectUrl ? (
              <WaveformPlayer
                src={reference.objectUrl}
                source="clone-reference"
                height={36}
                compact
              />
            ) : null}
            <ReferenceUsageNote durationSeconds={reference.durationSeconds} />
          </div>
        ) : null}

        {profile ? (
          <>
            <ProfileImageEditor profile={profile} />
            {profile.ref_audio_path && (
              <WaveformPlayer
                key={profile.audio_url ?? profile.id}
                src={profileAudioUrl(profile.id, profile.audio_url)}
                source="profile-reference"
                height={56}
              />
            )}
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setWorkspace({ editingProfileId: profile.id, panel: null })}
              >
                <PencilIcon data-icon="inline-start" />
                {t('clone.edit_voice')}
              </Button>
            </div>
          </>
        ) : null}

        {hasReference ? <OptionalDetails transcription={transcription} /> : null}

        {file && !hideSave ? (
          saving ? (
            <SaveProfileForm
              file={file}
              transcribing={transcription?.state === 'busy'}
              onDone={() => setSaving(false)}
            />
          ) : (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setSaving(true)}>
                <SaveIcon data-icon="inline-start" />
                {t('clone.save_as_profile')}
              </Button>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
