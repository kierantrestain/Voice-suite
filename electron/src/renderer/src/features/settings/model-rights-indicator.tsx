import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangleIcon, CheckCircle2Icon, ShieldCheckIcon, ScaleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModelLicenseIcon } from './model-license-icon';
import {
  modelLicenseCategory,
  type ModelLicenseCategory,
  type ModelLicenseInfo,
} from './model-license-contract';

import { apiJson } from '@/lib/api/client';

export const COMMERCIAL_MODE_STORAGE_KEY = 'voicesuite.commercialMode';
const COMMERCIAL_MODE_EVENT = 'voicesuite:commercial-mode-changed';

// Fallback token lists used ONLY when authoritative backend `model_licenses.json`
// metadata (`info.license_category` / `info.license`) is unavailable.
const NONCOMMERCIAL_TOKENS = [
  'omnivoice',
  'k2-fsa/omnivoice',
  'f5-tts',
  'nllb-200',
  'outetts',
];

const COMMERCIAL_PERMITTED_TOKENS = [
  'kokoro',
  'hexgrad/kokoro',
  'kittentts',
  'kitten-tts',
  'kittenml/kitten-tts',
  'moss-tts-nano',
  'moss-tts-v15',
  'openmoss-team/moss-tts',
  'cosyvoice',
  'funaudiollm/fun-cosyvoice3',
  'voxcpm',
  'openbmb/voxcpm',
  'pockettts',
  'kyutai/pocket-tts',
  'dots-tts',
  'audiocpp-dots',
  'ming-tts',
  'gpt-sovits',
  'faster-whisper',
  'systran/faster-whisper',
  'whisperx',
  'whisper-cpp',
  'moonshine',
  'parakeet',
  'qwen3-tts',
];

export interface ClassifiedModelRights {
  category: ModelLicenseCategory;
  shortBadge: string;
  headline: string;
  spdx: string;
  isNonCommercial: boolean;
  isCommercialPermitted: boolean;
}

export function classifyModelRights(
  target?: string | null,
  info?: ModelLicenseInfo,
): ClassifiedModelRights {
  const normalized = (target ?? '').trim().toLowerCase();
  const declaredCategory = modelLicenseCategory(info?.license_category);
  const declaredLicense = (info?.license ?? '').trim();
  const declaredLower = declaredLicense.toLowerCase();

  // 1. Authoritative backend registry classification always takes precedence.
  if (declaredCategory === 'noncommercial') {
    return {
      category: 'noncommercial',
      shortBadge: 'Non-Commercial Weights (CC-BY-NC)',
      headline: 'Non-Commercial Weights (CC-BY-NC) — Do not use for commercial business outputs',
      spdx: declaredLicense || 'CC-BY-NC-4.0',
      isNonCommercial: true,
      isCommercialPermitted: false,
    };
  }
  if (declaredCategory === 'commercial') {
    return {
      category: 'commercial',
      shortBadge: 'Commercial Output Permitted (Apache-2.0 / MIT)',
      headline: 'Commercial Output Permitted (Apache-2.0 / MIT)',
      spdx: declaredLicense || 'Apache-2.0 / MIT',
      isNonCommercial: false,
      isCommercialPermitted: true,
    };
  }
  if (declaredCategory === 'conditions') {
    return {
      category: 'conditions',
      shortBadge: 'Commercial Use With Conditions',
      headline: 'Commercial Use Permitted With Licence Conditions — Review Terms',
      spdx: declaredLicense || 'OpenRAIL / Conditional',
      isNonCommercial: false,
      isCommercialPermitted: false,
    };
  }

  // 2. Fallback heuristic only when no authoritative category was provided.
  const matchesNonCommercial =
    /\bnc\b|-nc\b|non-?commercial/.test(declaredLower) ||
    NONCOMMERCIAL_TOKENS.some((token) => normalized.includes(token));

  if (matchesNonCommercial) {
    return {
      category: 'noncommercial',
      shortBadge: 'Non-Commercial Weights (CC-BY-NC)',
      headline: 'Non-Commercial Weights (CC-BY-NC) — Do not use for commercial business outputs',
      spdx: declaredLicense || 'CC-BY-NC-4.0',
      isNonCommercial: true,
      isCommercialPermitted: false,
    };
  }

  const matchesCommercial =
    declaredLower === 'apache-2.0' ||
    declaredLower === 'mit' ||
    declaredLower === 'cc-by-4.0' ||
    COMMERCIAL_PERMITTED_TOKENS.some((token) => normalized.includes(token));

  if (matchesCommercial) {
    return {
      category: 'commercial',
      shortBadge: 'Commercial Output Permitted (Apache-2.0 / MIT)',
      headline: 'Commercial Output Permitted (Apache-2.0 / MIT)',
      spdx: declaredLicense || 'Apache-2.0 / MIT',
      isNonCommercial: false,
      isCommercialPermitted: true,
    };
  }

  return {
    category: 'unknown',
    shortBadge: 'Review License Before Commercial Use',
    headline: 'Review License Before Commercial Use',
    spdx: declaredLicense || 'Upstream Model Terms',
    isNonCommercial: false,
    isCommercialPermitted: false,
  };
}

function readCommercialMode(): boolean {
  try {
    const raw = localStorage.getItem(COMMERCIAL_MODE_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

function writeCommercialModeCache(next: boolean): void {
  try {
    localStorage.setItem(COMMERCIAL_MODE_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Preserve in-memory session state when localStorage is restricted.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COMMERCIAL_MODE_EVENT, { detail: next }));
  }
}

export function useCommercialProductionMode(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readCommercialMode());

  useEffect(() => {
    let active = true;
    const sync = () => setEnabled(readCommercialMode());
    window.addEventListener(COMMERCIAL_MODE_EVENT, sync);
    window.addEventListener('storage', sync);
    void apiJson<{ enabled?: boolean }>('/api/settings/commercial-mode')
      .then((res) => {
        if (!active || typeof res?.enabled !== 'boolean') return;
        setEnabled(res.enabled);
        writeCommercialModeCache(res.enabled);
      })
      .catch(() => {
        // Offline / disconnected hosted mode keeps local preference.
      });
    return () => {
      active = false;
      window.removeEventListener(COMMERCIAL_MODE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = (next: boolean) => {
    setEnabled(next);
    writeCommercialModeCache(next);
    void apiJson<{ enabled?: boolean }>('/api/settings/commercial-mode', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
      .then((res) => {
        if (typeof res?.enabled === 'boolean' && res.enabled !== next) {
          setEnabled(res.enabled);
          writeCommercialModeCache(res.enabled);
        }
      })
      .catch(() => {
        // Offline / env-locked errors are reconciled on the next read.
      });
  };

  return [enabled, update];
}

export type EngineRightsSubject =
  | string
  | { id: string; display_name?: string; license_required?: boolean }
  | null
  | undefined;

export function ModelRightsIndicator({
  engine,
  repoId,
  info,
  compact = false,
  className,
}: {
  engine?: EngineRightsSubject;
  repoId?: string | null;
  info?: ModelLicenseInfo;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [commercialMode, setCommercialMode] = useCommercialProductionMode();
  const engineId = typeof engine === 'string' ? engine : engine?.id;
  const target = repoId || engineId || 'omnivoice';
  const rights = classifyModelRights(target, info);
  const guardConflict = commercialMode && rights.isNonCommercial;

  const shortLocalized =
    rights.category === 'commercial'
      ? t('modelLicense.shortCommercial')
      : rights.category === 'noncommercial'
        ? t('modelLicense.shortNoncommercial')
        : rights.category === 'conditions'
          ? t('modelLicense.shortConditions')
          : t('modelLicense.shortUnknown');

  if (compact) {
    return (
      <div
        className={cn('flex flex-wrap items-center gap-1.5 text-xs', className)}
        data-testid="model-rights-indicator"
      >
        <span
          className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-card/80 px-2.5 py-1 text-xs font-medium text-foreground/90"
          title={`App License: AGPL-3.0 (Commercial application use permitted) | Model Weights (${target}): ${rights.headline}`}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              rights.isNonCommercial
                ? 'bg-destructive'
                : rights.isCommercialPermitted
                  ? 'bg-success'
                  : 'bg-warning',
            )}
          />
          <span className="max-w-52 truncate">{rights.shortBadge}</span>
          <span className="sr-only">({shortLocalized})</span>
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={commercialMode}
          aria-label="Commercial Production Guard"
          onClick={() => setCommercialMode(!commercialMode)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            guardConflict
              ? 'border-destructive bg-destructive/15 text-destructive'
              : commercialMode
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
          )}
          title="Toggle Commercial Production Guard (warns when non-commercial weights are active)"
        >
          {guardConflict ? (
            <AlertTriangleIcon className="size-3 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <ScaleIcon className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span>
            {guardConflict
              ? 'Commercial Guard: Non-Commercial Model Active'
              : commercialMode
                ? 'Commercial Guard: ON'
                : 'Commercial Guard: OFF'}
          </span>
        </button>

        <span
          className="hidden items-center gap-1 rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground xl:inline-flex"
          title="All generated speech is watermarked via local AudioSeal 16-bit neural provenance (mark_synthetic)"
        >
          <ShieldCheckIcon className="size-3 shrink-0 text-success" aria-hidden="true" />
          <span>AudioSeal Provenance</span>
        </span>
      </div>
    );
  }

  return (
    <section
      aria-label="App and Model Licensing Overview"
      className={cn(
        'space-y-2.5 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <ScaleIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>App License vs. Model Weights License</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={commercialMode}
          onClick={() => setCommercialMode(!commercialMode)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            commercialMode
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border bg-background/70 text-muted-foreground hover:text-foreground',
          )}
        >
          <span>Commercial Production Guard: {commercialMode ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-background/60 p-2.5">
          <p className="font-semibold text-foreground">
            App License (AGPL-3.0 — Commercial application use permitted)
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Voice Suite software may be run for commercial and business workflows. Model weights are
            licensed separately by their respective upstream authors.
          </p>
        </div>

        <div
          className={cn(
            'rounded-md border p-2.5',
            rights.isNonCommercial
              ? 'border-destructive/40 bg-destructive/10'
              : rights.isCommercialPermitted
                ? 'border-success/40 bg-success/10'
                : 'border-warning/40 bg-warning/10',
          )}
        >
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            <ModelLicenseIcon category={rights.category} className="size-4 shrink-0" />
            <span>Model Weights License ({rights.spdx})</span>
          </p>
          <p className="mt-0.5 font-medium">{rights.headline}</p>
        </div>
      </div>

      {guardConflict && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/15 p-2.5 text-destructive"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Commercial Production Guard Warning</p>
            <p>
              Commercial Production Mode is enabled, but the active model ({target}) uses
              non-commercial weights ({rights.spdx}). Switch to a commercial-permitted engine (such
              as Kokoro, Piper, KittenTTS, or Faster-Whisper) before producing commercial outputs.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheckIcon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          <span>
            Synthetic Audio Provenance: Local 16-bit AudioSeal neural watermarking (mark_synthetic)
          </span>
        </span>
        <span>{t('modelLicense.disclaimer')}</span>
      </div>
    </section>
  );
}

export function AppVsModelLicenseNotice({
  repoId,
  info,
}: {
  repoId: string;
  info?: ModelLicenseInfo;
}) {
  const { t } = useTranslation();
  const [commercialMode, setCommercialMode] = useCommercialProductionMode();
  const rights = classifyModelRights(repoId, info);
  const guardConflict = commercialMode && rights.isNonCommercial;

  return (
    <section
      aria-label="App License versus Model Weights Rights"
      className="space-y-2.5 rounded-lg border border-border bg-muted/30 p-3.5 text-xs"
      data-testid="app-vs-model-license-notice"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ScaleIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>App License vs. Model Weights License</span>
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={commercialMode}
          onClick={() => setCommercialMode(!commercialMode)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            commercialMode
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border bg-background/80 text-muted-foreground hover:text-foreground',
          )}
        >
          <span>Commercial Production Guard: {commercialMode ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border/70 bg-background/80 p-2.5">
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            <span>App License (AGPL-3.0 — Commercial application use permitted)</span>
          </p>
          <p className="mt-1 text-muted-foreground">
            Voice Suite application code is licensed under AGPL-3.0. Large model weights are never
            auto-downloaded without showing disk space requirements, license terms, and progress.
          </p>
        </div>

        <div
          className={cn(
            'rounded-md border p-2.5',
            rights.isNonCommercial
              ? 'border-destructive/40 bg-destructive/10'
              : rights.isCommercialPermitted
                ? 'border-success/40 bg-success/10'
                : 'border-warning/40 bg-warning/10',
          )}
        >
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            <ModelLicenseIcon category={rights.category} className="size-3.5 shrink-0" />
            <span>Model Weights License ({rights.spdx})</span>
          </p>
          <p className="mt-1 font-medium text-foreground">{rights.headline}</p>
        </div>
      </div>

      {guardConflict && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/15 p-2.5 text-destructive"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Commercial Production Guard Alert</p>
            <p>
              This repository ({repoId}) carries non-commercial weights ({rights.spdx}). Do not use
              its generated outputs for commercial business production while Commercial Production
              Mode is active.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheckIcon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          <span>
            Synthetic Audio Provenance: Local 16-bit AudioSeal neural watermarking (mark_synthetic)
          </span>
        </span>
        <span>{t('modelLicense.disclaimer')}</span>
      </div>
    </section>
  );
}
