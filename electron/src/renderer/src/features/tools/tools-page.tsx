import {
  ActivityIcon,
  AudioLinesIcon,
  AudioWaveformIcon,
  GitCompareArrowsIcon,
  ScissorsIcon,
  SparklesIcon,
  TargetIcon,
  UploadIcon,
  WrenchIcon,
} from 'lucide-react';
import { SecondarySidebar } from '@/components/workspace-sidebar';
import { ConvertVoice } from './convert-voice';
import { SoundEffects } from './sound-effects';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { CompareVoices } from './compare-voices';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PipelineFailure } from '@/components/pipeline-failure';
import { DisabledReason, firstReason } from '@/components/disabled-reason';
import { SaveAudioButton } from '@/components/save-audio-button';
import { WaveformPlayer } from '@/components/waveform-player';
import { apiFetch, apiJson, describeError } from '@/lib/api/client';
import { useLatestOutput } from '@/lib/store/output';
import { LanguagePicker } from '@/features/clone/language-picker';
import { LANG_CODES } from '@shared/utils/languages';
const options = LANG_CODES.map((item) => item.label);
const tools = [
  {
    id: 'direction',
    label: 'directorial_ai',
    description: 'directorial_desc',
    action: 'parse',
    icon: SparklesIcon,
  },
  {
    id: 'rate-fit',
    label: 'speech_rate_fit',
    description: 'speech_rate_desc',
    action: 'fit',
    icon: TargetIcon,
  },
  {
    id: 'probe',
    label: 'probe_file',
    description: 'probe_desc',
    action: 'probe',
    icon: ActivityIcon,
  },
] as const;
type Tool = (typeof tools)[number];
export function ToolsPage() {
  const { t } = useTranslation();
  const [comparing, setComparing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [effects, setEffects] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [selected, setSelected] = useState<Tool>(tools[0]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">{t('tools.title')}</h1>
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1 @max-[40rem]:flex-col">
        <SecondarySidebar
          title={t('tools.title')}
          icon={WrenchIcon}
          variant="navigation"
          className="space-y-1"
        >
          {tools.map((tool) => (
            <Button
              key={tool.id}
              className="h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 font-normal [&_svg]:text-muted-foreground"
              variant={
                !effects && !converting && !comparing && !finishing && selected.id === tool.id
                  ? 'secondary'
                  : 'ghost'
              }
              aria-pressed={
                !effects && !converting && !comparing && !finishing && selected.id === tool.id
              }
              onClick={() => {
                setEffects(false);
                setConverting(false);
                setComparing(false);
                setFinishing(false);
                setSelected(tool);
              }}
            >
              <tool.icon />
              {t('tools.' + tool.label)}
            </Button>
          ))}
          <Button
            className="h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 font-normal [&_svg]:text-muted-foreground"
            variant={!effects && !converting && !comparing && finishing ? 'secondary' : 'ghost'}
            aria-pressed={!effects && !converting && !comparing && finishing}
            onClick={() => {
              setEffects(false);
              setConverting(false);
              setComparing(false);
              setFinishing(true);
            }}
          >
            <ScissorsIcon />
            Audio Finishing &amp; Trim
          </Button>
          <Button
            className="h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 font-normal [&_svg]:text-muted-foreground"
            variant={!effects && !converting && comparing ? 'secondary' : 'ghost'}
            aria-pressed={!effects && !converting && comparing}
            onClick={() => {
              setEffects(false);
              setConverting(false);
              setFinishing(false);
              setComparing(true);
            }}
          >
            <GitCompareArrowsIcon />
            {t('compare.title')}
          </Button>
          <Button
            className="h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 font-normal [&_svg]:text-muted-foreground"
            variant={!effects && converting ? 'secondary' : 'ghost'}
            aria-pressed={!effects && converting}
            onClick={() => {
              setEffects(false);
              setComparing(false);
              setFinishing(false);
              setConverting(true);
            }}
          >
            <AudioWaveformIcon />
            {t('convert.convert')}
          </Button>
          <Button
            className="h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 font-normal [&_svg]:text-muted-foreground"
            variant={effects ? 'secondary' : 'ghost'}
            aria-pressed={effects}
            onClick={() => {
              setComparing(false);
              setConverting(false);
              setFinishing(false);
              setEffects(true);
            }}
          >
            <AudioLinesIcon />
            {t('sfx.title')}
          </Button>
        </SecondarySidebar>
        <section className="min-w-0 flex-1 overflow-y-auto px-6 py-8">
          {effects ? (
            <SoundEffects />
          ) : converting ? (
            <ConvertVoice />
          ) : comparing ? (
            <CompareVoices />
          ) : finishing ? (
            <AudioFinishingTool />
          ) : (
            <ToolForm key={selected.id} tool={selected} />
          )}
        </section>
      </div>
    </div>
  );
}

function AudioFinishingTool() {
  const { t } = useTranslation();
  const latestOutput = useLatestOutput();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [finishedUrl, setFinishedUrl] = useState<string>('');
  const [abMode, setAbMode] = useState<'A' | 'B'>('A');
  const [startSeconds, setStartSeconds] = useState<string>('0');
  const [endSeconds, setEndSeconds] = useState<string>('');
  const [fadeMs, setFadeMs] = useState<string>('15');
  const [targetDbfs, setTargetDbfs] = useState<string>('-2.0');
  const [trimSilence, setTrimSilence] = useState<boolean>(true);
  const [silenceThresholdDb, setSilenceThresholdDb] = useState<string>('-42');
  const [highpassHz, setHighpassHz] = useState<string>('80');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setSourceUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      if (finishedUrl) URL.revokeObjectURL(finishedUrl);
    };
  }, [finishedUrl]);

  const loadFile = (next: File) => {
    setError(null);
    if (finishedUrl) {
      URL.revokeObjectURL(finishedUrl);
      setFinishedUrl('');
    }
    setAbMode('A');
    setFile(next);
  };

  const loadLatestTake = () => {
    if (!latestOutput.result?.blob) return;
    const takeFile = new File(
      [latestOutput.result.blob],
      `voicesuite-${latestOutput.result.id ?? 'take'}.wav`,
      { type: 'audio/wav' },
    );
    loadFile(takeFile);
  };

  const runProcess = async (mode: 'finish' | 'trim') => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      let currentBlob: Blob = file;
      const startVal = Number(startSeconds);
      const endVal = endSeconds.trim() ? Number(endSeconds) : null;
      const fadeVal = Number(fadeMs);
      const hasTrim =
        mode === 'trim' ||
        (Number.isFinite(startVal) && startVal > 0) ||
        (endVal !== null && Number.isFinite(endVal) && endVal > 0);

      if (hasTrim) {
        const trimForm = new FormData();
        trimForm.append('audio', currentBlob, file.name || 'audio.wav');
        trimForm.append('start_seconds', String(Number.isFinite(startVal) ? Math.max(0, startVal) : 0));
        if (endVal !== null && Number.isFinite(endVal) && endVal > 0) {
          trimForm.append('end_seconds', String(endVal));
        }
        trimForm.append('fade_ms', String(Number.isFinite(fadeVal) ? Math.max(0, fadeVal) : 15));
        const trimRes = await apiFetch('/tools/trim-audio', {
          method: 'POST',
          body: trimForm,
        });
        currentBlob = await trimRes.blob();
      }

      if (mode === 'finish') {
        const finishForm = new FormData();
        finishForm.append('audio', currentBlob, file.name || 'audio.wav');
        finishForm.append(
          'target_dbfs',
          String(Number.isFinite(Number(targetDbfs)) ? Number(targetDbfs) : -2.0),
        );
        finishForm.append('trim_silence', String(trimSilence));
        finishForm.append(
          'silence_threshold_db',
          String(Number.isFinite(Number(silenceThresholdDb)) ? Number(silenceThresholdDb) : -42.0),
        );
        finishForm.append(
          'denoise_highpass_hz',
          String(Number.isFinite(Number(highpassHz)) ? Number(highpassHz) : 80.0),
        );
        const finishRes = await apiFetch('/tools/finish-audio', {
          method: 'POST',
          body: finishForm,
        });
        currentBlob = await finishRes.blob();
      }

      const nextUrl = URL.createObjectURL(currentBlob);
      if (finishedUrl) URL.revokeObjectURL(finishedUrl);
      setFinishedUrl(nextUrl);
      setAbMode('B');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestedName = file
    ? file.name.replace(/\.wav$/i, '') + '-finished.wav'
    : 'voicesuite-finished.wav';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-medium">Audio Finishing &amp; Waveform Editor</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspect waveforms, trim start/end points with smooth edge fades, remove low-end rumble and
          edge silence, normalize loudness, and A/B compare original vs. finished audio.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,audio/wav"
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) loadFile(chosen);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon />
          {file ? file.name : t('clone.upload_audio')}
        </Button>
        {latestOutput.result?.blob && (
          <Button type="button" variant="ghost" disabled={busy} onClick={loadLatestTake}>
            Load Latest Take
          </Button>
        )}
      </div>

      {sourceUrl && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={abMode === 'A' ? 'secondary' : 'ghost'}
                aria-pressed={abMode === 'A'}
                onClick={() => setAbMode('A')}
              >
                Original (A)
              </Button>
              <Button
                type="button"
                size="sm"
                variant={abMode === 'B' ? 'secondary' : 'ghost'}
                aria-pressed={abMode === 'B'}
                disabled={!finishedUrl}
                onClick={() => setAbMode('B')}
              >
                Finished (B)
              </Button>
            </div>
            {finishedUrl && (
              <SaveAudioButton url={finishedUrl} suggestedName={suggestedName} />
            )}
          </div>
          <WaveformPlayer
            key={abMode === 'B' && finishedUrl ? finishedUrl : sourceUrl}
            src={abMode === 'B' && finishedUrl ? finishedUrl : sourceUrl}
            source="tools-finishing"
            height={52}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border/50 p-4 sm:grid-cols-3">
        <label className="block space-y-1.5 text-sm">
          <span>Trim Start (s)</span>
          <Input
            type="number"
            min="0"
            step="0.05"
            value={startSeconds}
            disabled={busy}
            onChange={(e) => setStartSeconds(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>Trim End (s, optional)</span>
          <Input
            type="number"
            min="0"
            step="0.05"
            placeholder="End of clip"
            value={endSeconds}
            disabled={busy}
            onChange={(e) => setEndSeconds(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>Edge Fade (ms)</span>
          <Input
            type="number"
            min="0"
            max="1000"
            step="5"
            value={fadeMs}
            disabled={busy}
            onChange={(e) => setFadeMs(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-4 rounded-xl border border-border/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Trim Leading &amp; Trailing Silence</p>
            <p className="text-xs text-muted-foreground">
              Retains 50 ms natural speech padding around voiced audio
            </p>
          </div>
          <Switch
            checked={trimSilence}
            disabled={busy}
            onCheckedChange={(checked) => setTrimSilence(Boolean(checked))}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block space-y-1.5 text-sm">
            <span>Target Peak (dBFS)</span>
            <Input
              type="number"
              min="-24"
              max="-0.5"
              step="0.5"
              value={targetDbfs}
              disabled={busy}
              onChange={(e) => setTargetDbfs(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Silence Floor (dBFS)</span>
            <Input
              type="number"
              min="-70"
              max="-15"
              step="1"
              value={silenceThresholdDb}
              disabled={busy || !trimSilence}
              onChange={(e) => setSilenceThresholdDb(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>High-Pass Filter (Hz)</span>
            <Input
              type="number"
              min="0"
              max="400"
              step="10"
              value={highpassHz}
              disabled={busy}
              onChange={(e) => setHighpassHz(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={!file || busy}
          onClick={() => void runProcess('finish')}
        >
          {busy ? t('common.loading') : 'Apply Audio Finishing'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!file || busy}
          onClick={() => void runProcess('trim')}
        >
          Trim Only
        </Button>
      </div>

      {error && <PipelineFailure fallback={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
function ToolForm({ tool }: { tool: Tool }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [slot, setSlot] = useState('2');
  const [language, setLanguage] = useState('English');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const valid =
    Boolean(text.trim()) &&
    (tool.id !== 'rate-fit' || (Number.isFinite(Number(slot)) && Number(slot) > 0));
  const run = async () => {
    if (request.current || !valid) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body =
        tool.id === 'probe'
          ? { path: text.trim() }
          : tool.id === 'direction'
            ? { text }
            : {
                text,
                slot_seconds: Number(slot),
                target_lang: LANG_CODES.find((item) => item.label === language)?.code,
              };
      const data = await apiJson<Record<string, unknown>>('/tools/' + tool.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResult(data);
    } catch (error) {
      if (!controller.signal.aborted) setError(describeError(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      request.current = null;
    }
  };
  return (
    <form
      className="mx-auto max-w-3xl space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void run();
      }}
    >
      <div>
        <h2 className="text-lg font-medium">{t('tools.' + tool.label)}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('tools.' + tool.description)}
        </p>
      </div>
      <label className="block space-y-2 text-sm">
        <span>
          {t(
            tool.id === 'probe'
              ? 'tools.absolute_path'
              : tool.id === 'direction'
                ? 'tools.direction'
                : 'tools.translated_line',
          )}
        </span>
        {tool.id === 'probe' ? (
          <Input
            disabled={busy}
            placeholder={t('tools.probe_placeholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
          />
        ) : (
          <textarea
            dir="auto"
            className="min-h-36 w-full resize-y rounded-lg border border-input bg-transparent p-3 leading-7 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy}
            placeholder={t(
              tool.id === 'direction'
                ? 'tools.placeholder_direction'
                : 'tools.placeholder_rate_fit',
            )}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
          />
        )}
      </label>
      {tool.id === 'rate-fit' && (
        // One row of equal-height fields with their labels on the same baseline.
        <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,16rem)] items-start gap-4 max-sm:grid-cols-1">
          <label className="block space-y-2 text-sm">
            <span className="block">{t('tools.slot_seconds')}</span>
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={slot}
              disabled={busy}
              onChange={(event) => {
                setSlot(event.target.value);
                setResult(null);
              }}
            />
          </label>
          <div role="group" aria-label={t('tools.target_language')} className="space-y-2 text-sm">
            <p aria-hidden="true">{t('tools.target_language')}</p>
            <LanguagePicker
              value={language}
              options={options}
              disabled={busy}
              onValueChange={(value) => {
                setLanguage(value);
                setResult(null);
              }}
            />
          </div>
        </div>
      )}
      <DisabledReason
        reason={firstReason([
          [
            !text.trim(),
            t(
              tool.id === 'probe' ? 'disabledReason.path_required' : 'disabledReason.text_required',
            ),
          ],
          [!valid, t('disabledReason.slot_required')],
        ])}
      >
        {(describedBy) => (
          <Button type="submit" disabled={busy || !valid} aria-describedby={describedBy}>
            {t(busy ? 'common.loading' : 'tools.' + tool.action)}
          </Button>
        )}
      </DisabledReason>
      {error && <PipelineFailure fallback={error} onDismiss={() => setError(null)} />}
      {tool.id === 'probe' && (
        <Link to="/settings/media" className="block text-sm text-primary hover:underline">
          {t('settings.audio_tools')}
        </Link>
      )}
      {result && (
        <div
          role="region"
          aria-label={t('tools.result')}
          className="space-y-4 rounded-xl border border-border/50 p-4"
        >
          {Boolean(result.error) && <PipelineFailure fallback={describeError(result.error)} />}
          {tool.id === 'probe' ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <>
              <dl className="space-y-3 text-sm">
                {(tool.id === 'direction'
                  ? [
                      ['method', 'method'],
                      ['instruct_prompt', 'tts_instruct'],
                      ['translate_hint', 'translate_hint'],
                      ['rate_bias', 'rate_bias'],
                    ]
                  : [
                      ['method', 'method'],
                      ['ratio', 'ratio'],
                      ['attempts', 'attempts'],
                      ['text', 'result'],
                    ]
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">{t('tools.' + label)}</dt>
                    <dd className="mt-1 whitespace-pre-wrap">
                      {result[key] == null ? '?' : String(result[key])}
                    </dd>
                  </div>
                ))}
              </dl>
              {tool.id === 'direction' &&
                ['tokens', 'taxonomy'].map((key) => (
                  <details key={key} className="text-xs">
                    <summary className="cursor-pointer">{t('tools.' + key)}</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(result[key], null, 2)}
                    </pre>
                  </details>
                ))}
            </>
          )}
        </div>
      )}
    </form>
  );
}
