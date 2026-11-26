import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiJson } from '@/lib/api/client';
import { brandIcon } from '@/lib/brand';
import { rememberSetupStarted, setupWasCompleted, setupWasStarted } from '@/lib/setup-progress';
import type { SetupStatus } from './setup-wizard';
import { getBridge } from './bridge';
import { useBackendStatus } from '@/hooks/use-backend-status';

// Only a first run renders the wizard, so its settings panels load on demand
// instead of in every launch's startup bundle (#3924).
const SetupWizard = lazy(() =>
  import('./setup-wizard').then((module) => ({ default: module.SetupWizard })),
);

const StudioFirstRun = lazy(() =>
  import('./studio-first-run').then((module) => ({ default: module.StudioFirstRun })),
);

export function SetupGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const backend = useBackendStatus();
  const [advanced, setAdvanced] = useState(false);
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [setupInProgress, setSetupInProgress] = useState(setupWasStarted);
  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: ({ signal }) => apiJson<SetupStatus>('/setup/status', { signal }),
    retry: 2,
  });
  useEffect(() => {
    if (needed !== null || !status.data) return;
    const completed = setupWasCompleted();
    if (!setupInProgress && !completed) {
      // This marker belongs to the Electron shell. A populated shared model
      // cache does not prove that this installation has completed permissions,
      // privacy, media-engine, and dictation setup.
      rememberSetupStarted(true);
      setSetupInProgress(true);
    }
    setNeeded(!completed);
  }, [needed, setupInProgress, status.data]);
  if (needed === false || backend.remote) return <>{children}</>;
  const loading = (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-2.5">
        <img src={brandIcon} alt="" className="size-9" />
        <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
      </div>
      <Button variant="ghost" disabled={!status.isError} onClick={() => void status.refetch()}>
        {t(status.isError ? 'backend.retry' : 'preferences.loading')}
      </Button>
    </div>
  );
  if (needed === null) return loading;
  const finish = () => {
    setSetupInProgress(false);
    setNeeded(false);
  };
  if (getBridge() && !advanced)
    return (
      <Suspense fallback={loading}>
        <StudioFirstRun onComplete={finish} onAdvanced={() => setAdvanced(true)} />
      </Suspense>
    );
  return (
    <Suspense fallback={loading}>
      <SetupWizard onComplete={finish} />
    </Suspense>
  );
}
