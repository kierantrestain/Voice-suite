import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { CloudIcon, MonitorIcon, ServerIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DESKTOP_OPEN_URL } from '@shared/desktop-pairing';
import { RELEASES_URL } from '@shared/app-config';
import { isBackendReachable, useBackendStatus } from '@/hooks/use-backend-status';
import { connectHostedStudio, hostedBackendApi } from '@/lib/hosted-backend';
import { brandIcon } from '@/lib/brand';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RemoteBackendSettings } from '@/features/settings/remote-backend-settings';

const CloudWorkspace = lazy(() =>
  import('@/features/hosted/cloud-workspace').then(({ CloudWorkspace }) => ({
    default: CloudWorkspace,
  })),
);
const BrowserWorkspace = lazy(() =>
  import('@/features/hosted/browser-workspace').then(({ BrowserWorkspace }) => ({
    default: BrowserWorkspace,
  })),
);
const MODE_KEY = 'voice-suite.mode';

function initialMode(): Mode | null {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'cloud' || saved === 'browser' || saved === 'native') return saved;
    return localStorage.getItem('voice-suite.backend-url') ? 'native' : null;
  } catch {
    return null;
  }
}

type Mode = 'cloud' | 'browser' | 'native';

export function HostedConnectionGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(initialMode);
  const choose = (next: Mode | null) => {
    try {
      if (next) localStorage.setItem(MODE_KEY, next);
      else localStorage.removeItem(MODE_KEY);
    } catch {
      // The selected mode can still be used for this tab.
    }
    setMode(next);
  };
  const change = (
    <Button variant="ghost" size="sm" onClick={() => choose(null)}>
      {t('studioCloud.mode')}
    </Button>
  );
  if (mode === 'native') return <NativeConnection change={change}>{children}</NativeConnection>;
  return (
    <main className="min-h-dvh overflow-y-auto bg-background px-5 py-8 text-foreground">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src={brandIcon} alt="" className="size-8" />
            <span className="font-medium">{t('app.name')}</span>
          </div>
          {mode && change}
        </header>
        <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
          {mode === 'cloud' ? (
            <CloudWorkspace />
          ) : mode === 'browser' ? (
            <BrowserWorkspace />
          ) : (
            <section className="space-y-4">
              <h1 className="text-xl font-semibold">{t('studioCloud.mode')}</h1>
              <div className="grid gap-2 sm:grid-cols-3">
                <Button onClick={() => choose('cloud')}>
                  <CloudIcon />
                  {t('studioCloud.title')}
                </Button>
                <Button variant="outline" onClick={() => choose('browser')}>
                  <MonitorIcon />
                  {t('studioCloud.browser')}
                </Button>
                <Button variant="outline" onClick={() => choose('native')}>
                  <ServerIcon />
                  {t('studioSetup.app')}
                </Button>
              </div>
            </section>
          )}
        </Suspense>
      </div>
    </main>
  );
}

function NativeConnection({ children, change }: { children: ReactNode; change: ReactNode }) {
  const { t } = useTranslation();
  const status = useBackendStatus();
  const [pending, setPending] = useState<'desktop' | 'shared' | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  if (isBackendReachable(status.stage))
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
          <span className="text-xs text-muted-foreground">{t('studioSetup.connect')}</span>
          <div className="flex items-center gap-2">
            {change}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void hostedBackendApi.useLocal().then(() => window.location.reload());
              }}
            >
              {t('hosted.disconnect')}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );

  const connect = async (kind: 'desktop' | 'shared', event?: FormEvent) => {
    event?.preventDefault();
    if (pending) return;
    setPending(kind);
    setMessage('');
    try {
      await connectHostedStudio(kind, code);
      window.location.reload();
    } catch (error) {
      const code = (error as { status?: number }).status;
      setMessage(
        kind === 'desktop'
          ? t(code === 403 ? 'studioSetup.declined' : 'studioSetup.desktopUnavailable')
          : t(code === 401 ? 'studioSetup.codeExpired' : 'studioSetup.sharedUnavailable'),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="min-h-dvh overflow-y-auto bg-background px-5 py-12 text-foreground">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="space-y-3">
          <div className="flex items-center justify-between">
            <img src={brandIcon} alt="" className="size-10" />
            {change}
          </div>
          <h1 className="text-2xl font-semibold">{t('studioSetup.connect')}</h1>
          {status.baseUrl && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(
                status.stage === 'attaching' || status.stage === 'starting'
                  ? 'hosted.bar_checking'
                  : status.message === 'auth'
                    ? 'studioSetup.reconnect'
                    : 'hosted.bar_unreachable',
              )}
            </p>
          )}
        </header>
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <MonitorIcon aria-hidden="true" className="size-5 text-primary" />
          <h2 className="font-medium">{t('studioSetup.computer')}</h2>
          <p className="text-sm text-muted-foreground">{t('studioSetup.approve')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void connect('desktop')} disabled={Boolean(pending)}>
              {t(pending === 'desktop' ? 'studioSetup.approve' : 'studioSetup.connect')}
            </Button>
            <a href={DESKTOP_OPEN_URL} className={buttonVariants({ variant: 'outline' })}>
              {t('studioSetup.openDesktop')}
            </a>
          </div>
          <a
            href={`${RELEASES_URL}/latest`}
            className="inline-block text-sm text-primary underline"
          >
            {t('studioSetup.downloadDesktop')}
          </a>
        </section>
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <ServerIcon aria-hidden="true" className="size-5 text-primary" />
          <h2 className="font-medium">{t('studioSetup.shared')}</h2>
          {showCode ? (
            <form onSubmit={(event) => void connect('shared', event)} className="space-y-3">
              <label className="block space-y-1 text-sm">
                {t('studioSetup.code')}
                <Input
                  autoComplete="one-time-code"
                  maxLength={512}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <Button disabled={Boolean(pending)} type="submit">
                {t(pending === 'shared' ? 'preferences.loading' : 'studioSetup.connect')}
              </Button>
            </form>
          ) : (
            <Button variant="outline" onClick={() => setShowCode(true)}>
              {t('studioSetup.code')}
            </Button>
          )}
        </section>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t('dub.advanced')}</summary>
          <div className="mt-4">
            <RemoteBackendSettings />
          </div>
        </details>
      </div>
    </main>
  );
}
